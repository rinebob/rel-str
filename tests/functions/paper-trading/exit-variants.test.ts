/**
 * @topic #553 — Paper Trading Infra (task #563)
 *
 * Unit tests for the exit-variant registry: key parsing and the pure
 * per-family evaluators (initial-stop, trailing-stop, time-stop,
 * limit-stddev stub). Evaluators are direction-aware: for a SHORT position
 * an adverse move is a rising mark; for LONG it is a falling mark.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { TradeSide } from '../../../shared/common';
import { OptionQuoteSource } from '../../../shared/options-common';
import {
  PaperTradeSource,
  PaperTradeStatus,
  PaperTradingKind,
  type PaperTrade,
  type VariantRun,
} from '../../../shared/paper-trading-contracts';
import {
  evaluateVariant,
  EXIT_VARIANT_CONFIGS,
  isIndependentCloser,
  isTerminalVariantKey,
  parseVariantKey,
  variantLevel,
  type VariantEvalCtx,
} from '../../../functions/src/paper-trading/exits/registry';

function makeTrade(overrides: Partial<PaperTrade> = {}): PaperTrade {
  return {
    kind: PaperTradingKind.TRADE,
    id: 't-1',
    status: PaperTradeStatus.OPEN,
    source: PaperTradeSource.MANUAL,
    symbol: 'QQQM',
    expression: 'CSP',
    governingVariant: 'initial-stop-10',
    order: { side: TradeSide.SHORT, type: 'MARKET', quantity: 1 },
    fills: [
      {
        fillId: 'entry-t-1',
        role: 'entry',
        date: '2026-09-01',
        price: 2.0,
        quantity: 1,
        quoteSource: OptionQuoteSource.RH_MCP,
      },
    ],
    legs: [],
    marks: {},
    variantRuns: [],
    variantKeys: [],
    realizedPnl: 0,
    unrealizedPnl: 0,
    createdAt: '2026-09-01T12:00:00Z',
    updatedAt: '2026-09-01T12:00:00Z',
    ...overrides,
  };
}

function makeRun(variantKey: string, governing = true): VariantRun {
  return { variantKey, governing, state: 'ACTIVE', workingState: {} };
}

function ctx(overrides: Partial<VariantEvalCtx> = {}): VariantEvalCtx {
  return {
    trade: makeTrade(),
    mark: 2.0,
    date: '2026-09-10',
    daysHeld: 9,
    run: makeRun('initial-stop-10'),
    ...overrides,
  };
}

describe('parseVariantKey', () => {
  it('parses initial-stop percent', () => {
    const v = parseVariantKey('initial-stop-10');
    assert.ok(v);
    assert.equal(v.family, 'initial-stop');
    assert.deepEqual(v.params, { stopPct: 0.1 });
  });

  it('parses trailing percent', () => {
    const v = parseVariantKey('trailing-20');
    assert.ok(v);
    assert.equal(v.family, 'trailing-stop');
    assert.deepEqual(v.params, { stopPct: 0.2 });
  });

  it('parses time-stop days', () => {
    const v = parseVariantKey('time-30d');
    assert.ok(v);
    assert.equal(v.family, 'time-stop');
    assert.deepEqual(v.params, { days: 30 });
  });

  it('parses limit-stddev sigma', () => {
    const v = parseVariantKey('limit-sd1');
    assert.ok(v);
    assert.equal(v.family, 'limit-stddev');
    assert.deepEqual(v.params, { sigma: 1 });
  });

  it('returns null for the none sentinel and unknown keys', () => {
    assert.equal(parseVariantKey('none'), null);
    assert.equal(parseVariantKey(''), null);
    assert.equal(parseVariantKey('whatever-9'), null);
  });

  it('rejects malformed family params', () => {
    assert.equal(parseVariantKey('initial-stop-x'), null);
    assert.equal(parseVariantKey('trailing-'), null);
    assert.equal(parseVariantKey('time-d'), null);
    assert.equal(parseVariantKey('limit-sdx'), null);
  });
});

describe('isTerminalVariantKey', () => {
  it('trailing-* keys are governing-eligible', () => {
    assert.equal(isTerminalVariantKey('trailing-8'), true);
    assert.equal(isTerminalVariantKey('trailing-15'), true);
    assert.equal(isTerminalVariantKey('trailing-2.5'), true);
  });

  it('non-terminal families and sentinels are not governing-eligible', () => {
    assert.equal(isTerminalVariantKey('initial-stop-10'), false);
    assert.equal(isTerminalVariantKey('time-30d'), false);
    assert.equal(isTerminalVariantKey('limit-sd1'), false);
    assert.equal(isTerminalVariantKey('none'), false);
    assert.equal(isTerminalVariantKey('trailing'), false);
    assert.equal(isTerminalVariantKey('bogus'), false);
  });

  it('degenerate trailing params are not governing-eligible', () => {
    // trailing-0 fires on the first mark; trailing-100+ never realistically
    // triggers — both parse but would corrupt a lifecycle.
    assert.equal(isTerminalVariantKey('trailing-0'), false);
    assert.equal(isTerminalVariantKey('trailing-100'), false);
  });
});

describe('initial-stop', () => {
  it('SHORT: triggers when mark rises above entry × (1 + stopPct)', () => {
    // entry 2.0, stop 10% → breach at mark >= 2.2
    const hit = evaluateVariant(ctx({ mark: 2.2 }));
    assert.equal(hit.trigger, true);
    const miss = evaluateVariant(ctx({ mark: 2.19 }));
    assert.equal(miss.trigger, false);
  });

  it('LONG: triggers when mark falls below entry × (1 − stopPct)', () => {
    const trade = makeTrade({
      order: { side: TradeSide.LONG, type: 'MARKET', quantity: 1 },
    });
    const hit = evaluateVariant(ctx({ trade, mark: 1.8 }));
    assert.equal(hit.trigger, true);
    const miss = evaluateVariant(ctx({ trade, mark: 1.81 }));
    assert.equal(miss.trigger, false);
  });
});

describe('trailing-stop', () => {
  it('SHORT: tracks low-water mark and triggers on rebound', () => {
    // entry 2.0, mark fell to 1.0 (favorable) — low water updates, no breach
    const update = evaluateVariant(ctx({
      run: makeRun('trailing-20'),
      mark: 1.0,
    }));
    assert.equal(update.trigger, false);
    assert.equal(update.workingState?.lowWaterMark, 1.0);

    // later: mark rebounds 20% off the 1.0 low → breach at 1.2
    const run = { ...makeRun('trailing-20'), workingState: { lowWaterMark: 1.0 } };
    const hit = evaluateVariant(ctx({ run, mark: 1.2 }));
    assert.equal(hit.trigger, true);
    const miss = evaluateVariant(ctx({ run, mark: 1.19 }));
    assert.equal(miss.trigger, false);
  });

  it('LONG: tracks high-water mark and triggers on reversal', () => {
    const trade = makeTrade({
      order: { side: TradeSide.LONG, type: 'MARKET', quantity: 1 },
    });
    const run = { ...makeRun('trailing-20'), workingState: { highWaterMark: 3.0 } };
    const hit = evaluateVariant(ctx({ trade, run, mark: 2.4 }));
    assert.equal(hit.trigger, true);
    const miss = evaluateVariant(ctx({ trade, run, mark: 2.41 }));
    assert.equal(miss.trigger, false);
  });

  it('seeds the water mark from the entry price when state is empty', () => {
    // entry 2.0, mark 1.5 → SHORT low water becomes 1.5, no breach
    const res = evaluateVariant(ctx({ run: makeRun('trailing-20'), mark: 1.5 }));
    assert.equal(res.trigger, false);
    assert.equal(res.workingState?.lowWaterMark, 1.5);
  });
});

describe('time-stop', () => {
  it('triggers when daysHeld >= configured days', () => {
    const run = makeRun('time-30d');
    assert.equal(evaluateVariant(ctx({ run, daysHeld: 30 })).trigger, true);
    assert.equal(evaluateVariant(ctx({ run, daysHeld: 29 })).trigger, false);
  });
});

describe('limit-stddev (stub)', () => {
  it('never triggers while the level source is stubbed', () => {
    const run = makeRun('limit-sd1');
    const res = evaluateVariant(ctx({ run, underlyingClose: 99.5 }));
    assert.equal(res.trigger, false);
  });
});

describe('EXIT_VARIANT_CONFIGS', () => {
  it('every config key parses and its params match the key-embedded values', () => {
    assert.ok(EXIT_VARIANT_CONFIGS.length >= 4);
    for (const cfg of EXIT_VARIANT_CONFIGS) {
      const def = parseVariantKey(cfg.key);
      assert.ok(def, `${cfg.key} fails parseVariantKey`);
      const p = cfg.params;
      switch (def.family) {
        case 'initial-stop':
          assert.ok(
            p.type === 'initial-stop' && p.pct === def.params.stopPct * 100,
            cfg.key,
          );
          break;
        case 'trailing-stop':
          assert.ok(
            p.type === 'trailing-stop' && p.pct === def.params.stopPct * 100,
            cfg.key,
          );
          break;
        case 'time-stop':
          assert.ok(
            p.type === 'time-stop' && p.days === def.params.days,
            cfg.key,
          );
          break;
        case 'limit-stddev':
          assert.ok(
            p.type === 'limit-stddev' && p.sdMultiplier === def.params.sigma,
            cfg.key,
          );
          break;
      }
    }
  });
});

// ── Curated grammar (#1574): ma-close-{N}, target-{pct} ─────────────────────

describe('parseVariantKey — curated grammar (#1574)', () => {
  it('parses ma-close-{N} into a period', () => {
    const v = parseVariantKey('ma-close-20');
    assert.ok(v);
    assert.equal(v.family, 'ma-close');
    assert.deepEqual(v.params, { period: 20 });
    assert.deepEqual(parseVariantKey('ma-close-100')!.params, { period: 100 });
  });

  it('parses target-{pct} into a fraction', () => {
    const v = parseVariantKey('target-50');
    assert.ok(v);
    assert.equal(v.family, 'target');
    assert.deepEqual(v.params, { pct: 0.5 });
    assert.deepEqual(parseVariantKey('target-100')!.params, { pct: 1.0 });
  });

  it('rejects malformed curated keys', () => {
    assert.equal(parseVariantKey('ma-close-x'), null);
    assert.equal(parseVariantKey('ma-close-'), null);
    assert.equal(parseVariantKey('ma-20'), null);
    assert.equal(parseVariantKey('target-x'), null);
    assert.equal(parseVariantKey('target-'), null);
    assert.equal(parseVariantKey('target'), null);
  });

  it('ma-close/target are not governing-eligible (seed gate)', () => {
    assert.equal(isTerminalVariantKey('ma-close-20'), false);
    assert.equal(isTerminalVariantKey('target-50'), false);
  });
});

describe('evaluateVariant — ma-close-{N} (#1574)', () => {
  const LONG = { order: { side: TradeSide.LONG, type: 'MARKET', quantity: 1 } };

  it('long fires when the mark closes below the SMA', () => {
    const r = evaluateVariant(
      ctx({
        trade: makeTrade({ ...LONG }),
        mark: 94,
        run: makeRun('ma-close-20', false),
        indicators: { sma: { 20: 95 } },
      }),
    );
    assert.equal(r.trigger, true);
  });

  it('long does not fire at or above the SMA', () => {
    for (const mark of [95, 96]) {
      const r = evaluateVariant(
        ctx({
          trade: makeTrade({ ...LONG }),
          mark,
          run: makeRun('ma-close-20', false),
          indicators: { sma: { 20: 95 } },
        }),
      );
      assert.equal(r.trigger, false, `mark ${mark} should not fire`);
    }
  });

  it('short fires when the mark closes above the SMA', () => {
    const r = evaluateVariant(
      ctx({ mark: 96, run: makeRun('ma-close-50', false), indicators: { sma: { 50: 95 } } }),
    );
    assert.equal(r.trigger, true); // fixture trade is SHORT
  });

  it('absent SMA data never fires blind', () => {
    for (const indicators of [undefined, {}, { sma: {} }, { sma: { 50: 95 } }]) {
      const r = evaluateVariant(
        ctx({ mark: 1, run: makeRun('ma-close-20', false), indicators }),
      );
      assert.equal(r.trigger, false, `indicators ${JSON.stringify(indicators)}`);
    }
  });
});

describe('evaluateVariant — target-{pct} (#1574)', () => {
  it('long fires at entry × (1 + pct)', () => {
    // entry 2.0, target-50 → 3.0
    const fire = evaluateVariant(
      ctx({
        trade: makeTrade({ order: { side: TradeSide.LONG, type: 'MARKET', quantity: 1 } }),
        mark: 3.0,
        run: makeRun('target-50', false),
      }),
    );
    assert.equal(fire.trigger, true);
    const below = evaluateVariant(
      ctx({
        trade: makeTrade({ order: { side: TradeSide.LONG, type: 'MARKET', quantity: 1 } }),
        mark: 2.99,
        run: makeRun('target-50', false),
      }),
    );
    assert.equal(below.trigger, false);
  });

  it('short fires at entry × (1 − pct)', () => {
    // SHORT entry 2.0, target-50 → 1.0
    const fire = evaluateVariant(
      ctx({ mark: 1.0, run: makeRun('target-50', false) }),
    );
    assert.equal(fire.trigger, true);
    const above = evaluateVariant(
      ctx({ mark: 1.01, run: makeRun('target-50', false) }),
    );
    assert.equal(above.trigger, false);
  });
});

describe('variantLevel (#1574)', () => {
  it('trailing level rides the watermark including today\'s mark', () => {
    // LONG entry 2.0, high water at 3.0 → trailing-10 level 2.7; a fresh
    // mark of 3.2 ratchets the watermark first → 2.88.
    const long = makeTrade({ order: { side: TradeSide.LONG, type: 'MARKET', quantity: 1 } });
    const run: VariantRun = {
      variantKey: 'trailing-10',
      governing: false,
      state: 'ACTIVE',
      workingState: { highWaterMark: 3.0 },
    };
    assert.equal(
      variantLevel(run, { trade: long, mark: 3.2 }),
      3.2 * 0.9,
    );
  });

  it('ma-close level is today\'s SMA for its period; undefined without data', () => {
    const run = makeRun('ma-close-50', false);
    assert.equal(
      variantLevel(run, { trade: makeTrade(), mark: 2, indicators: { sma: { 50: 1.5 } } }),
      1.5,
    );
    assert.equal(variantLevel(run, { trade: makeTrade(), mark: 2 }), undefined);
  });

  it('target level is the fixed target price', () => {
    const long = makeTrade({ order: { side: TradeSide.LONG, type: 'MARKET', quantity: 1 } });
    assert.equal(
      variantLevel(makeRun('target-50'), { trade: long, mark: 2.5 }),
      3.0, // entry 2.0 × 1.5
    );
  });

  it('non-price rules and unparseable keys have no level', () => {
    assert.equal(variantLevel(makeRun('time-30d'), { trade: makeTrade(), mark: 2 }), undefined);
    assert.equal(variantLevel(makeRun('limit-sd1'), { trade: makeTrade(), mark: 2 }), undefined);
    assert.equal(variantLevel(makeRun('none'), { trade: makeTrade(), mark: 2 }), undefined);
  });
});

describe('isIndependentCloser (#1574)', () => {
  it('target and time families close independently', () => {
    assert.equal(isIndependentCloser('target-50'), true);
    assert.equal(isIndependentCloser('target-100'), true);
    assert.equal(isIndependentCloser('time-30d'), true);
  });

  it('stop families and unknown keys do not', () => {
    assert.equal(isIndependentCloser('trailing-8'), false);
    assert.equal(isIndependentCloser('ma-close-20'), false);
    assert.equal(isIndependentCloser('initial-stop-10'), false);
    assert.equal(isIndependentCloser('none'), false);
  });
});

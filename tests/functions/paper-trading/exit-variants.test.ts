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
  parseVariantKey,
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

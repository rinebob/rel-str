/**
 * @topic #553 — Paper Trading Infra (task #563)
 *
 * Integration tests for the nightly exit eval pass. Deps are injected
 * (stub repository), so the tests exercise the orchestration contract:
 * governing trigger → closing fill + CLOSED; shadow trigger → exitEvent +
 * run EXITED; mark gaps → skip; closed trades → no re-close.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { TradeSide } from '../../../shared/common';
import { OptionType, OptionQuoteSource, PositionSpreadType, StrategyFrequency } from '../../../shared/options-common';
import { LifecycleState } from '../../../shared/options-strategy-engine-contracts';
import {
  PaperTradeSource,
  PaperTradeStatus,
  PaperTradingKind,
  type PaperAccount,
  type PaperTrade,
  type VariantRun,
} from '../../../shared/paper-trading-contracts';
import {
  runExitEvalPass,
  type ExitEvalDeps,
} from '../../../functions/src/paper-trading/exits/eval-pass';
import { resolveAccountOwner } from '../../../functions/src/paper-trading/exits/eval-pass-deps';
import type { ExitFillInput } from '../../../functions/src/paper-trading/ledger';

const DATE = '2026-09-10';

function run(variantKey: string, governing: boolean, workingState: Record<string, number> = {}): VariantRun {
  return { variantKey, governing, state: 'ACTIVE', workingState };
}

function makeTrade(overrides: Partial<PaperTrade> = {}): PaperTrade {
  return {
    kind: PaperTradingKind.TRADE,
    id: 't-1',
    status: PaperTradeStatus.OPEN,
    source: PaperTradeSource.MANUAL,
    strategyInstanceId: 'inst-1',
    symbol: 'QQQM',
    expression: 'CSP',
    governingVariant: 'initial-stop-10',
    order: { side: TradeSide.SHORT, type: 'MARKET', quantity: 1 },
    fills: [
      { fillId: 'entry-t-1', role: 'entry', date: '2026-09-01', price: 2.0, quantity: 1, quoteSource: OptionQuoteSource.RH_MCP },
    ],
    legs: [
      {
        kind: 'option',
        side: TradeSide.SHORT,
        quantity: 1,
        multiplier: 100,
        entryMark: 2.0,
        lastMark: 2.0,
        contractID: 'QQQM260926P00097500',
        type: OptionType.PUT,
        strike: 97.5,
        expiration: '2026-09-26',
      },
    ],
    marks: { [DATE]: { mark: 2.2, underlyingClose: 99 } },
    variantRuns: [run('initial-stop-10', true)],
    variantKeys: ['initial-stop-10'],
    realizedPnl: 0,
    unrealizedPnl: 0,
    createdAt: '2026-09-01T12:00:00Z',
    updatedAt: '2026-09-01T12:00:00Z',
    ...overrides,
  };
}

interface SpyDeps {
  exits: ExitFillInput[];
  runUpdates: { tradeId: string; run: VariantRun }[];
  picks: { tradeId: string; runs: VariantRun[]; governingVariant: string }[];
}

function makeDeps(
  trades: PaperTrade[],
  spy: SpyDeps,
  overrides: Partial<ExitEvalDeps> = {},
): ExitEvalDeps {
  return {
    listTrades: async () => trades,
    applyExit: async (input) => {
      spy.exits.push(input);
      const account: PaperAccount = {
        kind: PaperTradingKind.ACCOUNT,
        id: `acct-${input.userId}`,
        userId: input.userId,
        cash: 0,
        equity: 0,
        realizedPnl: 0,
        openTradeCount: 0,
        createdAt: input.now,
        updatedAt: input.now,
      };
      return {
        trade: trades.find((t) => t.id === input.tradeId)!,
        account,
        cashDelta: 0,
      };
    },
    updateRun: async (tradeId, r) => {
      spy.runUpdates.push({ tradeId, run: r });
    },
    applyGoverningPick: async (tradeId, runs, governingVariant) => {
      spy.picks.push({ tradeId, runs, governingVariant });
    },
    resolveUserId: async () => 'user-1',
    ...overrides,
  };
}

describe('runExitEvalPass', () => {
  it('governing breach → closing fill at the mark + run EXITED with exitEvent', async () => {
    const spy: SpyDeps = { exits: [], runUpdates: [], picks: [] };
    // SHORT entry 2.0; mark 2.2 = +10% adverse → initial-stop-10 fires.
    await runExitEvalPass(DATE, makeDeps([makeTrade()], spy));

    assert.equal(spy.exits.length, 1);
    const exit = spy.exits[0];
    assert.equal(exit.tradeId, 't-1');
    assert.equal(exit.fill.role, 'exit');
    assert.equal(exit.fill.price, 2.2);
    assert.equal(exit.fill.date, DATE);
    assert.equal(exit.userId, 'user-1');

    const governing = spy.runUpdates.find((u) => u.run.governing);
    assert.ok(governing, 'governing run update expected');
    assert.equal(governing!.run.state, 'EXITED');
    assert.deepEqual(
      { ...governing!.run.exitEvent!, pnl: Math.round(governing!.run.exitEvent!.pnl * 1e9) / 1e9 },
      { date: DATE, price: 2.2, pnl: -20, daysHeld: 9 }, // (2.2 − 2.0) × 1 × 100 × −1
    );
  });

  it('governing trailing-8 on a SIGNAL trade fires — source is not a gate (#676)', async () => {
    const spy: SpyDeps = { exits: [], runUpdates: [], picks: [] };
    // SHORT entry 2.0; the mark pass writes 2.5 on DATE. trailing-8 peak
    // tracking starts at entry: 2.5 is +25% adverse → fires.
    const trade = makeTrade({
      source: PaperTradeSource.SIGNAL,
      strategyInstanceId: undefined,
      governingVariant: 'trailing-8',
      marks: { [DATE]: { mark: 2.5 } },
      variantRuns: [run('trailing-8', true)],
      variantKeys: ['trailing-8'],
    });
    await runExitEvalPass(DATE, makeDeps([trade], spy));

    assert.equal(spy.exits.length, 1, 'signal trade governing run must close at the mark');
    assert.equal(spy.exits[0].fill.price, 2.5);
    const governing = spy.runUpdates.find((u) => u.run.governing);
    assert.equal(governing!.run.state, 'EXITED');
  });

  it('shadow breach → exitEvent recorded, no closing fill', async () => {
    const spy: SpyDeps = { exits: [], runUpdates: [], picks: [] };
    const trade = makeTrade({
      governingVariant: 'time-30d',
      variantRuns: [run('time-30d', true), run('initial-stop-10', false)],
      variantKeys: ['time-30d', 'initial-stop-10'],
    });
    await runExitEvalPass(DATE, makeDeps([trade], spy));

    // governing time-30d does not fire (daysHeld 9 < 30) → trade stays open,
    // but shadow initial-stop-10 fires and records its event.
    assert.equal(spy.exits.length, 0);
    const shadow = spy.runUpdates.find((u) => u.run.variantKey === 'initial-stop-10');
    assert.ok(shadow, 'shadow run update expected');
    assert.equal(shadow!.run.state, 'EXITED');
    assert.ok(Math.abs((shadow!.run.exitEvent?.pnl ?? 0) + 20) < 1e-9, 'shadow pnl ≈ −20');
    assert.equal(shadow!.run.exitEvent?.daysHeld, 9);
  });

  it('updates working state on non-triggering runs', async () => {
    const spy: SpyDeps = { exits: [], runUpdates: [], picks: [] };
    const trade = makeTrade({
      governingVariant: 'trailing-20',
      // mark 1.0 is favorable for SHORT — new low water, no breach
      marks: { [DATE]: { mark: 1.0 } },
      variantRuns: [run('trailing-20', true)],
      variantKeys: ['trailing-20'],
    });
    await runExitEvalPass(DATE, makeDeps([trade], spy));

    assert.equal(spy.exits.length, 0);
    const update = spy.runUpdates.find((u) => u.run.variantKey === 'trailing-20');
    assert.ok(update, 'working-state update expected');
    assert.equal(update!.run.state, 'ACTIVE');
    assert.equal(update!.run.workingState.lowWaterMark, 1.0);
    assert.equal(update!.run.exitEvent, undefined);
  });

  it('skips the day entirely when the mark is missing (chain gap)', async () => {
    const spy: SpyDeps = { exits: [], runUpdates: [], picks: [] };
    const trade = makeTrade({ marks: {} });
    await runExitEvalPass(DATE, makeDeps([trade], spy));
    assert.equal(spy.exits.length, 0);
    assert.equal(spy.runUpdates.length, 0);
  });

  it('never re-closes a CLOSED trade; backfills governing exitEvent from the exit fill', async () => {
    const spy: SpyDeps = { exits: [], runUpdates: [], picks: [] };
    const trade = makeTrade({
      status: PaperTradeStatus.CLOSED,
      fills: [
        { fillId: 'entry-t-1', role: 'entry', date: '2026-09-01', price: 2.0, quantity: 1, quoteSource: OptionQuoteSource.RH_MCP },
        { fillId: 'exit-t-1', role: 'exit', date: '2026-09-05', price: 1.5, quantity: 1, quoteSource: OptionQuoteSource.RH_MCP },
      ],
    });
    await runExitEvalPass(DATE, makeDeps([trade], spy));

    assert.equal(spy.exits.length, 0, 'no closing fill on a closed trade');
    const governing = spy.runUpdates.find((u) => u.run.governing);
    assert.ok(governing, 'governing run should be finalized');
    assert.equal(governing!.run.state, 'EXITED');
    assert.equal(governing!.run.exitEvent?.price, 1.5);
    assert.equal(governing!.run.exitEvent?.daysHeld, 4);
  });

  it('shadow runs evaluate on a CLOSED trade when a mark exists', async () => {
    const spy: SpyDeps = { exits: [], runUpdates: [], picks: [] };
    const trade = makeTrade({
      status: PaperTradeStatus.CLOSED,
      governingVariant: 'time-30d',
      // distinct keys — updateVariantRun matches by variantKey, so a shared
      // key would overwrite the governing run (first-index match)
      variantRuns: [
        { ...run('time-30d', true), state: 'EXITED' },
        run('initial-stop-10', false),
      ],
      variantKeys: ['time-30d', 'initial-stop-10'],
    });
    await runExitEvalPass(DATE, makeDeps([trade], spy));

    assert.equal(spy.exits.length, 0);
    const shadow = spy.runUpdates.find((u) => !u.run.governing);
    assert.ok(shadow, 'shadow should evaluate on the fresh mark');
    assert.equal(shadow!.run.state, 'EXITED');
    assert.ok(shadow!.run.exitEvent, 'exitEvent recorded');
  });

  it('governing trigger on an ASSIGNED trade is an error, never a close', async () => {
    const spy: SpyDeps = { exits: [], runUpdates: [], picks: [] };
    const trade = makeTrade({ status: PaperTradeStatus.ASSIGNED });
    const summary = await runExitEvalPass(DATE, makeDeps([trade], spy));

    assert.equal(spy.exits.length, 0, 'no option-mark exit on share-holding trade');
    assert.ok(summary.errors.some((e) => e.includes('ASSIGNED')), 'error recorded');
    // run stays ACTIVE — assigned-share exits route through a dedicated seam
    const governing = spy.runUpdates.find((u) => u.run.governing);
    assert.equal(governing, undefined);
  });

  it('unknown variant keys (incl. none sentinel) are inert', async () => {
    const spy: SpyDeps = { exits: [], runUpdates: [], picks: [] };
    const trade = makeTrade({
      governingVariant: 'none',
      variantRuns: [run('none', true)],
      variantKeys: ['none'],
    });
    await runExitEvalPass(DATE, makeDeps([trade], spy));
    assert.equal(spy.exits.length, 0);
    assert.equal(spy.runUpdates.length, 0);
  });
});

describe('resolveAccountOwner (#652)', () => {
  it('returns the trade userId without touching Firestore — signal-trade path', async () => {
    // A signal trade has no strategyInstanceId; its doc-level userId is the
    // account owner. A db that throws on any access proves the fast path.
    const throwingDb = {
      doc: () => { throw new Error('db touched'); },
      collection: () => { throw new Error('db touched'); },
    } as never;
    const trade = makeTrade({ strategyInstanceId: undefined, userId: 'user-9' });
    assert.equal(await resolveAccountOwner(throwingDb, trade), 'user-9');
  });

  it('falls back to the instance doc when the trade has no userId', async () => {
    // Legacy strategy trades predate the doc-level userId — owner resolves
    // through the instance.
    const instDoc = {
      get: async () => ({
        exists: true,
        data: () => ({
          // Valid StStrategyInstance doc — the repository validator requires
          // the engine fields before returning the instance.
          symbol: 'QQQM',
          optionType: OptionType.PUT,
          side: TradeSide.SHORT,
          targetDelta: 0.2,
          dteMin: 21,
          dteMax: 30,
          phases: [
            {
              spreadType: PositionSpreadType.CASH_SECURED_PUT,
              targetDelta: 0.2,
              dteMin: 21,
              dteMax: 30,
            },
          ],
          frequency: StrategyFrequency.DAILY,
          openTimePT: '12:00',
          exitPolicies: [],
          lifecycleState: LifecycleState.ACTIVE,
          userId: 'user-from-instance',
          mode: 'paper',
          enabled: true,
          createdAt: '2025-08-16T00:00:00Z',
          updatedAt: '2025-08-16T00:00:00Z',
        }),
      }),
    };
    const fakeDb = {
      doc: () => instDoc,
      collection: () => ({ doc: () => instDoc }),
    } as never;
    const trade = makeTrade({ userId: undefined, strategyInstanceId: 'inst-1' });
    assert.equal(await resolveAccountOwner(fakeDb, trade), 'user-from-instance');
  });

  it('returns undefined when neither field resolves', async () => {
    const fakeDb = {
      doc: () => ({ get: async () => { throw new Error('unreachable'); } }),
    } as never;
    const trade = makeTrade({ userId: undefined, strategyInstanceId: undefined });
    assert.equal(await resolveAccountOwner(fakeDb, trade), undefined);
  });
});

// ── Curated governing policy (#1574) ────────────────────────────────────────

function policyTrade(overrides: Partial<PaperTrade> = {}): PaperTrade {
  return makeTrade({
    order: { side: TradeSide.LONG, type: 'MARKET', quantity: 1 },
    source: PaperTradeSource.SIGNAL,
    governingPolicy: 'deepest-stop-else-trailing-8',
    governingVariant: 'trailing-8',
    fills: [
      { fillId: 'entry-t-1', role: 'entry', date: '2026-09-01', price: 80, quantity: 1, quoteSource: OptionQuoteSource.SDS_BARS },
    ],
    marks: { [DATE]: { mark: 100, underlyingClose: 100 } },
    ...overrides,
  });
}

const sma20Bars = (close: number): { d: string; o: number; h: number; l: number; c: number }[] =>
  Array.from({ length: 20 }, (_, i) => ({
    d: `2026-08-${String(14 + i).padStart(2, '0')}`,
    o: 0, h: 0, l: 0, c: close,
  }));

describe('runExitEvalPass — governing policy (#1574)', () => {
  it('policy-marked trade rewrites governing flags + governingVariant each day', async () => {
    const spy: SpyDeps = { exits: [], runUpdates: [], picks: [] };
    const trade = policyTrade({
      variantRuns: [
        run('trailing-5', false, { highWaterMark: 100 }),
        run('trailing-8', true, { highWaterMark: 100 }),
        run('ma-close-20', false),
      ],
      variantKeys: ['trailing-5', 'trailing-8', 'ma-close-20'],
    });
    await runExitEvalPass(DATE, makeDeps([trade], spy, {
      getBars: async () => sma20Bars(90),
    }));

    // sma20 = 90 → deepest below the watermark (95/92/90) → ma-close-20
    // governs. Flags + mirror land in ONE atomic pick write.
    assert.equal(spy.picks.length, 1);
    const pick = spy.picks[0];
    assert.equal(pick.governingVariant, 'ma-close-20');
    assert.equal(
      pick.runs.find((r) => r.variantKey === 'ma-close-20')?.governing,
      true,
    );
    assert.equal(
      pick.runs.find((r) => r.variantKey === 'trailing-8')?.governing,
      false,
    );
    assert.equal(spy.exits.length, 0); // mark above sma → no fire
  });

  it('unmarked trades keep static governing — no recompute, no closer semantics', async () => {
    const spy: SpyDeps = { exits: [], runUpdates: [], picks: [] };
    const trade = policyTrade({
      governingPolicy: undefined, // static governing trade
      marks: { [DATE]: { mark: 130, underlyingClose: 130 } },
      variantRuns: [
        run('trailing-8', true, { highWaterMark: 100 }),
        run('target-50', false), // fires at 120 — but not a policy trade
      ],
      variantKeys: ['trailing-8', 'target-50'],
    });
    await runExitEvalPass(DATE, makeDeps([trade], spy, {
      getBars: async () => sma20Bars(90),
    }));

    assert.equal(spy.picks.length, 0);
    assert.equal(spy.exits.length, 0); // target-50 can't close an unmarked trade
    const tgt = spy.runUpdates.find((u) => u.run.variantKey === 'target-50');
    assert.equal(tgt?.run.state, 'EXITED'); // shadow exit recorded
  });

  it('independent closer fires the real close + rewrites governingVariant to the closer key', async () => {
    const spy: SpyDeps = { exits: [], runUpdates: [], picks: [] };
    const trade = policyTrade({
      fills: [
        { fillId: 'entry-t-1', role: 'entry', date: '2026-09-01', price: 60, quantity: 1, quoteSource: OptionQuoteSource.SDS_BARS },
      ],
      variantRuns: [
        run('trailing-8', true, { highWaterMark: 100 }),
        run('target-50', false), // entry 60 × 1.5 = 90 ≤ mark 100 → fires
      ],
      variantKeys: ['trailing-8', 'target-50'],
    });
    await runExitEvalPass(DATE, makeDeps([trade], spy));

    assert.equal(spy.exits.length, 1);
    assert.equal(spy.exits[0].fill.price, 100);
    assert.equal(spy.exits[0].fill.fillId, `exit-t-1-target-50-${DATE}`);
    // Closer attribution + run state land in ONE atomic write.
    const closeWrite = spy.picks.find((pk) => pk.governingVariant === 'target-50');
    assert.ok(closeWrite);
    assert.equal(
      closeWrite.runs.find((r) => r.variantKey === 'target-50')?.state,
      'EXITED',
    );
  });

  it('ma-close above the watermark shadows — a level past the peak is consumed, never the pick', async () => {
    const spy: SpyDeps = { exits: [], runUpdates: [], picks: [] };
    const trade = policyTrade({
      variantRuns: [
        run('trailing-8', true, { highWaterMark: 100 }),
        run('ma-close-20', false),
      ],
      variantKeys: ['trailing-8', 'ma-close-20'],
    });
    await runExitEvalPass(DATE, makeDeps([trade], spy, {
      getBars: async () => sma20Bars(110), // sma 110 > watermark 100 → consumed
    }));

    assert.equal(spy.exits.length, 0); // close comes only from the governing pick
    const ma = spy.runUpdates.find((u) => u.run.variantKey === 'ma-close-20');
    assert.equal(ma?.run.state, 'EXITED'); // shadow exitEvent recorded
    assert.ok(ma?.run.exitEvent);
    assert.equal(spy.picks.length, 0); // trailing-8 was already governing
  });

  it('missing bars dep — ma-close runs skip loudly, never fire blind', async () => {
    const spy: SpyDeps = { exits: [], runUpdates: [], picks: [] };
    const trade = policyTrade({
      variantRuns: [
        run('trailing-8', true, { highWaterMark: 100 }),
        run('ma-close-20', false),
      ],
      variantKeys: ['trailing-8', 'ma-close-20'],
    });
    const summary = await runExitEvalPass(DATE, makeDeps([trade], spy)); // no getBars

    assert.equal(spy.exits.length, 0);
    assert.ok(summary.errors.some((e) => e.includes('ma-close-20') && /sma/i.test(e)));
    const ma = spy.runUpdates.find((u) => u.run.variantKey === 'ma-close-20');
    assert.notEqual(ma?.run.state, 'EXITED'); // skipped, not shadow-exited
  });

  it('breach day — the deepest stop below the watermark fires the real close', async () => {
    // hwm 100 → trailing-5 95, trailing-8 92, sma20 90. Mark 85 breached all
    // three; deepest below the watermark = ma-close-20 → it closes at 85,
    // the tighter stops shadow-exit. Without watermark-side candidacy the
    // trade would sit OPEN forever (all stops shadowed, no pick).
    const spy: SpyDeps = { exits: [], runUpdates: [], picks: [] };
    const trade = policyTrade({
      marks: { [DATE]: { mark: 85, underlyingClose: 85 } },
      variantRuns: [
        run('trailing-5', false, { highWaterMark: 100 }),
        run('trailing-8', true, { highWaterMark: 100 }),
        run('ma-close-20', false),
      ],
      variantKeys: ['trailing-5', 'trailing-8', 'ma-close-20'],
    });
    const summary = await runExitEvalPass(DATE, makeDeps([trade], spy, {
      getBars: async () => sma20Bars(90),
    }));

    assert.equal(spy.exits.length, 1);
    assert.equal(spy.exits[0].fill.price, 85);
    assert.equal(spy.exits[0].fill.fillId, `exit-t-1-ma-close-20-${DATE}`);
    assert.equal(spy.picks[0]?.governingVariant, 'ma-close-20');
    assert.equal(summary.errors.length, 0);
    assert.equal(
      spy.runUpdates.find((u) => u.run.variantKey === 'trailing-8')?.run.state,
      'EXITED',
    );
  });

  it('same-day multi-close latch — second closer shadows, no ledger throw', async () => {
    // entry 60, mark 130: target-50 (90) and target-100 (120) both fire.
    // First in run order closes; the second records a shadow exitEvent —
    // it must NOT attempt applyExit on the already-CLOSED trade.
    const spy: SpyDeps = { exits: [], runUpdates: [], picks: [] };
    const trade = policyTrade({
      fills: [
        { fillId: 'entry-t-1', role: 'entry', date: '2026-09-01', price: 60, quantity: 1, quoteSource: OptionQuoteSource.SDS_BARS },
      ],
      marks: { [DATE]: { mark: 130, underlyingClose: 130 } },
      variantRuns: [
        run('trailing-8', true, { highWaterMark: 130 }), // level 119.6 — unbreached
        run('target-50', false),
        run('target-100', false),
      ],
      variantKeys: ['trailing-8', 'target-50', 'target-100'],
    });
    const summary = await runExitEvalPass(DATE, makeDeps([trade], spy));

    assert.equal(spy.exits.length, 1);
    assert.equal(spy.exits[0].fill.fillId, `exit-t-1-target-50-${DATE}`);
    assert.equal(spy.picks[0]?.governingVariant, 'target-50');
    assert.equal(summary.errors.length, 0); // no 'not open' ledger throw
    assert.equal(
      spy.runUpdates.find((u) => u.run.variantKey === 'target-100')?.run.state,
      'EXITED', // shadow exitEvent, not a second close
    );
    assert.equal(summary.shadowExits, 1);
  });

  it('pick === undefined — no pick write, mirror keeps the last selection', async () => {
    // Only an independent closer remains ACTIVE (trailing-8 already EXITED)
    // → no stop candidates → no pick; a later closer still attributes.
    const spy: SpyDeps = { exits: [], runUpdates: [], picks: [] };
    const trade = policyTrade({
      fills: [
        { fillId: 'entry-t-1', role: 'entry', date: '2026-09-01', price: 60, quantity: 1, quoteSource: OptionQuoteSource.SDS_BARS },
      ],
      marks: { [DATE]: { mark: 130, underlyingClose: 130 } },
      variantRuns: [
        { ...run('trailing-8', false), state: 'EXITED' },
        run('target-50', false),
      ],
      variantKeys: ['trailing-8', 'target-50'],
    });
    await runExitEvalPass(DATE, makeDeps([trade], spy));

    // Only ONE write all pass — the atomic close write (no selection write).
    assert.equal(spy.picks.length, 1);
    assert.equal(spy.picks[0].governingVariant, 'target-50');
    assert.equal(spy.exits.length, 1); // target-50 closes + attributes
  });
});

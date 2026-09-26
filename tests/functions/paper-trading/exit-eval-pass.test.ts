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
import { OptionType, OptionQuoteSource } from '../../../shared/options-common';
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
}

function makeDeps(trades: PaperTrade[], spy: SpyDeps): ExitEvalDeps {
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
    resolveUserId: async () => 'user-1',
  };
}

describe('runExitEvalPass', () => {
  it('governing breach → closing fill at the mark + run EXITED with exitEvent', async () => {
    const spy: SpyDeps = { exits: [], runUpdates: [] };
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

  it('shadow breach → exitEvent recorded, no closing fill', async () => {
    const spy: SpyDeps = { exits: [], runUpdates: [] };
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
    const spy: SpyDeps = { exits: [], runUpdates: [] };
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
    const spy: SpyDeps = { exits: [], runUpdates: [] };
    const trade = makeTrade({ marks: {} });
    await runExitEvalPass(DATE, makeDeps([trade], spy));
    assert.equal(spy.exits.length, 0);
    assert.equal(spy.runUpdates.length, 0);
  });

  it('never re-closes a CLOSED trade; backfills governing exitEvent from the exit fill', async () => {
    const spy: SpyDeps = { exits: [], runUpdates: [] };
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
    const spy: SpyDeps = { exits: [], runUpdates: [] };
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
    const spy: SpyDeps = { exits: [], runUpdates: [] };
    const trade = makeTrade({ status: PaperTradeStatus.ASSIGNED });
    const summary = await runExitEvalPass(DATE, makeDeps([trade], spy));

    assert.equal(spy.exits.length, 0, 'no option-mark exit on share-holding trade');
    assert.ok(summary.errors.some((e) => e.includes('ASSIGNED')), 'error recorded');
    // run stays ACTIVE — assigned-share exits route through a dedicated seam
    const governing = spy.runUpdates.find((u) => u.run.governing);
    assert.equal(governing, undefined);
  });

  it('unknown variant keys (incl. none sentinel) are inert', async () => {
    const spy: SpyDeps = { exits: [], runUpdates: [] };
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

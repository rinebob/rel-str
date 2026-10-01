/**
 * @topic #553 — Paper Trading Infra (task #720)
 *
 * signal-settlement-pass: settles OPEN signal-source trades whose option
 * legs have all expired. OTM legs expire worthless (full premium realized
 * via the markPositionSettled seam); any ITM leg cash-settles at net
 * intrinsic value via applyExitFill + governing-run finalize — the same
 * close shape the manual close callable produces. Share-only signal
 * trades never expire and are ignored.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { TradeSide } from '../../../shared/common';
import { OptionQuoteSource, OptionType } from '../../../shared/options-common';
import {
  PaperTradeSource,
  PaperTradeStatus,
  PaperTradingKind,
  type PaperTrade,
} from '../../../shared/paper-trading-contracts';
import {
  runSignalSettlementPass,
  type SignalSettlementPassDeps,
} from '../../../functions/src/paper-trading/passes/signal-settlement-pass';

const MARKET_DATE = '2026-10-20'; // a Tuesday — past the fixture expiration
const EXPIRATION = '2026-10-16';  // Friday before the run date

function signalTrade(overrides: Partial<PaperTrade> = {}): PaperTrade {
  return {
    kind: PaperTradingKind.TRADE,
    id: '260909-sig-QQQM-CSP',
    status: PaperTradeStatus.OPEN,
    userId: 'user1',
    source: PaperTradeSource.SIGNAL,
    symbol: 'QQQM',
    expression: 'CSP',
    governingVariant: 'trailing-8',
    order: { side: TradeSide.SHORT, type: 'MARKET', quantity: 1 },
    fills: [
      {
        fillId: 'entry-1',
        role: 'entry',
        date: '2026-09-09',
        price: 2.8,
        quantity: 1,
        quoteSource: OptionQuoteSource.RH_MCP,
      },
    ],
    legs: [
      {
        kind: 'option',
        contractID: 'QQQM261016P00580000',
        type: OptionType.PUT,
        strike: 580,
        expiration: EXPIRATION,
        side: TradeSide.SHORT,
        quantity: 1,
        multiplier: 100,
        entryMark: 2.8,
        lastMark: 2.1,
      },
    ],
    marks: { '2026-10-15': { mark: 2.1 } },
    variantRuns: [
      {
        variantKey: 'trailing-8',
        governing: true,
        state: 'ACTIVE',
        workingState: {},
      },
    ],
    variantKeys: ['trailing-8'],
    realizedPnl: 0,
    // SHORT entered 2.80, lastMark 2.10 → +70 unrealized.
    unrealizedPnl: 70,
    createdAt: '2026-09-09T00:00:00.000Z',
    updatedAt: '2026-09-09T00:00:00.000Z',
    ...overrides,
  };
}

function makeDeps(overrides: Partial<SignalSettlementPassDeps> = {}) {
  const settled: { tradeId: string; settlement: unknown; legOutcomes: unknown; dailyUpdate: unknown }[] = [];
  const exits: unknown[] = [];
  const runUpdates: { tradeId: string; run: unknown }[] = [];
  const deps: SignalSettlementPassDeps = {
    listOpenSignalTrades: overrides.listOpenSignalTrades ?? (async () => [signalTrade()]),
    getUnderlyingClose: overrides.getUnderlyingClose ?? (async () => 590), // OTM: close > put strike
    settleExpired: async (tradeId, settlement, legOutcomes, dailyUpdate) => {
      settled.push({ tradeId, settlement, legOutcomes, dailyUpdate });
    },
    applyExit: async (input) => {
      exits.push(input);
      return {
        trade: signalTrade(),
        account: {
          kind: PaperTradingKind.ACCOUNT,
          id: 'acct-user1',
          userId: 'user1',
          cash: 0,
          equity: 0,
          realizedPnl: 0,
          openTradeCount: 1,
          createdAt: '2026-09-09T00:00:00.000Z',
          updatedAt: '2026-09-09T00:00:00.000Z',
        },
        cashDelta: 0,
      };
    },
    updateRun: async (tradeId, run) => {
      runUpdates.push({ tradeId, run });
    },
    now: () => new Date('2026-10-20T23:00:00.000Z'),
    ...overrides,
  };
  return { deps, settled, exits, runUpdates };
}

describe('runSignalSettlementPass', () => {
  it('expires an OTM short put worthless via the settlement seam', async () => {
    const { deps, settled, exits } = makeDeps();
    const summary = await runSignalSettlementPass(MARKET_DATE, deps);

    assert.equal(summary.settled, 1);
    assert.equal(settled.length, 1);
    const s = settled[0];
    assert.equal(s.tradeId, '260909-sig-QQQM-CSP');
    const settlement = s.settlement as { status: string; currentValue: number };
    assert.equal(settlement.status, 'EXPIRED_WORTHLESS');
    assert.equal(settlement.currentValue, 0);
    // Daily update keys marks under the EXPIRATION date's underlying close.
    const dailyUpdate = s.dailyUpdate as { date: string; underlyingClose: number };
    assert.equal(dailyUpdate.date, EXPIRATION);
    assert.equal(dailyUpdate.underlyingClose, 590);
    const legOutcomes = s.legOutcomes as { outcome: string; closeDate: string }[];
    assert.equal(legOutcomes[0].outcome, 'EXPIRED_WORTHLESS');
    assert.equal(legOutcomes[0].closeDate, EXPIRATION);
    assert.equal(exits.length, 0, 'worthless expiry writes no exit fill');
  });

  it('cash-settles an ITM short put at intrinsic via applyExitFill', async () => {
    const { deps, settled, exits, runUpdates } = makeDeps({
      getUnderlyingClose: async () => 570, // ITM: 10 below the 580 put strike
    });
    const summary = await runSignalSettlementPass(MARKET_DATE, deps);

    assert.equal(summary.settled, 1);
    assert.equal(settled.length, 0, 'ITM does not take the worthless seam');
    assert.equal(exits.length, 1);
    const input = exits[0] as {
      userId: string;
      tradeId: string;
      fill: { price: number; role: string; quantity: number; date: string };
    };
    assert.equal(input.userId, 'user1');
    assert.equal(input.tradeId, '260909-sig-QQQM-CSP');
    assert.equal(input.fill.role, 'exit');
    // Intrinsic per contract = 580 − 570 = 10.
    assert.equal(input.fill.price, 10);
    assert.equal(input.fill.quantity, 1);
    assert.equal(input.fill.date, EXPIRATION);

    // Governing run finalized EXITED at intrinsic — the exit-event pnl for
    // a SHORT entry 2.80 → 10.00 buyback is −$720.
    assert.equal(runUpdates.length, 1);
    const run = runUpdates[0].run as {
      state: string;
      exitEvent: { price: number; pnl: number };
    };
    assert.equal(run.state, 'EXITED');
    assert.equal(run.exitEvent.price, 10);
    assert.ok(Math.abs(run.exitEvent.pnl - -720) < 1e-9);
  });

  it('cash-settles an ITM LONG put at intrinsic (positive exit proceeds)', async () => {
    const longPut = signalTrade({
      id: 'lp-1',
      order: { side: TradeSide.LONG, type: 'MARKET', quantity: 1 },
      legs: [
        {
          kind: 'option',
          contractID: 'QQQM261016P00580000',
          type: OptionType.PUT,
          strike: 580,
          expiration: EXPIRATION,
          side: TradeSide.LONG,
          quantity: 1,
          multiplier: 100,
          entryMark: 2.8,
          lastMark: 9.0,
        },
      ],
    });
    const { deps, exits } = makeDeps({
      listOpenSignalTrades: async () => [longPut],
      getUnderlyingClose: async () => 570,
    });
    await runSignalSettlementPass(MARKET_DATE, deps);
    const input = exits[0] as { fill: { price: number } };
    assert.equal(input.fill.price, 10);
  });

  it('leaves a trade whose option legs have not all expired', async () => {
    const live = signalTrade({
      legs: [
        {
          kind: 'option',
          contractID: 'QQQM261106P00580000',
          type: OptionType.PUT,
          strike: 580,
          expiration: '2026-11-06', // future
          side: TradeSide.SHORT,
          quantity: 1,
          multiplier: 100,
          entryMark: 2.8,
          lastMark: 2.1,
        },
      ],
    });
    const { deps, settled, exits } = makeDeps({
      listOpenSignalTrades: async () => [live],
    });
    const summary = await runSignalSettlementPass(MARKET_DATE, deps);
    assert.equal(summary.settled, 0);
    assert.equal(settled.length + exits.length, 0);
  });

  it('ignores share-only signal trades (equity legs never expire)', async () => {
    const equity = signalTrade({
      id: 'eq-1',
      order: { side: TradeSide.LONG, type: 'MARKET', quantity: 5 },
      legs: [
        {
          kind: 'share',
          side: TradeSide.LONG,
          quantity: 5,
          multiplier: 1,
          entryMark: 100,
          lastMark: 103,
        },
      ],
    });
    const { deps, settled, exits } = makeDeps({
      listOpenSignalTrades: async () => [equity],
    });
    const summary = await runSignalSettlementPass(MARKET_DATE, deps);
    assert.equal(summary.settled, 0);
    // Share-only trades aren't candidates at all — they must not inflate
    // the skipped count (every open EQ trade would, nightly, forever).
    assert.equal(summary.skipped, 0);
    assert.equal(settled.length + exits.length, 0);
  });

  it('records an error for a leg-less trade instead of ignoring it', async () => {
    const legless = signalTrade({ id: 'legless-1', legs: [] });
    const { deps } = makeDeps({
      listOpenSignalTrades: async () => [legless],
    });
    const summary = await runSignalSettlementPass(MARKET_DATE, deps);
    assert.equal(summary.settled, 0);
    assert.equal(summary.errors.length, 1);
    assert.match(summary.errors[0].error, /no legs/i);
  });

  it('records an error for a mixed share+option trade', async () => {
    const mixed = signalTrade({
      id: 'mixed-1',
      legs: [
        signalTrade().legs[0],
        {
          kind: 'share',
          side: TradeSide.LONG,
          quantity: 5,
          multiplier: 1,
          entryMark: 100,
          lastMark: 103,
        },
      ],
    });
    const { deps, settled, exits } = makeDeps({
      listOpenSignalTrades: async () => [mixed],
    });
    const summary = await runSignalSettlementPass(MARKET_DATE, deps);
    assert.equal(summary.settled, 0);
    assert.equal(summary.errors.length, 1);
    assert.match(summary.errors[0].error, /mixed/i);
    assert.equal(settled.length + exits.length, 0);
  });

  it('records an error for a multi-leg signal trade', async () => {
    const multi = signalTrade({
      id: 'multi-1',
      legs: [signalTrade().legs[0], signalTrade().legs[0]],
    });
    const { deps, settled, exits } = makeDeps({
      listOpenSignalTrades: async () => [multi],
    });
    const summary = await runSignalSettlementPass(MARKET_DATE, deps);
    assert.equal(summary.settled, 0);
    assert.equal(summary.errors.length, 1);
    assert.match(summary.errors[0].error, /multi-leg/i);
    assert.equal(settled.length + exits.length, 0);
  });

  it('records an error when the trade has no userId', async () => {
    const orphan = signalTrade({ id: 'orphan-1', userId: undefined });
    const { deps, settled, exits } = makeDeps({
      listOpenSignalTrades: async () => [orphan],
    });
    const summary = await runSignalSettlementPass(MARKET_DATE, deps);
    assert.equal(summary.settled, 0);
    assert.equal(summary.errors.length, 1);
    assert.match(summary.errors[0].error, /userId/i);
    assert.equal(settled.length + exits.length, 0);
  });

  it('settles a weekend expiration at the prior trading-day close', async () => {
    // 2026-10-17 is a Saturday — no SDS bar; the walk-back must reach
    // Friday 10-16's close and date the settlement to it.
    const sat = signalTrade({
      id: 'sat-1',
      legs: [{ ...signalTrade().legs[0], expiration: '2026-10-17' }],
    });
    const { deps, settled } = makeDeps({
      listOpenSignalTrades: async () => [sat],
      getUnderlyingClose: async (_s, d) => (d === '2026-10-16' ? 590 : null),
    });
    const summary = await runSignalSettlementPass(MARKET_DATE, deps);
    assert.equal(summary.settled, 1);
    const dailyUpdate = settled[0].dailyUpdate as { date: string; underlyingClose: number };
    assert.equal(dailyUpdate.date, '2026-10-16');
    assert.equal(dailyUpdate.underlyingClose, 590);
  });

  it('records an error when the underlying close for expiry is missing', async () => {
    const { deps, settled, exits } = makeDeps({
      getUnderlyingClose: async () => null,
    });
    const summary = await runSignalSettlementPass(MARKET_DATE, deps);
    assert.equal(summary.settled, 0);
    assert.equal(summary.errors.length, 1);
    assert.match(summary.errors[0].error, /underlying close/i);
    assert.equal(settled.length + exits.length, 0);
  });

  it('records a per-trade failure without aborting the pass', async () => {
    const good = signalTrade();
    const bad = signalTrade({ id: 'bad-trade' });
    const { deps, settled } = makeDeps({
      listOpenSignalTrades: async () => [bad, good],
      getUnderlyingClose: async (_s, d) => (d === EXPIRATION ? 590 : null),
      settleExpired: async (tradeId) => {
        if (tradeId === 'bad-trade') throw new Error('txn boom');
        settled.push({ tradeId, settlement: {}, legOutcomes: [], dailyUpdate: {} });
      },
    });
    const summary = await runSignalSettlementPass(MARKET_DATE, deps);
    assert.equal(summary.settled, 1);
    assert.equal(summary.errors.length, 1);
    assert.equal(summary.errors[0].tradeId, 'bad-trade');
  });
});

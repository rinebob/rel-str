/**
 * @topic #746 — On-demand Screenshot Capture (task #847)
 *
 * Engine hooks at the ledger seam: `onTradeLifecycle` fires after a
 * committed fill, `positionTypeForLegs` maps leg shape → strategy tag, and
 * the trade→input builder sets cohort/position group roots. The capture
 * itself is injected — these tests never touch Firestore or Storage.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { TradeSide } from '../../../shared/common';
import { OptionQuoteSource, OptionType } from '../../../shared/options-common';
import {
  CaptureEvent,
  PositionType,
} from '../../../shared/screenshot-capture-contracts';
import {
  PaperTradeSource,
  PaperTradeStatus,
  type PaperTrade,
  type PaperTradeLeg,
} from '../../../shared/paper-trading-contracts';
import {
  applyEntryFill,
  applyPendingFill,
  applyExitFill,
  createPendingTrade,
  type LedgerDeps,
} from '../../../functions/src/paper-trading/ledger';
import {
  lifecycleInputFor,
  makeTradeLifecycleHook,
  positionTypeForLegs,
  settlementCapturesPositionClosed,
} from '../../../functions/src/paper-trading/screenshot-lifecycle';
import { PositionStatus } from '../../../functions/src/paper-trading/engine/types';

const NOW = '2026-09-24T19:00:00.000Z';

function shareLeg(): PaperTradeLeg {
  return { kind: 'share', side: TradeSide.LONG, quantity: 100, multiplier: 1, entryMark: 50, lastMark: 50 };
}

function optionLeg(expiration = '2026-11-20', strike = 570): PaperTradeLeg {
  return {
    kind: 'option',
    contractID: 'QQQM251120P00570000',
    type: OptionType.PUT,
    strike,
    expiration,
    side: TradeSide.SHORT,
    quantity: 1,
    multiplier: 100,
    entryMark: 2.5,
    lastMark: 2.5,
  };
}

describe('positionTypeForLegs', () => {
  it('maps shares-only to stock', () => {
    assert.equal(positionTypeForLegs([shareLeg()]), PositionType.STOCK);
  });

  it('maps a single option leg to option-single', () => {
    assert.equal(positionTypeForLegs([optionLeg()]), PositionType.OPTION_SINGLE);
    // covered call shape — share + one option — still one option leg
    assert.equal(positionTypeForLegs([shareLeg(), optionLeg()]), PositionType.OPTION_SINGLE);
  });

  it('maps same-expiration multi-leg options to vertical-debit-spread', () => {
    assert.equal(
      positionTypeForLegs([optionLeg('2026-11-20', 570), optionLeg('2026-11-20', 560)]),
      PositionType.VERTICAL_DEBIT_SPREAD,
    );
  });

  it('maps mixed expirations to calendar', () => {
    assert.equal(
      positionTypeForLegs([optionLeg('2026-11-20'), optionLeg('2026-12-18')]),
      PositionType.CALENDAR,
    );
  });
});

describe('settlementCapturesPositionClosed', () => {
  it('fires on terminal settlement statuses', () => {
    assert.equal(settlementCapturesPositionClosed(PositionStatus.CLOSED), true);
    assert.equal(settlementCapturesPositionClosed(PositionStatus.EXPIRED_WORTHLESS), true);
    assert.equal(settlementCapturesPositionClosed(PositionStatus.ASSIGNED_HOLDING_SHARES), true);
  });

  it('does not fire on non-terminal statuses', () => {
    assert.equal(settlementCapturesPositionClosed(PositionStatus.OPEN), false);
    assert.equal(settlementCapturesPositionClosed(PositionStatus.COVERED_CALL_OPEN), false);
  });
});

function makeTrade(overrides: Partial<PaperTrade> = {}): PaperTrade {
  return {
    kind: 'trade' as PaperTrade['kind'],
    id: '260924-sig-QQQM-CSP-020-30',
    status: PaperTradeStatus.OPEN,
    userId: 'u1',
    source: PaperTradeSource.SIGNAL,
    cohortId: 'cohort-260924-QQQM-01',
    signalId: 'sig-1',
    symbol: 'QQQM',
    expression: 'CSP',
    governingVariant: 'trailing-20',
    order: { side: TradeSide.SHORT, type: 'MARKET', quantity: 1 },
    fills: [],
    legs: [optionLeg()],
    marks: {},
    variantRuns: [],
    variantKeys: [],
    realizedPnl: 0,
    unrealizedPnl: 0,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

describe('lifecycleInputFor', () => {
  it('groups signal trades under cohortId and carries the engine carrier', () => {
    const input = lifecycleInputFor(makeTrade(), CaptureEvent.ORDER_FILLED);
    assert.equal(input.positionId, '260924-sig-QQQM-CSP-020-30');
    assert.equal(input.groupId, 'cohort-260924-QQQM-01');
    assert.equal(input.symbol, 'QQQM');
    assert.equal(input.event, CaptureEvent.ORDER_FILLED);
    assert.equal(input.positionType, PositionType.OPTION_SINGLE);
    assert.deepEqual(input.carrier, {
      kind: 'engine-position',
      docPath: 'paper-trading/trades/items/260924-sig-QQQM-CSP-020-30',
    });
  });

  it('falls back to the position id as group root for engine trades', () => {
    const input = lifecycleInputFor(
      makeTrade({ cohortId: undefined }),
      CaptureEvent.POSITION_CLOSED,
    );
    assert.equal(input.groupId, '260924-sig-QQQM-CSP-020-30');
  });
});

// ── Ledger hook firing ──────────────────────────────────────────────────────
// Same fake-transact shape as ledger.test.ts: the write plan is buffered in
// memory; `onTradeLifecycle` is a recording spy.

interface FakeStore {
  accounts: Map<string, unknown>;
  trades: Map<string, unknown>;
}

function fakeDeps(store: FakeStore, hook?: LedgerDeps['onTradeLifecycle']): LedgerDeps {
  return {
    transact: async (work) =>
      work({
        getAccount: async (userId) =>
          (store.accounts.get(`acct-${userId}`) as never) ?? null,
        getTrade: async (tradeId) => (store.trades.get(tradeId) as never) ?? null,
        write: (plan) => {
          store.accounts.set(plan.accountId, plan.account);
          store.trades.set(plan.tradeId, plan.trade);
        },
      }),
    ...(hook ? { onTradeLifecycle: hook } : {}),
  };
}

function entryInput(tradeId = 't-1') {
  return {
    userId: 'u1',
    tradeId,
    order: { side: TradeSide.LONG, type: 'MARKET', quantity: 100 },
    legs: [shareLeg()],
    fill: {
      fillId: `entry-${tradeId}`,
      role: 'entry' as const,
      date: '2026-09-24',
      price: 50,
      quantity: 100,
      quoteSource: OptionQuoteSource.RH_MCP,
    },
    dims: {
      source: PaperTradeSource.MANUAL,
      symbol: 'QQQM',
      expression: 'EQ',
      governingVariant: 'trailing-20',
    },
    now: NOW,
  };
}

describe('ledger onTradeLifecycle hook', () => {
  it('fires order-filled after applyEntryFill commits, with the trade doc', async () => {
    const store: FakeStore = { accounts: new Map(), trades: new Map() };
    const calls: { trade: PaperTrade; event: CaptureEvent }[] = [];
    const deps = fakeDeps(store, async (trade, event) => {
      calls.push({ trade, event });
    });
    const result = await applyEntryFill(entryInput(), deps);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].event, CaptureEvent.ORDER_FILLED);
    assert.equal(calls[0].trade.id, 't-1');
    assert.equal(calls[0].trade, result.trade);
  });

  it('fires order-filled on applyPendingFill (PENDING→OPEN)', async () => {
    const store: FakeStore = { accounts: new Map(), trades: new Map() };
    const calls: CaptureEvent[] = [];
    const deps = fakeDeps(store, async (_t, event) => {
      calls.push(event);
    });
    await createPendingTrade(
      {
        userId: 'u1',
        tradeId: 't-p',
        order: { side: TradeSide.SHORT, type: 'MARKET', quantity: 1 },
        dims: entryInput('t-p').dims,
        now: NOW,
      },
      deps,
    );
    assert.equal(calls.length, 0, 'createPendingTrade fires no event');
    await applyPendingFill(
      {
        userId: 'u1',
        tradeId: 't-p',
        legs: [optionLeg()],
        fill: {
          fillId: 'entry-t-p',
          role: 'entry',
          date: '2026-09-24',
          price: 2.5,
          quantity: 1,
          quoteSource: OptionQuoteSource.RH_MCP,
        },
        now: NOW,
      },
      deps,
    );
    assert.deepEqual(calls, [CaptureEvent.ORDER_FILLED]);
  });

  it('fires position-closed after applyExitFill commits', async () => {
    const store: FakeStore = { accounts: new Map(), trades: new Map() };
    const calls: CaptureEvent[] = [];
    const deps = fakeDeps(store, async (_t, event) => {
      calls.push(event);
    });
    await applyEntryFill(entryInput('t-2'), deps);
    calls.length = 0;
    await applyExitFill(
      {
        userId: 'u1',
        tradeId: 't-2',
        fill: {
          fillId: 'exit-t-2',
          role: 'exit',
          date: '2026-09-25',
          price: 55,
          quantity: 100,
          quoteSource: OptionQuoteSource.RH_MCP,
        },
        now: '2026-09-25T19:00:00.000Z',
      },
      deps,
    );
    assert.deepEqual(calls, [CaptureEvent.POSITION_CLOSED]);
  });

  it('does not fire when the hook is absent (plain ledgerDeps shape)', async () => {
    const store: FakeStore = { accounts: new Map(), trades: new Map() };
    const result = await applyEntryFill(entryInput(), fakeDeps(store));
    assert.equal(result.trade.status, PaperTradeStatus.OPEN);
  });

  it('a throwing hook does not fail the fill (post-commit, swallowed)', async () => {
    const store: FakeStore = { accounts: new Map(), trades: new Map() };
    const deps = fakeDeps(store, async () => {
      throw new Error('capture exploded');
    });
    // The write already committed — a buggy hook must not propagate.
    const result = await applyEntryFill(entryInput(), deps);
    assert.equal(result.trade.status, PaperTradeStatus.OPEN);
  });
});

// ── Hook wrapper ────────────────────────────────────────────────────────────

describe('makeTradeLifecycleHook', () => {
  // NOTE: the production hook awaits captureLifecycleEvent against the real
  // db — covered by the #848 live verification. Here we only assert the
  // pure builder surface (above) plus that the wrapper shape is callable.
  it('returns an async hook', () => {
    const hook = makeTradeLifecycleHook({} as never);
    assert.equal(typeof hook, 'function');
  });
});

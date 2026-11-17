/**
 * @topic #984 — ST Firestore Reorg (task #1563)
 *
 * Unit tests for the ledger stats-increment seam: every paper-trade
 * lifecycle transition fans blind `FieldValue.increment` merge-sets into
 * the canonical stats scopes — `all`, `src-{source}`, `inst-{id}` when the
 * trade carries a strategy instance — inside one transaction that can
 * never throw into the fill path. The delta table mirrors
 * `computeStatsFromPositions` exactly; the nightly recompute remains the
 * self-healing authority over any drift.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Transaction } from 'firebase-admin/firestore';

import { FieldValue } from '../../../functions/src/firebase-admin-init';
import { TradeSide } from '../../../shared/common';
import { OptionQuoteSource, OptionType } from '../../../shared/options-common';
import {
  PaperTradeSource,
  PaperTradeStatus,
  PaperTradingKind,
  type PaperTrade,
  type PaperTradeLeg,
} from '../../../shared/paper-trading-contracts';
import {
  incrementStatsOnTransition,
  statsDeltasOnOpen,
  statsDeltasOnClose,
  statsDeltasOnSettle,
  type StatsIncrementDeps,
  type StatsIncrementDeltas,
} from '../../../functions/src/paper-trading/engine/stats-increments';
import { computeStatsFromPositions } from '../../../functions/src/paper-trading/engine/stats-utils';
import { tradeToPosition } from '../../../functions/src/paper-trading/engine/trade-adapter';
import { PositionStatus } from '../../../functions/src/paper-trading/engine/types';

const NOW = '2026-11-16T19:00:00.000Z';
const STATS_ROOT = 'st-paper-trading/stats/items';

// ── Fixtures ────────────────────────────────────────────────────────────────

function cspLeg(): PaperTradeLeg {
  return {
    kind: 'option',
    contractID: 'QQQM251120P00570000',
    type: OptionType.PUT,
    strike: 570,
    expiration: '2026-11-20',
    side: TradeSide.SHORT,
    quantity: 1,
    multiplier: 100,
    entryMark: 2.1,
    lastMark: 2.1,
  };
}

function strategyTrade(overrides: Partial<PaperTrade> = {}): PaperTrade {
  return {
    kind: PaperTradingKind.TRADE,
    id: '261116-st-QQQM-CSP-020-30',
    status: PaperTradeStatus.OPEN,
    source: PaperTradeSource.STRATEGY,
    strategyInstanceId: 'QQQM-CSP-020-30-D-1200',
    symbol: 'QQQM',
    expression: 'CSP',
    governingVariant: 'trailing-20',
    order: { side: TradeSide.SHORT, type: 'MARKET', quantity: 1 },
    fills: [
      {
        fillId: 'f1',
        role: 'entry',
        date: '2026-11-16',
        price: 2.1,
        quantity: 1,
        quoteSource: OptionQuoteSource.RH_MCP,
      },
    ],
    legs: [cspLeg()],
    marks: {},
    variantRuns: [],
    variantKeys: ['trailing-20'],
    realizedPnl: 0,
    unrealizedPnl: 0,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

// ── Fake txn: captures every set() the seam issues ─────────────────────────

interface SetCall {
  path: string;
  data: Record<string, unknown>;
  options: { merge?: boolean } | undefined;
}

function makeDeps(impl?: {
  runTransaction?: StatsIncrementDeps['runTransaction'];
  sets?: SetCall[];
}) {
  const sets: SetCall[] = impl?.sets ?? [];
  const deps: StatsIncrementDeps = {
    runTransaction:
      impl?.runTransaction ??
      (async <T>(work: (txn: Transaction) => Promise<T> | T) => {
        const txn = {
          set: (
            ref: { path: string },
            data: Record<string, unknown>,
            options?: { merge?: boolean },
          ) => {
            sets.push({ path: ref.path, data, options });
          },
        } as unknown as Transaction;
        return work(txn);
      }),
  };
  return { deps, sets };
}

const inc = (n: number) => FieldValue.increment(n);

// ── Tests ───────────────────────────────────────────────────────────────────

describe('incrementStatsOnTransition — scope resolution + write shape', () => {
  it('fans one transaction of blind increment merge-sets over all + src + inst', async () => {
    const { deps, sets } = makeDeps();
    const deltas = { openTradeCount: 1, totalPremiumCollected: 210 };

    let txnCount = 0;
    await incrementStatsOnTransition(
      {
        source: PaperTradeSource.STRATEGY,
        strategyInstanceId: 'QQQM-CSP-020-30-D-1200',
        deltas,
      },
      {
        runTransaction: async (work) => {
          txnCount++;
          return deps.runTransaction(work);
        },
      },
    );

    assert.equal(txnCount, 1);
    const paths = sets.map((s) => s.path);
    assert.deepEqual(paths, [
      `${STATS_ROOT}/stats-all`,
      `${STATS_ROOT}/stats-src-STRATEGY`,
      `${STATS_ROOT}/stats-inst-QQQM-CSP-020-30-D-1200`,
    ]);
    for (const [i, scope] of [
      'all',
      'src-STRATEGY',
      'inst-QQQM-CSP-020-30-D-1200',
    ].entries()) {
      const call = sets[i];
      assert.equal(call.options?.merge, true);
      assert.equal(call.data.kind, PaperTradingKind.STATS);
      assert.equal(call.data.scope, scope);
      assert.equal(typeof call.data.updatedAt, 'string');
      assert.ok((call.data.openTradeCount as FieldValue).isEqual(inc(1)));
      assert.ok((call.data.totalPremiumCollected as FieldValue).isEqual(inc(210)));
      // Every other counter rides inc(0) — mints the field on absent docs
      // (complete PaperStats counter shape) and no-ops on present ones.
      for (const f of [
        'closedTradeCount',
        'totalRealizedPnl',
        'totalUnrealizedPnl',
        'assignedCount',
        'expiredWorthlessCount',
        'maxDrawdown',
      ]) {
        assert.ok((call.data[f] as FieldValue).isEqual(inc(0)), `${f} not inc(0)`);
      }
    }
  });

  it('omits inst-* when the trade carries no strategyInstanceId (signal source)', async () => {
    const { deps, sets } = makeDeps();
    await incrementStatsOnTransition(
      {
        source: PaperTradeSource.SIGNAL,
        deltas: { openTradeCount: -1, closedTradeCount: 1, totalRealizedPnl: 75 },
      },
      deps,
    );
    assert.deepEqual(
      sets.map((s) => s.path),
      [`${STATS_ROOT}/stats-all`, `${STATS_ROOT}/stats-src-SIGNAL`],
    );
  });

  it('swallows a transaction failure — warn, never throws into the fill path', async () => {
    const deps: StatsIncrementDeps = {
      runTransaction: async () => {
        throw new Error('firestore unavailable');
      },
    };
    // Must resolve — a stats failure can never fail a fill.
    await incrementStatsOnTransition(
      { source: PaperTradeSource.MANUAL, deltas: { openTradeCount: 1 } },
      deps,
    );
  });

  it('swallows a throwing input thunk — argument eval stays inside the try', async () => {
    // The thunk form exists so delta/scope derivation can't throw out of
    // the never-throw boundary either.
    await incrementStatsOnTransition(() => {
      throw new Error('malformed trade');
    });
  });

  it('skips the transaction entirely when deltas are empty', async () => {
    let txnCount = 0;
    await incrementStatsOnTransition(
      { source: PaperTradeSource.STRATEGY, deltas: {} },
      {
        runTransaction: async () => {
          txnCount++;
        },
      },
    );
    assert.equal(txnCount, 0);
  });
});

describe('statsDeltasOnOpen — mirrors premiumCollected + open count', () => {
  it('SHORT option entry: open +1, premium = price × multiplier × quantity', () => {
    const deltas = statsDeltasOnOpen(strategyTrade());
    assert.deepEqual(deltas, {
      openTradeCount: 1,
      totalPremiumCollected: 210, // 2.10 × 100 × 1
    });
  });

  it('LONG entry collects no premium — the adapter maps premiumCollected 0', () => {
    const deltas = statsDeltasOnOpen(
      strategyTrade({
        order: { side: TradeSide.LONG, type: 'MARKET', quantity: 1 },
      }),
    );
    assert.deepEqual(deltas, { openTradeCount: 1, totalPremiumCollected: 0 });
  });
});

describe('statsDeltasOnClose — mirrors terminal realized counts', () => {
  it('open −1, closed +1, realized += the trade doc realizedPnl', () => {
    const deltas = statsDeltasOnClose(
      strategyTrade({ status: PaperTradeStatus.CLOSED, realizedPnl: 75 }),
    );
    assert.deepEqual(deltas, {
      openTradeCount: -1,
      closedTradeCount: 1,
      totalRealizedPnl: 75,
    });
  });

  it('closing from ASSIGNED hands assignedCount back (recompute parity)', () => {
    const deltas = statsDeltasOnClose(
      strategyTrade({ status: PaperTradeStatus.CLOSED, realizedPnl: 75 }),
      PaperTradeStatus.ASSIGNED,
    );
    assert.deepEqual(deltas, {
      openTradeCount: -1,
      closedTradeCount: 1,
      assignedCount: -1,
      totalRealizedPnl: 75,
    });
  });
});

describe('statsDeltasOnSettle — mirrors settlement branches', () => {
  it('EXPIRED_WORTHLESS: open −1, closed +1, expired +1, realized += premium', () => {
    assert.deepEqual(
      statsDeltasOnSettle(PositionStatus.EXPIRED_WORTHLESS, 210),
      {
        openTradeCount: -1,
        closedTradeCount: 1,
        expiredWorthlessCount: 1,
        totalRealizedPnl: 210,
      },
    );
  });

  it('ASSIGNED_HOLDING_SHARES: assigned +1 only — assigned counts as open', () => {
    assert.deepEqual(
      statsDeltasOnSettle(PositionStatus.ASSIGNED_HOLDING_SHARES, 210),
      { assignedCount: 1 },
    );
  });
});

// ── Recompute parity ────────────────────────────────────────────────────────
// The one contract that matters: accumulated deltas must equal
// `computeStatsFromPositions(post) − computeStatsFromPositions(pre)` on the
// increment-owned fields. (totalUnrealizedPnl/maxDrawdown/equityCurve are
// nightly-owned and excluded — they aren't transition deltas.)

const PARITY_FIELDS = {
  openTradeCount: 'openPositionCount',
  closedTradeCount: 'closedPositionCount',
  totalPremiumCollected: 'totalPremiumCollected',
  totalRealizedPnl: 'totalRealizedPnl',
  assignedCount: 'assignedCount',
  expiredWorthlessCount: 'expiredWorthlessCount',
} as const;

describe('parity with computeStatsFromPositions', () => {
  const recompute = (trades: PaperTrade[]) =>
    computeStatsFromPositions(trades.map(tradeToPosition), 'all', '2026-11-16');

  /** recompute(post) − recompute(pre) on the increment-owned fields. */
  const recomputeDiff = (
    pre: PaperTrade[],
    post: PaperTrade[],
  ): StatsIncrementDeltas => {
    const a = recompute(pre);
    const b = recompute(post);
    return Object.fromEntries(
      Object.entries(PARITY_FIELDS).map(([delta, stat]) => [
        delta,
        (b as Record<string, number>)[stat] - (a as Record<string, number>)[stat],
      ]),
    );
  };

  const assertParity = (
    pre: PaperTrade[],
    post: PaperTrade[],
    deltas: StatsIncrementDeltas,
  ) => {
    const expected = recomputeDiff(pre, post);
    for (const field of Object.keys(PARITY_FIELDS) as (keyof StatsIncrementDeltas)[]) {
      assert.equal(
        deltas[field] ?? 0,
        expected[field] ?? 0,
        `${field}: delta ${deltas[field] ?? 0} != recompute diff ${expected[field] ?? 0}`,
      );
    }
  };

  const openShort = () => strategyTrade();
  const openLong = () =>
    strategyTrade({
      order: { side: TradeSide.LONG, type: 'MARKET', quantity: 1 },
    });
  const closed = () =>
    strategyTrade({ status: PaperTradeStatus.CLOSED, realizedPnl: 160 });
  const assigned = () =>
    strategyTrade({ status: PaperTradeStatus.ASSIGNED, unrealizedPnl: 50 });
  const expired = () =>
    strategyTrade({ status: PaperTradeStatus.EXPIRED, realizedPnl: 210 });

  it('open (short): deltas == recompute diff', () => {
    const t = openShort();
    assertParity([], [t], statsDeltasOnOpen(t));
  });

  it('open (long): premium diff is 0 — collected premium is short-only', () => {
    const t = openLong();
    assertParity([], [t], statsDeltasOnOpen(t));
  });

  it('close from OPEN: deltas == recompute diff', () => {
    const post = closed();
    assertParity([openShort()], [post], statsDeltasOnClose(post, PaperTradeStatus.OPEN));
  });

  it('close from ASSIGNED: hands assignedCount back', () => {
    const post = closed();
    assertParity([assigned()], [post], statsDeltasOnClose(post, PaperTradeStatus.ASSIGNED));
  });

  it('settle EXPIRED: deltas == recompute diff (premium realized)', () => {
    assertParity(
      [openShort()],
      [expired()],
      statsDeltasOnSettle(PositionStatus.EXPIRED_WORTHLESS, 210),
    );
  });

  it('settle ASSIGNED: deltas == recompute diff (assigned bump only)', () => {
    assertParity(
      [openShort()],
      [assigned()],
      statsDeltasOnSettle(PositionStatus.ASSIGNED_HOLDING_SHARES, 210),
    );
  });
});

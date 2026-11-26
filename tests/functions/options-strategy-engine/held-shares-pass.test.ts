/**
 *
 * Unit tests for the held-shares mark pass (#1714): position-grain sweep
 * over all ASSIGNED trades (signal trades excluded — the signal machinery
 * owns those marks). Daily marks track the underlying close (not the
 * strike) and compute unrealized P&L on the resulting equity position.
 * Selection needs no instance, so held positions on legacy zombie docs and
 * STOPPED instances mark alongside manage positions.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { runHeldSharesMarkPass } from '../../../functions/src/options-strategy-engine/passes/held-shares-pass';
import type {
  HeldSharesMarkPassDependencies,
} from '../../../functions/src/options-strategy-engine/passes/held-shares-pass';
import { OptionQuoteSource } from '../../../shared/options-common';
import { TradeSide } from '../../../shared/common';
import {
  PaperTradeSource,
  PaperTradeStatus,
  PaperTradingKind,
  type PaperTrade,
} from '../../../shared/paper-trading-contracts';
import type { Position, DailyUpdate } from '../../../functions/src/options-strategy-engine/types';
import { PositionStatus } from '../../../functions/src/options-strategy-engine/types';

function makeHeldTrade(overrides: Partial<PaperTrade> = {}): PaperTrade {
  return {
    kind: PaperTradingKind.TRADE,
    id: 'inst-1-2025-08-01',
    status: PaperTradeStatus.ASSIGNED,
    legacyStatus: PositionStatus.ASSIGNED_HOLDING_SHARES,
    source: PaperTradeSource.STRATEGY,
    strategyInstanceId: 'inst-1',
    symbol: 'SPY',
    expression: 'CSP',
    governingVariant: 'hold-exp',
    order: { side: TradeSide.SHORT, type: 'LIMIT', quantity: 1, limitPrice: 0.5 },
    fills: [
      {
        fillId: 'f-1',
        role: 'entry',
        date: '2025-08-01',
        price: 0.5,
        quantity: 1,
        quoteSource: OptionQuoteSource.RH_MCP,
      },
    ],
    legs: [],
    marks: {},
    variantRuns: [],
    variantKeys: [],
    realizedPnl: 0,
    unrealizedPnl: -200,
    assignment: { strikePrice: 100, underlyingCloseAtExpiration: 98, assignedAt: '2025-08-15' },
    shares: { quantity: 1, costBasis: 100 },
    createdAt: '2025-08-01T00:00:00Z',
    updatedAt: '2025-08-15T18:00:00Z',
    ...overrides,
  };
}

function makeHeldDeps(overrides: {
  listAssignedTrades?: () => Promise<PaperTrade[]>;
  getUnderlyingClose?: (symbol: string, date: string) => Promise<number | null>;
  markHeldSharesPosition?: (
    positionId: string,
    update: { unrealizedPnl: number; currentValueAsOf: string },
    dailyUpdate: DailyUpdate,
  ) => Promise<void>;
} = {}): HeldSharesMarkPassDependencies & {
  markCalls: { positionId: string; update: { unrealizedPnl: number; currentValueAsOf: string }; dailyUpdate: DailyUpdate }[];
} {
  const markCalls: { positionId: string; update: { unrealizedPnl: number; currentValueAsOf: string }; dailyUpdate: DailyUpdate }[] = [];
  return {
    listAssignedTrades:
      overrides.listAssignedTrades ?? (async () => [makeHeldTrade()]),
    getUnderlyingClose: overrides.getUnderlyingClose ?? (async () => 97),
    markHeldSharesPosition:
      overrides.markHeldSharesPosition ??
      (async (
        positionId: string,
        update: { unrealizedPnl: number; currentValueAsOf: string },
        dailyUpdate: DailyUpdate,
      ) => {
        markCalls.push({ positionId, update, dailyUpdate });
      }),
    markCalls,
  };
}

describe('runHeldSharesMarkPass', () => {
  it('returns empty result when no held-shares positions', async () => {
    const deps = makeHeldDeps({
      listAssignedTrades: async () => [],
    });

    const result = await runHeldSharesMarkPass('2025-08-18', deps);

    assert.equal(result.date, '2025-08-18');
    assert.equal(result.marked.length, 0);
    assert.equal(result.errors.length, 0);
  });

  it('marks a held-shares position with the underlying close and computes P&L vs strike', async () => {
    // shares: quantity 1 contract, costBasis 100 (per-share strike). close 97.
    const deps = makeHeldDeps({
      getUnderlyingClose: async () => 97,
    });

    const result = await runHeldSharesMarkPass('2025-08-18', deps);

    assert.equal(result.marked.length, 1);
    const marked = result.marked[0];
    assert.equal(marked.positionId, 'inst-1-2025-08-01');
    assert.equal(marked.underlyingClose, 97);
    // currentValue = close * 100 * quantity = 97 * 100 * 1 = 9700
    assert.equal(marked.currentValue, 9700);
    // unrealizedPnl = (close - costBasis) * 100 * quantity = (97 - 100) * 100 = -300
    assert.equal(marked.unrealizedPnl, -300);

    assert.equal(deps.markCalls.length, 1);
    assert.equal(deps.markCalls[0].positionId, 'inst-1-2025-08-01');
    // currentValue is a Position-view computation — it rides the marked[]
    // result, not the doc update (which persists unrealizedPnl + asOf only).
    assert.equal(deps.markCalls[0].update.unrealizedPnl, -300);
    assert.ok(deps.markCalls[0].update.currentValueAsOf);
    assert.deepEqual(deps.markCalls[0].dailyUpdate, { date: '2025-08-18', underlyingClose: 97 });
  });

  it('prices each position against its OWN symbol', async () => {
    const deps = makeHeldDeps({
      listAssignedTrades: async () => [
        makeHeldTrade({ id: 'spy-pos', symbol: 'SPY' }),
        makeHeldTrade({ id: 'qqq-pos', symbol: 'QQQ' }),
      ],
      getUnderlyingClose: async (s) => (s === 'SPY' ? 97 : s === 'QQQ' ? 400 : null),
    });

    const result = await runHeldSharesMarkPass('2025-08-18', deps);

    assert.equal(result.marked.length, 2);
    assert.equal(result.marked[0].underlyingClose, 97);
    assert.equal(result.marked[1].underlyingClose, 400);
    assert.equal(result.marked[1].unrealizedPnl, (400 - 100) * 100 * 1);
  });

  it('marks held positions on zombie docs with no strategyInstanceId', async () => {
    const deps = makeHeldDeps({
      listAssignedTrades: async () => [
        makeHeldTrade({ id: '260819-abc', strategyInstanceId: undefined }),
      ],
    });

    const result = await runHeldSharesMarkPass('2025-08-18', deps);

    assert.equal(result.marked.length, 1);
    assert.equal(result.marked[0].positionId, '260819-abc');
    assert.equal(deps.markCalls[0].positionId, '260819-abc');
  });

  it('errors when no underlying closing bar is available for the date', async () => {
    const deps = makeHeldDeps({
      getUnderlyingClose: async () => null,
    });

    const result = await runHeldSharesMarkPass('2025-08-18', deps);

    assert.equal(result.marked.length, 0);
    assert.equal(result.errors.length, 1);
    assert.match(result.errors[0].error, /No usable underlying closing bar/);
    assert.equal(deps.markCalls.length, 0);
  });

  it('records an error and continues when one position fails', async () => {
    const posA = makeHeldTrade({ id: 'inst-1-2025-08-01' });
    const posB = makeHeldTrade({ id: 'inst-1-2025-07-25' });
    const markTracker: string[] = [];
    const deps = makeHeldDeps({
      listAssignedTrades: async () => [posA, posB],
      markHeldSharesPosition: async (positionId, update, dailyUpdate) => {
        if (positionId === 'inst-1-2025-08-01') {
          throw new Error('update failed');
        }
        markTracker.push(positionId);
      },
      getUnderlyingClose: async () => 97,
    });

    const result = await runHeldSharesMarkPass('2025-08-18', deps);

    assert.equal(result.marked.length, 1);
    assert.equal(result.marked[0].positionId, 'inst-1-2025-07-25');
    assert.equal(result.errors.length, 1);
    assert.equal(result.errors[0].positionId, 'inst-1-2025-08-01');
    assert.match(result.errors[0].error, /update failed/);
    assert.deepEqual(markTracker, ['inst-1-2025-07-25']);
  });
});

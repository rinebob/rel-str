/**
 *
 * Unit tests for the held-shares mark pass: daily marks for positions in
 * ASSIGNED_HOLDING_SHARES status, tracking the underlying close (not the
 * strike) and computing unrealized P&L on the resulting equity position.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { runHeldSharesMarkPass } from '../../../functions/src/options-strategy-engine/passes/held-shares-pass';
import type {
  HeldSharesMarkPassDependencies,
} from '../../../functions/src/options-strategy-engine/passes/held-shares-pass';
import { OptionType, PositionSpreadType, StrategyFrequency } from '../../../shared/options-common';
import { TradeSide } from '../../../shared/common';
import { ExitPolicy, LifecycleState, type StrategyInstanceConfig } from '../../../shared/options-strategy-engine-contracts';
import type { Position, DailyUpdate } from '../../../functions/src/options-strategy-engine/types';
import { PositionStatus } from '../../../functions/src/options-strategy-engine/types';

function makeConfig(
  overrides: Partial<StrategyInstanceConfig> = {},
): StrategyInstanceConfig {
  return {
    id: 'inst-1',
    symbol: 'SPY',
    optionType: OptionType.PUT,
    side: TradeSide.SHORT,
    dteMin: 2,
    dteMax: 5,
    targetDelta: 0.3,
    phases: [
      {
        spreadType: PositionSpreadType.CASH_SECURED_PUT,
        targetDelta: 0.3,
        dteMin: 2,
        dteMax: 5,
      },
    ],
    frequency: StrategyFrequency.DAILY,
    openTimePT: '12:00',
    exitPolicies: [{ policy: ExitPolicy.HOLD_TO_EXPIRATION }],
    lifecycleState: LifecycleState.ACTIVE,
    userId: 'test-user',
    createdAt: '2025-08-16T00:00:00Z',
    updatedAt: '2025-08-16T00:00:00Z',
    ...overrides,
  };
}

function makeHeldPosition(overrides: Partial<Position> = {}): Position {
  return {
    id: 'inst-1-2025-08-01',
    instanceId: 'inst-1',
    symbol: 'SPY',
    status: PositionStatus.ASSIGNED_HOLDING_SHARES,
    premiumCollected: 50,
    capitalRequired: 10000,
    openDate: '2025-08-01',
    currentValue: 9800,
    currentValueAsOf: '2025-08-15T18:00:00Z',
    unrealizedPnl: -200,
    assignment: { strikePrice: 100, underlyingCloseAtExpiration: 98, assignedAt: '2025-08-15' },
    shares: { quantity: 1, costBasis: 100 },
    ...overrides,
  };
}

function makeHeldDeps(overrides: {
  listHeldSharesPositions?: (instanceId: string) => Promise<Position[]>;
  getUnderlyingClose?: (symbol: string, date: string) => Promise<number | null>;
  markHeldSharesPosition?: (
    positionId: string,
    update: Partial<Position>,
    dailyUpdate: DailyUpdate,
  ) => Promise<void>;
} = {}): HeldSharesMarkPassDependencies & {
  markCalls: { positionId: string; update: Partial<Position>; dailyUpdate: DailyUpdate }[];
} {
  const markCalls: { positionId: string; update: Partial<Position>; dailyUpdate: DailyUpdate }[] = [];
  return {
    listHeldSharesPositions:
      overrides.listHeldSharesPositions ?? (async () => [makeHeldPosition()]),
    getUnderlyingClose: overrides.getUnderlyingClose ?? (async () => 97),
    markHeldSharesPosition:
      overrides.markHeldSharesPosition ??
      (async (
        positionId: string,
        update: Partial<Position>,
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
      listHeldSharesPositions: async () => [],
    });

    const result = await runHeldSharesMarkPass('inst-1', '2025-08-18', makeConfig(), deps);

    assert.equal(result.instanceId, 'inst-1');
    assert.equal(result.date, '2025-08-18');
    assert.equal(result.marked.length, 0);
    assert.equal(result.deferred.length, 0);
    assert.equal(result.errors.length, 0);
  });

  it('marks a held-shares position with the underlying close and computes P&L vs strike', async () => {
    // shares: quantity 1 contract, costBasis 100 (per-share strike). close 97.
    const deps = makeHeldDeps({
      getUnderlyingClose: async () => 97,
    });

    const result = await runHeldSharesMarkPass('inst-1', '2025-08-18', makeConfig(), deps);

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
    assert.equal(deps.markCalls[0].update.currentValue, 9700);
    assert.equal(deps.markCalls[0].update.unrealizedPnl, -300);
    assert.ok(deps.markCalls[0].update.currentValueAsOf);
    assert.deepEqual(deps.markCalls[0].dailyUpdate, { date: '2025-08-18', underlyingClose: 97 });
  });

  it('errors when no underlying closing bar is available for the date', async () => {
    const deps = makeHeldDeps({
      getUnderlyingClose: async () => null,
    });

    const result = await runHeldSharesMarkPass('inst-1', '2025-08-18', makeConfig(), deps);

    assert.equal(result.marked.length, 0);
    assert.equal(result.errors.length, 1);
    assert.match(result.errors[0].error, /No underlying closing bar/);
    assert.equal(deps.markCalls.length, 0);
  });

  it('records an error and continues when one position fails', async () => {
    const posA = makeHeldPosition({ id: 'inst-1-2025-08-01' });
    const posB = makeHeldPosition({ id: 'inst-1-2025-07-25' });
    const markTracker: string[] = [];
    const deps = makeHeldDeps({
      listHeldSharesPositions: async () => [posA, posB],
      markHeldSharesPosition: async (positionId, update, dailyUpdate) => {
        if (positionId === 'inst-1-2025-08-01') {
          throw new Error('update failed');
        }
        markTracker.push(positionId);
      },
      getUnderlyingClose: async () => 97,
    });

    const result = await runHeldSharesMarkPass('inst-1', '2025-08-18', makeConfig(), deps);

    assert.equal(result.marked.length, 1);
    assert.equal(result.marked[0].positionId, 'inst-1-2025-07-25');
    assert.equal(result.errors.length, 1);
    assert.equal(result.errors[0].positionId, 'inst-1-2025-08-01');
    assert.match(result.errors[0].error, /update failed/);
    assert.deepEqual(markTracker, ['inst-1-2025-07-25']);
  });
});

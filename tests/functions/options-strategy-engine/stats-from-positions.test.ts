/**
 * @topic #108 — Options Position Strategy Engine
 *
 * Unit tests for computeStatsFromPositions — the pure computation that turns
 * a list of positions into a StrategyStats object (no Firestore).
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { computeStatsFromPositions } from '../../../functions/src/options-strategy-engine/stats-utils';
import type { Position } from '../../../functions/src/options-strategy-engine/types';
import { PositionStatus } from '../../../functions/src/options-strategy-engine/types';

function makePosition(overrides: Partial<Position> = {}): Position {
  return {
    id: 'inst-1-2026-01-01',
    instanceId: 'inst-1',
    symbol: 'QQQM',
    status: PositionStatus.OPEN,
    premiumCollected: 50,
    capitalRequired: 10000,
    openDate: '2026-01-01',
    currentValue: 30,
    currentValueAsOf: '2026-01-05',
    unrealizedPnl: 20,
    ...overrides,
  };
}

describe('computeStatsFromPositions', () => {
  it('returns zeroed stats for an empty position list', () => {
    const stats = computeStatsFromPositions([], 'inst-1', '2026-01-10');

    assert.equal(stats.scope, 'inst-1');
    assert.equal(stats.totalPremiumCollected, 0);
    assert.equal(stats.totalRealizedPnl, 0);
    assert.equal(stats.totalUnrealizedPnl, 0);
    assert.equal(stats.openPositionCount, 0);
    assert.equal(stats.closedPositionCount, 0);
    assert.equal(stats.assignedCount, 0);
    assert.equal(stats.expiredWorthlessCount, 0);
    assert.equal(stats.maxDrawdown, 0);
    assert.equal(stats.lastUpdated, '2026-01-10');
  });

  it('counts a single OPEN position correctly', () => {
    const stats = computeStatsFromPositions(
      [makePosition()],
      'inst-1',
      '2026-01-10',
    );

    assert.equal(stats.openPositionCount, 1);
    assert.equal(stats.closedPositionCount, 0);
    assert.equal(stats.totalPremiumCollected, 50);
    assert.equal(stats.totalUnrealizedPnl, 20);
    assert.equal(stats.totalRealizedPnl, 0);
    assert.equal(stats.assignedCount, 0);
    assert.equal(stats.expiredWorthlessCount, 0);
  });

  it('counts EXPIRED_WORTHLESS as closed with realized P&L = premium', () => {
    const pos = makePosition({
      id: 'inst-1-2026-01-02',
      status: PositionStatus.EXPIRED_WORTHLESS,
      premiumCollected: 75,
      unrealizedPnl: 0,
      currentValue: 0,
    });
    const stats = computeStatsFromPositions([pos], 'inst-1', '2026-01-10');

    assert.equal(stats.openPositionCount, 0);
    assert.equal(stats.closedPositionCount, 1);
    assert.equal(stats.expiredWorthlessCount, 1);
    assert.equal(stats.assignedCount, 0);
    assert.equal(stats.totalRealizedPnl, 75);
    assert.equal(stats.totalUnrealizedPnl, 0);
    assert.equal(stats.totalPremiumCollected, 75);
  });

  it('counts ASSIGNED_HOLDING_SHARES as open with unrealized P&L', () => {
    const pos = makePosition({
      id: 'inst-1-2026-01-03',
      status: PositionStatus.ASSIGNED_HOLDING_SHARES,
      premiumCollected: 50,
      unrealizedPnl: -200,
      currentValue: 9800,
    });
    const stats = computeStatsFromPositions([pos], 'inst-1', '2026-01-10');

    assert.equal(stats.openPositionCount, 1);
    assert.equal(stats.closedPositionCount, 0);
    assert.equal(stats.assignedCount, 1);
    assert.equal(stats.expiredWorthlessCount, 0);
    assert.equal(stats.totalRealizedPnl, 0);
    assert.equal(stats.totalUnrealizedPnl, -200);
    assert.equal(stats.totalPremiumCollected, 50);
  });

  it('aggregates a mix of OPEN, EXPIRED_WORTHLESS, and ASSIGNED positions', () => {
    const positions = [
      makePosition({ id: 'p1', status: PositionStatus.OPEN, premiumCollected: 50, unrealizedPnl: 20 }),
      makePosition({ id: 'p2', status: PositionStatus.EXPIRED_WORTHLESS, premiumCollected: 75, unrealizedPnl: 0, currentValue: 0 }),
      makePosition({ id: 'p3', status: PositionStatus.EXPIRED_WORTHLESS, premiumCollected: 60, unrealizedPnl: 0, currentValue: 0 }),
      makePosition({ id: 'p4', status: PositionStatus.ASSIGNED_HOLDING_SHARES, premiumCollected: 40, unrealizedPnl: -200, currentValue: 9800 }),
    ];
    const stats = computeStatsFromPositions(positions, 'inst-1', '2026-01-10');

    assert.equal(stats.openPositionCount, 2); // OPEN + ASSIGNED_HOLDING_SHARES
    assert.equal(stats.closedPositionCount, 2); // 2x EXPIRED_WORTHLESS
    assert.equal(stats.expiredWorthlessCount, 2);
    assert.equal(stats.assignedCount, 1);
    assert.equal(stats.totalPremiumCollected, 225); // 50 + 75 + 60 + 40
    assert.equal(stats.totalRealizedPnl, 135); // 75 + 60 (premium from expired)
    assert.equal(stats.totalUnrealizedPnl, -180); // 20 + 0 + 0 + (-200)
  });
});

/**
 * @topic #108 — Options Position Strategy Engine
 *
 * Unit tests for stats-repository: recomputeStats writes stats doc + equity
 * curve point atomically, with max drawdown computed from the full series.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { recomputeStats, getStats, getEquityCurve } from '../../../functions/src/options-strategy-engine/stats-repository';
import type { StatsRepositoryDependencies } from '../../../functions/src/options-strategy-engine/stats-repository';
import type { Position, StrategyStats, EquityCurvePoint } from '../../../functions/src/options-strategy-engine/types';
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

function makeDeps(overrides: {
  getExistingEquityCurve?: (scope: string) => Promise<EquityCurvePoint[]>;
  writeStatsAtomically?: (
    scope: string,
    stats: StrategyStats,
    point: EquityCurvePoint,
  ) => Promise<void>;
} = {}): StatsRepositoryDependencies & {
  atomicWrites: { scope: string; stats: StrategyStats; point: EquityCurvePoint }[];
} {
  const atomicWrites: { scope: string; stats: StrategyStats; point: EquityCurvePoint }[] = [];
  return {
    getExistingEquityCurve:
      overrides.getExistingEquityCurve ?? (async () => []),
    writeStatsAtomically:
      overrides.writeStatsAtomically ??
      (async (scope: string, stats: StrategyStats, point: EquityCurvePoint) => {
        atomicWrites.push({ scope, stats, point });
      }),
    atomicWrites,
  };
}

describe('recomputeStats', () => {
  it('writes zeroed stats and a zero cumulative P&L point for no positions', async () => {
    const deps = makeDeps();

    await recomputeStats('inst-1', '2026-01-10', [], deps);

    assert.equal(deps.atomicWrites.length, 1);
    const { scope, stats, point } = deps.atomicWrites[0];
    assert.equal(scope, 'inst-1');
    assert.equal(stats.totalPremiumCollected, 0);
    assert.equal(stats.totalRealizedPnl, 0);
    assert.equal(stats.totalUnrealizedPnl, 0);
    assert.equal(stats.maxDrawdown, 0);
    assert.equal(stats.lastUpdated, '2026-01-10');
    assert.equal(point.date, '2026-01-10');
    assert.equal(point.cumulativePnl, 0);
  });

  it('writes stats with cumulative P&L = realized + unrealized and appends equity-curve point', async () => {
    const positions = [
      makePosition({ id: 'p1', status: PositionStatus.EXPIRED_WORTHLESS, premiumCollected: 75, unrealizedPnl: 0 }),
      makePosition({ id: 'p2', status: PositionStatus.OPEN, premiumCollected: 50, unrealizedPnl: 20 }),
    ];
    const deps = makeDeps();

    await recomputeStats('inst-1', '2026-01-10', positions, deps);

    const { stats, point } = deps.atomicWrites[0];
    // cumulative = realized (75) + unrealized (20) = 95
    assert.equal(point.cumulativePnl, 95);
    assert.equal(point.date, '2026-01-10');
    assert.equal(stats.totalRealizedPnl, 75);
    assert.equal(stats.totalUnrealizedPnl, 20);
  });

  it('computes max drawdown from existing equity curve + new point', async () => {
    // Existing curve: peak 200, trough 80 → drawdown 120
    const existingCurve: EquityCurvePoint[] = [
      { date: '2026-01-01', cumulativePnl: 0 },
      { date: '2026-01-02', cumulativePnl: 200 },
      { date: '2026-01-03', cumulativePnl: 80 },
    ];
    // Two positions: EXPIRED_WORTHLESS (realized 75) + OPEN (unrealized 20)
    // cumulative = 75 + 20 = 95 (above trough 80, so drawdown stays 120)
    const positions = [
      makePosition({ id: 'p1', status: PositionStatus.EXPIRED_WORTHLESS, premiumCollected: 75, unrealizedPnl: 0 }),
      makePosition({ id: 'p2', status: PositionStatus.OPEN, premiumCollected: 50, unrealizedPnl: 20 }),
    ];
    const deps = makeDeps({
      getExistingEquityCurve: async () => existingCurve,
    });

    await recomputeStats('inst-1', '2026-01-10', positions, deps);

    const { stats, point } = deps.atomicWrites[0];
    assert.equal(stats.maxDrawdown, 120);
    // New point: realized 75 + unrealized 20 = 95
    assert.equal(point.cumulativePnl, 95);
  });

  it('updates max drawdown when new point creates a larger drawdown', async () => {
    // Existing: peak 100, trough 80 → drawdown 20
    const existingCurve: EquityCurvePoint[] = [
      { date: '2026-01-01', cumulativePnl: 0 },
      { date: '2026-01-02', cumulativePnl: 100 },
      { date: '2026-01-03', cumulativePnl: 80 },
    ];
    // New point: cumulative = -100 (below trough 80, so drawdown = 100 - (-100) = 200)
    const positions = [
      makePosition({ id: 'p1', status: PositionStatus.ASSIGNED_HOLDING_SHARES, premiumCollected: 50, unrealizedPnl: -100 }),
    ];
    const deps = makeDeps({
      getExistingEquityCurve: async () => existingCurve,
    });

    await recomputeStats('inst-1', '2026-01-10', positions, deps);

    const { stats, point } = deps.atomicWrites[0];
    // peak 100, new point -100 → drawdown = 100 - (-100) = 200
    assert.equal(stats.maxDrawdown, 200);
    // realized 0 + unrealized -100 = -100
    assert.equal(point.cumulativePnl, -100);
  });

  it('replaces existing equity-curve point for the same date (idempotent re-run)', async () => {
    const existingCurve: EquityCurvePoint[] = [
      { date: '2026-01-10', cumulativePnl: 50 }, // same date as today
    ];
    const deps = makeDeps({
      getExistingEquityCurve: async () => existingCurve,
    });

    await recomputeStats('inst-1', '2026-01-10', [], deps);

    // Should write a new point for the same date (overwrite via doc ID)
    assert.equal(deps.atomicWrites.length, 1);
    assert.equal(deps.atomicWrites[0].point.date, '2026-01-10');
    assert.equal(deps.atomicWrites[0].point.cumulativePnl, 0);
  });

  it('returns maxDrawdown 0 when equity curve is empty and first point is the only point', async () => {
    // No existing curve, single position with unrealized P&L = first point
    const positions = [
      makePosition({ id: 'p1', status: PositionStatus.OPEN, premiumCollected: 50, unrealizedPnl: 20 }),
    ];
    const deps = makeDeps({
      getExistingEquityCurve: async () => [],
    });

    await recomputeStats('inst-1', '2026-01-10', positions, deps);

    const { stats, point } = deps.atomicWrites[0];
    // Single point: no drawdown possible
    assert.equal(stats.maxDrawdown, 0);
    assert.equal(point.cumulativePnl, 20);
  });
});

describe('getStats', () => {
  it('returns null when no stats doc exists', async () => {
    const deps = makeDeps();
    // getStats uses the real Firestore helper by default; test with injected read
    const result = await getStats('inst-1', {
      ...deps,
      readStatsDoc: async () => null,
    });
    assert.equal(result, null);
  });

  it('returns the stats doc when it exists', async () => {
    const stats: StrategyStats = {
      scope: 'inst-1',
      totalPremiumCollected: 100,
      totalRealizedPnl: 50,
      totalUnrealizedPnl: 20,
      openPositionCount: 1,
      closedPositionCount: 1,
      assignedCount: 0,
      expiredWorthlessCount: 1,
      maxDrawdown: 30,
      lastUpdated: '2026-01-09',
    };
    const result = await getStats('inst-1', {
      readStatsDoc: async () => stats,
    });
    assert.deepEqual(result, stats);
  });
});

describe('getEquityCurve', () => {
  it('returns empty array when no points exist', async () => {
    const result = await getEquityCurve('inst-1', {
      readEquityCurve: async () => [],
    });
    assert.deepEqual(result, []);
  });

  it('returns points sorted by date', async () => {
    const points: EquityCurvePoint[] = [
      { date: '2026-01-02', cumulativePnl: 50 },
      { date: '2026-01-01', cumulativePnl: 0 },
      { date: '2026-01-03', cumulativePnl: 100 },
    ];
    const result = await getEquityCurve('inst-1', {
      readEquityCurve: async () => points,
    });
    assert.deepEqual(result, [
      { date: '2026-01-01', cumulativePnl: 0 },
      { date: '2026-01-02', cumulativePnl: 50 },
      { date: '2026-01-03', cumulativePnl: 100 },
    ]);
  });
});

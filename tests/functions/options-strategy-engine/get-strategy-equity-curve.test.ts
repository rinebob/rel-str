/**
 *
 * Unit tests for the getStrategyEquityCurve callable handler — auth check,
 * instanceId → scope mapping, returns equity curve points + stats.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { handleGetStrategyEquityCurve } from '../../../functions/src/options-strategy-engine/options-strategy-callables';
import type { GetStrategyEquityCurveRequest } from '../../../functions/src/options-strategy-engine/options-strategy-callables';
import type {
  EquityCurvePoint,
  StrategyStats,
} from '../../../functions/src/options-strategy-engine/types';

const samplePoints: EquityCurvePoint[] = [
  { date: '2026-01-01', cumulativePnl: 0 },
  { date: '2026-01-02', cumulativePnl: 50 },
  { date: '2026-01-03', cumulativePnl: 120 },
];

const sampleStats: StrategyStats = {
  scope: 'QQQM-WHEEL',
  totalPremiumCollected: 150,
  totalRealizedPnl: 75,
  totalUnrealizedPnl: 45,
  openPositionCount: 1,
  closedPositionCount: 1,
  assignedCount: 0,
  expiredWorthlessCount: 1,
  maxDrawdown: 30,
  lastUpdated: '2026-01-03',
};

describe('handleGetStrategyEquityCurve', () => {
  it('throws unauthenticated when no auth context', async () => {
    await assert.rejects(
      () =>
        handleGetStrategyEquityCurve(
          { data: { instanceId: 'QQQM-WHEEL' } },
          { readEquityCurve: async () => [], readStatsDoc: async () => null },
        ),
      /Must be signed in/i,
    );
  });

  it('uses "ALL" scope when no instanceId provided', async () => {
    let receivedScope: string | undefined;
    await handleGetStrategyEquityCurve(
      { data: {} as GetStrategyEquityCurveRequest, auth: { uid: 'test-user' } },
      {
        readEquityCurve: async (scope) => {
          receivedScope = scope;
          return samplePoints;
        },
        readStatsDoc: async (scope) => {
          receivedScope = scope;
          return { ...sampleStats, scope: 'ALL' };
        },
      },
    );
    assert.equal(receivedScope, 'ALL');
  });

  it('uses instanceId as scope when provided', async () => {
    let receivedScope: string | undefined;
    await handleGetStrategyEquityCurve(
      { data: { instanceId: 'QQQM-WHEEL' }, auth: { uid: 'test-user' } },
      {
        readEquityCurve: async (scope) => {
          receivedScope = scope;
          return samplePoints;
        },
        readStatsDoc: async () => sampleStats,
      },
    );
    assert.equal(receivedScope, 'QQQM-WHEEL');
  });

  it('returns sorted equity curve points + stats for a scope', async () => {
    const result = await handleGetStrategyEquityCurve(
      { data: { instanceId: 'QQQM-WHEEL' }, auth: { uid: 'test-user' } },
      {
        readEquityCurve: async () => [...samplePoints].reverse(),
        readStatsDoc: async () => sampleStats,
      },
    );
    assert.equal(result.points.length, 3);
    // Points should be sorted oldest-first
    assert.equal(result.points[0].date, '2026-01-01');
    assert.equal(result.points[2].date, '2026-01-03');
    assert.equal(result.stats?.scope, 'QQQM-WHEEL');
    assert.equal(result.stats?.maxDrawdown, 30);
  });

  it('returns empty points + null stats when no data exists for scope', async () => {
    const result = await handleGetStrategyEquityCurve(
      { data: { instanceId: 'UNKNOWN' }, auth: { uid: 'test-user' } },
      { readEquityCurve: async () => [], readStatsDoc: async () => null },
    );
    assert.deepEqual(result.points, []);
    assert.equal(result.stats, null);
  });

  it('returns ALL-scope stats when no instanceId provided', async () => {
    const allStats: StrategyStats = { ...sampleStats, scope: 'ALL' };
    const result = await handleGetStrategyEquityCurve(
      { data: {}, auth: { uid: 'test-user' } },
      {
        readEquityCurve: async () => samplePoints,
        readStatsDoc: async () => allStats,
      },
    );
    assert.equal(result.stats?.scope, 'ALL');
    assert.equal(result.points.length, 3);
  });
});

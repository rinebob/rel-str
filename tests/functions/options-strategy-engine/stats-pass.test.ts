/**
 *
 * Unit tests for the stats pass: recomputes per-instance and ALL-scope stats
 * from positions, writing stats docs + equity-curve points.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { runStatsPass } from '../../../functions/src/options-strategy-engine/passes/stats-pass';
import type { StatsPassDependencies } from '../../../functions/src/options-strategy-engine/passes/stats-pass';
import type { Position, StrategyStats, EquityCurvePoint } from '../../../functions/src/options-strategy-engine/types';
import { PositionStatus } from '../../../functions/src/options-strategy-engine/types';

function makePosition(overrides: Partial<Position> = {}): Position {
  return {
    id: 'QQQM-WHEEL-2026-01-01',
    instanceId: 'QQQM-WHEEL',
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
  listPositionsByInstance?: (instanceId: string) => Promise<Position[]>;
  listAllPositions?: () => Promise<Position[]>;
  recomputeStats?: (
    scope: string,
    date: string,
    positions: Position[],
  ) => Promise<void>;
} = {}): StatsPassDependencies & {
  recomputes: { scope: string; date: string; positions: Position[] }[];
} {
  const recomputes: { scope: string; date: string; positions: Position[] }[] = [];
  return {
    listPositionsByInstance:
      overrides.listPositionsByInstance ?? (async () => []),
    listAllPositions:
      overrides.listAllPositions ?? (async () => []),
    recomputeStats:
      overrides.recomputeStats ??
      (async (scope: string, date: string, positions: Position[]) => {
        recomputes.push({ scope, date, positions });
      }),
    recomputes,
  };
}

describe('runStatsPass', () => {
  it('recomputes per-instance and ALL scopes for a single instance', async () => {
    const positions = [
      makePosition({ id: 'p1', status: PositionStatus.OPEN, premiumCollected: 50, unrealizedPnl: 20 }),
      makePosition({ id: 'p2', status: PositionStatus.EXPIRED_WORTHLESS, premiumCollected: 75, unrealizedPnl: 0 }),
    ];
    const deps = makeDeps({
      listPositionsByInstance: async (instanceId: string) => {
        assert.equal(instanceId, 'QQQM-WHEEL');
        return positions;
      },
      listAllPositions: async () => positions,
    });

    const result = await runStatsPass('QQQM-WHEEL', '2026-01-10', deps);

    assert.equal(deps.recomputes.length, 2);
    assert.equal(deps.recomputes[0].scope, 'QQQM-WHEEL');
    assert.equal(deps.recomputes[0].date, '2026-01-10');
    assert.equal(deps.recomputes[0].positions.length, 2);
    assert.equal(deps.recomputes[1].scope, 'ALL');
    assert.equal(deps.recomputes[1].date, '2026-01-10');
    assert.equal(deps.recomputes[1].positions.length, 2);

    assert.equal(result.scopesWritten.length, 2);
    assert.deepEqual(result.scopesWritten, ['QQQM-WHEEL', 'ALL']);
  });

  it('recomputes ALL scope with positions from all instances', async () => {
    const qqqmPositions = [
      makePosition({ id: 'QQQM-WHEEL-2026-01-01', instanceId: 'QQQM-WHEEL', premiumCollected: 50 }),
    ];
    const spyPositions = [
      makePosition({ id: 'SPY-WHEEL-2026-01-01', instanceId: 'SPY-WHEEL', symbol: 'SPY', premiumCollected: 30 }),
    ];
    const deps = makeDeps({
      listPositionsByInstance: async (instanceId: string) => {
        return instanceId === 'QQQM-WHEEL' ? qqqmPositions : spyPositions;
      },
      listAllPositions: async () => [...qqqmPositions, ...spyPositions],
    });

    const result = await runStatsPass('QQQM-WHEEL', '2026-01-10', deps);

    // Per-instance scope gets only QQQM positions
    assert.equal(deps.recomputes[0].scope, 'QQQM-WHEEL');
    assert.equal(deps.recomputes[0].positions.length, 1);
    // ALL scope gets both
    assert.equal(deps.recomputes[1].scope, 'ALL');
    assert.equal(deps.recomputes[1].positions.length, 2);
  });

  it('handles an instance with no positions (writes zeroed stats)', async () => {
    const deps = makeDeps({
      listPositionsByInstance: async () => [],
      listAllPositions: async () => [],
    });

    const result = await runStatsPass('QQQM-WHEEL', '2026-01-10', deps);

    assert.equal(deps.recomputes.length, 2);
    assert.equal(deps.recomputes[0].positions.length, 0);
    assert.equal(deps.recomputes[1].positions.length, 0);
    assert.equal(result.scopesWritten.length, 2);
  });

  it('fails fast when per-instance recompute throws (ALL scope not attempted)', async () => {
    const deps = makeDeps({
      listPositionsByInstance: async () => [makePosition()],
      listAllPositions: async () => [makePosition()],
      recomputeStats: async (scope: string, date: string, positions: Position[]) => {
        if (scope === 'QQQM-WHEEL') {
          throw new Error('per-instance write failed');
        }
        deps.recomputes.push({ scope, date, positions });
      },
    });

    await assert.rejects(
      runStatsPass('QQQM-WHEEL', '2026-01-10', deps),
      /per-instance write failed/,
    );
  });
});

/**
 *
 * Unit tests for the listStrategyPositions callable handler — auth check,
 * delegates to listAllPositions + buildPositionsResponse, filters by
 * instanceId and status.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { handleListStrategyPositions } from '../../../functions/src/options-strategy-engine/options-strategy-callables';
import type { Position } from '../../../functions/src/options-strategy-engine/types';
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

describe('handleListStrategyPositions', () => {
  it('throws unauthenticated when no auth context', async () => {
    await assert.rejects(
      () => handleListStrategyPositions({ data: {} }, { listAllPositions: async () => [] }),
      /Must be signed in/i,
    );
  });

  it('returns empty open/closed arrays when no positions exist', async () => {
    const result = await handleListStrategyPositions(
      { data: {}, auth: { uid: 'test-user' } },
      { listAllPositions: async () => [] },
    );
    assert.deepEqual(result.openPositions, []);
    assert.deepEqual(result.closedPositions, []);
  });

  it('splits positions into open and closed arrays', async () => {
    const positions = [
      makePosition({ id: 'p1', status: PositionStatus.OPEN }),
      makePosition({ id: 'p2', status: PositionStatus.EXPIRED_WORTHLESS }),
    ];
    const result = await handleListStrategyPositions(
      { data: {}, auth: { uid: 'test-user' } },
      { listAllPositions: async () => positions },
    );
    assert.equal(result.openPositions.length, 1);
    assert.equal(result.closedPositions.length, 1);
  });

  it('passes instanceId filter through to listAllPositions', async () => {
    let receivedInstanceId: string | undefined = 'not-called';
    const result = await handleListStrategyPositions(
      { data: { instanceId: 'QQQM-WHEEL' }, auth: { uid: 'test-user' } },
      {
        listAllPositions: async (instanceId?: string) => {
          receivedInstanceId = instanceId;
          return [makePosition({ id: 'p1', instanceId: 'QQQM-WHEEL' })];
        },
      },
    );
    assert.equal(receivedInstanceId, 'QQQM-WHEEL');
    assert.equal(result.openPositions.length, 1);
  });

  it('filters by status when status is provided', async () => {
    const positions = [
      makePosition({ id: 'p1', status: PositionStatus.OPEN }),
      makePosition({ id: 'p2', status: PositionStatus.EXPIRED_WORTHLESS }),
      makePosition({ id: 'p3', status: PositionStatus.ASSIGNED_HOLDING_SHARES }),
    ];
    const result = await handleListStrategyPositions(
      { data: { status: PositionStatus.EXPIRED_WORTHLESS }, auth: { uid: 'test-user' } },
      { listAllPositions: async () => positions },
    );
    // Only EXPIRED_WORTHLESS positions pass the filter, and they go to closedPositions
    assert.equal(result.openPositions.length, 0);
    assert.equal(result.closedPositions.length, 1);
    assert.equal(result.closedPositions[0].id, 'p2');
  });
});

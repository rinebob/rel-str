/**
 *
 * Unit tests for buildPositionsResponse — splits a flat position list into
 * open and closed arrays for the dashboard.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildPositionsResponse } from '../../../functions/src/options-strategy-engine/strategy-query-service';
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

describe('buildPositionsResponse', () => {
  it('returns empty arrays for an empty position list', () => {
    const result = buildPositionsResponse([]);
    assert.deepEqual(result.openPositions, []);
    assert.deepEqual(result.closedPositions, []);
  });

  it('splits OPEN positions into openPositions', () => {
    const positions = [makePosition({ id: 'p1', status: PositionStatus.OPEN })];
    const result = buildPositionsResponse(positions);
    assert.equal(result.openPositions.length, 1);
    assert.equal(result.closedPositions.length, 0);
    assert.equal(result.openPositions[0].id, 'p1');
  });

  it('splits ASSIGNED_HOLDING_SHARES into openPositions (still holding)', () => {
    const positions = [
      makePosition({ id: 'p1', status: PositionStatus.ASSIGNED_HOLDING_SHARES }),
    ];
    const result = buildPositionsResponse(positions);
    assert.equal(result.openPositions.length, 1);
    assert.equal(result.closedPositions.length, 0);
  });

  it('splits EXPIRED_WORTHLESS into closedPositions', () => {
    const positions = [
      makePosition({ id: 'p1', status: PositionStatus.EXPIRED_WORTHLESS }),
    ];
    const result = buildPositionsResponse(positions);
    assert.equal(result.openPositions.length, 0);
    assert.equal(result.closedPositions.length, 1);
  });

  it('splits CLOSED into closedPositions', () => {
    const positions = [
      makePosition({ id: 'p1', status: PositionStatus.CLOSED }),
    ];
    const result = buildPositionsResponse(positions);
    assert.equal(result.openPositions.length, 0);
    assert.equal(result.closedPositions.length, 1);
  });

  it('handles a mix of all statuses', () => {
    const positions = [
      makePosition({ id: 'p1', status: PositionStatus.OPEN }),
      makePosition({ id: 'p2', status: PositionStatus.ASSIGNED_HOLDING_SHARES }),
      makePosition({ id: 'p3', status: PositionStatus.EXPIRED_WORTHLESS }),
      makePosition({ id: 'p4', status: PositionStatus.CLOSED }),
    ];
    const result = buildPositionsResponse(positions);
    assert.equal(result.openPositions.length, 2);
    assert.equal(result.closedPositions.length, 2);
    assert.deepEqual(
      result.openPositions.map((p) => p.id),
      ['p1', 'p2'],
    );
    assert.deepEqual(
      result.closedPositions.map((p) => p.id),
      ['p3', 'p4'],
    );
  });
});

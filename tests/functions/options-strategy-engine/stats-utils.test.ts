/**
 * @topic #108 — Options Position Strategy Engine
 *
 * Unit tests for stats utility functions: max drawdown calculation over a
 * cumulative P&L series.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { computeMaxDrawdown } from '../../../functions/src/options-strategy-engine/stats-utils';
import type { EquityCurvePoint } from '../../../functions/src/options-strategy-engine/types';

function point(date: string, cumulativePnl: number): EquityCurvePoint {
  return { date, cumulativePnl };
}

describe('computeMaxDrawdown', () => {
  it('returns 0 for an empty series', () => {
    assert.equal(computeMaxDrawdown([]), 0);
  });

  it('returns 0 for a monotonically increasing series', () => {
    const points = [
      point('2026-01-01', 0),
      point('2026-01-02', 50),
      point('2026-01-03', 120),
      point('2026-01-04', 200),
    ];
    assert.equal(computeMaxDrawdown(points), 0);
  });

  it('returns the peak-to-trough decline for a single drawdown', () => {
    // Peak 200, trough 80 → drawdown = 200 - 80 = 120
    const points = [
      point('2026-01-01', 0),
      point('2026-01-02', 100),
      point('2026-01-03', 200),
      point('2026-01-04', 80),
      point('2026-01-05', 150),
    ];
    assert.equal(computeMaxDrawdown(points), 120);
  });

  it('returns the largest drawdown when multiple drawdowns exist', () => {
    // Drawdown 1: 150 → 120 = 30
    // Drawdown 2: 300 → 100 = 200 (largest)
    // Drawdown 3: 250 → 220 = 30
    const points = [
      point('2026-01-01', 0),
      point('2026-01-02', 150),
      point('2026-01-03', 120),  // -30
      point('2026-01-04', 300),
      point('2026-01-05', 100),  // -200 (largest)
      point('2026-01-06', 250),
      point('2026-01-07', 220),  // -30
    ];
    assert.equal(computeMaxDrawdown(points), 200);
  });

  it('returns 0 when all points are at the same value', () => {
    const points = [
      point('2026-01-01', 100),
      point('2026-01-02', 100),
      point('2026-01-03', 100),
    ];
    assert.equal(computeMaxDrawdown(points), 0);
  });

  it('handles a series that never recovers from its drawdown', () => {
    // Peak 200, drops to 50, stays there
    const points = [
      point('2026-01-01', 0),
      point('2026-01-02', 200),
      point('2026-01-03', 50),
      point('2026-01-04', 50),
    ];
    assert.equal(computeMaxDrawdown(points), 150);
  });

  it('handles a single-point series', () => {
    assert.equal(computeMaxDrawdown([point('2026-01-01', 100)]), 0);
  });
});

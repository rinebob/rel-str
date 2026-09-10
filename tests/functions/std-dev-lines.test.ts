/**
 * Unit tests for std-dev-lines.ts — the pure Standard Deviation Lines engine.
 *
 * Tests computeStdDevLines with synthetic OHLCV bars that have known prices,
 * so all center line, std dev, and band values are deterministic. Expected
 * values are hand-calculated literals, not recomputed formulas.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  computeStdDevLines,
} from '../../functions/src/indicators/std-dev-lines';
import type { OHLCV } from '../../functions/src/indicators/st-trend-bands';

// ─── Helpers ────────────────────────────────────────────────────────────────

function bar(close: number, open?: number, high?: number, low?: number): OHLCV {
  const o = open ?? close;
  return {
    open: o,
    close,
    high: high ?? Math.max(o, close),
    low: low ?? Math.min(o, close),
  };
}

/** Tolerance for floating-point comparisons. */
const TOL = 1e-6;

/**
 * Assert that two numbers are approximately equal (within tol).
 * Throws an AssertionError with actual/expected values on failure.
 * Fails if actual is NaN (guards against silent NaN passes).
 */
function assertApprox(actual: number, expected: number, tol = TOL, label?: string): void {
  if (Number.isNaN(actual)) {
    assert.fail(`${label ? label + ': ' : ''}expected ~${expected}, got NaN`);
  }
  if (Math.abs(actual - expected) >= tol) {
    assert.fail(
      `${label ? label + ': ' : ''}expected ~${expected}, got ${actual} (diff ${actual - expected}, tol ${tol})`,
    );
  }
}

/** Assert that a value is NaN. */
function assertNaN(actual: number, label?: string): void {
  if (!Number.isNaN(actual)) {
    assert.fail(`${label ? label + ': ' : ''}expected NaN, got ${actual}`);
  }
}

// ─── Fixtures ───────────────────────────────────────────────────────────────

// 5 bars with closes [100, 101, 102, 103, 104], period=5
// mean = 102, population std dev = sqrt( (4+1+0+1+4)/5 ) = sqrt(2) ≈ 1.41421356
const FIXTURE_5 = [
  bar(100),
  bar(101),
  bar(102),
  bar(103),
  bar(104),
];
const EXPECTED_MEAN_5 = 102.0;
const EXPECTED_STDDEV_5 = Math.sqrt(2.0); // ≈ 1.41421356

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('computeStdDevLines', () => {
  describe('SMA center line', () => {
    it('computes basic SMA center line at last bar (period=5)', () => {
      const result = computeStdDevLines(FIXTURE_5, { centerLineType: 'sma', period: 5 });
      assertApprox(result.centerLine[4], EXPECTED_MEAN_5, TOL, 'center line at bar 4');
    });

    it('returns NaN for first period-1 bars (SMA, period=5)', () => {
      const result = computeStdDevLines(FIXTURE_5, { centerLineType: 'sma', period: 5 });
      for (let i = 0; i < 4; i++) {
        assertNaN(result.centerLine[i], `center line at bar ${i}`);
      }
    });

    it('computes SMA center line with longer period (10 bars, period=10)', () => {
      const bars = Array.from({ length: 10 }, (_, i) => bar(100 + i));
      const result = computeStdDevLines(bars, { centerLineType: 'sma', period: 10 });
      // mean of [100..109] = 104.5
      assertApprox(result.centerLine[9], 104.5, TOL, 'center line at bar 9');
      for (let i = 0; i < 9; i++) {
        assertNaN(result.centerLine[i], `center line at bar ${i}`);
      }
    });
  });

  describe('EMA center line', () => {
    it('computes basic EMA center line (period=3)', () => {
      // closes: 100, 101, 102, 103, 104
      // EMA seed at bar 2 = SMA(100,101,102) = 101
      // k = 2/(3+1) = 0.5
      // bar 3: 0.5*103 + 0.5*101 = 102
      // bar 4: 0.5*104 + 0.5*102 = 103
      const result = computeStdDevLines(FIXTURE_5, { centerLineType: 'ema', period: 3 });
      assertApprox(result.centerLine[2], 101.0, TOL, 'EMA seed at bar 2');
      assertApprox(result.centerLine[3], 102.0, TOL, 'EMA at bar 3');
      assertApprox(result.centerLine[4], 103.0, TOL, 'EMA at bar 4');
    });

    it('returns NaN for insufficient data (EMA, period=3, only 2 bars)', () => {
      const bars = [bar(100), bar(101)];
      const result = computeStdDevLines(bars, { centerLineType: 'ema', period: 3 });
      for (let i = 0; i < bars.length; i++) {
        assertNaN(result.centerLine[i], `center line at bar ${i}`);
      }
    });
  });

  describe('Standard deviation (SMA)', () => {
    it('computes population std dev at last bar (period=5)', () => {
      const result = computeStdDevLines(FIXTURE_5, { centerLineType: 'sma', period: 5 });
      assertApprox(result.stdDev[4], EXPECTED_STDDEV_5, TOL, 'std dev at bar 4');
    });

    it('returns std dev = 0 for constant prices', () => {
      const bars = Array.from({ length: 5 }, () => bar(100));
      const result = computeStdDevLines(bars, { centerLineType: 'sma', period: 5 });
      assertApprox(result.stdDev[4], 0, TOL, 'std dev at bar 4');
    });

    it('returns NaN for first period-1 bars (std dev)', () => {
      const result = computeStdDevLines(FIXTURE_5, { centerLineType: 'sma', period: 5 });
      for (let i = 0; i < 4; i++) {
        assertNaN(result.stdDev[i], `std dev at bar ${i}`);
      }
    });
  });

  describe('Standard deviation (EMA)', () => {
    it('computes exponentially-weighted std dev for EMA center line (period=3)', () => {
      // closes: 100, 101, 102, 103, 104; period=3; k = 0.5
      // EMA seed at bar 2 = SMA(100,101,102) = 101
      // Seed variance = ((100-101)^2 + (101-101)^2 + (102-101)^2) / 3 = 2/3
      // std[2] = sqrt(2/3) ≈ 0.81649658
      // bar 3: diff = 103-102 = 1, var = 0.5*1 + 0.5*(2/3) = 5/6, std = sqrt(5/6) ≈ 0.91287093
      // bar 4: diff = 104-103 = 1, var = 0.5*1 + 0.5*(5/6) = 11/12, std = sqrt(11/12) ≈ 0.95742711
      const result = computeStdDevLines(FIXTURE_5, { centerLineType: 'ema', period: 3 });
      assertApprox(result.stdDev[2], Math.sqrt(2 / 3), TOL, 'EMA std dev at bar 2');
      assertApprox(result.stdDev[3], Math.sqrt(5 / 6), TOL, 'EMA std dev at bar 3');
      assertApprox(result.stdDev[4], Math.sqrt(11 / 12), TOL, 'EMA std dev at bar 4');
    });

    it('returns NaN for first period-1 bars (EMA std dev)', () => {
      const result = computeStdDevLines(FIXTURE_5, { centerLineType: 'ema', period: 3 });
      for (let i = 0; i < 2; i++) {
        assertNaN(result.stdDev[i], `EMA std dev at bar ${i}`);
      }
    });
  });

  describe('Regular bands', () => {
    it('computes regular band values at level 1.0', () => {
      const result = computeStdDevLines(FIXTURE_5, {
        centerLineType: 'sma',
        period: 5,
        stdDevLevels: [1.0],
        fibDevLevels: [],
      });
      const band = result.regularBands[0];
      assertApprox(band.upper[4], EXPECTED_MEAN_5 + 1.0 * EXPECTED_STDDEV_5, TOL, 'upper band 1.0');
      assertApprox(band.lower[4], EXPECTED_MEAN_5 - 1.0 * EXPECTED_STDDEV_5, TOL, 'lower band 1.0');
    });

    it('computes all default regular levels [0.5, 1.0, 1.5, 2.0, 2.5]', () => {
      const result = computeStdDevLines(FIXTURE_5, { centerLineType: 'sma', period: 5 });
      assert.strictEqual(result.regularBands.length, 5);
      const levels = [0.5, 1.0, 1.5, 2.0, 2.5];
      for (let i = 0; i < levels.length; i++) {
        const band = result.regularBands[i];
        assertApprox(band.upper[4], EXPECTED_MEAN_5 + levels[i] * EXPECTED_STDDEV_5, TOL, `upper ${levels[i]}`);
        assertApprox(band.lower[4], EXPECTED_MEAN_5 - levels[i] * EXPECTED_STDDEV_5, TOL, `lower ${levels[i]}`);
      }
    });

    it('regular bands are symmetric around center line', () => {
      const result = computeStdDevLines(FIXTURE_5, { centerLineType: 'sma', period: 5 });
      for (const band of result.regularBands) {
        const upper = band.upper[4];
        const lower = band.lower[4];
        const center = result.centerLine[4];
        assertApprox(upper - center, center - lower, TOL, 'symmetry');
      }
    });
  });

  describe('Fibonacci bands', () => {
    it('computes Fibonacci band values at level 0.618', () => {
      const result = computeStdDevLines(FIXTURE_5, {
        centerLineType: 'sma',
        period: 5,
        stdDevLevels: [],
        fibDevLevels: [0.618],
      });
      const band = result.fibBands[0];
      assertApprox(band.upper[4], EXPECTED_MEAN_5 + 0.618 * EXPECTED_STDDEV_5, TOL, 'fib upper 0.618');
      assertApprox(band.lower[4], EXPECTED_MEAN_5 - 0.618 * EXPECTED_STDDEV_5, TOL, 'fib lower 0.618');
    });

    it('computes all default Fibonacci levels [0.618, 1.618, 2.618]', () => {
      const result = computeStdDevLines(FIXTURE_5, { centerLineType: 'sma', period: 5 });
      assert.strictEqual(result.fibBands.length, 3);
      const levels = [0.618, 1.618, 2.618];
      for (let i = 0; i < levels.length; i++) {
        const band = result.fibBands[i];
        assertApprox(band.upper[4], EXPECTED_MEAN_5 + levels[i] * EXPECTED_STDDEV_5, TOL, `fib upper ${levels[i]}`);
        assertApprox(band.lower[4], EXPECTED_MEAN_5 - levels[i] * EXPECTED_STDDEV_5, TOL, `fib lower ${levels[i]}`);
      }
    });
  });

  describe('Configuration', () => {
    it('supports custom std dev levels', () => {
      const result = computeStdDevLines(FIXTURE_5, {
        centerLineType: 'sma',
        period: 5,
        stdDevLevels: [1.0, 2.0],
        fibDevLevels: [],
      });
      assert.strictEqual(result.regularBands.length, 2);
      assertApprox(result.regularBands[0].upper[4], EXPECTED_MEAN_5 + 1.0 * EXPECTED_STDDEV_5, TOL, 'custom level 1.0');
      assertApprox(result.regularBands[1].upper[4], EXPECTED_MEAN_5 + 2.0 * EXPECTED_STDDEV_5, TOL, 'custom level 2.0');
    });

    it('supports custom fib dev levels', () => {
      const result = computeStdDevLines(FIXTURE_5, {
        centerLineType: 'sma',
        period: 5,
        stdDevLevels: [],
        fibDevLevels: [1.618],
      });
      assert.strictEqual(result.fibBands.length, 1);
      assertApprox(result.fibBands[0].upper[4], EXPECTED_MEAN_5 + 1.618 * EXPECTED_STDDEV_5, TOL, 'custom fib 1.618');
    });

    it('uses EMA center line when configured', () => {
      const result = computeStdDevLines(FIXTURE_5, { centerLineType: 'ema', period: 3 });
      // EMA at bar 4 = 103 (see EMA test above)
      assertApprox(result.centerLine[4], 103.0, TOL, 'EMA center line at bar 4');
    });

    it('uses custom period', () => {
      const bars = Array.from({ length: 10 }, (_, i) => bar(100 + i));
      const result = computeStdDevLines(bars, { centerLineType: 'sma', period: 10 });
      // mean of [100..109] = 104.5
      assertApprox(result.centerLine[9], 104.5, TOL, 'center line with period 10');
      // std dev of [100..109]: variance = 8.25, std dev = sqrt(8.25) ≈ 2.8722813
      assertApprox(result.stdDev[9], Math.sqrt(8.25), TOL, 'std dev with period 10');
    });
  });

  describe('Edge cases', () => {
    it('handles empty input without crash', () => {
      const result = computeStdDevLines([], { centerLineType: 'sma', period: 5 });
      assert.strictEqual(result.centerLine.length, 0);
      assert.strictEqual(result.stdDev.length, 0);
      assert.strictEqual(result.regularBands.length, 0);
      assert.strictEqual(result.fibBands.length, 0);
    });

    it('handles single bar (all NaN for reasonable period)', () => {
      const bars = [bar(100)];
      const result = computeStdDevLines(bars, { centerLineType: 'sma', period: 5 });
      assertNaN(result.centerLine[0], 'center line single bar');
      assertNaN(result.stdDev[0], 'std dev single bar');
      for (const band of result.regularBands) {
        assertNaN(band.upper[0], 'regular upper single bar');
        assertNaN(band.lower[0], 'regular lower single bar');
      }
      for (const band of result.fibBands) {
        assertNaN(band.upper[0], 'fib upper single bar');
        assertNaN(band.lower[0], 'fib lower single bar');
      }
    });

    it('handles bars fewer than period (all NaN)', () => {
      const bars = [bar(100), bar(101), bar(102)];
      const result = computeStdDevLines(bars, { centerLineType: 'sma', period: 5 });
      for (let i = 0; i < bars.length; i++) {
        assertNaN(result.centerLine[i], `center line at bar ${i}`);
        assertNaN(result.stdDev[i], `std dev at bar ${i}`);
        for (const band of result.regularBands) {
          assertNaN(band.upper[i], `regular upper at bar ${i}`);
          assertNaN(band.lower[i], `regular lower at bar ${i}`);
        }
        for (const band of result.fibBands) {
          assertNaN(band.upper[i], `fib upper at bar ${i}`);
          assertNaN(band.lower[i], `fib lower at bar ${i}`);
        }
      }
    });

    it('handles all same price (std dev = 0, bands = center)', () => {
      const bars = Array.from({ length: 5 }, () => bar(100));
      const result = computeStdDevLines(bars, { centerLineType: 'sma', period: 5 });
      assertApprox(result.stdDev[4], 0, TOL, 'std dev constant prices');
      for (const band of result.regularBands) {
        assertApprox(band.upper[4], 100, TOL, 'regular upper = center');
        assertApprox(band.lower[4], 100, TOL, 'regular lower = center');
      }
      for (const band of result.fibBands) {
        assertApprox(band.upper[4], 100, TOL, 'fib upper = center');
        assertApprox(band.lower[4], 100, TOL, 'fib lower = center');
      }
    });

    it('returns arrays of correct length matching input', () => {
      const bars = Array.from({ length: 20 }, (_, i) => bar(100 + i));
      const result = computeStdDevLines(bars, { centerLineType: 'sma', period: 5 });
      assert.strictEqual(result.centerLine.length, 20);
      assert.strictEqual(result.stdDev.length, 20);
      for (const band of result.regularBands) {
        assert.strictEqual(band.upper.length, 20);
        assert.strictEqual(band.lower.length, 20);
      }
      for (const band of result.fibBands) {
        assert.strictEqual(band.upper.length, 20);
        assert.strictEqual(band.lower.length, 20);
      }
    });

    it('handles both stdDevLevels and fibDevLevels empty', () => {
      const result = computeStdDevLines(FIXTURE_5, {
        centerLineType: 'sma',
        period: 5,
        stdDevLevels: [],
        fibDevLevels: [],
      });
      assert.strictEqual(result.regularBands.length, 0);
      assert.strictEqual(result.fibBands.length, 0);
      // Center line and std dev still computed
      assertApprox(result.centerLine[4], EXPECTED_MEAN_5, TOL, 'center line with empty levels');
    });
  });

  describe('Input validation', () => {
    it('returns all NaN for period = 0', () => {
      const result = computeStdDevLines(FIXTURE_5, { centerLineType: 'sma', period: 0 });
      for (let i = 0; i < FIXTURE_5.length; i++) {
        assertNaN(result.centerLine[i], `center line at bar ${i}`);
        assertNaN(result.stdDev[i], `std dev at bar ${i}`);
      }
    });

    it('returns all NaN for negative period', () => {
      const result = computeStdDevLines(FIXTURE_5, { centerLineType: 'sma', period: -1 });
      for (let i = 0; i < FIXTURE_5.length; i++) {
        assertNaN(result.centerLine[i], `center line at bar ${i}`);
        assertNaN(result.stdDev[i], `std dev at bar ${i}`);
      }
    });

    it('returns all NaN for non-integer period', () => {
      const result = computeStdDevLines(FIXTURE_5, { centerLineType: 'sma', period: 2.5 });
      for (let i = 0; i < FIXTURE_5.length; i++) {
        assertNaN(result.centerLine[i], `center line at bar ${i}`);
        assertNaN(result.stdDev[i], `std dev at bar ${i}`);
      }
    });

    it('returns all NaN for NaN period', () => {
      const result = computeStdDevLines(FIXTURE_5, { centerLineType: 'sma', period: NaN });
      for (let i = 0; i < FIXTURE_5.length; i++) {
        assertNaN(result.centerLine[i], `center line at bar ${i}`);
        assertNaN(result.stdDev[i], `std dev at bar ${i}`);
      }
    });

    it('returns all NaN for Infinity period', () => {
      const result = computeStdDevLines(FIXTURE_5, { centerLineType: 'sma', period: Infinity });
      for (let i = 0; i < FIXTURE_5.length; i++) {
        assertNaN(result.centerLine[i], `center line at bar ${i}`);
        assertNaN(result.stdDev[i], `std dev at bar ${i}`);
      }
    });
  });
});

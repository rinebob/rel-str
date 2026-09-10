/**
 * Standard Deviation Lines — mean-reversion indicator engine.
 *
 * Computes a configurable moving average (SMA or EMA) as the center line,
 * then plots two independent sets of deviation bands above and below it:
 *
 *   1. Regular bands at configurable std dev levels (default: 0.5, 1.0, 1.5, 2.0, 2.5)
 *   2. Fibonacci bands at configurable std dev levels (default: 0.618, 1.618, 2.618)
 *
 * Uses population standard deviation (divide by N, not N-1), matching the
 * Bollinger Bands convention. The std dev calculation matches the center
 * line type: SMA uses a rolling-window std dev, EMA uses an exponentially-
 * weighted std dev with the same decay factor.
 *
 * All computation is pure math on OHLCV arrays. No external dependencies
 * beyond the shared primitives.
 */

import { emaSeries, smaSeries } from './primitives';
import type { OHLCV } from './st-trend-bands';

// =============================================================================
// INTERFACES
// =============================================================================

/** Center line calculation type. */
export type CenterLineType = 'sma' | 'ema';

/** Configuration for computeStdDevLines. */
export interface StdDevLinesConfig {
  /** Center line calculation: 'sma' or 'ema'. */
  centerLineType: CenterLineType;
  /** Lookback period for both the MA and the std dev window. Must be a positive integer. */
  period: number;
  /** Regular std dev levels (default: [0.5, 1.0, 1.5, 2.0, 2.5]). */
  stdDevLevels?: number[];
  /** Fibonacci std dev levels (default: [0.618, 1.618, 2.618]). */
  fibDevLevels?: number[];
}

/** A single band pair (upper + lower) at a given deviation level. */
export interface DevBand {
  level: number;
  upper: number[];
  lower: number[];
}

/** Result of computeStdDevLines — one value per input bar. */
export interface StdDevLinesResult {
  /** Center line (SMA or EMA). NaN for first period-1 bars. */
  centerLine: number[];
  /** Population std dev. NaN for first period-1 bars. */
  stdDev: number[];
  /** Regular deviation bands, one entry per configured level. */
  regularBands: DevBand[];
  /** Fibonacci deviation bands, one entry per configured level. */
  fibBands: DevBand[];
}

// =============================================================================
// DEFAULTS
// =============================================================================

const DEFAULT_STD_DEV_LEVELS = [0.5, 1.0, 1.5, 2.0, 2.5];
const DEFAULT_FIB_DEV_LEVELS = [0.618, 1.618, 2.618];

// =============================================================================
// ENGINE
// =============================================================================

/**
 * Compute Standard Deviation Lines for a series of OHLCV bars.
 *
 * @param bars - OHLCV input bars
 * @param config - Configuration: centerLineType, period, optional level arrays
 * @returns StdDevLinesResult with center line, std dev, and band arrays
 */
export function computeStdDevLines(
  bars: OHLCV[],
  config: StdDevLinesConfig,
): StdDevLinesResult {
  const len = bars.length;
  const period = config.period;
  const stdDevLevels = config.stdDevLevels ?? DEFAULT_STD_DEV_LEVELS;
  const fibDevLevels = config.fibDevLevels ?? DEFAULT_FIB_DEV_LEVELS;

  // Handle empty input
  if (len === 0) {
    return {
      centerLine: [],
      stdDev: [],
      regularBands: [],
      fibBands: [],
    };
  }

  // Validate period: must be a positive integer. Invalid period → all NaN.
  if (!Number.isInteger(period) || period < 1 || len < period) {
    const centerLine = new Array<number>(len).fill(NaN);
    const stdDev = new Array<number>(len).fill(NaN);
    return {
      centerLine,
      stdDev,
      regularBands: buildBands(stdDevLevels, centerLine, stdDev),
      fibBands: buildBands(fibDevLevels, centerLine, stdDev),
    };
  }

  // Extract close prices
  const closes = bars.map(b => b.close);

  // Compute center line (SMA or EMA)
  const centerLine = config.centerLineType === 'ema'
    ? emaSeries(closes, period)
    : smaSeries(closes, period);

  // Compute std dev — matches the center line type:
  //   SMA → rolling-window population std dev around the SMA
  //   EMA → exponentially-weighted std dev around the EMA (same decay factor)
  const stdDev = config.centerLineType === 'ema'
    ? computeEmaStdDev(closes, centerLine, period)
    : computeRollingStdDev(closes, centerLine, period);

  return {
    centerLine,
    stdDev,
    regularBands: buildBands(stdDevLevels, centerLine, stdDev),
    fibBands: buildBands(fibDevLevels, centerLine, stdDev),
  };
}

// =============================================================================
// BAND CONSTRUCTION
// =============================================================================

/**
 * Build band pairs (upper + lower) for each deviation level.
 * upper[i] = centerLine[i] + level × stdDev[i]
 * lower[i] = centerLine[i] - level × stdDev[i]
 * NaN where center line or std dev is NaN.
 */
function buildBands(
  levels: number[],
  centerLine: number[],
  stdDev: number[],
): DevBand[] {
  const len = centerLine.length;
  return levels.map(level => {
    const upper = new Array<number>(len);
    const lower = new Array<number>(len);
    for (let i = 0; i < len; i++) {
      if (Number.isNaN(centerLine[i]) || Number.isNaN(stdDev[i])) {
        upper[i] = NaN;
        lower[i] = NaN;
      } else {
        const offset = level * stdDev[i];
        upper[i] = centerLine[i] + offset;
        lower[i] = centerLine[i] - offset;
      }
    }
    return { level, upper, lower };
  });
}

// =============================================================================
// ROLLING STD DEV (SMA)
// =============================================================================

/**
 * Compute population standard deviation over a rolling window of `period`
 * bars, using the SMA center line as the mean for each window.
 *
 * For bar i (where i >= period - 1):
 *   stdDev[i] = sqrt( sum( (close[j] - centerLine[i])^2 for j in [i-period+1, i] ) / period )
 *
 * @param closes - Close prices array
 * @param centerLine - SMA center line array
 * @param period - Rolling window size
 * @returns Array of std dev values (NaN for first period-1 bars)
 */
function computeRollingStdDev(
  closes: number[],
  centerLine: number[],
  period: number,
): number[] {
  const len = closes.length;
  const result = new Array<number>(len).fill(NaN);

  for (let i = period - 1; i < len; i++) {
    if (Number.isNaN(centerLine[i])) {
      continue;
    }

    const mean = centerLine[i];
    let sumSq = 0;

    for (let j = i - period + 1; j <= i; j++) {
      const diff = closes[j] - mean;
      sumSq += diff * diff;
    }

    // Population std dev: divide by N (the window size), not N-1.
    result[i] = Math.sqrt(sumSq / period);
  }

  return result;
}

// =============================================================================
// EMA STD DEV (exponentially-weighted)
// =============================================================================

/**
 * Compute exponentially-weighted population std dev around an EMA center line.
 *
 * Uses the same decay factor (k = 2/(period+1)) as the EMA, so recent prices
 * contribute more to the volatility than older ones — matching the EMA's
 * weighting. This keeps the bands visually consistent with the center line.
 *
 * Seeding (at bar period-1, same point as the EMA seed):
 *   var = population variance of first `period` closes around the EMA seed
 *
 * Update (from bar period onward):
 *   diff[i] = close[i] - ema[i]
 *   var[i] = k * diff[i]^2 + (1-k) * var[i-1]
 *   std[i] = sqrt(var[i])
 *
 * NaN closes in the seed window are skipped; NaN closes during the update
 * step carry forward the previous variance (matching emaSeries behavior of
 * carrying forward the previous EMA value when a price is NaN).
 *
 * @param closes - Close prices array
 * @param ema - EMA center line array
 * @param period - EMA period (determines decay factor)
 * @returns Array of std dev values (NaN for first period-1 bars)
 */
function computeEmaStdDev(
  closes: number[],
  ema: number[],
  period: number,
): number[] {
  const len = closes.length;
  const result = new Array<number>(len).fill(NaN);

  if (len < period || period < 1) return result;

  // Find the seed index (first non-NaN EMA value, which is at period-1)
  const seedIdx = period - 1;
  if (Number.isNaN(ema[seedIdx])) return result;

  // Seed: population variance of first `period` closes around the EMA seed.
  // Skip NaN closes in the seed window (matching emaSeries NaN handling).
  const seedMean = ema[seedIdx];
  let sumSq = 0;
  let validCount = 0;
  for (let j = 0; j <= seedIdx; j++) {
    if (!Number.isNaN(closes[j])) {
      const diff = closes[j] - seedMean;
      sumSq += diff * diff;
      validCount++;
    }
  }
  if (validCount === 0) return result;
  let variance = sumSq / validCount;
  result[seedIdx] = Math.sqrt(variance);

  // EWMA update from bar period onward.
  // NaN closes carry forward the previous variance (matching emaSeries
  // behavior of carrying forward the EMA value when price is NaN).
  const k = 2 / (period + 1);
  for (let i = seedIdx + 1; i < len; i++) {
    if (Number.isNaN(ema[i])) continue;
    if (Number.isNaN(closes[i])) {
      result[i] = Math.sqrt(variance);
      continue;
    }
    const diff = closes[i] - ema[i];
    variance = k * diff * diff + (1 - k) * variance;
    result[i] = Math.sqrt(variance);
  }

  return result;
}

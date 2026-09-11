/**
 * Standard Deviation Lines — mean-reversion chart indicator.
 *
 * Computes a configurable moving average (SMA or EMA) as the center line,
 * then plots two independent sets of deviation bands above and below it:
 *
 *   1. Regular bands at std dev levels (default: 0.5, 1.0, 1.5, 2.0, 2.5)
 *   2. Fibonacci bands at std dev levels (default: 0.618, 1.618, 2.618)
 *
 * Uses population standard deviation (divide by N, not N-1). The std dev
 * calculation matches the center line type: SMA uses a rolling-window std
 * dev, EMA uses an exponentially-weighted std dev with the same decay factor.
 *
 * Three display modes:
 *   - 'regular-only': center line + regular bands
 *   - 'fib-only': center line + Fibonacci bands
 *   - 'combined': center line + both band sets + fills between nearest
 *     regular and Fibonacci lines
 *
 * Inline calculation mirrors the BE engine (functions/src/indicators/std-dev-lines.ts)
 * for frontend visual verification — no import from the functions package.
 * NaN handling matches the BE primitives (skip NaN closes, carry forward).
 */

import type { IndicatorOption, IndicatorCalculator, PriceBar } from '../flex-chart.types';
import { StIndicator } from '../flex-chart.types';

// =============================================================================
// 1. CHART CONFIGURATION
// =============================================================================

export const ST_STD_DEV_LINES_INDICATOR: IndicatorOption = {
  id: 'st-std-dev-lines',
  label: 'ST StdDevLines',
  type: StIndicator.ST_STD_DEV_LINES,
  defaultPane: 'overlay',
  axisScale: 'price',
  params: [
    { key: 'period', label: 'Period', default: 50, min: 2, max: 500 },
    { key: 'maType', label: 'MA Type', default: 'sma', options: ['sma', 'ema'] },
    { key: 'displayMode', label: 'Display Mode', default: 'combined', options: ['regular-only', 'fib-only', 'combined'] },
  ],
  defaultOptions: {
    referenceLines: [],
  },
};

// =============================================================================
// 2. TYPES
// =============================================================================

/** A single named line series for chart rendering. */
export interface StdDevLineSeries {
  /** Unique key for this line (e.g. 'center', 'regular-upper-1.0'). */
  key: string;
  /** Display name for legend/tooltip. */
  name: string;
  /** Line color. */
  color: string;
  /** Line width. */
  width: number;
  /** Dash array for dashed lines (empty for solid). */
  dashArray: string;
  /** Data points: index from bar, y value (NaN filtered out by caller). */
  data: { index: number; y: number }[];
}

/** A fill zone between two band lines (for combined mode RangeArea rendering). */
export interface StdDevFillZone {
  /** Display name for legend/tooltip. */
  name: string;
  /** Fill color. */
  color: string;
  /** Fill opacity (0-1). */
  opacity: number;
  /** Data points with high/low for RangeArea series. */
  data: { index: number; high: number; low: number }[];
}

/** Complete chart-ready output for the Std Dev Lines indicator. */
export interface StdDevLineSeriesData {
  /** All line series to render. */
  lines: StdDevLineSeries[];
  /** Fill zones for combined mode (empty if not combined). */
  fills: StdDevFillZone[];
}

// =============================================================================
// 3. CALCULATION (inline, mirrors BE engine)
// =============================================================================

const DEFAULT_STD_DEV_LEVELS = [0.5, 1.0, 1.5, 2.0, 2.5];
const DEFAULT_FIB_DEV_LEVELS = [0.618, 1.618, 2.618];

// Colors for regular bands (by level index)
const REGULAR_COLORS = ['#e0e0e0', '#bdbdbd', '#9e9e9e', '#757575', '#424242'];
// Colors for Fibonacci bands
const FIB_COLORS = ['#81c784', '#66bb6a', '#4caf50'];
// Center line color
const CENTER_COLOR = '#1976d2';

/**
 * SMA series — rolling simple moving average.
 * NaN for first period-1 bars. Matches BE smaSeries.
 */
function smaSeries(prices: number[], period: number): number[] {
  const len = prices.length;
  const result = new Array<number>(len).fill(NaN);
  if (len < period || period < 1) return result;

  let sum = 0;
  for (let i = 0; i < period; i++) sum += prices[i];
  result[period - 1] = sum / period;

  for (let i = period; i < len; i++) {
    sum += prices[i] - prices[i - period];
    result[i] = sum / period;
  }
  return result;
}

/**
 * EMA series — exponential moving average.
 * NaN for first period-1 bars. Seeds with SMA of first `period` values.
 * Matches BE emaSeries: skips NaN closes, carries forward previous EMA.
 */
function emaSeries(prices: number[], period: number): number[] {
  const len = prices.length;
  const result = new Array<number>(len).fill(NaN);
  if (len < period || period < 1) return result;
  const k = 2 / (period + 1);

  // Find first non-NaN index (matching BE)
  let start = 0;
  while (start < len && isNaN(prices[start])) start++;
  if (start + period > len) return result;

  // SMA seed from first `period` valid values
  let sum = 0;
  for (let i = start; i < start + period; i++) sum += prices[i];
  let val = sum / period;
  result[start + period - 1] = val;

  for (let i = start + period; i < len; i++) {
    val = (isNaN(prices[i]) ? val : prices[i]) * k + val * (1 - k);
    result[i] = val;
  }
  return result;
}

/**
 * Rolling population std dev for SMA center line.
 * stdDev[i] = sqrt( sum( (close[j] - sma[i])^2 for j in window ) / period )
 */
function computeRollingStdDev(
  closes: number[],
  centerLine: number[],
  period: number,
): number[] {
  const len = closes.length;
  const result = new Array<number>(len).fill(NaN);

  for (let i = period - 1; i < len; i++) {
    if (Number.isNaN(centerLine[i])) continue;
    const mean = centerLine[i];
    let sumSq = 0;
    for (let j = i - period + 1; j <= i; j++) {
      const diff = closes[j] - mean;
      sumSq += diff * diff;
    }
    result[i] = Math.sqrt(sumSq / period);
  }
  return result;
}

/**
 * Exponentially-weighted population std dev for EMA center line.
 * Uses the same decay factor (k = 2/(period+1)) as the EMA.
 * Matches BE: skips NaN closes in seed, carries forward variance on NaN.
 */
function computeEmaStdDev(
  closes: number[],
  ema: number[],
  period: number,
): number[] {
  const len = closes.length;
  const result = new Array<number>(len).fill(NaN);
  if (len < period || period < 1) return result;

  const seedIdx = period - 1;
  if (Number.isNaN(ema[seedIdx])) return result;

  // Seed: population variance of first `period` closes around the EMA seed.
  // Skip NaN closes in the seed window (matching BE).
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
  // NaN closes carry forward the previous variance (matching BE).
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

/** Build upper/lower band arrays for a set of deviation levels. */
function buildBands(
  levels: number[],
  centerLine: number[],
  stdDev: number[],
): { level: number; upper: number[]; lower: number[] }[] {
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

/** Shared core computation — used by both calculateStdDevLines and computeStdDevLinesSeries. */
function computeCenterLine(
  bars: PriceBar[],
  period: number,
  maType: string,
): { centerLine: number[]; stdDev: number[] } | null {
  if (bars.length === 0 || !Number.isInteger(period) || period < 1 || bars.length < period) {
    return null;
  }

  const closes = bars.map(b => b.close);
  const centerLine = maType === 'ema'
    ? emaSeries(closes, period)
    : smaSeries(closes, period);

  const stdDev = maType === 'ema'
    ? computeEmaStdDev(closes, centerLine, period)
    : computeRollingStdDev(closes, centerLine, period);

  return { centerLine, stdDev };
}

// =============================================================================
// 4. INDICATOR CALCULATOR (IndicatorCalculator signature)
// =============================================================================

/**
 * calculateStdDevLines — returns center line as `y` for basic line rendering.
 * For full multi-line rendering, use `computeStdDevLinesSeries` instead.
 */
export const calculateStdDevLines: IndicatorCalculator = (bars, params) => {
  const period = Number(params['period'] ?? 50);
  const maType = String(params['maType'] ?? 'sma');

  const core = computeCenterLine(bars, period, maType);
  if (!core) return [];

  return bars
    .map((b, i) => ({ x: b.x, y: core.centerLine[i] }))
    .filter(p => !Number.isNaN(p.y));
};

// =============================================================================
// 5. FULL SERIES COMPUTATION (for chart rendering)
// =============================================================================

/**
 * Compute all Std Dev Lines series for chart rendering.
 * Returns named line series + fill zones based on display mode.
 */
export function computeStdDevLinesSeries(
  bars: PriceBar[],
  params: Record<string, number | string | boolean>,
): StdDevLineSeriesData {
  const len = bars.length;
  if (len === 0) return { lines: [], fills: [] };

  const period = Number(params['period'] ?? 50);
  const maType = String(params['maType'] ?? 'sma');
  const displayMode = String(params['displayMode'] ?? 'combined');

  const core = computeCenterLine(bars, period, maType);
  if (!core) return { lines: [], fills: [] };

  const { centerLine, stdDev } = core;
  const regularBands = buildBands(DEFAULT_STD_DEV_LEVELS, centerLine, stdDev);
  const fibBands = buildBands(DEFAULT_FIB_DEV_LEVELS, centerLine, stdDev);

  const showRegular = displayMode === 'regular-only' || displayMode === 'combined';
  const showFib = displayMode === 'fib-only' || displayMode === 'combined';

  const lines: StdDevLineSeries[] = [];

  // Center line
  lines.push(buildLineSeries('center', 'Center', CENTER_COLOR, 2, '', centerLine));

  // Regular bands
  if (showRegular) {
    regularBands.forEach((band, idx) => {
      const color = REGULAR_COLORS[idx % REGULAR_COLORS.length];
      lines.push(buildLineSeries(
        `regular-upper-${band.level}`, `+${band.level}σ`, color, 1, '4,2',
        band.upper,
      ));
      lines.push(buildLineSeries(
        `regular-lower-${band.level}`, `-${band.level}σ`, color, 1, '4,2',
        band.lower,
      ));
    });
  }

  // Fibonacci bands
  if (showFib) {
    fibBands.forEach((band, idx) => {
      const color = FIB_COLORS[idx % FIB_COLORS.length];
      lines.push(buildLineSeries(
        `fib-upper-${band.level}`, `+${band.level}σ fib`, color, 1, '2,2',
        band.upper,
      ));
      lines.push(buildLineSeries(
        `fib-lower-${band.level}`, `-${band.level}σ fib`, color, 1, '2,2',
        band.lower,
      ));
    });
  }

  // Fill zones for combined mode — fill between nearest regular and fib lines
  const fills: StdDevFillZone[] = [];
  if (displayMode === 'combined' && regularBands.length > 0 && fibBands.length > 0) {
    regularBands.forEach((regBand, regIdx) => {
      // Find nearest fib level
      let nearestFibIdx = 0;
      let nearestDist = Infinity;
      fibBands.forEach((fibBand, fibIdx) => {
        const dist = Math.abs(regBand.level - fibBand.level);
        if (dist < nearestDist) {
          nearestDist = dist;
          nearestFibIdx = fibIdx;
        }
      });
      const fibBand = fibBands[nearestFibIdx];
      const regColor = REGULAR_COLORS[regIdx % REGULAR_COLORS.length];

      // Upper fill: between regular upper and fib upper
      // high = max of the two, low = min of the two (per bar)
      fills.push(buildFillZone(
        `Fill +${regBand.level}σ / +${fibBand.level}σ fib`,
        regColor, 0.08, regBand.upper, fibBand.upper,
      ));
      // Lower fill: between regular lower and fib lower
      fills.push(buildFillZone(
        `Fill -${regBand.level}σ / -${fibBand.level}σ fib`,
        regColor, 0.08, regBand.lower, fibBand.lower,
      ));
    });
  }

  return { lines, fills };
}

/** Build a StdDevLineSeries from a value array, filtering NaN and mapping to bar indices. */
function buildLineSeries(
  key: string,
  name: string,
  color: string,
  width: number,
  dashArray: string,
  values: number[],
): StdDevLineSeries {
  const data: { index: number; y: number }[] = [];
  for (let i = 0; i < values.length; i++) {
    if (!Number.isNaN(values[i])) {
      data.push({ index: i, y: values[i] });
    }
  }
  return { key, name, color, width, dashArray, data };
}

/** Build a StdDevFillZone from two band arrays, computing high/low per bar. */
function buildFillZone(
  name: string,
  color: string,
  opacity: number,
  bandA: number[],
  bandB: number[],
): StdDevFillZone {
  const data: { index: number; high: number; low: number }[] = [];
  for (let i = 0; i < bandA.length; i++) {
    if (!Number.isNaN(bandA[i]) && !Number.isNaN(bandB[i])) {
      data.push({
        index: i,
        high: Math.max(bandA[i], bandB[i]),
        low: Math.min(bandA[i], bandB[i]),
      });
    }
  }
  return { name, color, opacity, data };
}

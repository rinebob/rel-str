/**
 * Indicator Primitives
 *
 * Shared low-level math utilities used by all ST indicators.
 * Pure functions operating on number arrays — no external dependencies.
 */

/** HTF multiplier — always 3 periods. Non-negotiable system constant. */
export const HTF_MULTIPLIER = 3;

// =============================================================================
// EMA (full-series output)
// =============================================================================

/**
 * Exponential Moving Average returning ALL intermediate values.
 * First `period - 1` values are NaN (insufficient data).
 * Value at index `period - 1` is the SMA seed.
 *
 * @param prices - Input number array
 * @param period - EMA lookback period
 * @returns Array of same length as input with EMA values (NaN for insufficient data)
 */
export function emaSeries(prices: number[], period: number): number[] {
  const len = prices.length;
  const result = new Array<number>(len).fill(NaN);

  if (len < period || period < 1) return result;

  const k = 2 / (period + 1);

  // Find first non-NaN index
  let start = 0;
  while (start < len && isNaN(prices[start])) start++;
  if (start + period > len) return result;

  // Seed: SMA of first `period` valid values
  let sum = 0;
  for (let i = start; i < start + period; i++) {
    sum += prices[i];
  }
  let val = sum / period;
  result[start + period - 1] = val;

  // EMA from seed onward
  for (let i = start + period; i < len; i++) {
    val = (isNaN(prices[i]) ? val : prices[i]) * k + val * (1 - k);
    result[i] = val;
  }

  return result;
}

// =============================================================================
// SMA (full-series output)
// =============================================================================

/**
 * Simple Moving Average returning ALL intermediate values.
 * First `period - 1` values are NaN.
 */
export function smaSeries(prices: number[], period: number): number[] {
  const len = prices.length;
  const result = new Array<number>(len).fill(NaN);

  if (len < period || period < 1) return result;

  let sum = 0;
  for (let i = 0; i < period; i++) {
    sum += prices[i];
  }
  result[period - 1] = sum / period;

  for (let i = period; i < len; i++) {
    sum += prices[i] - prices[i - period];
    result[i] = sum / period;
  }

  return result;
}

// =============================================================================
// Crossover / Crossunder
// =============================================================================

/**
 * Returns boolean array: true at index i when `a` crosses above `b`.
 * a[i] > b[i] AND a[i-1] <= b[i-1]
 */
export function crossover(a: number[], b: number[]): boolean[] {
  const len = Math.min(a.length, b.length);
  const result = new Array<boolean>(len).fill(false);

  for (let i = 1; i < len; i++) {
    if (!isNaN(a[i]) && !isNaN(b[i]) && !isNaN(a[i - 1]) && !isNaN(b[i - 1])) {
      result[i] = a[i] > b[i] && a[i - 1] <= b[i - 1];
    }
  }

  return result;
}

/**
 * Returns boolean array: true at index i when `a` crosses below `b`.
 * a[i] < b[i] AND a[i-1] >= b[i-1]
 */
export function crossunder(a: number[], b: number[]): boolean[] {
  const len = Math.min(a.length, b.length);
  const result = new Array<boolean>(len).fill(false);

  for (let i = 1; i < len; i++) {
    if (!isNaN(a[i]) && !isNaN(b[i]) && !isNaN(a[i - 1]) && !isNaN(b[i - 1])) {
      result[i] = a[i] < b[i] && a[i - 1] >= b[i - 1];
    }
  }

  return result;
}

/**
 * Returns boolean array: true at index i when `a` crosses `b` in either direction.
 */
export function cross(a: number[], b: number[]): boolean[] {
  const len = Math.min(a.length, b.length);
  const result = new Array<boolean>(len).fill(false);

  for (let i = 1; i < len; i++) {
    if (!isNaN(a[i]) && !isNaN(b[i]) && !isNaN(a[i - 1]) && !isNaN(b[i - 1])) {
      result[i] = (a[i] > b[i] && a[i - 1] <= b[i - 1]) ||
                  (a[i] < b[i] && a[i - 1] >= b[i - 1]);
    }
  }

  return result;
}

// =============================================================================
// Crossover/under against a constant threshold
// =============================================================================

/**
 * Returns boolean array: true when series crosses above a constant value.
 */
export function crossoverValue(series: number[], value: number): boolean[] {
  const len = series.length;
  const result = new Array<boolean>(len).fill(false);

  for (let i = 1; i < len; i++) {
    if (!isNaN(series[i]) && !isNaN(series[i - 1])) {
      result[i] = series[i] > value && series[i - 1] <= value;
    }
  }

  return result;
}

/**
 * Returns boolean array: true when series crosses below a constant value.
 */
export function crossunderValue(series: number[], value: number): boolean[] {
  const len = series.length;
  const result = new Array<boolean>(len).fill(false);

  for (let i = 1; i < len; i++) {
    if (!isNaN(series[i]) && !isNaN(series[i - 1])) {
      result[i] = series[i] < value && series[i - 1] >= value;
    }
  }

  return result;
}

// =============================================================================
// Utility: nz (null/NaN to zero)
// =============================================================================

/**
 * Pine `nz()` equivalent: returns 0 if value is NaN/undefined/null.
 */
export function nz(value: number | undefined | null): number {
  if (value === undefined || value === null || isNaN(value)) return 0;
  return value;
}

/**
 * Array lookback with nz: returns arr[i - offset] or 0 if out of bounds / NaN.
 */
export function nzLookback(arr: number[], i: number, offset: number): number {
  if (i < offset) return 0;
  return nz(arr[i - offset]);
}

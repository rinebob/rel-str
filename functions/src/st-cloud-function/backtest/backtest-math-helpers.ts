/**
 * Shared math helpers for backtest metrics computation.
 *
 * Used by backtest-metrics.ts (which exposes computeMetricsCore, used by both
 * the trade-based computeMetrics and the return-based computeDailyReturnMetrics
 * in open-close-returns.ts) to avoid duplication.
 */

/** Number of trading days per year for Sharpe annualization. */
export const TRADING_DAYS_PER_YEAR = 252;

/** Safe division — returns 0 when the denominator is zero or non-finite. */
export function safeDiv(a: number, b: number): number {
  return b === 0 || !Number.isFinite(b) ? 0 : a / b;
}

/** Population standard deviation. Returns 0 for fewer than 2 values. */
export function stdDev(values: number[]): number {
  if (values.length < 2) return 0;
  const mean = values.reduce((s, v) => s + v, 0) / values.length;
  const variance = values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

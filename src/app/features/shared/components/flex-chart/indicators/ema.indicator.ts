/**
 * EMA — Exponential Moving Average
 *
 * THEORY
 * ------
 * EMA gives more weight to recent prices, making it more responsive to new
 * information than a Simple Moving Average (SMA). The weighting multiplier
 * decreases exponentially, so older prices have diminishing influence.
 *
 * CALCULATION
 * ----------
 * 1. Multiplier k = 2 / (period + 1)
 * 2. First EMA value = SMA of the first `period` closing prices
 * 3. Subsequent: EMA = close × k + prevEMA × (1 - k)
 *
 * PARAMETERS
 * ----------
 * - period (default: 20) — lookback window.
 *   Common values: 9, 12, 20, 26, 50, 200.
 *   Shorter = more responsive, longer = smoother.
 *
 * USAGE NOTES
 * -----------
 * - Price above EMA → bullish bias; below → bearish bias.
 * - EMA crossovers (fast over slow) are common trend signals.
 * - EMA(12) and EMA(26) are the basis of MACD.
 * - Not useful in sideways/choppy markets (many false signals).
 *
 * CHART RENDERING
 * ---------------
 * - Pane: main (overlaid on price)
 * - Axis: auto (follows price scale)
 * - Series: single line (y = EMA value)
 */

import type { IndicatorOption, IndicatorCalculator, PriceBar } from '../flex-chart.types';

// =============================================================================
// 1. CHART CONFIGURATION
// =============================================================================

export const EMA_INDICATOR: IndicatorOption = {
  id: 'ema',
  label: 'EMA (Exponential Moving Average)',
  type: 'ema',
  defaultPane: 'main',
  axisScale: 'auto',
  params: [
    { key: 'period', label: 'Period', default: 20, min: 2, max: 500 },
  ],
};

// =============================================================================
// 2. CALCULATION
// =============================================================================

/** Core EMA calculation from PriceBar close values */
export const calculateEMA: IndicatorCalculator = (bars, params) => {
  const period = Number(params['period']) || 20;
  return calculateEMAFromBars(bars, period);
};

/** EMA from PriceBar array (used by other indicators that depend on EMA) */
export function calculateEMAFromBars(
  bars: PriceBar[],
  period: number
): { x: Date; y: number }[] {
  if (period <= 0 || bars.length < period) return [];

  const k = 2 / (period + 1);
  const result: { x: Date; y: number }[] = [];

  // First EMA = SMA of initial period
  let ema = 0;
  for (let i = 0; i < period; i++) {
    ema += bars[i].close;
  }
  ema /= period;
  result.push({ x: bars[period - 1].x, y: ema });

  // Subsequent EMAs
  for (let i = period; i < bars.length; i++) {
    ema = bars[i].close * k + ema * (1 - k);
    result.push({ x: bars[i].x, y: ema });
  }

  return result;
}

/** EMA from a pre-computed value series (used internally by MACD) */
export function calculateEMAFromValues(
  values: { x: Date; y: number }[],
  period: number
): { x: Date; y: number }[] {
  if (period <= 0 || values.length < period) return [];

  const k = 2 / (period + 1);
  const result: { x: Date; y: number }[] = [];

  let ema = 0;
  for (let i = 0; i < period; i++) {
    ema += values[i].y;
  }
  ema /= period;
  result.push({ x: values[period - 1].x, y: ema });

  for (let i = period; i < values.length; i++) {
    ema = values[i].y * k + ema * (1 - k);
    result.push({ x: values[i].x, y: ema });
  }

  return result;
}

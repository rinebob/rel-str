/**
 * MACD — Moving Average Convergence Divergence
 *
 * THEORY
 * ------
 * MACD is a trend-following momentum indicator that shows the relationship
 * between two EMAs of a security's price. Developed by Gerald Appel (1979).
 *
 * Components:
 *   - MACD line:   EMA(fast) - EMA(slow)  — measures momentum direction
 *   - Signal line: EMA of the MACD line   — smoothed trigger line
 *   - Histogram:   MACD line - signal line — visualizes convergence/divergence
 *
 * Key signals:
 *   - MACD crosses above signal → bullish momentum (buy)
 *   - MACD crosses below signal → bearish momentum (sell)
 *   - Histogram growing → momentum accelerating
 *   - Histogram shrinking → momentum decelerating
 *   - Zero line cross → trend direction change
 *
 * CALCULATION
 * ----------
 * 1. fastEMA = EMA(close, fastPeriod)     (default 12)
 * 2. slowEMA = EMA(close, slowPeriod)     (default 26)
 * 3. MACD line = fastEMA - slowEMA
 * 4. Signal line = EMA(MACD line, signalPeriod)  (default 9)
 * 5. Histogram = MACD line - signal line
 *
 * PARAMETERS
 * ----------
 * - fastPeriod   (default: 12) — short-term EMA period
 * - slowPeriod   (default: 26) — long-term EMA period
 * - signalPeriod (default:  9) — signal line smoothing period
 *
 * USAGE NOTES
 * -----------
 * - Classic settings (12,26,9) work well for daily charts.
 * - For intraday, try (5,13,1) or (3,10,16).
 * - MACD is a lagging indicator — it confirms trends, doesn't predict them.
 * - Divergence between price and MACD histogram often precedes reversals.
 * - Works poorly in rangebound/choppy markets (many false crosses).
 *
 * CHART RENDERING
 * ---------------
 * - Pane: lower (separate from price)
 * - Axis: auto-scaled
 * - Reference line: zero line (gray dashed)
 * - Series: MACD line (y), signal line (y2), histogram columns (y3)
 */

import type { IndicatorOption, IndicatorCalculator } from '../flex-chart.types';
import { calculateEMAFromBars, calculateEMAFromValues } from './ema.indicator';

// =============================================================================
// 1. CHART CONFIGURATION
// =============================================================================

export const MACD_INDICATOR: IndicatorOption = {
  id: 'macd',
  label: 'MACD',
  type: 'macd',
  defaultPane: 'lower-2',
  axisScale: 'auto',
  params: [
    { key: 'fastPeriod', label: 'Fast Period', default: 12, min: 2, max: 50 },
    { key: 'slowPeriod', label: 'Slow Period', default: 26, min: 5, max: 200 },
    { key: 'signalPeriod', label: 'Signal Period', default: 9, min: 2, max: 50 },
  ],
  defaultOptions: {
    color2: '#e91e63',
    referenceLines: [
      { value: 0, color: '#9e9e9e', dashArray: '2,2' },
    ],
    showHistogram: true,
  },
};

// =============================================================================
// 2. CALCULATION
// =============================================================================

export const calculateMACD: IndicatorCalculator = (bars, params) => {
  const fastPeriod = Number(params['fastPeriod']) || 12;
  const slowPeriod = Number(params['slowPeriod']) || 26;
  const signalPeriod = Number(params['signalPeriod']) || 9;

  if (bars.length < slowPeriod + signalPeriod) return [];

  // Step 1-2: Calculate fast and slow EMAs
  const fastEMA = calculateEMAFromBars(bars, fastPeriod);
  const slowEMA = calculateEMAFromBars(bars, slowPeriod);

  // Step 3: MACD line = fastEMA - slowEMA (aligned by date)
  const macdLine: { x: Date; y: number }[] = [];
  const slowStartIndex = slowPeriod - 1;

  for (let i = 0; i < fastEMA.length; i++) {
    const fastIndex = fastPeriod - 1 + i;
    if (fastIndex >= slowStartIndex) {
      const slowIndex = fastIndex - slowStartIndex;
      if (slowIndex < slowEMA.length) {
        macdLine.push({
          x: fastEMA[i].x,
          y: fastEMA[i].y - slowEMA[slowIndex].y,
        });
      }
    }
  }

  // Step 4: Signal line = EMA of MACD line
  const signalLine = calculateEMAFromValues(macdLine, signalPeriod);

  // Step 5: Combine MACD, signal, and histogram
  const result: { x: Date; y: number; y2?: number; y3?: number }[] = [];
  const signalStartIndex = signalPeriod - 1;

  for (let i = signalStartIndex; i < macdLine.length; i++) {
    const signalIndex = i - signalStartIndex;
    if (signalIndex < signalLine.length) {
      const macdVal = Math.round(macdLine[i].y * 100) / 100;
      const signalVal = Math.round(signalLine[signalIndex].y * 100) / 100;
      result.push({
        x: macdLine[i].x,
        y: macdVal,
        y2: signalVal,
        y3: Math.round((macdVal - signalVal) * 100) / 100,
      });
    }
  }

  return result;
};

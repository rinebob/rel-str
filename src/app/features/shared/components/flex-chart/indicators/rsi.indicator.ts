/**
 * RSI — Relative Strength Index
 *
 * THEORY
 * ------
 * RSI measures the speed and magnitude of recent price changes to evaluate
 * whether a security is overbought or oversold. Developed by J. Welles Wilder
 * (1978, "New Concepts in Technical Trading Systems").
 *
 * RSI oscillates between 0 and 100:
 *   - Above 70: overbought (potential reversal or pullback)
 *   - Below 30: oversold   (potential bounce or reversal)
 *   - 50 line:  neutral momentum divider
 *
 * CALCULATION
 * ----------
 * 1. For each bar, compute price change: change = close[i] - close[i-1]
 * 2. Separate into gains (change > 0) and losses (|change| when change < 0)
 * 3. First average: simple average of first `period` gains and losses
 * 4. Subsequent averages use Wilder smoothing (exponential):
 *      avgGain = (prevAvgGain × (period - 1) + currentGain) / period
 *      avgLoss = (prevAvgLoss × (period - 1) + currentLoss) / period
 * 5. RS = avgGain / avgLoss
 * 6. RSI = 100 - (100 / (1 + RS))
 *
 * PARAMETERS
 * ----------
 * - period (default: 14) — lookback window. Wilder recommended 14.
 *   Shorter periods (7-9) are more sensitive; longer (21-28) smoother.
 *
 * USAGE NOTES
 * -----------
 * - RSI divergence (price makes new high but RSI doesn't) is a strong
 *   reversal signal, but is NOT detected by this indicator alone.
 * - In strong trends, RSI can stay overbought/oversold for extended periods.
 *   Adjust thresholds to 80/20 in trending markets.
 * - Combine with price action or volume for confirmation.
 *
 * CHART RENDERING
 * ---------------
 * - Pane: lower (separate from price)
 * - Axis: fixed 0–100
 * - Reference lines: 70 (overbought, red dashed), 30 (oversold, green dashed)
 * - Series: single line (y = RSI value)
 */

import type { IndicatorOption, IndicatorCalculator } from '../flex-chart.types';

// =============================================================================
// 1. CHART CONFIGURATION
// =============================================================================

export const RSI_INDICATOR: IndicatorOption = {
  id: 'rsi',
  label: 'RSI (Relative Strength Index)',
  type: 'rsi',
  defaultPane: 'lower-1',
  axisScale: 'fixed-0-100',
  params: [
    { key: 'period', label: 'Period', default: 14, min: 2, max: 100 },
  ],
  defaultOptions: {
    referenceLines: [
      { value: 70, color: '#ef5350', dashArray: '4,3', label: 'Overbought' },
      { value: 30, color: '#26a69a', dashArray: '4,3', label: 'Oversold' },
    ],
  },
};

// =============================================================================
// 2. CALCULATION
// =============================================================================

export const calculateRSI: IndicatorCalculator = (bars, params) => {
  const period = Number(params['period']) || 14;

  if (period <= 0 || bars.length < period + 1) return [];

  const result: { x: Date; y: number }[] = [];
  let gains = 0;
  let losses = 0;

  // Step 1-3: Initial average gain/loss over first `period` changes
  for (let i = 1; i <= period; i++) {
    const change = bars[i].close - bars[i - 1].close;
    if (change > 0) gains += change;
    else losses += Math.abs(change);
  }

  let avgGain = gains / period;
  let avgLoss = losses / period;

  // Step 5-6: First RSI value
  let rs = avgGain / avgLoss;
  let rsi = 100 - 100 / (1 + rs);
  result.push({ x: bars[period].x, y: Math.round(rsi * 100) / 100 });

  // Step 4-6: Subsequent RSI values using Wilder smoothing
  for (let i = period + 1; i < bars.length; i++) {
    const change = bars[i].close - bars[i - 1].close;
    const gain = change > 0 ? change : 0;
    const loss = change < 0 ? Math.abs(change) : 0;

    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;

    rs = avgGain / avgLoss;
    rsi = 100 - 100 / (1 + rs);
    result.push({ x: bars[i].x, y: Math.round(rsi * 100) / 100 });
  }

  return result;
};

/**
 * ST-Trend-Strength — Savant Trader Trend Strength
 *
 * THEORY
 * ------
 * Measures directional trend strength using a proprietary adaptation of the
 * Directional Index. Produces DI+, DI-, and a histogram (diHist = DI+ - DI-)
 * that indicates bullish/bearish momentum intensity.
 *
 * Both CTF and HTF instances are supported via period multiplier.
 *
 * CALCULATION
 * ----------
 * 1. For each bar, compute:
 *    - +DM = high[i] - high[i-1] (if positive and > -DM, else 0)
 *    - -DM = low[i-1] - low[i]   (if positive and > +DM, else 0)
 *    - TR  = max(high-low, |high-prevClose|, |low-prevClose|)
 * 2. Smooth +DM, -DM, TR with Wilder smoothing over `period`
 * 3. DI+ = (smoothed +DM / smoothed TR) * 100
 *    DI- = (smoothed -DM / smoothed TR) * 100
 * 4. diHist = DI+ - DI-
 * 5. DX = |DI+ - DI-| / (DI+ + DI-) * 100
 *    ADX = Wilder smooth of DX over `period`
 *
 * Signal generation:
 * - Cross triggers on diHist crossing zero, +10, -10
 * - Break patterns: upBreak = diHist > 0 && diHist > prev && prev < prevPrev
 *
 * PARAMETERS
 * ----------
 * - period (default: 14) — DI smoothing period
 * - htfMultiplier (default: 5) — for HTF instance, multiply period by this
 * - upperThreshold (default: 10) — cross trigger level
 * - lowerThreshold (default: -10) — cross trigger level
 *
 * USAGE NOTES
 * -----------
 * - diHist > 0 = bulls in control; diHist < 0 = bears in control
 * - Break patterns indicate trend acceleration after consolidation
 * - HTF instance provides higher-timeframe trend context
 * - Combine with ST-Trend-Bands for directional confirmation
 *
 * CHART RENDERING
 * ---------------
 * - Pane: lower (separate from price)
 * - Axis: auto-scaled (typically -50 to +50 range)
 * - Reference lines: 0 (neutral), +10 (upper threshold), -10 (lower threshold)
 * - Series: histogram (diHist), optional DI+/DI- lines
 */

import type { IndicatorOption, IndicatorCalculator } from '../flex-chart.types';

// =============================================================================
// 1. CHART CONFIGURATION
// =============================================================================

export const ST_TREND_STRENGTH_INDICATOR: IndicatorOption = {
  id: 'st-trend-strength',
  label: 'ST Trend Strength',
  type: 'st-trend-strength',
  defaultPane: 'lower-2',
  axisScale: 'fixed',
  params: [
    { key: 'period', label: 'Period', default: 14, min: 5, max: 50 },
  ],
  defaultOptions: {
    axisMin: -50,
    axisMax: 50,
    referenceLines: [
      { value: 0, color: '#000000', label: 'Zero' },
      { value: 10, color: '#000000', label: 'Upper' },
      { value: -10, color: '#000000', label: 'Lower' },
    ],
  },
};

// =============================================================================
// 2. CALCULATION (inline for frontend visual verification)
// =============================================================================

const HTF_MULTIPLIER = 3;
const ADX_LENGTH = 14;

export const calculateStTrendStrength: IndicatorCalculator = (bars, params) => {
  const len = bars.length;
  const mult = HTF_MULTIPLIER;

  if (len < mult + ADX_LENGTH) return [];

  const rawHigh = bars.map(b => b.high);
  const rawLow = bars.map(b => b.low);
  const rawClose = bars.map(b => b.close);

  const diHist = new Array<number>(len).fill(NaN);
  const smoothedTR = new Array<number>(len).fill(0);
  const smoothedDMPlus = new Array<number>(len).fill(0);
  const smoothedDMMinus = new Array<number>(len).fill(0);

  for (let i = mult; i < len; i++) {
    const h = rawHigh[i];
    const l = rawLow[i];
    const prevClose = rawClose[i - mult] ?? 0;
    const prevHigh = rawHigh[i - mult] ?? 0;
    const prevLow = rawLow[i - mult] ?? 0;

    // True Range
    const trueRange = Math.max(h - l, Math.abs(h - prevClose), Math.abs(l - prevClose));

    // Directional Movement
    const upMove = h - prevHigh;
    const downMove = prevLow - l;
    const dmPlus = (upMove > downMove && upMove > 0) ? upMove : 0;
    const dmMinus = (downMove > upMove && downMove > 0) ? downMove : 0;

    // Wilder smoothing with HTF lookback
    const prevSTR = i >= mult ? (smoothedTR[i - mult] || 0) : 0;
    const prevSDMP = i >= mult ? (smoothedDMPlus[i - mult] || 0) : 0;
    const prevSDMM = i >= mult ? (smoothedDMMinus[i - mult] || 0) : 0;

    smoothedTR[i] = prevSTR - (prevSTR / ADX_LENGTH) + trueRange;
    smoothedDMPlus[i] = prevSDMP - (prevSDMP / ADX_LENGTH) + dmPlus;
    smoothedDMMinus[i] = prevSDMM - (prevSDMM / ADX_LENGTH) + dmMinus;

    if (smoothedTR[i] !== 0) {
      const diPlus = (smoothedDMPlus[i] / smoothedTR[i]) * 100;
      const diMinus = (smoothedDMMinus[i] / smoothedTR[i]) * 100;
      diHist[i] = diPlus - diMinus;
    } else {
      diHist[i] = 0;
    }
  }

  return bars.map((b, i) => ({
    x: b.x,
    y: diHist[i],
    color: diHist[i] >= 0 ? '#2196f3' : '#ffeb3b',
  })).filter(p => !isNaN(p.y));
};

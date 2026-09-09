/**
 * ST-Trend-Strength — Savant Trader Trend Strength
 *
 * THEORY
 * ------
 * Measures directional trend strength using a proprietary adaptation of the
 * Directional Index. Produces DI+, DI-, and a histogram (diHist = DI+ - DI-)
 * that indicates bullish/bearish momentum intensity.
 *
 * The visible local DI reference uses a one-bar lookback. Trend Bands and
 * Zones retain their separate HTF multiplier behavior.
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
 * - showHtf (default: 1) — show the stepped 3-period HTF histogram
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
import { StIndicator } from '../flex-chart.types';

// =============================================================================
// 1. CHART CONFIGURATION
// =============================================================================

export const ST_TREND_STRENGTH_INDICATOR: IndicatorOption = {
  id: 'st-trend-strength',
  label: 'ST Trend Strength',
  type: StIndicator.TREND_STRENGTH,
  defaultPane: 'lower-2',
  axisScale: 'fixed',
  params: [
    { key: 'period', label: 'Period', default: 14, min: 5, max: 50 },
    { key: 'showHtf', label: 'Show HTF (1/0)', default: 1, min: 0, max: 1 },
  ],
  defaultOptions: {
    axisMin: -50,
    axisMax: 50,
    color: '#2196f3',
    color2: '#0d47a1',
    referenceLines: [
      { value: 0,   color: '#9e9e9e', dashArray: '4,3', label: 'Zero' },
      { value: 10,  color: 'rgba(158,158,158,0.5)', dashArray: '4,3', label: 'Upper' },
      { value: -10, color: 'rgba(158,158,158,0.5)', dashArray: '4,3', label: 'Lower' },
    ],
  },
};

// =============================================================================
// 2. CALCULATION (inline for frontend visual verification)
// =============================================================================

const DI_LOOKBACK = 1;
const ADX_LENGTH = 14;

export const calculateStTrendStrength: IndicatorCalculator = (bars, params) => {
  const len = bars.length;
  const mult = DI_LOOKBACK;
  const adxLength = Number(params['period']) || ADX_LENGTH;
  const showHtf = Number(params['showHtf'] ?? 1) !== 0;

  if (len < Math.max(mult, 3) + 1) return [];

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

    smoothedTR[i] = prevSTR - (prevSTR / adxLength) + trueRange;
    smoothedDMPlus[i] = prevSDMP - (prevSDMP / adxLength) + dmPlus;
    smoothedDMMinus[i] = prevSDMM - (prevSDMM / adxLength) + dmMinus;

    if (smoothedTR[i] !== 0) {
      const diPlus = (smoothedDMPlus[i] / smoothedTR[i]) * 100;
      const diMinus = (smoothedDMMinus[i] / smoothedTR[i]) * 100;
      diHist[i] = diPlus - diMinus;
    } else {
      diHist[i] = 0;
    }
  }

  // Stepped/developing HTF histogram: same 3-period lookback concept as
  // Trend Bands. The recurrence carries the latest value between steps.
  const htfMult = 3;
  const htfRawDiHist = new Array<number>(len).fill(NaN);
  const htfSmoothedTR = new Array<number>(len).fill(0);
  const htfSmoothedDMPlus = new Array<number>(len).fill(0);
  const htfSmoothedDMMinus = new Array<number>(len).fill(0);

  for (let i = htfMult; i < len; i++) {
    const h = rawHigh[i];
    const l = rawLow[i];
    const prevClose = rawClose[i - htfMult] ?? 0;
    const prevHigh = rawHigh[i - htfMult] ?? 0;
    const prevLow = rawLow[i - htfMult] ?? 0;
    const trueRange = Math.max(h - l, Math.abs(h - prevClose), Math.abs(l - prevClose));
    const upMove = h - prevHigh;
    const downMove = prevLow - l;
    const dmPlus = (upMove > downMove && upMove > 0) ? upMove : 0;
    const dmMinus = (downMove > upMove && downMove > 0) ? downMove : 0;
    const prevTR = htfSmoothedTR[i - htfMult] || 0;
    const prevDMPlus = htfSmoothedDMPlus[i - htfMult] || 0;
    const prevDMMinus = htfSmoothedDMMinus[i - htfMult] || 0;
    htfSmoothedTR[i] = prevTR - (prevTR / adxLength) + trueRange;
    htfSmoothedDMPlus[i] = prevDMPlus - (prevDMPlus / adxLength) + dmPlus;
    htfSmoothedDMMinus[i] = prevDMMinus - (prevDMMinus / adxLength) + dmMinus;
    htfRawDiHist[i] = htfSmoothedTR[i] !== 0
      ? (htfSmoothedDMPlus[i] / htfSmoothedTR[i] - htfSmoothedDMMinus[i] / htfSmoothedTR[i]) * 100
      : 0;
  }

  // Hold the latest HTF value between 3-period boundaries, matching the
  // stepped higher-timeframe behavior used by Trend Bands.
  const htfDiHist = new Array<number>(len).fill(NaN);
  let lastHtfValue = NaN;
  for (let i = 0; i < len; i++) {
    if (i >= htfMult && (i + 1) % htfMult === 0) lastHtfValue = htfRawDiHist[i];
    htfDiHist[i] = lastHtfValue;
  }

  return bars.map((b, i) => {
    const includeHtf = showHtf && !Number.isNaN(htfDiHist[i]);
    return {
      x: b.x,
      y: diHist[i],
      color: diHist[i] > 0 ? '#2196f3' : '#ffeb3b',
      ...(includeHtf ? {
        y2: htfDiHist[i],
        y2Color: htfDiHist[i] > 0 ? '#0d47a1' : '#8a6d00',
      } : {}),
    };
  }).filter(p => !Number.isNaN(p.y));
};

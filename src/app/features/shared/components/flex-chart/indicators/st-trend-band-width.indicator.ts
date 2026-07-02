/**
 * ST-TrendBandWidth — Savant Trader Trend Band Width
 *
 * THEORY
 * ------
 * Measures the total vertical span of all 4 ST-Trend-Bands combined at each bar.
 * Captures the compression → expansion → pullback rhythm that precedes high-probability
 * trend continuation entries.
 *
 * validSetup[i] is true when:
 *   1. A band width expansion spike occurred recently (within maxPullbackBars)
 *   2. Width is still elevated at bar i (hasn't fully contracted back)
 *
 * This is the "rocket vs rubber band" filter: rubber bands fail stillElevated because
 * bands have already snapped back. Rockets pass because the pullback occurs while bands
 * are still wide.
 *
 * CHART RENDERING
 * ---------------
 * - Lower pane (lower-1): line series of raw width values, shared with ST-TrendStrength
 *   so you can see if band expansion correlates with DI histogram spikes
 *   Color: green (#4caf50) when validSetup=true, grey (#666666) when false
 * - Price pane (main): scatter dots at bars where validSetup=true
 */

import type { IndicatorOption, IndicatorCalculator, PriceBar } from '../flex-chart.types';
import { StIndicator } from '../flex-chart.types';

// =============================================================================
// 1. CHART CONFIGURATION
// =============================================================================

export const ST_TREND_BAND_WIDTH_INDICATOR: IndicatorOption = {
  id: 'st-trend-band-width',
  label: 'ST TrendBand Width',
  type: StIndicator.TREND_BAND_WIDTH,
  defaultPane: 'lower-4',
  axisScale: 'auto',
  params: [
    { key: 'N',                  label: 'Lookback',           default: 10,   min: 5,  max: 30 },
    { key: 'expansionThreshold', label: 'Expansion Threshold', default: 1.25, min: 1.1, max: 2.0 },
    { key: 'retainThreshold',    label: 'Retain Threshold',    default: 1.10, min: 1.0, max: 1.5 },
    { key: 'maxPullbackBars',    label: 'Max Pullback Bars',   default: 10,   min: 3,  max: 20 },
    { key: 'overlayStrength',    label: 'Overlay on Strength', default: 0,    min: 0,  max: 1 },
  ],
  defaultOptions: {},
};

// =============================================================================
// 2. INLINE BAND + WIDTH COMPUTATION (no external imports — follows ST indicator pattern)
// =============================================================================

const HTF_MULTIPLIER = 3;

function emaSeries(prices: number[], period: number): number[] {
  const len = prices.length;
  const result = new Array<number>(len).fill(NaN);
  if (len < period || period < 1) return result;
  const k = 2 / (period + 1);
  let start = 0;
  while (start < len && isNaN(prices[start])) start++;
  if (start + period > len) return result;
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

function computeBandHL(bars: PriceBar[], smoothLen: number, afterLen: number, mult: number): { h: number[]; l: number[] } {
  const len = bars.length;
  const beforeLength = smoothLen * mult;
  const afterLength  = afterLen  * mult;
  const lookback     = mult;

  const sO = emaSeries(bars.map(b => b.open),  beforeLength);
  const sH = emaSeries(bars.map(b => b.high),  beforeLength);
  const sL = emaSeries(bars.map(b => b.low),   beforeLength);
  const sC = emaSeries(bars.map(b => b.close), beforeLength);

  const haClose = new Array<number>(len).fill(NaN);
  const haOpen  = new Array<number>(len).fill(NaN);

  for (let i = 0; i < len; i++) {
    if (isNaN(sO[i]) || isNaN(sH[i]) || isNaN(sL[i]) || isNaN(sC[i])) continue;
    haClose[i] = (sO[i] + sH[i] + sL[i] + sC[i]) / 4;
    haOpen[i]  = (i < lookback || isNaN(haOpen[i - lookback]))
      ? (sO[i] + sC[i]) / 2
      : (haOpen[i - lookback] + haClose[i - lookback]) / 2;
  }

  const postO = emaSeries(haOpen,  afterLength);
  const postC = emaSeries(haClose, afterLength);

  const bandH = new Array<number>(len).fill(NaN);
  const bandL = new Array<number>(len).fill(NaN);

  for (let i = 0; i < len; i++) {
    if (isNaN(postO[i]) || isNaN(postC[i])) continue;
    bandH[i] = Math.max(postO[i], postC[i]);
    bandL[i] = Math.min(postO[i], postC[i]);
  }

  if (mult > 1) {
    for (let i = 0; i < len; i++) {
      const isHtfClose = (i % mult) === (mult - 1);
      if (!isHtfClose && i > 0) {
        bandH[i] = bandH[i - 1];
        bandL[i] = bandL[i - 1];
      }
    }
  }

  return { h: bandH, l: bandL };
}

interface BandWidthSeries {
  width:      number[];
  validSetup: boolean[];
}

function computeBandWidthSeries(bars: PriceBar[], params: Record<string, number>): BandWidthSeries {
  const N                  = params['N']                  ?? 10;
  const expansionThreshold = params['expansionThreshold'] ?? 1.25;
  const retainThreshold    = params['retainThreshold']    ?? 1.10;
  const maxPullbackBars    = params['maxPullbackBars']    ?? 10;

  const b1 = computeBandHL(bars, 5,  5,  1);
  const b2 = computeBandHL(bars, 10, 10, 1);
  const b3 = computeBandHL(bars, 5,  5,  HTF_MULTIPLIER);
  const b4 = computeBandHL(bars, 10, 10, HTF_MULTIPLIER);

  const len   = bars.length;
  const width = new Array<number>(len).fill(NaN);

  for (let i = 0; i < len; i++) {
    const maxH = Math.max(b1.h[i], b2.h[i], b3.h[i], b4.h[i]);
    const minL = Math.min(b1.l[i], b2.l[i], b3.l[i], b4.l[i]);
    const close = bars[i].close;
    if (isFinite(maxH) && isFinite(minL) && close > 0) width[i] = (maxH - minL) / close * 100;
  }

  const validSetup  = new Array<boolean>(len).fill(false);
  let lastSpikeBar  = -Infinity;

  for (let i = N; i < len; i++) {
    const w = width[i];
    const wN = width[i - N];
    if (isNaN(w) || isNaN(wN) || wN === 0) continue;

    const ratio = w / wN;
    if (ratio > expansionThreshold) lastSpikeBar = i;

    const barsSinceSpike   = i - lastSpikeBar;
    const recentlyExpanded = barsSinceSpike <= maxPullbackBars;
    const stillElevated    = ratio > retainThreshold;
    validSetup[i]          = recentlyExpanded && stillElevated;
  }

  return { width, validSetup };
}

// =============================================================================
// 3. CALCULATOR (lower pane — line series colored by validSetup)
// =============================================================================

export const calculateStTrendBandWidth: IndicatorCalculator = (bars, params) => {
  if (bars.length < 30) return [];
  const N                  = Number(params?.['N']                  ?? 10);
  const expansionThreshold = Number(params?.['expansionThreshold'] ?? 1.25);
  const retainThreshold    = Number(params?.['retainThreshold']    ?? 1.10);
  const maxPullbackBars    = Number(params?.['maxPullbackBars']    ?? 10);
  const overlayStrength    = Number(params?.['overlayStrength']    ?? 0);

  const p = { N, expansionThreshold, retainThreshold, maxPullbackBars };
  const { width, validSetup } = computeBandWidthSeries(bars, p);

  // Compute expansionRatio inline for scaled output
  const result = [];
  for (let i = N; i < bars.length; i++) {
    const w  = width[i];
    const wN = width[i - N];
    if (isNaN(w) || isNaN(wN) || wN === 0) continue;
    const ratio = w / wN;
    // overlayStrength=1: scale into -50/50 window for trend strength pane overlay
    // overlayStrength=0: output % band width (width/close*100)
    const y = overlayStrength === 1 ? (ratio - 1) * 50 : w;
    result.push({
      x:     bars[i].x,
      y,
      color: validSetup[i] ? '#2196f3' : '#ffc107',
    });
  }
  return result;
};

// =============================================================================
// 4. VALID-SETUP DOTS (price pane overlay)
// =============================================================================

export interface BandWidthDotPoint {
  x: Date;
  y: number;
  color: string;
}

/**
 * Compute scatter dots for the price pane at bars where validSetup is true.
 * Positioned just below the bar low for visibility without obscuring price action.
 */
export function computeBandWidthDots(
  bars: PriceBar[],
  params?: Record<string, number | string | boolean>,
): BandWidthDotPoint[] {
  if (bars.length < 30) return [];
  const p = {
    N:                  Number(params?.['N']                  ?? 10),
    expansionThreshold: Number(params?.['expansionThreshold'] ?? 1.25),
    retainThreshold:    Number(params?.['retainThreshold']    ?? 1.10),
    maxPullbackBars:    Number(params?.['maxPullbackBars']    ?? 10),
  };
  const { validSetup } = computeBandWidthSeries(bars, p);
  const dots: BandWidthDotPoint[] = [];
  for (let i = 0; i < bars.length; i++) {
    if (validSetup[i]) {
      dots.push({ x: bars[i].x, y: bars[i].low * 0.995, color: '#4caf50' });
    }
  }
  return dots;
}

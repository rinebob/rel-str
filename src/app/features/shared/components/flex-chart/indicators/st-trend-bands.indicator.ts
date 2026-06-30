/**
 * ST-Trend-Bands — Savant Trader Trend Bands
 *
 * THEORY
 * ------
 * Double-smoothed price bands that act as dynamic trend filters. Each band
 * applies EMA pre-smoothing to raw OHLC, transforms via a proprietary method,
 * then applies EMA post-smoothing. The result is a set of smooth bands that
 * define trend direction and provide cross-trigger entry signals.
 *
 * Four bands are produced:
 *   - Band 1 (CTF fast): lengths 5/5 on chart timeframe
 *   - Band 2 (CTF slow): lengths 10/10 on chart timeframe
 *   - Band 3 (HTF fast): lengths 5/5 scaled by HTF multiplier
 *   - Band 4 (HTF slow): lengths 10/10 scaled by HTF multiplier
 *
 * CALCULATION
 * ----------
 * Per band:
 * 1. Pre-smooth raw OHLC with EMA(length) → smoothed O, H, L, C
 * 2. Proprietary transform on smoothed OHLC (recursive, seed on first bar)
 * 3. Post-smooth with EMA(afterLength) → final band O, H, L, C
 * 4. Force body: H = max(O,C), L = min(O,C), mid = L + |H-L|/2
 * 5. Trend: up = C > O, dn = O > C
 * 6. Cross triggers: crossover(rawClose, bandHigh), crossunder(rawClose, bandLow)
 *
 * HTF bands multiply smoothing lengths by htfMultiplier (e.g., 5 for daily→weekly)
 * and use a deeper lookback for the recursive seed.
 *
 * PARAMETERS
 * ----------
 * - ctfFastLength (default: 5) — pre-smooth length for CTF fast band
 * - ctfSlowLength (default: 10) — pre-smooth length for CTF slow band
 * - htfFastLength (default: 5) — pre-smooth length for HTF fast band (before multiplier)
 * - htfSlowLength (default: 10) — pre-smooth length for HTF slow band (before multiplier)
 * - afterLength (default: same as pre-smooth) — post-smooth EMA length
 * - htfMultiplier (default: 5) — timeframe scaling factor (daily→weekly = 5)
 *
 * USAGE NOTES
 * -----------
 * - Bands overlay on price; trend direction is determined by band slope (C > O = up)
 * - Cross triggers (price crossing band high/low) are primary entry signals
 * - Composite trend categories (threeUp, twoUp, etc.) are derived from
 *   combining band 1/2/3 up/dn flags
 *
 * CHART RENDERING
 * ---------------
 * - Pane: overlay (main price pane)
 * - Axis: price scale
 * - Series: 4 bands rendered as filled rectangles (H/L) with directional coloring
 */

import type { IndicatorOption, IndicatorCalculator, PriceBar } from '../flex-chart.types';
import { StIndicator } from '../flex-chart.types';

// =============================================================================
// 1. CHART CONFIGURATION
// =============================================================================

export const ST_TREND_BANDS_INDICATOR: IndicatorOption = {
  id: 'st-trend-bands',
  label: 'ST Trend Bands',
  type: StIndicator.TREND_BANDS,
  defaultPane: 'overlay',
  axisScale: 'price',
  params: [
    { key: 'ctfFastLength', label: 'CTF Fast Length', default: 5, min: 2, max: 50 },
    { key: 'ctfSlowLength', label: 'CTF Slow Length', default: 10, min: 2, max: 100 },
  ],
  defaultOptions: {
    referenceLines: [],
  },
};

// =============================================================================
// 2. CALCULATION (inline for frontend visual verification)
// =============================================================================

const HTF_MULTIPLIER = 3;

function emaSeries(prices: number[], period: number): number[] {
  const len = prices.length;
  const result = new Array<number>(len).fill(NaN);
  if (len < period || period < 1) return result;
  const k = 2 / (period + 1);

  // Find first non-NaN index
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

function computeBand(bars: PriceBar[], smoothLen: number, afterLen: number, mult: number) {
  const len = bars.length;
  const beforeLength = smoothLen * mult;
  const afterLength = afterLen * mult;
  const lookback = mult;

  const rawO = bars.map(b => b.open);
  const rawH = bars.map(b => b.high);
  const rawL = bars.map(b => b.low);
  const rawC = bars.map(b => b.close);

  const sO = emaSeries(rawO, beforeLength);
  const sH = emaSeries(rawH, beforeLength);
  const sL = emaSeries(rawL, beforeLength);
  const sC = emaSeries(rawC, beforeLength);

  const haClose = new Array<number>(len).fill(NaN);
  const haOpen = new Array<number>(len).fill(NaN);
  const haHigh = new Array<number>(len).fill(NaN);
  const haLow = new Array<number>(len).fill(NaN);

  for (let i = 0; i < len; i++) {
    if (isNaN(sO[i]) || isNaN(sH[i]) || isNaN(sL[i]) || isNaN(sC[i])) continue;
    haClose[i] = (sO[i] + sH[i] + sL[i] + sC[i]) / 4;
    if (i < lookback || isNaN(haOpen[i - lookback])) {
      haOpen[i] = (sO[i] + sC[i]) / 2;
    } else {
      haOpen[i] = (haOpen[i - lookback] + haClose[i - lookback]) / 2;
    }
    haHigh[i] = Math.max(sH[i], haOpen[i], haClose[i]);
    haLow[i] = Math.min(sL[i], haOpen[i], haClose[i]);
  }

  const postO = emaSeries(haOpen, afterLength);
  const postC = emaSeries(haClose, afterLength);

  const bandO = new Array<number>(len).fill(NaN);
  const bandH = new Array<number>(len).fill(NaN);
  const bandL = new Array<number>(len).fill(NaN);
  const bandC = new Array<number>(len).fill(NaN);
  const bandM = new Array<number>(len).fill(NaN);
  const up = new Array<boolean>(len).fill(false);

  for (let i = 0; i < len; i++) {
    if (isNaN(postO[i]) || isNaN(postC[i])) continue;
    bandO[i] = postO[i];
    bandC[i] = postC[i];
    bandH[i] = Math.max(postO[i], postC[i]);
    bandL[i] = Math.min(postO[i], postC[i]);
    bandM[i] = bandL[i] + Math.abs(bandH[i] - bandL[i]) / 2;
    up[i] = bandC[i] > bandO[i];
  }

  // Jagged stepping for HTF (mult > 1)
  if (mult > 1) {
    for (let i = 0; i < len; i++) {
      const isHtfClose = (i % mult) === (mult - 1);
      if (!isHtfClose && i > 0) {
        bandO[i] = bandO[i - 1];
        bandH[i] = bandH[i - 1];
        bandL[i] = bandL[i - 1];
        bandC[i] = bandC[i - 1];
        bandM[i] = bandM[i - 1];
        up[i] = up[i - 1];
      }
    }
    for (let i = 0; i < len; i++) {
      if (!isNaN(bandO[i]) && !isNaN(bandC[i])) {
        bandH[i] = Math.max(bandO[i], bandC[i]);
        bandL[i] = Math.min(bandO[i], bandC[i]);
      }
    }
  }

  return { o: bandO, h: bandH, l: bandL, c: bandC, m: bandM, up };
}

export const calculateStTrendBands: IndicatorCalculator = (bars, params) => {
  if (bars.length < 30) return [];

  const band1 = computeBand(bars, 5, 5, 1);               // CTF fast
  const band2 = computeBand(bars, 10, 10, 1);             // CTF slow
  const band3 = computeBand(bars, 5, 5, HTF_MULTIPLIER);  // HTF fast
  const band4 = computeBand(bars, 10, 10, HTF_MULTIPLIER); // HTF slow

  // Return band high/low for rendering as filled ranges
  // y = band1 high, y2 = band1 low, bandHigh/bandLow used for additional bands
  // up = band1 direction (for coloring)
  return bars.map((b, i) => ({
    x: b.x,
    y: band1.m[i],
    y2: band3.m[i],
    bandHigh: band1.h[i],
    bandLow: band1.l[i],
    up: band1.up[i],
  })).filter(p => !isNaN(p.y));
};

/**
 * Exported for direct use by the flex-chart component to render all 4 bands.
 * Returns 4 arrays of band candle data ready for Syncfusion Candle series.
 */
export function computeAllBands(bars: PriceBar[]): BandSeriesData[] {
  if (bars.length < 30) return [];

  const band1 = computeBand(bars, 5, 5, 1);
  const band2 = computeBand(bars, 10, 10, 1);
  const band3 = computeBand(bars, 5, 5, HTF_MULTIPLIER);
  const band4 = computeBand(bars, 10, 10, HTF_MULTIPLIER);

  const bands = [band1, band2, band3, band4];
  const colors: [string, string][] = [
    ['#ffeb3b', '#2196f3'],  // band 1: yellow up, blue down
    ['#ffeb3b', '#2196f3'],  // band 2: yellow up, blue down
    ['#ff9800', '#1565c0'],  // band 3: orange up, dark blue down
    ['#ff9800', '#1565c0'],  // band 4: orange up, dark blue down
  ];

  return bands.map((band, bandIdx) => ({
    bandIndex: bandIdx + 1,
    bullColor: colors[bandIdx][0],
    bearColor: colors[bandIdx][1],
    data: bars.map((b, i) => ({
      index: i,
      open: band.o[i],
      high: band.h[i],
      low: band.l[i],
      close: band.c[i],
    })).filter(p => !isNaN(p.open)),
  }));
}

export interface BandSeriesData {
  bandIndex: number;
  bullColor: string;
  bearColor: string;
  data: { index: number; open: number; high: number; low: number; close: number }[];
}

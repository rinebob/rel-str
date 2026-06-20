/**
 * ST-Zone — Savant Trader Zone Classification
 *
 * THEORY
 * ------
 * Flattens the relationship between price and trend bands into a simple
 * discrete zone value (-3 to +3). This makes it easy to read at a glance
 * whether price is positioned bullishly or bearishly relative to the bands.
 *
 * Zone is derived by comparing bar midpoint ((H+L)/2) against the midpoints
 * of bands 1, 2, and 3 from ST-Trend-Bands.
 *
 * CALCULATION
 * ----------
 * 1. Compute bar midpoint: barMid = (high + low) / 2
 * 2. Get band midpoints: b1m, b2m, b3m from ST-Trend-Bands output
 * 3. Compare barMid against each band midpoint:
 *    - zonePlusThree:  barMid > b1m AND barMid > b2m AND barMid > b3m (strongest bull)
 *    - zonePlusTwo:    barMid > b1m AND barMid > b2m (moderate bull)
 *    - zonePlusOne:    barMid > b1m (weak bull)
 *    - zoneMinusOne:   barMid < b1m (weak bear)
 *    - zoneMinusTwo:   barMid < b1m AND barMid < b2m (moderate bear)
 *    - zoneMinusThree: barMid < b1m AND barMid < b2m AND barMid < b3m (strongest bear)
 *
 * PARAMETERS
 * ----------
 * - Inherits band parameters from ST-Trend-Bands (or receives pre-computed band data)
 *
 * USAGE NOTES
 * -----------
 * - Zone +3 = price is above all bands (strong uptrend)
 * - Zone -3 = price is below all bands (strong downtrend)
 * - Zone transitions are key signals (e.g., -2 → -1 = weakening bearish pressure)
 * - Works best in conjunction with ST-Trend-Strength for confirmation
 *
 * CHART RENDERING
 * ---------------
 * - Pane: lower (separate from price)
 * - Axis: fixed -3 to +3
 * - Series: stepped histogram or colored bar, one value per bar
 * - Colors: gradient from red (-3) through neutral (0) to green (+3)
 */

import type { IndicatorOption, IndicatorCalculator, PriceBar } from '../flex-chart.types';

// =============================================================================
// 1. CHART CONFIGURATION
// =============================================================================

export const ST_ZONE_INDICATOR: IndicatorOption = {
  id: 'st-zone',
  label: 'ST Zone',
  type: 'st-zone',
  defaultPane: 'lower-1',
  axisScale: 'fixed',
  params: [
    { key: 'ctfFastLength', label: 'CTF Fast Length', default: 5, min: 2, max: 50 },
    { key: 'ctfSlowLength', label: 'CTF Slow Length', default: 10, min: 2, max: 100 },
  ],
  defaultOptions: {
    referenceLines: [
      { value: 0, color: '#9e9e9e', dashArray: '4,3', label: 'Neutral' },
    ],
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

function computeBandMid(bars: PriceBar[], smoothLen: number, mult: number): { m: number[]; up: boolean[] } {
  const len = bars.length;
  const beforeLength = smoothLen * mult;
  const afterLength = smoothLen * mult;
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

  for (let i = 0; i < len; i++) {
    if (isNaN(sO[i]) || isNaN(sH[i]) || isNaN(sL[i]) || isNaN(sC[i])) continue;
    haClose[i] = (sO[i] + sH[i] + sL[i] + sC[i]) / 4;
    if (i < lookback || isNaN(haOpen[i - lookback])) {
      haOpen[i] = (sO[i] + sC[i]) / 2;
    } else {
      haOpen[i] = (haOpen[i - lookback] + haClose[i - lookback]) / 2;
    }
  }

  const postO = emaSeries(haOpen, afterLength);
  const postC = emaSeries(haClose, afterLength);

  const m = new Array<number>(len).fill(NaN);
  const up = new Array<boolean>(len).fill(false);

  for (let i = 0; i < len; i++) {
    if (isNaN(postO[i]) || isNaN(postC[i])) continue;
    const h = Math.max(postO[i], postC[i]);
    const l = Math.min(postO[i], postC[i]);
    m[i] = l + Math.abs(h - l) / 2;
    up[i] = postC[i] > postO[i];
  }

  // Jagged stepping for HTF
  if (mult > 1) {
    for (let i = 0; i < len; i++) {
      if ((i % mult) !== (mult - 1) && i > 0) {
        m[i] = m[i - 1];
        up[i] = up[i - 1];
      }
    }
  }

  return { m, up };
}

export const calculateStZone: IndicatorCalculator = (bars, params) => {
  if (bars.length < 30) return [];

  const b1 = computeBandMid(bars, 5, 1);                // CTF fast
  const b2 = computeBandMid(bars, 10, 1);               // CTF slow
  const b3 = computeBandMid(bars, 5, HTF_MULTIPLIER);   // HTF fast

  const result = bars.map((b, i) => {
    const b1m = b1.m[i];
    const b2m = b2.m[i];
    const b3m = b3.m[i];
    if (isNaN(b1m) || isNaN(b2m) || isNaN(b3m)) return null;

    const midpoint = (b.high + b.low) / 2;
    const b1Up = b1.up[i]; const b1Dn = !b1Up;
    const b2Up = b2.up[i]; const b2Dn = !b2Up;
    const b3Up = b3.up[i]; const b3Dn = !b3Up;

    const threeUp = (b1Up && b2Up && b3Up) || (b1Up && b2Dn && b3Up);
    const twoUp = b1Dn && b2Up && b3Up;
    const oneUp = b1Dn && b2Dn && b3Up;
    const oneDown = b1Up && b2Up && b3Dn;
    const twoDown = b1Up && b2Dn && b3Dn;
    const threeDown = (b3Dn && b2Dn && b1Dn) || (b3Dn && b2Up && b1Dn);

    const isUpCat = oneUp || twoUp || threeUp;
    const isDownCat = oneDown || twoDown || threeDown;

    const zonePlusThree = (midpoint > b1m && isUpCat) || (midpoint > b3m && isDownCat);
    const zoneMinusThree = (midpoint < b1m && isDownCat) || (midpoint < b3m && isUpCat);
    const zonePlusTwo = (midpoint > b2m && midpoint <= b1m) && (twoUp || threeUp);
    const zoneMinusTwo = (midpoint < b2m && midpoint >= b1m) && (twoDown || threeDown);
    const zonePlusOne = (midpoint > b3m && midpoint <= b2m) && isUpCat;
    const zoneMinusOne = (midpoint < b3m && midpoint >= b2m) && isDownCat;

    let zone = 0;
    if (zonePlusThree) zone = 3;
    else if (zonePlusTwo) zone = 2;
    else if (zonePlusOne) zone = 1;
    else if (zoneMinusOne) zone = -1;
    else if (zoneMinusTwo) zone = -2;
    else if (zoneMinusThree) zone = -3;

    const ZONE_COLORS: Record<number, string> = {
      3: '#2196f3',   // blue
      2: '#4caf50',   // green
      1: '#9e9e9e',   // grey
      0: '#9e9e9e',   // grey
      [-1]: '#f44336', // red
      [-2]: '#e91e63', // magenta
      [-3]: '#ffeb3b', // yellow
    };

    return { x: b.x, y: zone, color: ZONE_COLORS[zone] || '#9e9e9e' };
  }).filter((p): p is { x: Date; y: number; color: string } => p !== null);

  return result;
};

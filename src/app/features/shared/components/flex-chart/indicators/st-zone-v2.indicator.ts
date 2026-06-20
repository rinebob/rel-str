/**
 * ST-Zone V2 — 4-Band Zone Classification
 *
 * THEORY
 * ------
 * Extends V1 by incorporating all 4 trend bands (CTF-1, CTF-2, HTF-1, HTF-2)
 * into zone classification. Produces a discrete zone value from -4 to +4.
 *
 * CALCULATION
 * ----------
 * 1. Compute all 4 bands (same as ST-Trend-Bands):
 *    - B1: CTF fast (smoothLen=5, mult=1)
 *    - B2: CTF slow (smoothLen=10, mult=1)
 *    - B3: HTF fast (smoothLen=5, mult=3)
 *    - B4: HTF slow (smoothLen=10, mult=3)
 *
 * 2. Each band contributes +1 (bullish) or -1 (bearish) based on its `up` state
 *    baseZone = sum of all 4 band states → produces -4, -2, 0, +2, +4
 *
 * 3. Bar midpoint vs band midpoints refines to odd zone values:
 *    - baseZone ±4 → zone ±4 (all bands agree, no refinement needed)
 *    - baseZone ±2 → compare barMid against dissenting band's midpoint
 *      to determine if zone is ±2 or ±3
 *    - baseZone 0 → compare barMid against average of all band midpoints
 *      to determine if zone is +1 or -1
 *
 * ZONE MEANINGS
 * -------------
 * +4: All bands bullish — strongest uptrend
 * +3: 3 bands bullish, price positioned above the bearish band
 * +2: 3 bands bullish, price still below the bearish band
 * +1: Split (2v2), price positioned bullishly
 * -1: Split (2v2), price positioned bearishly
 * -2: 3 bands bearish, price still above the bullish band
 * -3: 3 bands bearish, price positioned below the bullish band
 * -4: All bands bearish — strongest downtrend
 *
 * PARAMETERS
 * ----------
 * Inherits band parameters from ST-Trend-Bands (hardcoded HTF mult=3)
 *
 * CHART RENDERING
 * ---------------
 * - Pane: lower (separate from price)
 * - Axis: fixed -4 to +4
 * - Series: stepped line or colored bar
 * - Colors: gradient from deep red (-4) through neutral (0) to deep blue (+4)
 */

import type { IndicatorOption, IndicatorCalculator, PriceBar } from '../flex-chart.types';

// =============================================================================
// 1. CHART CONFIGURATION
// =============================================================================

export const ST_ZONE_V2_INDICATOR: IndicatorOption = {
  id: 'st-zone-v2',
  label: 'ST Zone V2',
  type: 'st-zone-v2',
  defaultPane: 'lower-1',
  axisScale: 'fixed',
  params: [
    { key: 'ctfFastLength', label: 'CTF Fast Length', default: 5, min: 2, max: 50 },
    { key: 'ctfSlowLength', label: 'CTF Slow Length', default: 10, min: 2, max: 100 },
  ],
  defaultOptions: {
    axisMin: -7,
    axisMax: 7,
    referenceLines: [
      { value: 0, color: '#9e9e9e', dashArray: '4,3', label: 'Neutral' },
    ],
  },
};

// =============================================================================
// 2. CALCULATION
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

interface BandResult {
  m: number[];   // midpoints
  up: boolean[]; // bullish state per bar
}

function computeBandMid(bars: PriceBar[], smoothLen: number, mult: number): BandResult {
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

// =============================================================================
// 3. ZONE CLASSIFICATION
// =============================================================================

/**
 * Classify zone value for a single bar given 4 band states and midpoints.
 *
 * Logic:
 * - baseZone = sum of (+1/-1) per band → -4, -2, 0, +2, +4
 * - Refine with bar midpoint comparison to get odd values
 */
function classifyZone(
  barMid: number,
  bands: { m: number; up: boolean }[]
): number {
  // Sum band states: +1 for bullish, -1 for bearish
  const baseZone = bands.reduce((sum, b) => sum + (b.up ? 1 : -1), 0);

  switch (baseZone) {
    case 4:  return 4;   // All bullish
    case -4: return -4;  // All bearish

    case 2: {
      // 3 bullish, 1 bearish — find the bearish band's midpoint
      const bearishBands = bands.filter(b => !b.up);
      const bearishMid = bearishBands[0]?.m ?? 0;
      // If price is above the one bearish band → strong (+3), else moderate (+2)
      return barMid > bearishMid ? 3 : 2;
    }

    case -2: {
      // 3 bearish, 1 bullish — find the bullish band's midpoint
      const bullishBands = bands.filter(b => b.up);
      const bullishMid = bullishBands[0]?.m ?? 0;
      // If price is below the one bullish band → strong (-3), else moderate (-2)
      return barMid < bullishMid ? -3 : -2;
    }

    case 0: {
      // 2 bullish, 2 bearish — use average of all midpoints as reference
      const avgMid = bands.reduce((sum, b) => sum + b.m, 0) / bands.length;
      return barMid > avgMid ? 1 : -1;
    }

    default: return 0;
  }
}

// =============================================================================
// 4. MAIN CALCULATOR
// =============================================================================

export const calculateStZoneV2: IndicatorCalculator = (bars, params) => {
  if (bars.length < 30) return [];

  // Compute all 4 bands
  const b1 = computeBandMid(bars, 5, 1);                // CTF fast
  const b2 = computeBandMid(bars, 10, 1);               // CTF slow
  const b3 = computeBandMid(bars, 5, HTF_MULTIPLIER);   // HTF fast
  const b4 = computeBandMid(bars, 10, HTF_MULTIPLIER);  // HTF slow (NEW in V2)

  const ZONE_COLORS: Record<number, string> = {
    4:  '#0d47a1',  // deep blue — strongest bull
    3:  '#2196f3',  // blue
    2:  '#4caf50',  // green
    1:  '#81c784',  // light green
    0:  '#9e9e9e',  // grey (shouldn't normally appear)
    [-1]: '#e57373', // light red
    [-2]: '#f44336', // red
    [-3]: '#e91e63', // magenta
    [-4]: '#b71c1c', // deep red — strongest bear
  };

  const result = bars.map((bar, i) => {
    const b1m = b1.m[i];
    const b2m = b2.m[i];
    const b3m = b3.m[i];
    const b4m = b4.m[i];

    // All 4 bands must be valid
    if (isNaN(b1m) || isNaN(b2m) || isNaN(b3m) || isNaN(b4m)) return null;

    const barMid = (bar.high + bar.low) / 2;

    const zone = classifyZone(barMid, [
      { m: b1m, up: b1.up[i] },
      { m: b2m, up: b2.up[i] },
      { m: b3m, up: b3.up[i] },
      { m: b4m, up: b4.up[i] },
    ]);

    return { x: bar.x, y: zone, color: ZONE_COLORS[zone] || '#9e9e9e' };
  }).filter((p): p is { x: Date; y: number; color: string } => p !== null);

  return result;
};

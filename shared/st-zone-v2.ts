/**
 * ST-Zone V2 — 4-Band Zone Classification (Backend)
 *
 * Extends V1 by incorporating all 4 trend bands (CTF-1, CTF-2, HTF-1, HTF-2)
 * into zone classification. Produces a discrete zone value from -4 to +4.
 *
 * Ported from frontend st-zone-v2.indicator.ts.
 *
 * Depends on ST-Trend-Bands output.
 */

import { computeStTrendBands, type OHLCV, type TrendBandsResult } from './st-trend-bands';

// =============================================================================
// INTERFACES
// =============================================================================

export interface ZoneV2Result {
  zone: number[];  // -4 to +4 per bar
}

// =============================================================================
// ZONE CLASSIFICATION
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
  const baseZone = bands.reduce((sum, b) => sum + (b.up ? 1 : -1), 0);

  switch (baseZone) {
    case 4:  return 4;
    case -4: return -4;

    case 2: {
      // 3 bullish, 1 bearish — find the bearish band's midpoint
      const bearishBand = bands.find(b => !b.up);
      const bearishMid = bearishBand?.m ?? 0;
      return barMid > bearishMid ? 3 : 2;
    }

    case -2: {
      // 3 bearish, 1 bullish — find the bullish band's midpoint
      const bullishBand = bands.find(b => b.up);
      const bullishMid = bullishBand?.m ?? 0;
      return barMid < bullishMid ? -3 : -2;
    }

    case 0: {
      // 2 bullish, 2 bearish — use average of all midpoints
      const avgMid = bands.reduce((sum, b) => sum + b.m, 0) / bands.length;
      return barMid > avgMid ? 1 : -1;
    }

    default: return 0;
  }
}

// =============================================================================
// MAIN COMPUTATION
// =============================================================================

/**
 * Compute zone V2 classification from bars and pre-computed band results.
 *
 * @param bars - OHLCV input bars
 * @param bands - Pre-computed TrendBandsResult (or will be computed if not provided)
 * @returns ZoneV2Result with zone values per bar
 */
export function computeStZoneV2(bars: OHLCV[], bands?: TrendBandsResult): ZoneV2Result {
  const b = bands ?? computeStTrendBands(bars);
  const len = bars.length;

  const zone = new Array<number>(len).fill(0);

  for (let i = 0; i < len; i++) {
    const b1m = b.band1.m[i];
    const b2m = b.band2.m[i];
    const b3m = b.band3.m[i];
    const b4m = b.band4.m[i];

    // All 4 bands must be valid
    if (isNaN(b1m) || isNaN(b2m) || isNaN(b3m) || isNaN(b4m)) continue;

    const barMid = (bars[i].high + bars[i].low) / 2;

    zone[i] = classifyZone(barMid, [
      { m: b1m, up: b.band1.up[i] },
      { m: b2m, up: b.band2.up[i] },
      { m: b3m, up: b.band3.up[i] },
      { m: b4m, up: b.band4.up[i] },
    ]);
  }

  return { zone };
}

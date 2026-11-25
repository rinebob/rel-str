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
import { StIndicator } from '../flex-chart.types';
import { computeStTrendBands, type OHLCV } from '@st/trend-bands';
import { computeStZoneV2 } from '@st/zone-v2';
import {
  ST_ZONE_COLORS,
  ST_ZONE_FALLBACK_COLOR,
  ST_ZONE_V2_AXIS_MIN,
  ST_ZONE_V2_AXIS_MAX,
  ST_ZONE_NEUTRAL_REFLINE,
} from '@flex-chart/indicator-visuals';

// =============================================================================
// 1. CHART CONFIGURATION
// =============================================================================

export const ST_ZONE_V2_INDICATOR: IndicatorOption = {
  id: 'st-zone-v2',
  label: 'ST Zone V2',
  type: StIndicator.ZONE_V2,
  defaultPane: 'lower-3',
  axisScale: 'fixed',
  params: [
    { key: 'ctfFastLength', label: 'CTF Fast Length', default: 5, min: 2, max: 50 },
    { key: 'ctfSlowLength', label: 'CTF Slow Length', default: 10, min: 2, max: 100 },
  ],
  defaultOptions: {
    axisMin: ST_ZONE_V2_AXIS_MIN,
    axisMax: ST_ZONE_V2_AXIS_MAX,
    referenceLines: [
      { ...ST_ZONE_NEUTRAL_REFLINE, label: 'Neutral' },
    ],
  },
};

// =============================================================================
// 2. CALCULATION — delegates to the shared engine (#1727)
// =============================================================================

/**
 * One body of zone math (shared/st-zone-v2.ts — the same engine the BE
 * computes on; it was originally ported FROM this file's logic, so the
 * algorithm is unchanged): this calculator adapts PriceBar → OHLCV and
 * maps the shared zone + band flags to chart points. Bars whose bands
 * haven't computed yet (warmup) emit no point — preserving the legacy
 * series shape.
 */
export const calculateStZoneV2: IndicatorCalculator = (bars, params) => {
  if (bars.length < 30) return [];

  const ohlcv: OHLCV[] = bars.map((b) => ({
    open: b.open, high: b.high, low: b.low, close: b.close,
  }));
  const bands = computeStTrendBands(ohlcv);
  const zone = computeStZoneV2(ohlcv, bands).zone;

  return bars.map((bar, i) => {
    if (
      isNaN(bands.band1.m[i]) || isNaN(bands.band2.m[i]) ||
      isNaN(bands.band3.m[i]) || isNaN(bands.band4.m[i])
    ) return null;
    const z = zone[i];
    return { x: bar.x, y: z, color: ST_ZONE_COLORS[z] || ST_ZONE_FALLBACK_COLOR };
  }).filter((p): p is { x: Date; y: number; color: string } => p !== null);
};

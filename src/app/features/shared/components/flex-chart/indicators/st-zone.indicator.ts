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

import { ST_ZONE_NEUTRAL_REFLINE, ST_ZONE_FALLBACK_COLOR } from '@flex-chart/indicator-visuals';
import type { IndicatorOption, IndicatorCalculator, PriceBar } from '../flex-chart.types';
import { StIndicator } from '../flex-chart.types';
import { computeStTrendBands, type OHLCV } from '@st/trend-bands';
import { computeStZone } from '@st/zone';

// =============================================================================
// 1. CHART CONFIGURATION
// =============================================================================

export const ST_ZONE_INDICATOR: IndicatorOption = {
  id: 'st-zone',
  label: 'ST Zone',
  type: StIndicator.ZONE,
  defaultPane: 'lower-2',
  axisScale: 'fixed',
  params: [
    { key: 'ctfFastLength', label: 'CTF Fast Length', default: 5, min: 2, max: 50 },
    { key: 'ctfSlowLength', label: 'CTF Slow Length', default: 10, min: 2, max: 100 },
  ],
  defaultOptions: {
    referenceLines: [
      { ...ST_ZONE_NEUTRAL_REFLINE, label: 'Neutral' },
    ],
  },
};

// =============================================================================
// 2. CALCULATION — delegates to the shared engine (#1727)
// =============================================================================

// literal-sweep exception #1216: categorical zone-identity ramp —
// per-zone hues consumed by the chart lib as literals.
const ZONE_COLORS: Record<number, string> = {
  3: '#2196f3',   // blue
  2: '#4caf50',   // green
  1: '#9e9e9e',   // grey
  0: '#9e9e9e',   // grey
  [-1]: '#f44336', // red
  [-2]: '#e91e63', // magenta
  [-3]: '#ffeb3b', // yellow
};

/**
 * One body of zone math (shared/st-zone.ts — the same engine the BE
 * computes on): this calculator adapts PriceBar → OHLCV and maps the
 * shared zone + band flags to chart points. Bars whose bands haven't
 * computed yet (warmup) emit no point — the legacy inline impl dropped
 * them, so the series preserves that shape.
 */
export const calculateStZone: IndicatorCalculator = (bars, params) => {
  if (bars.length < 30) return [];

  const ohlcv: OHLCV[] = bars.map((b) => ({
    open: b.open, high: b.high, low: b.low, close: b.close,
  }));
  const bands = computeStTrendBands(ohlcv);
  const zone = computeStZone(ohlcv, bands).zone;

  return bars.map((b, i) => {
    if (isNaN(bands.band1.m[i]) || isNaN(bands.band2.m[i]) || isNaN(bands.band3.m[i])) return null;
    const z = zone[i];
    return { x: b.x, y: z, color: ZONE_COLORS[z] || ST_ZONE_FALLBACK_COLOR };
  }).filter((p): p is { x: Date; y: number; color: string } => p !== null);
};

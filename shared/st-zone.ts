/**
 * ST-Zone — Savant Trader Zone Classification
 *
 * Combines composite trend categories with price-vs-band midpoint comparison
 * to produce a simple zone integer (-3 to +3) per bar.
 *
 * Ported from rb-smha-four-band-plot.pine (zones section).
 *
 * Depends on ST-Trend-Bands output.
 */

import { computeStTrendBands, type OHLCV, type TrendBandsResult } from './st-trend-bands';

// =============================================================================
// INTERFACES
// =============================================================================

export interface ZoneResult {
  zone: number[];           // -3 to +3 per bar
  category: TrendCategory[];  // composite category per bar
}

export type TrendCategory = 'threeUp' | 'twoUp' | 'oneUp' | 'oneDown' | 'twoDown' | 'threeDown' | 'neutral';

// =============================================================================
// COMPOSITE TREND CATEGORIES
// =============================================================================

/**
 * Compute composite trend category from band 1/2/3 up/dn flags.
 * Direct port from rb-smha-four-band-plot.pine.
 */
function computeCategories(
  b1Up: boolean[], b1Dn: boolean[],
  b2Up: boolean[], b2Dn: boolean[],
  b3Up: boolean[], b3Dn: boolean[],
): TrendCategory[] {
  const len = b1Up.length;
  const result: TrendCategory[] = new Array(len).fill('neutral');

  for (let i = 0; i < len; i++) {
    const threeUp = (b1Up[i] && b2Up[i] && b3Up[i]) || (b1Up[i] && b2Dn[i] && b3Up[i]);
    const twoUp = b1Dn[i] && b2Up[i] && b3Up[i];
    const oneUp = b1Dn[i] && b2Dn[i] && b3Up[i];
    const oneDown = b1Up[i] && b2Up[i] && b3Dn[i];
    const twoDown = b1Up[i] && b2Dn[i] && b3Dn[i];
    const threeDown = (b3Dn[i] && b2Dn[i] && b1Dn[i]) || (b3Dn[i] && b2Up[i] && b1Dn[i]);

    if (threeUp) result[i] = 'threeUp';
    else if (twoUp) result[i] = 'twoUp';
    else if (oneUp) result[i] = 'oneUp';
    else if (oneDown) result[i] = 'oneDown';
    else if (twoDown) result[i] = 'twoDown';
    else if (threeDown) result[i] = 'threeDown';
  }

  return result;
}

// =============================================================================
// ZONE CLASSIFICATION
// =============================================================================

/**
 * Compute zone classification from bars and pre-computed band results.
 * Direct port of zone logic from rb-smha-four-band-plot.pine.
 *
 * @param bars - OHLCV input bars
 * @param bands - Pre-computed TrendBandsResult (or will be computed if not provided)
 * @returns ZoneResult with zone values and categories per bar
 */
export function computeStZone(bars: OHLCV[], bands?: TrendBandsResult): ZoneResult {
  const b = bands ?? computeStTrendBands(bars);
  const len = bars.length;

  // Compute categories from band 1 (CTF fast), band 2 (CTF slow), band 3 (HTF fast)
  const category = computeCategories(
    b.band1.up, b.band1.dn,
    b.band2.up, b.band2.dn,
    b.band3.up, b.band3.dn,
  );

  const zone = new Array<number>(len).fill(0);

  for (let i = 0; i < len; i++) {
    const midpoint = (bars[i].high + bars[i].low) / 2;
    const b1m = b.band1.m[i];
    const b2m = b.band2.m[i];
    const b3m = b.band3.m[i];

    // Skip if bands not yet computed
    if (isNaN(b1m) || isNaN(b2m) || isNaN(b3m)) continue;

    const cat = category[i];
    const isUpCategory = cat === 'oneUp' || cat === 'twoUp' || cat === 'threeUp';
    const isDownCategory = cat === 'oneDown' || cat === 'twoDown' || cat === 'threeDown';

    // zonePlusThree
    const zonePlusThree = (midpoint > b1m && isUpCategory) ||
                          (midpoint > b3m && isDownCategory);
    // zoneMinusThree
    const zoneMinusThree = (midpoint < b1m && isDownCategory) ||
                           (midpoint < b3m && isUpCategory);
    // zonePlusTwo
    const zonePlusTwo = (midpoint > b2m && midpoint <= b1m) &&
                        (cat === 'twoUp' || cat === 'threeUp');
    // zoneMinusTwo
    const zoneMinusTwo = (midpoint < b2m && midpoint >= b1m) &&
                         (cat === 'twoDown' || cat === 'threeDown');
    // zonePlusOne
    const zonePlusOne = (midpoint > b3m && midpoint <= b2m) && isUpCategory;
    // zoneMinusOne
    const zoneMinusOne = (midpoint < b3m && midpoint >= b2m) && isDownCategory;

    if (zonePlusThree) zone[i] = 3;
    else if (zonePlusTwo) zone[i] = 2;
    else if (zonePlusOne) zone[i] = 1;
    else if (zoneMinusOne) zone[i] = -1;
    else if (zoneMinusTwo) zone[i] = -2;
    else if (zoneMinusThree) zone[i] = -3;
  }

  return { zone, category };
}

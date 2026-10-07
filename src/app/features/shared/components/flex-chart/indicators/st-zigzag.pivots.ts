/**
 * ST ZigZag Engine — pivot detection.
 *
 * Computes confirmed pivots and optional projected (unconfirmed) pivots
 * from OHLCV bars using a two-gate model: depth confirmation + deviation
 * threshold.
 *
 * Ported from the TradingView official ZigZag library v9 (MPL 2.0),
 * adapted from Pine's per-bar `update()` model to a batch computation.
 * The single `depth` parameter is split into `leftDepth` and `rightDepth`
 * for asymmetric pivot confirmation.
 *
 * DIVERGENCE FROM PINE: Pine's streaming `update()` can remove the last
 * confirmed pivot on the final bar if a same-direction extreme exceeds it,
 * then re-project from the previous pivot and conditionally restore the
 * removed pivot (repainting behavior). This batch engine does NOT replicate
 * that — confirmed pivots are stable once depth-confirmed. The projection
 * pivot handles the "developing swing" use case without repainting. This is
 * an intentional design choice for historical analysis where stable pivots
 * are preferred over streaming repaints.
 *
 * Pure functions — no Angular dependencies, no side effects.
 */

import type { PriceBar } from '../flex-chart.types';
import type { AnchorEvent, ZigZagConfig, Pivot, ZigZagResult } from './st-zigzag.types';
import { DEFAULT_CONFIG } from './st-zigzag.types';
import { isFiniteNum, calcDev } from './st-zigzag.utils';

// =============================================================================
// PIVOT DETECTION HELPERS
// =============================================================================

/**
 * Check if a bar at `candidateIndex` is a local extreme (pivot point).
 *
 * For a high pivot: the candidate's high must be strictly above all bars
 * 1 to `leftDepth` bars before it (left side), and above or equal to all
 * bars 1 to `rightDepth` bars after it (right side). Mirror for low pivot.
 *
 * Batch adaptation of Pine's `findPivotPoint`.
 */
function isPivotPoint(
  bars: PriceBar[],
  candidateIndex: number,
  leftDepth: number,
  rightDepth: number,
  isHigh: boolean,
): boolean {
  const candidatePrice = isHigh ? bars[candidateIndex].high : bars[candidateIndex].low;
  if (!isFiniteNum(candidatePrice)) return false;

  // Right side: bars 1 to rightDepth after the candidate must not exceed it
  for (let i = 1; i <= rightDepth; i++) {
    const idx = candidateIndex + i;
    if (idx >= bars.length) return false;
    const cmpPrice = isHigh ? bars[idx].high : bars[idx].low;
    if (!isFiniteNum(cmpPrice)) return false;
    if (isHigh && cmpPrice > candidatePrice) return false;
    if (!isHigh && cmpPrice < candidatePrice) return false;
  }

  // Left side: bars 1 to leftDepth before the candidate must be strictly below (high) or above (low)
  for (let i = 1; i <= leftDepth; i++) {
    const idx = candidateIndex - i;
    if (idx < 0) return false;
    const cmpPrice = isHigh ? bars[idx].high : bars[idx].low;
    if (!isFiniteNum(cmpPrice)) return false;
    if (isHigh && cmpPrice >= candidatePrice) return false;
    if (!isHigh && cmpPrice <= candidatePrice) return false;
  }

  return true;
}

/**
 * Process a candidate pivot: either create a new pivot (reversal) or
 * extend the last pivot (same direction, more extreme).
 *
 * @returns `'added'` for a new pivot, `'replaced'` when the last pivot was
 *          overwritten by a more extreme same-direction one, `null` when
 *          the candidate was rejected
 */
function processPivot(
  candidate: Pivot,
  pivots: Pivot[],
  lastPivot: Pivot | null,
  devThreshold: number,
): 'added' | 'replaced' | null {
  if (!lastPivot) {
    pivots.push(candidate);
    return 'added';
  }

  if (lastPivot.isHigh === candidate.isHigh) {
    // Same direction — check if candidate is more extreme
    if (candidate.isHigh && candidate.price > lastPivot.price) {
      pivots[pivots.length - 1] = candidate;
      return 'replaced';
    }
    if (!candidate.isHigh && candidate.price < lastPivot.price) {
      pivots[pivots.length - 1] = candidate;
      return 'replaced';
    }
    return null;
  }

  // Opposite direction — check deviation threshold
  const dev = calcDev(lastPivot.price, candidate.price);
  if (Number.isNaN(dev)) return null;
  if (
    (!lastPivot.isHigh && dev >= devThreshold) ||
    (lastPivot.isHigh && dev <= -devThreshold)
  ) {
    pivots.push(candidate);
    return 'added';
  }

  return null;
}

// =============================================================================
// PROJECTION PIVOT
// =============================================================================

/**
 * Find a projected (unconfirmed) pivot after the last confirmed pivot.
 *
 * Searches bars after the last pivot for a local extreme that meets the
 * deviation threshold. Implements Pine's fallback search: if the simple
 * extreme fails left-side confirmation, scan every bar back to the last
 * pivot for a valid candidate.
 *
 * Pine parity:
 * - The simple-extreme pass keeps the NEWEST equal extreme (matching Pine's
 *   reversed-array + indexOf behavior).
 * - Left-side confirmation checks the full `leftDepth` bars before the
 *   candidate (not truncated at the last pivot).
 * - Right-side check: no newer bar within `rightDepth` may exceed the
 *   candidate (matching Pine's `ind + depth < n` requirement).
 *
 * @param bars - Full bar array
 * @param lastPivot - The last confirmed pivot
 * @param leftDepth - Left depth for confirmation
 * @param rightDepth - Right depth for confirmation
 * @param devThreshold - Deviation threshold
 * @returns Projected pivot or undefined
 */
function findProjectionPivot(
  bars: PriceBar[],
  lastPivot: Pivot,
  leftDepth: number,
  rightDepth: number,
  devThreshold: number,
): Pivot | undefined {
  const nextIsHigh = !lastPivot.isHigh;
  const startIndex = lastPivot.barIndex + 1;

  if (startIndex >= bars.length) return undefined;

  // Find the most extreme price after the last pivot.
  // Use >= / <= so the NEWEST equal extreme wins (Pine parity).
  let extremeIndex = -1;
  let extremePrice = nextIsHigh ? -Infinity : Infinity;

  for (let i = startIndex; i < bars.length; i++) {
    const price = nextIsHigh ? bars[i].high : bars[i].low;
    if (!isFiniteNum(price)) continue;
    if (nextIsHigh && price >= extremePrice) {
      extremePrice = price;
      extremeIndex = i;
    }
    if (!nextIsHigh && price <= extremePrice) {
      extremePrice = price;
      extremeIndex = i;
    }
  }

  if (extremeIndex === -1) return undefined;

  // Check if the extreme meets the deviation threshold
  const dev = calcDev(lastPivot.price, extremePrice);
  if (Number.isNaN(dev)) return undefined;
  const dir = nextIsHigh ? 1 : -1;
  if (dir * dev < devThreshold) return undefined;

  // Try the simple extreme first, then fall back to scanning all bars
  if (isValidProjection(bars, extremeIndex, leftDepth, rightDepth, nextIsHigh, extremePrice)) {
    return makeProjectionPivot(bars, extremeIndex, extremePrice, nextIsHigh);
  }

  // Fallback: scan every bar from the last bar back to the last pivot
  // looking for the most extreme valid candidate (Pine's fallback search).
  // The fallback picks the newest valid candidate at the most extreme price.
  let bestCandidate: Pivot | undefined;
  for (let i = bars.length - 1; i >= startIndex; i--) {
    if (i === extremeIndex) continue;
    const price = nextIsHigh ? bars[i].high : bars[i].low;
    if (!isFiniteNum(price)) continue;
    const candidateDev = calcDev(lastPivot.price, price);
    if (Number.isNaN(candidateDev)) continue;
    if (dir * candidateDev < devThreshold) continue;

    if (isValidProjection(bars, i, leftDepth, rightDepth, nextIsHigh, price)) {
      if (!bestCandidate ||
          (nextIsHigh && price > bestCandidate.price) ||
          (!nextIsHigh && price < bestCandidate.price)) {
        bestCandidate = makeProjectionPivot(bars, i, price, nextIsHigh);
      }
    }
  }

  return bestCandidate;
}

/**
 * Check left-side and right-side confirmation for a projection candidate.
 *
 * Left side: the full `leftDepth` bars before the candidate must not
 * exceed it (strict for high: >=, strict for low: <=).
 *
 * Right side: no bar within `rightDepth` bars AFTER the candidate may
 * exceed it. If there aren't enough bars after the candidate for a full
 * right-side check, the candidate is still valid (it's a projection —
 * the right side hasn't fully formed yet).
 */
function isValidProjection(
  bars: PriceBar[],
  candidateIndex: number,
  leftDepth: number,
  rightDepth: number,
  isHigh: boolean,
  candidatePrice: number,
): boolean {
  // Require full leftDepth bars before the candidate
  if (candidateIndex < leftDepth) return false;

  for (let i = 1; i <= leftDepth; i++) {
    const idx = candidateIndex - i;
    if (idx < 0) return false;
    const cmpPrice = isHigh ? bars[idx].high : bars[idx].low;
    if (!isFiniteNum(cmpPrice)) return false;
    if (isHigh && cmpPrice >= candidatePrice) return false;
    if (!isHigh && cmpPrice <= candidatePrice) return false;
  }

  // Right side: no newer bar within rightDepth may exceed the candidate.
  // If fewer than rightDepth bars remain, accept (projection is developing).
  const rightLimit = Math.min(rightDepth, bars.length - 1 - candidateIndex);
  for (let i = 1; i <= rightLimit; i++) {
    const idx = candidateIndex + i;
    if (idx >= bars.length) break;
    const cmpPrice = isHigh ? bars[idx].high : bars[idx].low;
    if (!isFiniteNum(cmpPrice)) continue;
    if (isHigh && cmpPrice > candidatePrice) return false;
    if (!isHigh && cmpPrice < candidatePrice) return false;
  }

  return true;
}

/** Create a projection Pivot from a bar index. */
function makeProjectionPivot(
  bars: PriceBar[],
  index: number,
  price: number,
  isHigh: boolean,
): Pivot {
  return {
    barIndex: index,
    time: bars[index].x.getTime(),
    price,
    isHigh,
    confirmed: false,
  };
}

// =============================================================================
// MAIN COMPUTATION
// =============================================================================

/**
 * Compute ZigZag pivots from a bar array.
 *
 * Walks bars sequentially, detecting confirmed pivots using the two-gate
 * model (depth confirmation + deviation threshold). Optionally computes
 * a projected (unconfirmed) pivot for the developing swing.
 *
 * NaN/invalid prices are filtered — bars with non-finite highs or lows
 * cannot be pivots and are skipped.
 *
 * @param bars - OHLCV bars
 * @param config - ZigZag configuration
 * @returns Confirmed pivots and optional projected pivot
 */
export function computeZigZagPivots(
  bars: PriceBar[],
  config: ZigZagConfig = DEFAULT_CONFIG,
): ZigZagResult {
  const leftDepth = Math.max(2, config.leftDepth);
  const rightDepth = Math.max(2, config.rightDepth);

  if (bars.length === 0) {
    return { pivots: [] };
  }

  const { pivots, lastPivot } = walkPivots(bars, config);

  // Projection: find the developing pivot after the last confirmed pivot
  let projection: Pivot | undefined;
  if (config.projectionPivots && lastPivot) {
    projection = findProjectionPivot(bars, lastPivot, leftDepth, rightDepth, config.devThreshold);
  }

  return { pivots, projection };
}

/**
 * Compute every anchor the ZigZag walk produces, in walk order — new pivots
 * and same-side replacements alike — each with the bar on which it became
 * knowable (`confirmBar = pivotBar + rightDepth`).
 *
 * Runs the same walk as `computeZigZagPivots`, so the two can never disagree.
 * The surviving pivots are what is left after each `replaced` event removes
 * its predecessor. Projected pivots never produce events.
 *
 * @param bars - OHLCV bars
 * @param config - ZigZag configuration
 * @returns Anchor events in walk order (non-decreasing `confirmBar`)
 */
export function computeZigZagAnchorEvents(
  bars: PriceBar[],
  config: ZigZagConfig = DEFAULT_CONFIG,
): AnchorEvent[] {
  const events: AnchorEvent[] = [];
  walkPivots(bars, config, (event) => events.push(event));
  return events;
}

// =============================================================================
// SHARED WALK
// =============================================================================

/**
 * The single pivot walk behind both public computations. Walks bars
 * sequentially; a pivot at bar `i` can only be confirmed once `rightDepth`
 * bars have passed (`i + rightDepth`). `onAnchor` is called for every
 * candidate that registers — a new pivot or a same-side replacement.
 */
function walkPivots(
  bars: PriceBar[],
  config: ZigZagConfig,
  onAnchor?: (event: AnchorEvent) => void,
): { pivots: Pivot[]; lastPivot: Pivot | null } {
  const leftDepth = Math.max(2, config.leftDepth);
  const rightDepth = Math.max(2, config.rightDepth);

  const pivots: Pivot[] = [];
  let lastPivot: Pivot | null = null;

  const register = (candidate: Pivot): boolean => {
    const outcome = processPivot(candidate, pivots, lastPivot, config.devThreshold);
    if (!outcome) return false;
    lastPivot = pivots[pivots.length - 1];
    onAnchor?.({
      confirmBar: candidate.barIndex + rightDepth,
      pivotBar: candidate.barIndex,
      time: candidate.time,
      price: candidate.price,
      isHigh: candidate.isHigh,
      replaced: outcome === 'replaced',
    });
    return true;
  };

  for (let i = 0; i < bars.length; i++) {
    if (i + rightDepth >= bars.length) break;

    let foundHighOnThisBar = false;

    // Try high pivot
    if (isPivotPoint(bars, i, leftDepth, rightDepth, true)) {
      foundHighOnThisBar = register({
        barIndex: i, time: bars[i].x.getTime(), price: bars[i].high, isHigh: true, confirmed: true,
      });
    }

    // Try low pivot
    if (config.allowZigZagOnOneBar || !foundHighOnThisBar) {
      if (isPivotPoint(bars, i, leftDepth, rightDepth, false)) {
        register({
          barIndex: i, time: bars[i].x.getTime(), price: bars[i].low, isHigh: false, confirmed: true,
        });
      }
    }
  }

  return { pivots, lastPivot };
}

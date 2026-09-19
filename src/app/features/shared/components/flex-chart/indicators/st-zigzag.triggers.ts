/**
 * ST ZigZag Engine — reversal trigger points.
 *
 * For each confirmed pivot, finds the first subsequent bar whose price
 * crossed the deviation threshold — the bar where the reversal "flipped
 * the switch" and the new swing started forming.
 *
 * For a HIGH pivot at price P the reversal triggers when a later bar's
 * low reaches P × (1 - devThreshold/100). Mirror for a LOW pivot:
 * a later bar's high reaching P × (1 + devThreshold/100).
 *
 * The marker y-value is the exact threshold level, which by construction
 * lies inside the trigger bar's high-low range — so the dot renders on
 * the price bar that caused the reversal, not on the ZigZag line.
 *
 * Pure functions — no Angular dependencies, no side effects.
 */

import type { PriceBar } from '../flex-chart.types';
import type { Pivot } from './st-zigzag.types';
import { isFiniteNum } from './st-zigzag.utils';

/** A bar where the deviation threshold was crossed after a pivot. */
export interface TriggerPoint {
  /** Index in the bar array. */
  barIndex: number;
  /** Timestamp in milliseconds. */
  time: number;
  /** The threshold price level that was crossed. */
  price: number;
  /** True = source pivot was a high (down-reversal trigger). */
  isHigh: boolean;
}

/**
 * Compute reversal trigger points for a set of confirmed pivots.
 *
 * For each pivot i the scan runs from the pivot's own bar (a one-bar
 * reversal can trigger on the same bar) through the next pivot's bar —
 * the crossing is guaranteed to occur at or before the next pivot since
 * that pivot deviates at least devThreshold percent from pivot i. For
 * the last pivot the scan runs to the final bar; when no crossing exists
 * the reversal hasn't triggered and no point is emitted.
 *
 * @param bars - OHLCV bars
 * @param pivots - Confirmed pivots in chronological order
 * @param devThreshold - Deviation threshold percent
 * @returns Trigger points, one per pivot whose reversal triggered
 */
export function computeTriggerPoints(
  bars: PriceBar[],
  pivots: Pivot[],
  devThreshold: number,
): TriggerPoint[] {
  const triggers: TriggerPoint[] = [];

  for (let i = 0; i < pivots.length; i++) {
    const pivot = pivots[i];
    const bound = i + 1 < pivots.length ? pivots[i + 1].barIndex : bars.length - 1;
    const level = pivot.isHigh
      ? pivot.price * (1 - devThreshold / 100)
      : pivot.price * (1 + devThreshold / 100);

    for (let j = pivot.barIndex; j <= bound && j < bars.length; j++) {
      const bar = bars[j];
      const extreme = pivot.isHigh ? bar.low : bar.high;
      if (!isFiniteNum(extreme)) continue;

      const crossed = pivot.isHigh ? extreme <= level : extreme >= level;
      if (crossed) {
        triggers.push({
          barIndex: j,
          time: bar.x.getTime(),
          price: level,
          isHigh: pivot.isHigh,
        });
        break; // first crossing wins
      }
    }
  }

  return triggers;
}

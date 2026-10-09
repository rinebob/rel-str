/**
 * ST Anchored VWAP — pure computation.
 *
 * Turns two scales of ZigZag anchor events into Anchored VWAP line segments.
 * Each line is drawn from its anchor's confirmation bar (the bar on which the
 * pivot became knowable) and never back to the pivot bar, so the output at
 * bar `t` depends only on bars `0..t`. The VWAP itself accumulates from the
 * pivot bar: `Σ(typical × volume) / Σ(volume)` over `[pivotBar, bar]`, where
 * `typical = (high + low + close) / 3`.
 *
 * A line ends on the next same-side anchor's confirmation bar, where that
 * anchor's line begins. A same-side pivot that replaces the current anchor is
 * itself an anchor — the replaced one was the live line until then.
 *
 * The History Window is a pure filter over which terminated segments draw: a
 * segment's content never depends on the window, but which history segments
 * are shown legitimately depends on how much history exists.
 *
 * Pure functions — no Angular dependencies, no side effects.
 */

import type { PriceBar } from '../flex-chart.types';
import { parseIsoDateLocal } from '../../../utils/date.util';
import { computeZigZagAnchorEvents, DEFAULT_CONFIG, type AnchorEvent } from './st-zigzag.engine';
import type {
  AnchoredVwapConfig,
  AnchoredVwapPoint,
  AnchoredVwapScale,
  AnchoredVwapSegment,
  AnchoredVwapSide,
} from './st-anchored-vwap.types';

// =============================================================================
// CUMULATIVE SUMS
// =============================================================================

interface CumulativeSums {
  /** `cumPV[i]` = Σ typical × volume over bars `0..i`. */
  cumPV: number[];
  /** `cumV[i]` = Σ volume over bars `0..i`. */
  cumV: number[];
  /** Per-bar typical price (may be NaN for bars with non-finite OHLC). */
  typical: number[];
}

/**
 * Prefix sums so any anchored VWAP over `[a, j]` is
 * `(cumPV[j] - cumPV[a-1]) / (cumV[j] - cumV[a-1])`.
 * Missing, zero, negative or non-finite volume — and bars with a non-finite
 * typical price — contribute nothing.
 */
function cumulativeSums(bars: PriceBar[]): CumulativeSums {
  const cumPV: number[] = [];
  const cumV: number[] = [];
  const typical: number[] = [];
  let pv = 0;
  let v = 0;
  for (const bar of bars) {
    const tp = (bar.high + bar.low + bar.close) / 3;
    const volume = bar.volume;
    const vol = volume !== undefined && Number.isFinite(volume) && volume > 0 ? volume : 0;
    if (Number.isFinite(tp) && vol > 0) {
      pv += tp * vol;
      v += vol;
    }
    typical.push(tp);
    cumPV.push(pv);
    cumV.push(v);
  }
  return { cumPV, cumV, typical };
}

// =============================================================================
// SEGMENTS
// =============================================================================

/**
 * Points of one segment: the anchored VWAP at each bar of `[startBar, endBar]`.
 * Where no volume has accumulated since the pivot, the line holds its last
 * value — seeded with the pivot bar's typical price (or the pivot price when
 * that bar's typical price is not finite).
 */
function segmentPoints(
  sums: CumulativeSums,
  anchor: AnchorEvent,
  startBar: number,
  endBar: number,
): AnchoredVwapPoint[] {
  const { cumPV, cumV, typical } = sums;
  const basePV = anchor.pivotBar > 0 ? cumPV[anchor.pivotBar - 1] : 0;
  const baseV = anchor.pivotBar > 0 ? cumV[anchor.pivotBar - 1] : 0;
  let y = Number.isFinite(typical[anchor.pivotBar]) ? typical[anchor.pivotBar] : anchor.price;
  const points: AnchoredVwapPoint[] = [];
  for (let index = startBar; index <= endBar; index++) {
    const volume = cumV[index] - baseV;
    if (volume > 0) y = (cumPV[index] - basePV) / volume;
    points.push({ index, y });
  }
  return points;
}

/** The segments of one side of one scale: one per anchor, in confirmation order. */
function sideSegments(
  sums: CumulativeSums,
  anchors: AnchorEvent[],
  scale: AnchoredVwapScale,
  side: AnchoredVwapSide,
  lastBar: number,
): AnchoredVwapSegment[] {
  return anchors.map((anchor, k) => {
    const next = anchors[k + 1];
    const startBar = anchor.confirmBar;
    const endBar = next ? next.confirmBar : lastBar;
    return {
      key: `${scale}-${side}-${anchor.pivotBar}-${startBar}`,
      scale,
      side,
      pivotBar: anchor.pivotBar,
      startBar,
      endBar,
      active: !next,
      points: segmentPoints(sums, anchor, startBar, endBar),
    };
  });
}

// =============================================================================
// HISTORY WINDOW
// =============================================================================

/**
 * Select what to draw for one scale: every active line, plus a window of the
 * terminated segments (both sides combined, ordered by start bar).
 *
 * - `historyStart` set (ISO 'YYYY-MM-DD'): terminated segments whose pivot's
 *   session `date` is on or after it, chronologically forward, the first
 *   `maxHistory` kept — the cap eats the recent end. Calendar strings are
 *   compared, not epochs: a pivot's `x` is a PT-midnight instant for real
 *   bars and browser-local midnight for synthetic ones, so an epoch
 *   threshold would shift the boundary for users outside PT.
 * - unset (or not an ISO date): the most recent `maxHistory` kept, oldest
 *   pruned.
 *
 * Active lines are never windowed.
 */
function applyHistoryWindow(
  bars: PriceBar[],
  segments: AnchoredVwapSegment[],
  historyStart: string | undefined,
  maxHistory: number,
): AnchoredVwapSegment[] {
  const cap = Math.max(0, Math.floor(maxHistory)) || 0;
  const terminated = segments
    .filter((s) => !s.active)
    .sort((a, b) => a.startBar - b.startBar || (a.side < b.side ? -1 : 1));

  const trimmed = historyStart?.trim();
  const era = trimmed && parseIsoDateLocal(trimmed) !== null ? trimmed : undefined;
  const kept = era !== undefined
    ? terminated.filter((s) => bars[s.pivotBar].date >= era).slice(0, cap)
    : terminated.slice(Math.max(0, terminated.length - cap));

  return [...kept, ...segments.filter((s) => s.active)]
    .sort((a, b) => (a.side === b.side ? a.startBar - b.startBar : a.side < b.side ? -1 : 1));
}

// =============================================================================
// MAIN COMPUTATION
// =============================================================================

/**
 * Compute the Anchored VWAP segments for both retracement scales.
 *
 * @param bars - OHLCV bars
 * @param config - retracement scales, pivot depths and history window
 * @returns Segments ordered by scale, then side (high first), then start bar
 */
export function computeAnchoredVwap(bars: PriceBar[], config: AnchoredVwapConfig): AnchoredVwapSegment[] {
  if (bars.length === 0) return [];

  const sums = cumulativeSums(bars);
  const scales: [AnchoredVwapScale, number][] = [
    ['small', config.smallRetracementPct],
    ['large', config.largeRetracementPct],
  ];
  const segments: AnchoredVwapSegment[] = [];

  for (const [scale, devThreshold] of scales) {
    const events = computeZigZagAnchorEvents(bars, {
      ...DEFAULT_CONFIG,
      devThreshold,
      leftDepth: config.leftDepth,
      rightDepth: config.rightDepth,
      allowZigZagOnOneBar: true,
      projectionPivots: false,
    });
    const sideSegs = (['high', 'low'] as const).flatMap((side) =>
      sideSegments(sums, events.filter((e) => e.isHigh === (side === 'high')), scale, side, bars.length - 1),
    );
    segments.push(...applyHistoryWindow(bars, sideSegs, config.historyStart, config.maxHistory));
  }

  return segments;
}

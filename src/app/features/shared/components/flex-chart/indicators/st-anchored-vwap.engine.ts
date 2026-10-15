/**
 * ST Anchored VWAP — pure computation.
 *
 * Turns two sets of ZigZag anchor events into Anchored VWAP line segments.
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
 * `computeAnchoredVwapResult` additionally returns each set's ZigZag legs —
 * a vertex per surviving anchor plus a render-only developing leg — so the
 * chart can mark the pivots the live lines came from.
 *
 * The History Window is a pure filter over which terminated segments draw: a
 * segment's content never depends on the window, but which history segments
 * are shown legitimately depends on how much history exists.
 *
 * Pure functions — no Angular dependencies, no side effects.
 */

import type { PriceBar } from '../flex-chart.types';
import { parseIsoDateLocal } from '../../../utils/date.util';
import {
  computeZigZagAnchorResult,
  DEFAULT_CONFIG,
  type AnchorEvent,
  type Pivot,
  type ZigZagConfig,
} from './st-zigzag.engine';
import type {
  AnchoredVwapConfig,
  AnchoredVwapLeg,
  AnchoredVwapLegSet,
  AnchoredVwapPoint,
  AnchoredVwapResult,
  AnchoredVwapSegment,
  AnchoredVwapSet,
  AnchoredVwapSide,
  AnchoredVwapVertex,
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

/** The segments of one side of one set: one per anchor, in confirmation order. */
function sideSegments(
  sums: CumulativeSums,
  anchors: AnchorEvent[],
  set: AnchoredVwapSet,
  side: AnchoredVwapSide,
  lastBar: number,
): AnchoredVwapSegment[] {
  return anchors.map((anchor, k) => {
    const next = anchors[k + 1];
    const startBar = anchor.confirmBar;
    const endBar = next ? next.confirmBar : lastBar;
    return {
      key: `${set}-${side}-${anchor.pivotBar}-${startBar}`,
      set,
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
 * Select what to draw for one set: every active line, plus a window of the
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
// ZIGZAG LEGS
// =============================================================================

/**
 * The set's legs from one walk: `vertices` is every *surviving* anchor —
 * an event immediately followed by a `replaced` event was superseded by it
 * and drops out, so legs alternate sides like the standalone ST ZigZag
 * (a superseded anchor still anchored its now-terminated VWAP segment; only
 * the mark is dropped. Unlike the segments, the chain is retroactive here:
 * a drawn vertex can vanish once its replacer registers). Same-bar high+low
 * pairs still collapse to the later event — a line series can't draw two
 * vertices at one index. Legs join consecutive vertices; `developing` runs
 * from the last vertex to the walk's projection pivot. Render-only; it never
 * anchors a VWAP line.
 */
function legsForSet(events: AnchorEvent[], projection: Pivot | undefined, set: AnchoredVwapSet): AnchoredVwapLegSet {
  const vertices: AnchoredVwapVertex[] = [];
  for (let i = 0; i < events.length; i++) {
    const e = events[i];
    if (events[i + 1]?.replaced) continue;
    // `allowZigZagOnOneBar` can register a high and a low on the same bar —
    // two vertices at one index can't both draw, so collapse them to the
    // later event (its side colors the outgoing leg).
    const vertex: AnchoredVwapVertex = { index: e.pivotBar, y: e.price, isHigh: e.isHigh };
    if (vertices.length && vertices[vertices.length - 1].index === vertex.index) {
      vertices[vertices.length - 1] = vertex;
    } else {
      vertices.push(vertex);
    }
  }

  const confirmed: AnchoredVwapLeg[] = [];
  for (let i = 0; i < vertices.length - 1; i++) {
    confirmed.push({ from: vertices[i], to: vertices[i + 1], isHigh: vertices[i + 1].isHigh });
  }

  const last = vertices[vertices.length - 1];
  const developing: AnchoredVwapLeg | null = last && projection
    ? {
        from: last,
        to: { index: projection.barIndex, y: projection.price, isHigh: projection.isHigh },
        isHigh: projection.isHigh,
      }
    : null;

  return { set, vertices, confirmed, developing };
}

// =============================================================================
// MAIN COMPUTATION
// =============================================================================

/**
 * Compute the Anchored VWAP segments and the ZigZag legs for both
 * retracement sets.
 *
 * @param bars - OHLCV bars
 * @param config - retracement sets, pivot depths and history window
 * @returns Segments ordered by set, then side (high first), then start bar;
 *          legs ordered by set
 */
export function computeAnchoredVwapResult(bars: PriceBar[], config: AnchoredVwapConfig): AnchoredVwapResult {
  const empty: AnchoredVwapResult = { segments: [], legs: [] };
  if (bars.length === 0) return empty;

  const sums = cumulativeSums(bars);
  const sets: [AnchoredVwapSet, number, number, number][] = [
    ['line1', config.line1RetracementPct, config.line1LeftDepth, config.line1RightDepth],
    ['line2', config.line2RetracementPct, config.line2LeftDepth, config.line2RightDepth],
  ];
  const segments: AnchoredVwapSegment[] = [];
  const legs: AnchoredVwapLegSet[] = [];

  for (const [set, devThreshold, leftDepth, rightDepth] of sets) {
    const zigzagConfig: ZigZagConfig = {
      ...DEFAULT_CONFIG,
      devThreshold,
      leftDepth,
      rightDepth,
      allowZigZagOnOneBar: true,
      projectionPivots: true,
    };
    // One walk per set: events drive both the VWAP anchors and the leg
    // chain; the same pass also yields the developing-leg projection.
    const { events, projection } = computeZigZagAnchorResult(bars, zigzagConfig);
    const sideSegs = (['high', 'low'] as const).flatMap((side) =>
      sideSegments(sums, events.filter((e) => e.isHigh === (side === 'high')), set, side, bars.length - 1),
    );
    segments.push(...applyHistoryWindow(bars, sideSegs, config.historyStart, config.maxHistory));
    legs.push(legsForSet(events, projection, set));
  }

  return { segments, legs };
}

/**
 * Compute the Anchored VWAP segments for both retracement sets.
 *
 * @param bars - OHLCV bars
 * @param config - retracement sets, pivot depths and history window
 * @returns Segments ordered by set, then side (high first), then start bar
 */
export function computeAnchoredVwap(bars: PriceBar[], config: AnchoredVwapConfig): AnchoredVwapSegment[] {
  return computeAnchoredVwapResult(bars, config).segments;
}

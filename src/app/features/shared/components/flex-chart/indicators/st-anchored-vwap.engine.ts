/**
 * ST Anchored VWAP — pure computation.
 *
 * Turns two sets of ZigZag pivots into Anchored VWAP line segments.
 * The VWAP accumulates from the pivot bar: `Σ(typical × volume) / Σ(volume)`
 * over `[pivotBar, bar]`, where `typical = (high + low + close) / 3`.
 *
 * One line per ZigZag leg, anchored at the leg's start vertex. A line
 * begins on the vertex's trigger bar — the first bar that crossed the
 * deviation threshold, the same bar the standalone ZigZag marks with a
 * trigger dot — and ends on the next vertex's trigger bar, where the next
 * leg's line begins: exactly one live line per set, alternating sides. A
 * vertex whose reversal hasn't triggered yet anchors no line; the previous
 * leg's line stays live until it does.
 *
 * Causality is not strict: a vertex only exists once depth-confirmed, so
 * its trigger (which can fire *before* confirmation on a violent reversal)
 * is attributed retroactively — a truncated run at bar `t` may omit a line
 * the full run back-fills, and a drawn segment vanishes when its vertex is
 * superseded by a later extreme. Lines never draw before the trigger bar,
 * though — no hindsight attachment to the pivot bar itself.
 *
 * Persist mode (`lineNPersist`) drops the termination: every triggered
 * vertex's line runs to the last bar — a fan of anchored VWAPs. The newest
 * is still the set's `active` line; the rest count as history, so
 * `maxHistory` bounds how far back the fan reaches.
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
  computeTriggerPoints,
  computeZigZagPivots,
  DEFAULT_CONFIG,
  type Pivot,
  type TriggerPoint,
  type ZigZagConfig,
} from './st-zigzag.engine';
import type {
  AnchoredVwapConfig,
  AnchoredVwapConfirmation,
  AnchoredVwapLeg,
  AnchoredVwapLegSet,
  AnchoredVwapPoint,
  AnchoredVwapResult,
  AnchoredVwapSegment,
  AnchoredVwapSet,
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
  anchor: { pivotBar: number; price: number },
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

/** The set's segments: one per triggered vertex — every surviving vertex
 *  anchors a line at its own pivot, drawn from its own trigger bar (the bar
 *  that first crossed the deviation threshold — the same trigger points the
 *  standalone ZigZag dots) and ended by the next vertex's trigger. A vertex
 *  with no trigger yet — only possible for the last, whose reversal hasn't
 *  fired — anchors no line, so exactly one line per set is ever live. In
 *  `persist` mode the termination is dropped — every line runs to `lastBar`
 *  and `active` marks only the newest; the rest are windowed by maxHistory
 *  like any other history. */
function setSegments(
  sums: CumulativeSums,
  vertices: AnchoredVwapVertex[],
  triggers: TriggerPoint[],
  set: AnchoredVwapSet,
  lastBar: number,
  persist: boolean,
): AnchoredVwapSegment[] {
  // Pair each vertex to the trigger computed from its own pivot — by pivot
  // bar, not list position: a vertex whose reversal hasn't fired has no
  // trigger, and side-matched scanning would silently steal the next
  // same-side vertex's.
  const byPivot = new Map(triggers.map((t) => [`${t.isHigh}:${t.pivotIndex}`, t]));
  const triggered = vertices
    .map((vertex) => ({ vertex, trigger: byPivot.get(`${vertex.isHigh}:${vertex.index}`) }))
    .filter((p): p is { vertex: AnchoredVwapVertex; trigger: TriggerPoint } => p.trigger !== undefined);
  return triggered.map(({ vertex, trigger }, k) => {
    const next = triggered[k + 1];
    const startBar = trigger.barIndex;
    const endBar = next && !persist ? next.trigger.barIndex : lastBar;
    const anchor = { pivotBar: vertex.index, price: vertex.y };
    return {
      key: `${set}-${vertex.isHigh ? 'high' : 'low'}-${vertex.index}-${startBar}`,
      set,
      side: vertex.isHigh ? 'high' : 'low',
      pivotBar: vertex.index,
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
 * The set's legs from one walk: `vertices` is the surviving-pivot chain —
 * the same `pivots` `computeZigZagPivots` returns, which the walk already
 * maintains by overwriting each superseded anchor in place (a superseded
 * vertex anchors nothing — unlike the segments, the chain is retroactive
 * here: a drawn vertex can vanish once its replacer registers). Same-bar
 * high+low pairs still collapse to the later pivot — a line series can't
 * draw two vertices at one index. `developing` runs from the last vertex to
 * the walk's projection pivot. Render-only; it never anchors a VWAP line.
 */
function legsForSet(
  pivots: Pivot[],
  projection: Pivot | undefined,
  confirmations: AnchoredVwapConfirmation[],
  set: AnchoredVwapSet,
): AnchoredVwapLegSet {
  const vertices: AnchoredVwapVertex[] = [];
  for (const p of pivots) {
    // `allowZigZagOnOneBar` can register a high and a low on the same bar —
    // two vertices at one index can't both draw, so collapse them to the
    // later pivot.
    const vertex: AnchoredVwapVertex = { index: p.barIndex, y: p.price, isHigh: p.isHigh };
    if (vertices.length && vertices[vertices.length - 1].index === vertex.index) {
      vertices[vertices.length - 1] = vertex;
    } else {
      vertices.push(vertex);
    }
  }

  const last = vertices[vertices.length - 1];
  const developing: AnchoredVwapLeg | null = last && projection
    ? {
        from: last,
        to: { index: projection.barIndex, y: projection.price, isHigh: projection.isHigh },
        isHigh: projection.isHigh,
      }
    : null;

  return { set, vertices, developing, confirmations };
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
  const sets: [AnchoredVwapSet, number, number, number, boolean][] = [
    ['line1', config.line1RetracementPct, config.line1LeftDepth, config.line1RightDepth, config.line1Persist ?? false],
    ['line2', config.line2RetracementPct, config.line2LeftDepth, config.line2RightDepth, config.line2Persist ?? false],
  ];
  const segments: AnchoredVwapSegment[] = [];
  const legs: AnchoredVwapLegSet[] = [];

  for (const [set, devThreshold, leftDepth, rightDepth, persist] of sets) {
    const zigzagConfig: ZigZagConfig = {
      ...DEFAULT_CONFIG,
      devThreshold,
      leftDepth,
      rightDepth,
      allowZigZagOnOneBar: true,
      projectionPivots: true,
    };
    // One walk per set — `computeZigZagPivots` yields the surviving-vertex
    // chain and the developing-leg projection. Triggers — the same
    // computeTriggerPoints the standalone ZigZag dots — then drive both
    // the VWAP line starts/ends and the confirmation markers.
    const { pivots, projection } = computeZigZagPivots(bars, zigzagConfig);
    const triggers = computeTriggerPoints(bars, pivots, devThreshold);
    const confirmations: AnchoredVwapConfirmation[] = triggers.map((t) => ({
      index: t.barIndex,
      y: t.price,
      isHigh: t.isHigh,
    }));
    const legSet = legsForSet(pivots, projection, confirmations, set);
    const segs = setSegments(sums, legSet.vertices, triggers, set, bars.length - 1, persist);
    segments.push(...applyHistoryWindow(bars, segs, config.historyStart, config.maxHistory));
    legs.push(legSet);
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

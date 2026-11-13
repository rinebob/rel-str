/**
 * ST Anchored VWAP — shared types.
 *
 * Type definitions for the pure Anchored VWAP computation. No runtime logic —
 * imported by `st-anchored-vwap.engine.ts` and the chart indicator.
 */

/** Which retracement set produced a line (two independent tunings, not an ordered size hierarchy). */
export type AnchoredVwapSet = 'line1' | 'line2';

/** Which side of the swing a line is anchored on. */
export type AnchoredVwapSide = 'high' | 'low';

/** Configuration for the Anchored VWAP computation. */
export interface AnchoredVwapConfig {
  /** ZigZag deviation threshold (%) for the line-1 pivot set. */
  line1RetracementPct: number;
  /** ZigZag deviation threshold (%) for the line-2 pivot set. */
  line2RetracementPct: number;
  /** Line-1 pivot-confirmation depth, bars to the left. */
  line1LeftDepth: number;
  /** Line-1 pivot-confirmation depth, bars to the right — also the confirmation lag. */
  line1RightDepth: number;
  /** Line-2 pivot-confirmation depth, bars to the left. */
  line2LeftDepth: number;
  /** Line-2 pivot-confirmation depth, bars to the right — also the confirmation lag. */
  line2RightDepth: number;
  /**
   * Optional history start as ISO 'YYYY-MM-DD' — compared against the pivot
   * bar's session `date`, so the boundary is a calendar date, not an epoch
   * (pivot `x` is a PT-midnight instant in real mode and local-midnight in
   * synthetic; comparing strings sidesteps all of that). Set: terminated
   * segments whose pivot is on or after it render chronologically up to
   * `maxHistory`. Unset: the most recent `maxHistory` terminated segments.
   */
  historyStart?: string;
  /** Max terminated segments per set, both sides combined. Active lines are never counted. */
  maxHistory: number;
  /**
   * Line-1 persist mode — every triggered vertex keeps its line to the last
   * bar instead of ending at the next vertex's trigger, so the set draws a
   * fan of anchored VWAPs rather than one alternating line. The newest line
   * stays `active`; older ones count toward `maxHistory`, which becomes the
   * fan-size bound. Default off (alternating).
   */
  line1Persist?: boolean;
  /** Line-2 persist mode — see `line1Persist`. */
  line2Persist?: boolean;
}

// =============================================================================
// ZIGZAG LEGS (render-only context)
// =============================================================================

/** A leg vertex: a pivot bar, its price, and its side. */
export interface AnchoredVwapVertex {
  /** Bar index of the pivot. */
  index: number;
  /** Pivot price. */
  y: number;
  /** True = pivot high, false = pivot low. */
  isHigh: boolean;
}

/** One leg between two pivots — legs draw in the set's uniform leg color. */
export interface AnchoredVwapLeg {
  from: AnchoredVwapVertex;
  to: AnchoredVwapVertex;
}

/**
 * The ZigZag legs of one set. `vertices` is the surviving-pivot chain the
 * walk maintains (superseded anchors are overwritten in place, so legs
 * alternate like the standalone ST ZigZag) with same-bar high+low pairs
 * collapsed to the later pivot — one index can carry only one vertex.
 * `developing` runs from the last anchor to the running extreme (the
 * engine's projection pivot); it is render-only, never an anchor, and null
 * when no anchor exists yet or the post-pivot move hasn't met the
 * deviation threshold.
 *
 * A reversal trigger marker — identical to the standalone ST ZigZag's
 * trigger dots: the first bar after a pivot whose price crossed the
 * deviation threshold, drawn at the threshold level so the dot sits inside
 * the trigger bar's range — or at the bar's open when a gap carried price
 * through the level. The anchored line for that vertex begins on this
 * same bar.
 */
export interface AnchoredVwapConfirmation {
  /** The trigger bar's index. */
  index: number;
  /** The deviation-threshold price level — or the trigger bar's open on a
   *  gap-through (the level lies outside the bar's range). */
  y: number;
  /** True = the source pivot was a high (down-reversal trigger). */
  isHigh: boolean;
}

export interface AnchoredVwapLegSet {
  set: AnchoredVwapSet;
  vertices: AnchoredVwapVertex[];
  developing: AnchoredVwapLeg | null;
  /** Every surviving pivot's reversal trigger — debug overlay, not a leg. */
  confirmations: AnchoredVwapConfirmation[];
}

/** Segments plus the legs that produced their anchors. */
export interface AnchoredVwapResult {
  segments: AnchoredVwapSegment[];
  legs: AnchoredVwapLegSet[];
}

/** One drawn point of a segment. */
export interface AnchoredVwapPoint {
  /** Bar index. */
  index: number;
  /** VWAP value at that bar. */
  y: number;
}

/**
 * One anchored VWAP line segment — one per triggered vertex. It is drawn
 * from the vertex's trigger bar (`startBar`: the bar that first crossed the
 * deviation threshold) to the next vertex's trigger bar (`endBar`), or to
 * the last bar while active — or, in persist mode, always to the last bar.
 * The VWAP itself accumulates from `pivotBar`.
 */
export interface AnchoredVwapSegment {
  /** Stable unique key: `${set}-${side}-${pivotBar}` (one segment per vertex). */
  key: string;
  set: AnchoredVwapSet;
  side: AnchoredVwapSide;
  /** Bar index of the pivot the VWAP accumulates from. */
  pivotBar: number;
  /** The anchor vertex's trigger bar — the first drawn bar. */
  startBar: number;
  /** Last drawn bar: the next vertex's trigger bar, or the last bar while active. */
  endBar: number;
  /** True for the set's live line (no later reversal). */
  active: boolean;
  /** Drawn points, one per bar from `startBar` to `endBar` inclusive. */
  points: AnchoredVwapPoint[];
}

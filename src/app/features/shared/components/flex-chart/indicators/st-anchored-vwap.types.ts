/**
 * ST Anchored VWAP — shared types.
 *
 * Type definitions for the pure Anchored VWAP computation. No runtime logic —
 * imported by `st-anchored-vwap.engine.ts` and the chart indicator.
 */

/** Which retracement scale produced a line. */
export type AnchoredVwapScale = 'small' | 'large';

/** Which side of the swing a line is anchored on. */
export type AnchoredVwapSide = 'high' | 'low';

/** Configuration for the Anchored VWAP computation. */
export interface AnchoredVwapConfig {
  /** ZigZag deviation threshold (%) for the small-scale pivot set. */
  smallRetracementPct: number;
  /** ZigZag deviation threshold (%) for the large-scale pivot set. */
  largeRetracementPct: number;
  /** Shared pivot-confirmation depth, bars to the left. */
  leftDepth: number;
  /** Shared pivot-confirmation depth, bars to the right — also the confirmation lag. */
  rightDepth: number;
  /**
   * Optional history start (ms). Set: terminated segments whose pivot is on or
   * after it render chronologically up to `maxHistory`. Unset: the most recent
   * `maxHistory` terminated segments render.
   */
  historyStart?: number;
  /** Max terminated segments per scale, both sides combined. Active lines are never counted. */
  maxHistory: number;
}

/** One drawn point of a segment. */
export interface AnchoredVwapPoint {
  /** Bar index. */
  index: number;
  /** VWAP value at that bar. */
  y: number;
}

/**
 * One anchored VWAP line segment: drawn from its anchor's confirmation bar
 * (`startBar`) to the next same-side anchor's confirmation bar (`endBar`), or
 * to the last bar while active. The VWAP itself accumulates from `pivotBar`.
 */
export interface AnchoredVwapSegment {
  /** Stable unique key: `${scale}-${side}-${pivotBar}-${startBar}`. */
  key: string;
  scale: AnchoredVwapScale;
  side: AnchoredVwapSide;
  /** Bar index of the pivot the VWAP accumulates from. */
  pivotBar: number;
  /** Bar index on which the pivot became knowable — the first drawn bar. */
  startBar: number;
  /** Last drawn bar: the next same-side anchor's confirmation bar, or the last bar while active. */
  endBar: number;
  /** True for the live line of its side (no later same-side anchor). */
  active: boolean;
  /** Drawn points, one per bar from `startBar` to `endBar` inclusive. */
  points: AnchoredVwapPoint[];
}

/**
 * Swing Analysis — shared types.
 *
 * Type definitions for saved swing analyses and the paramsId helper.
 * No runtime logic beyond the paramsId derivation.
 */

import type { ZigZagConfig, Pivot, Swing, SwingStats, PriceBar } from '../../shared/components/flex-chart/indicators/st-zigzag.engine';

/** A persisted swing analysis document in Firestore. */
export interface SwingAnalysisDoc {
  /** Firestore document id (same as paramsId). */
  id: string;
  /** Symbol the analysis was saved for. */
  symbol: string;
  /** Hash of the ZigZagConfig params — used as the Firestore doc id. */
  paramsId: string;
  /** The config used to compute this analysis. */
  config: ZigZagConfig;
  /** Price bars used for the analysis — kept so updateConfig can recompute. */
  bars: PriceBar[];
  /** Confirmed pivots. */
  pivots: Pivot[];
  /** Projected pivot (if any). */
  projection?: Pivot | null;
  /** Derived swings. */
  swings: Swing[];
  /** Computed swing statistics. */
  stats: SwingStats;
  /** ISO timestamp of when the analysis was saved. */
  savedAt: string;
}

/**
 * Derive a stable paramsId from a ZigZagConfig.
 * Used as the Firestore document id under
 * `zig-zags/{symbol}/analyses/{paramsId}`.
 */
export function deriveParamsId(config: ZigZagConfig): string {
  const parts = [
    `dev${config.devThreshold}`,
    `l${config.leftDepth}`,
    `r${config.rightDepth}`,
    `a${config.allowZigZagOnOneBar ? 1 : 0}`,
    `p${config.projectionPivots ? 1 : 0}`,
  ];
  return parts.join('-');
}

/**
 * Swing Analysis — shared types.
 *
 * Type definitions for saved swing analyses and the paramsId helper.
 * No runtime logic beyond the paramsId derivation.
 */

import type { ZigZagConfig, Pivot, Swing, SwingStats, PriceBar } from '../../shared/components/flex-chart/indicators/st-zigzag.engine';

/** Input for saving a swing analysis — built by the store, no auth fields. */
export interface SwingAnalysisInput {
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

/** A persisted swing analysis document in Firestore (read shape). */
export interface SwingAnalysisDoc extends SwingAnalysisInput {
  /** Firestore document id (same as paramsId). Added client-side on read. */
  id: string;
  /** Owner of this analysis — stamped by the service from auth. Required by Firestore security rules. */
  userId: string;
}

/**
 * Derive a stable paramsId from a ZigZagConfig.
 * Used as the Firestore document id under
 * `zig-zags/{symbol}/analyses/{paramsId}`.
 *
 * Format: dev{N}_L{N}_R{N}_1bar{Y|N}_proj{Y|N}
 */
export function deriveParamsId(config: ZigZagConfig): string {
  const parts = [
    `dev${config.devThreshold}`,
    `L${config.leftDepth}`,
    `R${config.rightDepth}`,
    `1bar${config.allowZigZagOnOneBar ? 'Y' : 'N'}`,
    `proj${config.projectionPivots ? 'Y' : 'N'}`,
  ];
  return parts.join('_');
}

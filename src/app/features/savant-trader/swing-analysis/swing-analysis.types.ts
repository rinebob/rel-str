/**
 * Swing Analysis — shared types.
 *
 * Type definitions for saved swing analyses and the paramsId helper.
 * No runtime logic beyond the paramsId derivation.
 */

import type { ZigZagConfig, Pivot, Swing, SwingStats } from '../../shared/components/flex-chart/indicators/st-zigzag.engine';

/** Input for saving a swing analysis — built by the store, no auth fields. */
export interface SwingAnalysisInput {
  /** Symbol the analysis was saved for. */
  symbol: string;
  /** Hash of the ZigZagConfig params — used as the Firestore doc id. */
  paramsId: string;
  /** The config used to compute this analysis. */
  config: ZigZagConfig;
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

/** Input for saving a swing config (or a set of them) to the global library. */
export interface SwingConfigInput {
  /** Optional user-facing name — falls back to a param summary label. */
  name?: string;
  /** The ZigZag config params — present on single-config (preset) docs. */
  config?: ZigZagConfig;
  /** The config list — present on set docs (N configs applied together). */
  configs?: ZigZagConfig[];
  /** ISO timestamp of when the config was saved. */
  savedAt: string;
  /** Explicit doc id override — renames pass the existing paramsId so the
   *  write targets the stored doc instead of re-deriving the key. */
  paramsId?: string;
}

/** A persisted swing config doc in `st-swing-configs/{paramsId}`. */
export interface SwingConfigDoc extends SwingConfigInput {
  /** Firestore document id — same value as paramsId. */
  id: string;
  /** Hash of the config params — the doc id (dedupe key). */
  paramsId: string;
  /** Owner of this config — stamped by the service from auth. */
  userId: string;
}

/** The configs a library doc applies — singles normalize to length-1. */
export function docConfigs(doc: SwingConfigDoc): ZigZagConfig[] {
  if (doc.configs?.length) return doc.configs;
  return doc.config ? [doc.config] : [];
}

/** True for multi-config set docs (written by "Save set"). Empty
 *  `configs: []` does not count — such a doc has nothing to apply. */
export function isConfigSet(doc: SwingConfigDoc): boolean {
  return !!doc.configs?.length;
}

/**
 * Derive a stable paramsId from a ZigZagConfig.
 * Combined with the symbol to form the Firestore document id:
 * `st-swing-sets/{symbol}_{paramsId}`.
 *
 * Hashes every behavior-relevant field. `showTriggerDots` participates
 * (normalized to its default `true` when unset — per ZigZagConfig docs) so
 * configs differing only in that flag don't collide. `lineColor` is
 * visual-only and deliberately excluded — configs differing only in color
 * dedupe to one doc.
 *
 * Format: dev{N}_L{N}_R{N}_1bar{Y|N}_proj{Y|N}_trig{Y|N}
 */
export function deriveParamsId(config: ZigZagConfig): string {
  const parts = [
    `dev${config.devThreshold}`,
    `L${config.leftDepth}`,
    `R${config.rightDepth}`,
    `1bar${config.allowZigZagOnOneBar ? 'Y' : 'N'}`,
    `proj${config.projectionPivots ? 'Y' : 'N'}`,
    `trig${(config.showTriggerDots ?? true) ? 'Y' : 'N'}`,
  ];
  return parts.join('_');
}

/**
 * Derive the doc id for a config SET — `set_` + member paramsIds joined
 * by `+`. Distinct from single ids so a set can't collide with (or
 * overwrite) a single-config doc sharing a member's params.
 */
export function deriveSetParamsId(configs: ZigZagConfig[]): string {
  // Sorted+deduped → {A,B} and {B,A} key the same doc; a set's identity
  // is its members, not their order.
  const ids = [...new Set(configs.map(deriveParamsId))].sort();
  return `set_${ids.join('+')}`;
}

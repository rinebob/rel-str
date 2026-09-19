/**
 * ST ZigZag Engine — public API facade.
 *
 * Re-exports the pure ZigZag computation functions and types from their
 * focused modules:
 * - `st-zigzag.types.ts` — shared types and defaults
 * - `st-zigzag.pivots.ts` — pivot detection (confirmed + projected)
 * - `st-zigzag.swings.ts` — swing derivation
 * - `st-zigzag.stats.ts` — distribution summaries + histograms
 *
 * Import from this module: `import { computeZigZagPivots } from './st-zigzag.engine'`
 */

export { computeZigZagPivots } from './st-zigzag.pivots';
export { computeTriggerPoints, type TriggerPoint } from './st-zigzag.triggers';
export { calcDev } from './st-zigzag.utils';
export { deriveSwings } from './st-zigzag.swings';
export { computeSwingStats } from './st-zigzag.stats';
export {
  DEFAULT_CONFIG,
  type ZigZagConfig,
  type Pivot,
  type ZigZagResult,
  type Swing,
  type SwingStats,
  type DistributionSummary,
  type Histogram,
  type DirectionStats,
  type PriceBar,
} from './st-zigzag.types';

/**
 * Log-space transform helpers — the single source of the price↔axis-unit
 * mapping for the manual log scale. Pure functions so both the strategy
 * (viewport/pixels/labels) and the data adapter (series dataSources) share
 * one mapping.
 *
 * Canonical source moved to `shared/flex-chart-scale-math.ts` (alias
 * `@flex-chart/scale-math`) so the server-side screenshot renderer
 * (Topic #746) shares the identical mapping. This file re-exports it for
 * backward-compatible relative imports.
 */
export {
  LOG_AXIS_FLOOR,
  fromLogAxis,
  nicePriceStep,
  nicePriceTicks,
  toLogAxis,
} from '@flex-chart/scale-math';

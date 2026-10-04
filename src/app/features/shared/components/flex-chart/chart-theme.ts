/**
 * Chart Theme — flex-chart appearance palettes.
 *
 * Canonical source moved to `shared/flex-chart-theme.ts` (alias
 * `@flex-chart/theme`) so the server-side screenshot renderer (Topic #746)
 * and the FE component share one palette. This file re-exports it for
 * backward-compatible relative imports.
 */
export {
  CHART_PALETTES,
  buildLogTickStripLines,
  resolveChartPalette,
} from '@flex-chart/theme';
export type {
  ChartAppearance,
  ChartPalette,
  LogTickStripLine,
} from '@flex-chart/theme';

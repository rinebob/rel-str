/**
 * Shared price formatting for axis labels, tooltips, and gutter labels.
 *
 * Canonical source moved to `shared/flex-chart-scale-math.ts` (alias
 * `@flex-chart/scale-math`) so the server-side screenshot renderer
 * (Topic #746) uses the same formatter. This file re-exports it for
 * backward-compatible relative imports.
 */
export { formatPrice } from '@flex-chart/scale-math';

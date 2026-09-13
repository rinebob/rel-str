/**
 * Stop Loss Math Utility (shared)
 *
 * Pure functions for computing stop-loss prices and percentages.
 * Extracted from features/savant-trader/utils/position-sizing.util.ts so
 * shared components can use them without depending on a feature module.
 *
 * Refs:
 * - IMPL: 219-279-291-IMPL-portfolio-FE-portfolio-dashboard-order-placement.md Task 1
 */

/**
 * Compute the stop loss price from an entry price and stop percent.
 * stopPrice = entryPrice * (1 - stopPercent / 100)
 */
export function stopPriceFromPercent(
  entryPrice: number,
  stopPercent: number,
): number {
  return Math.round(entryPrice * (1 - stopPercent / 100) * 100) / 100;
}

/**
 * Compute the stop loss percent from an entry price and stop price.
 * stopPercent = ((entryPrice - stopPrice) / entryPrice) * 100
 */
export function stopPercentFromPrice(
  entryPrice: number,
  stopPrice: number,
): number {
  if (entryPrice <= 0) return 0;
  return Math.round(((entryPrice - stopPrice) / entryPrice) * 1000) / 10;
}

/** Default stop loss percent. */
export const DEFAULT_STOP_PERCENT = 8;

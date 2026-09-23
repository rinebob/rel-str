/**
 * Shared price formatting for axis labels, tooltips, and gutter labels.
 */

/** Format a real price for display (e.g. "$1,234"). Sub-dollar prices get
 *  significant decimals — penny/sub-penny ticks would otherwise all render
 *  "$0". */
export function formatPrice(price: number): string {
  if (price >= 1) return `$${Math.round(price).toLocaleString('en-US')}`;
  return `$${parseFloat(price.toPrecision(4)).toLocaleString('en-US')}`;
}

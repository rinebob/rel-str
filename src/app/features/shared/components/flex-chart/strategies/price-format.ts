/**
 * Shared price formatting for axis labels, tooltips, and gutter labels.
 */

/** Format a real price for display (e.g. "$1,234"). */
export function formatPrice(price: number): string {
  return `$${Math.round(price).toLocaleString('en-US')}`;
}

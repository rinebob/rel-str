/**
 * Formatting helpers shared by the option-grid components (chain grid,
 * pct-change grid).
 */

/** "±N (±X%)" distance of a strike from the ATM strike — the sub-label
 *  under each strike row header. Null when there is no ATM anchor. */
export function formatAtmDiff(strike: number, atm: number | null): string | null {
  if (atm == null) return null;
  const diff = strike - atm;
  const sign = diff > 0 ? '+' : '';
  const pctStr = atm !== 0 ? ` (${sign}${((diff / atm) * 100).toFixed(1)}%)` : '';
  return `${sign}${diff.toFixed(0)}${pctStr}`;
}

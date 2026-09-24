/**
 * Formatting helpers shared by the option-grid components (chain grid,
 * pct-change grid).
 */
import { DAYS, daysBetween } from '../../shared/utils/date.util';

/** Minimum contract price for a cell to count toward a color scale or
 *  top-gainer highlight — penny-priced contracts produce meaningless pct
 *  changes that wreck both. */
export const MIN_CELL_PRICE = 0.02;

/** Percentile of a sorted numeric array (linear interpolation). */
export function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  if (sorted.length === 1) return sorted[0];
  const idx = (p / 100) * (sorted.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

/** "±N (±X%)" distance of a strike from the ATM strike — the sub-label
 *  under each strike row header. Null when there is no ATM anchor. */
export function formatAtmDiff(strike: number, atm: number | null): string | null {
  if (atm == null) return null;
  const diff = strike - atm;
  const sign = diff > 0 ? '+' : '';
  const pctStr = atm !== 0 ? ` (${sign}${((diff / atm) * 100).toFixed(1)}%)` : '';
  return `${sign}${diff.toFixed(0)}${pctStr}`;
}

/** Expiration column-header parts shared by both grids — the 3-letter
 *  day of week plus "Nd" days-to-expiry relative to an anchor date
 *  (session date on the chain page, start date on pct-change). Null
 *  anchor → no DTE label. */
export function expirationMeta(
  date: string,
  anchor: string | null,
): { dowText: string; daysText: string | null } {
  return {
    dowText: DAYS[new Date(date + 'T00:00:00Z').getUTCDay()],
    daysText: anchor ? `${daysBetween(anchor, date)}d` : null,
  };
}

/** "+12.3%" — sign-prefixed percent with a negative-zero guard (values
 *  that round to zero display unsigned). */
export function formatSignedPct(pct: number, decimals = 1): string {
  const v = Math.abs(pct) < 0.5 * 10 ** -decimals ? 0 : pct;
  return `${v > 0 ? '+' : ''}${v.toFixed(decimals)}%`;
}

/** Session-vs-prior percent change for the underlying — 'n/a' when
 *  either close is missing or the prior is zero. */
export function sessionPctChange(
  cur: number | null,
  prev: number | null,
  decimals = 2,
): string {
  if (cur == null || prev == null || prev === 0) return 'n/a';
  return formatSignedPct(((cur - prev) / prev) * 100, decimals);
}

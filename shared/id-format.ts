/**
 *
 * Shared ID-segment formatters — single source of truth for the YYMMDD date,
 * delta, and DTE segments used across instance, position, and paper-trade IDs.
 */

/** YYMMDD from a Date, using UTC so IDs are timezone-stable. */
export function formatYYMMDD(date: Date): string {
  const yy = String(date.getUTCFullYear()).slice(2);
  const mm = String(date.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(date.getUTCDate()).padStart(2, '0');
  return `${yy}${mm}${dd}`;
}

/** Delta formatted as a 3-digit integer of |delta|*100 — 0.20 → '020'. */
export function formatDelta(delta: number): string {
  return String(Math.round(Math.abs(delta) * 100)).padStart(3, '0');
}

/** DTE formatted as a 2-digit integer — 30 → '30', 7 → '07'. */
export function formatDte(dte: number): string {
  return String(dte).padStart(2, '0');
}

/**
 * Shared sort helpers for the dashboard's plain-HTML tables.
 *
 * `compareSortable` orders numbers numerically and everything else via
 * locale-aware string comparison. Nullish values always sort last,
 * regardless of direction — a position missing a quote or entry date
 * shouldn't jump to the top when descending.
 */

export type SortDirection = 'asc' | 'desc';

export function compareSortable(
  a: string | number | null | undefined,
  b: string | number | null | undefined,
  dir: SortDirection,
): number {
  if (a == null && b == null) return 0;
  if (a == null) return 1;
  if (b == null) return -1;

  const cmp =
    typeof a === 'number' && typeof b === 'number'
      ? a - b
      : String(a).localeCompare(String(b));
  return dir === 'asc' ? cmp : -cmp;
}

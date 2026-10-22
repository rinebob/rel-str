/**
 * Multi-level column sort for scanner tables (#1098/#1197) — the
 * option-chart contract-catalog idiom generalized to the scanner's
 * string-typed wire cells. Click-cycle interaction: a clicked column joins
 * the chain ascending, a second click flips it to descending, a third
 * removes it; array order is sort priority (headers show `1↑`, `2↓`…).
 *
 * Comparisons sort RAW cell values (pre-format): numeric-aware via
 * `Number()` after stripping %/$/commas (strict — '1.5x' sinks as
 * unparseable); blank or unparseable cells sink last in BOTH directions;
 * equal levels fall through to the next.
 */
import type { ScanRow } from './scanner-rows.util';

export interface SortLevel {
  /** Column key — a fixed field ('tracked'|'symbol'|'instrument_id'|
   *  'instrument_type') or a column display name. */
  key: string;
  direction: 'asc' | 'desc';
}

/** Click-cycle: absent → asc → desc → removed. */
export function nextSortLevels(
  levels: readonly SortLevel[],
  key: string,
): SortLevel[] {
  const next = [...levels];
  const idx = next.findIndex((l) => l.key === key);
  if (idx === -1) {
    next.push({ key, direction: 'asc' });
  } else if (next[idx].direction === 'asc') {
    next[idx] = { key, direction: 'desc' };
  } else {
    next.splice(idx, 1);
  }
  return next;
}

/** Header badge for a sorted column: {priority, direction} or null. */
export function sortInfo(
  levels: readonly SortLevel[],
  key: string,
): { priority: number; direction: 'asc' | 'desc' } | null {
  const idx = levels.findIndex((l) => l.key === key);
  return idx === -1
    ? null
    : { priority: idx + 1, direction: levels[idx].direction };
}

/** Numeric value of a wire cell — '12.5%', '$1,200' parse; blank and
 *  unparseable cells return null (they sink last regardless of dir). */
export function numericCell(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim().replace(/[%$,]/g, '');
  if (s === '') return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/** Sort rows by the level chain — the chained `compareByField` analog.
 *  `cellFor` resolves a key to the row's raw value (component supplies
 *  it — fixed fields vs column-map cells resolve differently). Returns
 *  a new array; input order is preserved for full ties (stable sort). */
export function sortRows(
  rows: readonly ScanRow[],
  levels: readonly SortLevel[],
  cellFor: (row: ScanRow, key: string) => unknown,
): ScanRow[] {
  if (levels.length === 0) return [...rows];
  return [...rows].sort((a, b) => {
    for (const { key, direction } of levels) {
      const av = cellFor(a, key);
      const bv = cellFor(b, key);
      const an = numericCell(av);
      const bn = numericCell(bv);
      let cmp: number;
      if (an === null && bn === null) {
        // Both unparseable — blank sinks below non-blank text; two texts
        // compare alphabetically (case-insensitive).
        const aBlank = String(av ?? '').trim() === '';
        const bBlank = String(bv ?? '').trim() === '';
        if (aBlank !== bBlank) return aBlank ? 1 : -1;
        cmp = String(av ?? '').localeCompare(String(bv ?? ''), undefined, {
          sensitivity: 'base',
        });
      } else if (an === null) {
        return 1;
      } else if (bn === null) {
        return -1;
      } else {
        cmp = an - bn;
      }
      if (cmp !== 0) return direction === 'asc' ? cmp : -cmp;
    }
    return 0;
  });
}

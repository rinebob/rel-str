/**
 * Analysis row filter + sort helpers (Thread #1059, task #1081) — pure
 * functions over TradeAnalysisRow, shared by the store's filteredRows /
 * sortedRows / filteredCompareRows computeds. Kept out of the store file
 * per the one-responsibility guideline; tested through the store spec.
 */
import type { SliceFilter, TradeAnalysisRow } from '@paper-trading/analysis';

export type AnalysisSortDir = 'asc' | 'desc';
export interface AnalysisSort {
  column: keyof TradeAnalysisRow & string;
  dir: AnalysisSortDir;
}

/** Evaluate one predicate — null row values never match a bounded
 *  filter; a filter with no bounds/empty value list is a no-op. */
export function matchesSliceFilter(row: TradeAnalysisRow, f: SliceFilter): boolean {
  const v = row[f.column];
  switch (f.op) {
    case 'in':
      return f.value.length === 0 || (v !== null && f.value.includes(v));
    case 'range': {
      const { min, max } = f.value;
      if (min === undefined && max === undefined) return true;
      return typeof v === 'number' &&
        (min === undefined || v >= min) &&
        (max === undefined || v <= max);
    }
    case 'dateRange': {
      const { from, to } = f.value;
      if (!from && !to) return true;
      return typeof v === 'string' && (!from || v >= from) && (!to || v <= to);
    }
  }
}

/** AND-composed filter chain — empty chain returns the input set. */
export function applySliceFilters(
  rows: TradeAnalysisRow[],
  filters: readonly SliceFilter[],
): TradeAnalysisRow[] {
  if (filters.length === 0) return rows;
  return rows.filter((r) => filters.every((f) => matchesSliceFilter(r, f)));
}

/** Multi-key sort in chain order — nulls sort last regardless of
 *  direction. Empty chain returns the input set. */
export function sortAnalysisRows(
  rows: TradeAnalysisRow[],
  sorts: readonly AnalysisSort[],
): TradeAnalysisRow[] {
  if (sorts.length === 0) return rows;
  return [...rows].sort((a, b) => {
    for (const s of sorts) {
      const va = a[s.column];
      const vb = b[s.column];
      if (va === null && vb === null) continue;
      if (va === null) return 1;
      if (vb === null) return -1;
      const cmp =
        typeof va === 'number' && typeof vb === 'number'
          ? va - vb
          : String(va).localeCompare(String(vb));
      if (cmp !== 0) return (s.dir === 'asc' ? 1 : -1) * cmp;
    }
    return 0;
  });
}

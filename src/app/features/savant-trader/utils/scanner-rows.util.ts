/**
 * Scan-row model + value coercion — RH Scanner page (#1098/#1136).
 *
 * Pure mapping from the preview_scan wire row (`ScanResultRow` — every
 * column value stringified) into the page's `ScanRow`, plus column-value
 * coercions that go through a per-recipe `columnLookup`: the backend
 * canonicalizes filter-identical expressions to standard column names
 * (observed live: display_name 'ROE' returned as 'Return on equity'), so
 * callers resolve via the lookup rather than raw display names.
 */
import type {
  PreviewScanResult,
  ScanAppliedFilter,
  ScanColumn,
} from '@robinhood-mcp/contracts';

export interface ScanRow {
  symbol: string;
  /** columns['Name'] ?? '' — display label, not the ticker. */
  name: string;
  instrumentType: string;
  /** Raw display-name → stringified value map, untouched. */
  values: Record<string, string>;
  /** Stamped by the compare engine — parse always starts false. */
  tracked: boolean;
}

/** Capture-verified shape — rows missing a ticker are dropped. */
export function parseScanRows(result: PreviewScanResult): ScanRow[] {
  const rows: ScanRow[] = [];
  for (const r of result.results) {
    if (!r || typeof r !== 'object') continue;
    const symbol = typeof r.ticker === 'string' ? r.ticker.trim() : '';
    if (!symbol) continue;
    rows.push({
      symbol,
      name: r.columns?.['Name'] ?? '',
      instrumentType: typeof r.instrument_type === 'string' ? r.instrument_type : '',
      values: r.columns ?? {},
      tracked: false,
    });
  }
  return rows;
}

/**
 * Per-recipe display-name → canonical-column-name map, built from the
 * response's filters_applied echo: an applied filter carrying an
 * `expression` matching a requested expression column binds that column's
 * display_name to the backend's canonical `filter_type` name.
 */
export function buildColumnLookup(
  applied?: ScanAppliedFilter[],
  requested?: readonly ScanColumn[],
): Map<string, string> {
  const lookup = new Map<string, string>();
  // Strip whitespace outside string literals — the backend echoes
  // expressions with its own spacing, but interior whitespace inside a
  // quoted arg is semantically significant.
  const norm = (e: string | undefined) =>
    e?.replace(/\s+(?=(?:[^"]*"[^"]*")*[^"]*$)/g, '');
  for (const col of requested ?? []) {
    if (col.expression === undefined) continue;
    const echo = (applied ?? []).find(
      (a) => !!a && typeof a === 'object' && norm(a.expression) === norm(col.expression),
    );
    // Only remap when the echo points at a DIFFERENT column name. An
    // expression filter carrying a display_title echoes the title in
    // filter_type (dep-prev-scan-04) while the row still keys the column
    // by display_name — the coercers' presence fallback covers that case.
    if (echo && echo.filter_type !== col.display_name) {
      lookup.set(col.display_name, echo.filter_type);
    }
  }
  return lookup;
}

/** Resolve a requested name through the lookup; misses pass through. */
export function canonicalColumnName(
  lookup: ReadonlyMap<string, string>,
  name: string,
): string {
  return lookup.get(name) ?? name;
}

/** Stringified numeric column → number; '' / missing / unparseable → null. */
export function numericColumn(
  row: ScanRow,
  displayName: string,
  lookup?: ReadonlyMap<string, string>,
): number | null {
  const key = lookup ? canonicalColumnName(lookup, displayName) : displayName;
  // A mapped key that isn't an actual column falls back to the raw name —
  // a display_title echo (dep-prev-scan-04) can point the lookup at a
  // key no row carries, and presence wins over a wrong remap.
  const raw = row.values[key] ?? (key !== displayName ? row.values[displayName] : undefined);
  if (typeof raw !== 'string' || raw.trim() === '') return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

/**
 * Fraction-scaled column → percent points (0.149 → 14.9). Percent-valued
 * fields arrive as fractions upstream; the display layer owns the `%`
 * suffix — this only rescales.
 */
export function percentColumn(
  row: ScanRow,
  displayName: string,
  lookup?: ReadonlyMap<string, string>,
): number | null {
  const n = numericColumn(row, displayName, lookup);
  return n === null ? null : n * 100;
}

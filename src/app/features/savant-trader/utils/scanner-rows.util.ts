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
  /** Wire instrument_id — RH's opaque instrument identifier. */
  instrumentId: string;
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
      instrumentId:
        typeof r.instrument_id === 'string' ? r.instrument_id : '',
      instrumentType: typeof r.instrument_type === 'string' ? r.instrument_type : '',
      values: r.columns ?? {},
      tracked: false,
    });
  }
  return rows;
}

/** Canonical scan-symbol key — trim + case-fold. THE shared membership
 *  policy: dedupe, tracked badges, compare buckets, and matchedCount
 *  must all key identically or a case-variant drifts them apart. */
export function normScanSymbol(symbol: string): string {
  return symbol.trim().toUpperCase();
}

/** First-wins dedupe on the normalized ticker — protects
 *  `track row.symbol` against a duplicated wire ticker (NG0955). */
export function dedupeScanRows(rows: readonly ScanRow[]): ScanRow[] {
  const seen = new Set<string>();
  return rows.filter((row) => {
    const key = normScanSymbol(row.symbol);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** Displayed cell text for a display_name — percentColumns rescale to
 *  `N.N%`, blank/missing → '—', drifted non-strings render via String()
 *  rather than crashing the table. */
export function displayCell(
  row: ScanRow,
  displayName: string,
  lookup?: ReadonlyMap<string, string>,
  percentColumns?: readonly string[],
): string {
  if (percentColumns?.includes(displayName)) {
    const p = percentColumn(row, displayName, lookup);
    return p === null ? '—' : `${p.toFixed(1)}%`;
  }
  const resolved = lookup ? canonicalColumnName(lookup, displayName) : displayName;
  const v: unknown = row.values[resolved] ?? row.values[displayName];
  if (v === undefined || v === null) return '—';
  return typeof v !== 'string' ? String(v) : v.trim() === '' ? '—' : v;
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

/**
 * Effective display_name → wire-key map for a run. Candidates are
 * [response echo, static recipe map, raw name] and the FIRST key any
 * returned row actually carries wins — the echo is preferred when it
 * names a real column, but a bad echo (e.g. filter_type = a filter's
 * display_title, which is never a row key) can't clobber the verified
 * static mapping. When no candidate appears in the rows the static
 * map wins over the unverifiable echo. Shared by the store's run paths
 * and the per-recipe table component (#1197).
 */
export function mergeLookup(
  recipe: {
    columns: readonly ScanColumn[];
    columnLookup?: ReadonlyMap<string, string>;
  },
  applied: ScanAppliedFilter[] | undefined,
  rows: readonly ScanRow[],
): Map<string, string> {
  const dynamic = buildColumnLookup(applied, recipe.columns);
  const lookup = new Map<string, string>();
  for (const col of recipe.columns) {
    const name = col.display_name;
    const candidates = [
      dynamic.get(name),
      recipe.columnLookup?.get(name),
      name,
    ].filter((k): k is string => !!k);
    const pick =
      candidates.find((k) => rows.some((r) => Object.hasOwn(r.values, k))) ??
      recipe.columnLookup?.get(name) ??
      name;
    if (pick !== name) lookup.set(name, pick);
  }
  return lookup;
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

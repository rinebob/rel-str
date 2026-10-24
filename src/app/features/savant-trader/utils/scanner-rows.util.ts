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

/** Parse + first-wins-dedupe + lookup-merge for one run — the shared
 *  row-pipeline prefix the recipe table and the page rail both consume,
 *  so the two surfaces can't drift on dedupe or column resolution. */
export function scanRunRows(
  recipe: {
    columns: readonly ScanColumn[];
    columnLookup?: ReadonlyMap<string, string>;
  },
  result: PreviewScanResult | null,
): { rows: ScanRow[]; lookup: ReadonlyMap<string, string> } {
  const rows = result ? dedupeScanRows(parseScanRows(result)) : [];
  return { rows, lookup: mergeLookup(recipe, result?.filters_applied, rows) };
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
 *  rather than crashing the table. Plain-numeric strings get
 *  magnitude-aware formatting (sci-notation and long decimal tails come
 *  through raw otherwise); already-formatted strings ('117.2%', '$1.2B',
 *  'N/A') don't parse and pass through unchanged. */
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
  const s = typeof v === 'string' ? v : String(v);
  if (s.trim() === '') return '—';
  const n = Number(s);
  return Number.isFinite(n) ? formatNumericCell(n) : s;
}

/** Magnitude-aware formatting for a plain-numeric cell value —
 *  scoreboard density, not accounting precision:
 *  |n| ≥ 1e6 → '5.12T'/'80.29M'; ≥1000 → locale separators ('22,970',
 *  '1,274.18'); ≥1 → integers verbatim, else 2 decimals ('35.33',
 *  '-1.15'); <1 → 4 significant digits ('0.3112', '-0.005419'). */
function formatNumericCell(n: number): string {
  const abs = Math.abs(n);
  if (abs >= 1e12) return `${round2(n / 1e12)}T`;
  if (abs >= 1e9) return `${round2(n / 1e9)}B`;
  if (abs >= 1e6) return `${round2(n / 1e6)}M`;
  if (abs >= 1000)
    return n.toLocaleString('en-US', { maximumFractionDigits: 2 });
  if (abs >= 1)
    return Number.isInteger(n) ? String(n) : n.toFixed(2);
  return Number(n.toPrecision(4)).toString();
}

/** toFixed(2) minus trailing zeros — '5.1T'/'5T' not '5.10T'/'5.00T'. */
function round2(n: number): string {
  return n.toFixed(2).replace(/\.?0+$/, '');
}

/** Compact `filters_applied` echo for the table header — the result's
 *  own filter summary. Expression filters show their expression; enum
 *  filters show `name predicate values` with the PREDICATE_ wire prefix
 *  stripped. Wire-drift defensive: a malformed entry renders as nothing
 *  rather than throwing inside a caller's computed. */
export function appliedFilterSummary(
  applied: ScanAppliedFilter[] | undefined,
): string {
  return (applied ?? [])
    .map((f) => {
      if (!f || typeof f !== 'object') return '';
      if (typeof f.expression === 'string' && f.expression)
        return f.expression;
      const name = typeof f.filter_type === 'string' ? f.filter_type : '';
      const pred =
        typeof f.predicate === 'string'
          ? f.predicate.replace(/^PREDICATE_/, '')
          : '';
      const vals = Array.isArray(f.values) ? f.values.join(', ') : '';
      return `${name} ${pred} ${vals}`.trim();
    })
    .filter(Boolean)
    .join(' · ');
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

/** Raw sortable value for a row key — the fixed fields, the tracked
 *  badge (1/0 so asc groups new symbols first), or a column cell resolved
 *  through the lookup. Fixed dispatch is case-insensitive to match the
 *  table's FIXED_KEYS extras suppression — a declared 'Symbol'/'TRACKED'
 *  column sorts the fixed field it collides with, not a shadow wire key.
 *  Shared by the recipe table's sort and the page's rail baseline sort so
 *  both order rows identically. */
export function scanSortCell(
  row: ScanRow,
  key: string,
  lookup: ReadonlyMap<string, string>,
  tracked: boolean,
): unknown {
  switch (key.toLowerCase()) {
    case 'tracked':
      return tracked ? '1' : '0';
    case 'symbol':
      return row.symbol;
    case 'instrument_id':
      return row.instrumentId;
    case 'instrument_type':
      return row.instrumentType;
  }
  const resolved = lookup.get(key) ?? key;
  return row.values[resolved] ?? row.values[key] ?? '';
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

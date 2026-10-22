/**
 * Specs for the scanner recipe catalog (#1098/#1137).
 *
 * Guards the catalog's invariants: every entry is a valid ScanRecipe,
 * percent-scaled fundamentals ride expression filters with fraction
 * thresholds (never enum PERCENTAGE filters — the field guide's verified
 * footgun), and prune-capable recipes declare a noDataPred.
 */
import { isEnumFilter, isExpressionFilter } from '@st/scanner';
import { SCANNER_RECIPES, scannerRecipeById } from './scanner-recipes';

/** Enum filter types that silently fail on fraction-scaled values —
 *  verified live: enum '>=15' passes literal 15 against raw 1.49.
 *  FILTER_TYPE_PERCENT_CHANGE_FROM_CLOSE is deliberately exempt: the
 *  gainers/losers recipes use it at the scale-invariant '0' boundary —
 *  see the pctChangeFilter comment in scanner-recipes.ts. */
const FORBIDDEN_PERCENT_ENUMS = new Set([
  'FILTER_TYPE_RETURN_ON_EQUITY',
  'FILTER_TYPE_NET_PROFIT_MARGIN',
  'FILTER_TYPE_RETURN_ON_ASSETS',
  'FILTER_TYPE_GROSS_MARGIN',
  'FILTER_TYPE_OPERATING_MARGIN',
  'FILTER_TYPE_IMPLIED_VOLATILITY',
  'FILTER_TYPE_HISTORICAL_VOLATILITY',
  'FILTER_TYPE_GAP',
]);

describe('scanner recipe catalog (#1137)', () => {
  it('contains the field-guide recipe set', () => {
    expect(SCANNER_RECIPES.length).toBeGreaterThanOrEqual(10);
    for (const id of [
      'quality-mega',
      'quality-large',
      'quality-mid',
      'high-52w',
      'near-52w-high',
      'low-52w',
      'near-52w-low',
      'ivr-high',
      'ivr-low',
      'vol-spike',
      'gainers',
      'losers',
    ]) {
      expect(scannerRecipeById(id)).toBeDefined();
    }
  });

  it('every id is unique kebab-case', () => {
    const ids = SCANNER_RECIPES.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
  });

  it('every recipe carries title/blurb, non-empty filters, and columns array', () => {
    for (const r of SCANNER_RECIPES) {
      expect(r.title).toBeTruthy();
      expect(r.blurb).toBeTruthy();
      expect(r.filters.length).toBeGreaterThan(0);
      expect(Array.isArray(r.columns)).toBe(true);
    }
  });

  it('every filter is a valid ScanFilter variant', () => {
    for (const r of SCANNER_RECIPES) {
      for (const f of r.filters) {
        const variant = isExpressionFilter(f) || isEnumFilter(f);
        expect(variant).toBe(true);
        expect(typeof f.predicate).toBe('string');
        expect(f.values.every((v) => typeof v === 'string')).toBe(true);
        if (isExpressionFilter(f)) {
          expect(f.expression).toBeTruthy();
        }
      }
    }
  });

  it('no recipe drives a percent-scaled fundamental via enum filter (fraction-threshold guard)', () => {
    for (const r of SCANNER_RECIPES) {
      for (const f of r.filters) {
        if (isEnumFilter(f)) {
          // percent fields must be expression filters with fraction thresholds
          expect(FORBIDDEN_PERCENT_ENUMS.has(f.filter_type)).toBe(false);
        }
      }
    }
  });

  it('fraction thresholds stay on the 0–1 scale — no percent literals like 15 or 80', () => {
    const quality = scannerRecipeById('quality-mega')!;
    const exprs = quality.filters
      .filter(isExpressionFilter)
      .map((f) => f.expression)
      .join(' ');
    expect(exprs).toContain('returnOnEquity >= 0.15');
    expect(exprs).toContain('netProfitMargin >= 0.10');
    const ivr = scannerRecipeById('ivr-high')!;
    expect(
      ivr.filters.some(
        (f) => isExpressionFilter(f) && f.expression.includes('ivRank >= 0.8'),
      ),
    ).toBe(true);
  });

  it('quality recipes carry an mcap bound AND the full fundamental screen', () => {
    for (const id of ['quality-mega', 'quality-large', 'quality-mid']) {
      const r = scannerRecipeById(id)!;
      const exprs = r.filters
        .filter(isExpressionFilter)
        .map((f) => f.expression);
      expect(exprs.some((e) => e.includes('marketCap'))).toBe(true);
      expect(exprs.some((e) => e.includes('returnOnEquity'))).toBe(true);
      expect(exprs.some((e) => e.includes('netProfitMargin'))).toBe(true);
      expect(exprs.some((e) => e.includes('eps'))).toBe(true);
      expect(exprs.some((e) => e.includes('pegRatio'))).toBe(true);
    }
    const mega = scannerRecipeById('quality-mega')!;
    expect(
      mega.filters.some(
        (f) =>
          isExpressionFilter(f) && f.expression.includes('marketCap >= 200e9'),
      ),
    ).toBe(true);
    // large + mid are bounded on BOTH sides — no overlap drift.
    for (const [id, lo, hi] of [
      ['quality-large', '10e9', '200e9'],
      ['quality-mid', '2e9', '10e9'],
    ] as const) {
      const exprs = scannerRecipeById(id)!
        .filters.filter(isExpressionFilter)
        .map((f) => f.expression)
        .join(' ');
      expect(exprs).toContain(`marketCap >= ${lo}`);
      expect(exprs).toContain(`marketCap < ${hi}`);
    }
  });

  it('supportsPrune recipes carry a noDataPred; non-prune recipes do not', () => {
    for (const r of SCANNER_RECIPES) {
      if (r.supportsPrune) {
        expect(typeof r.noDataPred).toBe('function');
      } else {
        expect(r.noDataPred).toBeUndefined();
      }
    }
    expect(scannerRecipeById('quality-mid')!.supportsPrune).toBe(true);
    expect(scannerRecipeById('gainers')!.supportsPrune).toBeUndefined();
  });

  it('sort columns resolve to a declared column display_name', () => {
    for (const r of SCANNER_RECIPES) {
      if (r.sort === undefined) continue;
      const names = r.columns.map((c) => c.display_name);
      expect(names).toContain(r.sort.column);
    }
  });

  it('columnLookup entries map requested names to non-empty canonical keys', () => {
    for (const r of SCANNER_RECIPES) {
      if (r.columnLookup === undefined) continue;
      const names = new Set(r.columns.map((c) => c.display_name));
      for (const [from, to] of r.columnLookup) {
        expect(names.has(from)).toBe(true);
        expect(to.length).toBeGreaterThan(0);
      }
    }
  });

  it('ivr recipes are scoped to optionable-size names (mcap ≥ 2B)', () => {
    for (const id of ['ivr-high', 'ivr-low']) {
      const exprs = scannerRecipeById(id)!
        .filters.filter(isExpressionFilter)
        .map((f) => f.expression)
        .join(' ');
      expect(exprs).toContain('marketCap >= 2e9');
    }
  });

  it('filter and column objects carry only wire-legal keys', () => {
    const FILTER_KEYS = new Set([
      'expression',
      'filter_type',
      'predicate',
      'values',
      'display_title',
      'interval',
      'length',
      'plot',
    ]);
    const COLUMN_KEYS = new Set(['display_name', 'expression', 'visible', 'order']);
    for (const r of SCANNER_RECIPES) {
      for (const f of r.filters) {
        for (const k of Object.keys(f)) {
          expect(FILTER_KEYS.has(k)).toBe(true);
        }
      }
      for (const c of r.columns) {
        for (const k of Object.keys(c)) {
          expect(COLUMN_KEYS.has(k)).toBe(true);
        }
      }
    }
  });

  it('quality noDataPred flags blank key metrics via the canonical lookup', () => {
    // The real predicate resolves 'ROE'/'NPM' through QUALITY_LOOKUP —
    // a lookup regression silently routes blank rows to dropCandidates.
    const q = scannerRecipeById('quality-mid')!;
    const mk = (values: Record<string, string>) => ({
      symbol: 'X',
      name: '',
      instrumentId: '',
      instrumentType: 'EQUITY',
      values,
      tracked: false,
    });
    expect(q.noDataPred!(mk({}))).toBe(true);
    // Blank strings and non-numeric cells count as no-data too.
    expect(q.noDataPred!(mk({ 'Return on equity': '', 'Net profit margin': 'abc' }))).toBe(true);
    expect(q.noDataPred!(mk({ 'Return on equity': '0.2' }))).toBe(false);
    expect(q.noDataPred!(mk({ 'Net profit margin': '0.3' }))).toBe(false);
    // Raw display-name keys work too (presence fallback in numericColumn).
    expect(q.noDataPred!(mk({ ROE: '0.2' }))).toBe(false);
  });

  it('no column display_name collides with a filter display_title (live wire error)', () => {
    // Probed 2026-10-20: backend rejects 'column "X" already exists from
    // a filter' when a column re-declares a title the filter produced.
    for (const r of SCANNER_RECIPES) {
      const titles = new Set(
        r.filters
          .filter(isExpressionFilter)
          .map((f) => f.display_title)
          .filter(Boolean),
      );
      for (const c of r.columns) {
        expect(titles.has(c.display_name)).toBe(false);
      }
    }
  });

  it('every recipe sort.column names a declared + VISIBLE column (page re-sort, #1140/#1197)', () => {
    // The page seeds its sort chain with this column — a drifted name
    // would silently sort on all-null keys, and a hidden column would
    // apply an unremovable badge-less sort.
    for (const r of SCANNER_RECIPES) {
      const col = r.columns.find((c) => c.display_name === r.sort?.column);
      expect(r.sort).toBeDefined();
      expect(col).toBeDefined();
      expect(col!.visible).not.toBe(false);
    }
  });

  it('percentColumns entries name declared columns (display hint, #1140)', () => {
    for (const r of SCANNER_RECIPES) {
      const names = new Set(r.columns.map((c) => c.display_name));
      for (const p of r.percentColumns ?? []) {
        expect(names.has(p)).toBe(true);
      }
    }
  });
});

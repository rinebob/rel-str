/**
 * Scanner recipe catalog — RH Scanner page (#1098/#1137).
 *
 * Named, code-versioned `preview_scan` bundles (CONTEXT.md: Scan Recipe).
 * Every threshold expression here is field-guide-verified
 * (docs/topics/657-rh-mcp/rh-mcp-scanner-field-guide.md):
 *
 * - Percent-scaled fundamentals (ROE, NPM, growth, IV rank) are
 *   FRACTION-scaled upstream — they ride expression filters with
 *   0–1 thresholds (`fundamental.returnOnEquity >= 0.15`), never enum
 *   PERCENTAGE filters, which compare the literal `15` against raw `1.49`.
 * - Expression boolean form `{expression: '<expr> <cmp> <n>', predicate:
 *   '=', values: ['True']}` is the live-verified shape (dep-prev-scan-05).
 * - Standard-expression columns canonicalize on the backend — a column
 *   requested as 'ROE' arrives keyed 'Return on equity' (verified by the
 *   live score-symbols run); quality recipes declare `columnLookup` for
 *   those renames. Non-standard expression columns keep display_name —
 *   probed live 2026-10-20: '52w high', 'Range pos', 'IV rank',
 *   'IV 52w high/low', 'Vol × 30d avg' all returned under their
 *   requested names.
 * - `sort` is client-side (preview_scan has no sort arg): the page
 *   sorts the returned rows itself via ScanSort. The backend pre-cuts
 *   to a `Last desc` page of ~200 — recipes matching >200 names are
 *   re-sorts of that price-weighted subset, not true top-N.
 */
import type {
  ScanColumn,
  ScanExpressionFilter,
  ScanFilter,
} from '@robinhood-mcp/contracts';
import type { ScanRecipe } from '@st/scanner';
import { numericColumn, type ScanRow } from '../utils/scanner-rows.util';

/**
 * FE recipe — the wire ScanRecipe plus page-layer metadata:
 * `supportsPrune` enables the "Evaluate tracked" compare direction,
 * `noDataPred` flags returned rows whose key columns are blank, and
 * `columnLookup` statically maps requested display names to backend
 * canonical column keys where the field guide verified the rename.
 */
export interface ScannerRecipe extends ScanRecipe {
  /** Enable universe evaluation (quality screens only — IMPL §2). */
  supportsPrune?: boolean;
  /** Returned row whose required metric columns are blank → no-data bucket. */
  noDataPred?: (row: ScanRow) => boolean;
  /** Requested display_name → backend canonical column key. */
  columnLookup?: ReadonlyMap<string, string>;
}

/** Expression boolean form — the verified wire shape. */
function expr(expression: string, displayTitle: string): ScanExpressionFilter {
  return { expression, predicate: '=', values: ['True'], display_title: displayTitle };
}

function col(displayName: string, expression?: string): ScanColumn {
  return expression === undefined
    ? { display_name: displayName }
    : { display_name: displayName, expression };
}

/* ------------------------------------------------------------------ */
/* Quality screen — field guide's verified fundamental set, segmented  */
/* by market cap. Percent fields are fraction-scaled: ROE ≥ 0.15 = 15% */
/* ------------------------------------------------------------------ */

const QUALITY_FILTERS: readonly ScanFilter[] = [
  expr('fundamental.returnOnEquity >= 0.15', 'ROE ≥ 15%'),
  expr('fundamental.netProfitMargin >= 0.10', 'NPM ≥ 10%'),
  expr('fundamental.eps > 0', 'EPS > 0'),
  expr('fundamental.pegRatio <= 2', 'PEG ≤ 2'),
];

const QUALITY_COLUMNS: readonly ScanColumn[] = [
  col('ROE', 'fundamental.returnOnEquity'),
  col('NPM', 'fundamental.netProfitMargin'),
  col('EPS', 'fundamental.eps'),
  col('PEG', 'fundamental.pegRatio'),
  col('Market cap', 'fundamental.marketCap'),
];

/** Live-verified canonical renames (score-symbols run CANON map). */
const QUALITY_LOOKUP: ReadonlyMap<string, string> = new Map([
  ['ROE', 'Return on equity'],
  ['NPM', 'Net profit margin'],
]);

/** A scoped row came back but the metrics driving the screen are blank —
 *  suspicious data, not a quality verdict (CONTEXT.md: verify before drop). */
const qualityNoData = (row: ScanRow): boolean =>
  numericColumn(row, 'ROE', QUALITY_LOOKUP) === null &&
  numericColumn(row, 'NPM', QUALITY_LOOKUP) === null;

function qualityRecipe(
  id: string,
  title: string,
  segmentBlurb: string,
  mcapFilters: ScanFilter[],
): ScannerRecipe {
  return {
    id,
    title,
    blurb: segmentBlurb,
    filters: [...QUALITY_FILTERS, ...mcapFilters],
    columns: [...QUALITY_COLUMNS],
    sort: { column: 'ROE', direction: 'desc' },
    supportsPrune: true,
    noDataPred: qualityNoData,
    columnLookup: QUALITY_LOOKUP,
  };
}

/* ------------------------------------------------------------------ */
/* 52-week extremes                                                    */
/* ------------------------------------------------------------------ */

const RANGE_POS_EXPR = 'pricePosInRange(candleCount=252, candlePeriod="1d")';
const HIGH_EXPR = 'high(timePeriod="1y", candlePeriod="1d")';
const LOW_EXPR = 'low(timePeriod="1y", candlePeriod="1d")';

const RANGE_COLUMNS: readonly ScanColumn[] = [
  col('52w high', HIGH_EXPR),
  col('52w low', LOW_EXPR),
  col('Range pos', RANGE_POS_EXPR),
];

/* ------------------------------------------------------------------ */
/* IV rank — fraction-scaled 0–1 despite "0–100%" doc wording          */
/* ------------------------------------------------------------------ */

const MCAP_2B_FILTER = expr('fundamental.marketCap >= 2e9', 'mcap ≥ $2B');
const IVR_COLUMNS: readonly ScanColumn[] = [
  col('IV rank', 'ivRank'),
  col('IV 52w high', 'iv52weeksHigh'),
  col('IV 52w low', 'iv52weeksLow'),
];

/* ------------------------------------------------------------------ */

const VOL_RATIO_EXPR = 'dayVolume / volumeAvg(candleCount=30, candlePeriod="1d")';

/** Signed % change screen — the verified dep-prev-scan-07 enum.
 *  Threshold '0' is deliberately scale-safe: the enum compares literals
 *  on the FRACTION scale (values ['2'] matched +200%/+700% movers live),
 *  so only sign boundaries are safe thresholds. Non-zero percent
 *  thresholds must be expression filters. '% Change' column values are
 *  likewise fractions — the display layer applies `percentColumn`. */
function pctChangeFilter(direction: '>' | '<'): ScanFilter {
  return {
    filter_type: 'FILTER_TYPE_PERCENT_CHANGE_FROM_CLOSE',
    predicate: direction,
    values: ['0'],
    interval: '1d',
    plot: 'Close',
  };
}

/** The recipe catalog — the page picker's source (IMPL §2). */
export const SCANNER_RECIPES: readonly ScannerRecipe[] = [
  qualityRecipe(
    'quality-mega',
    'Quality — Mega Cap',
    'ROE≥15% · NPM≥10% · EPS>0 · PEG≤2 · mcap≥$200B',
    [expr('fundamental.marketCap >= 200e9', 'mcap ≥ $200B')],
  ),
  qualityRecipe(
    'quality-large',
    'Quality — Large Cap',
    'ROE≥15% · NPM≥10% · EPS>0 · PEG≤2 · $10B≤mcap<$200B',
    [
      expr('fundamental.marketCap >= 10e9', 'mcap ≥ $10B'),
      expr('fundamental.marketCap < 200e9', 'mcap < $200B'),
    ],
  ),
  qualityRecipe(
    'quality-mid',
    'Quality — Mid Cap',
    'ROE≥15% · NPM≥10% · EPS>0 · PEG≤2 · $2B≤mcap<$10B',
    [
      MCAP_2B_FILTER,
      expr('fundamental.marketCap < 10e9', 'mcap < $10B'),
    ],
  ),

  {
    id: 'high-52w',
    title: 'At 52-Week High',
    blurb: 'Trading at or above the 1y daily high',
    filters: [expr(`tradeAllDay.price >= ${HIGH_EXPR}`, 'At 52w high')],
    columns: [...RANGE_COLUMNS],
    sort: { column: 'Range pos', direction: 'desc' },
  },
  {
    id: 'near-52w-high',
    title: 'Near 52-Week High',
    blurb: 'Top 5% of the 52-week range',
    filters: [expr(`${RANGE_POS_EXPR} >= 0.95`, 'Range pos ≥ 95%')],
    columns: [...RANGE_COLUMNS],
    sort: { column: 'Range pos', direction: 'desc' },
  },
  {
    id: 'low-52w',
    title: 'At 52-Week Low',
    blurb: 'Trading at or below the 1y daily low',
    filters: [expr(`tradeAllDay.price <= ${LOW_EXPR}`, 'At 52w low')],
    columns: [...RANGE_COLUMNS],
    sort: { column: 'Range pos', direction: 'asc' },
  },
  {
    id: 'near-52w-low',
    title: 'Near 52-Week Low',
    blurb: 'Bottom 5% of the 52-week range',
    filters: [expr(`${RANGE_POS_EXPR} <= 0.05`, 'Range pos ≤ 5%')],
    columns: [...RANGE_COLUMNS],
    sort: { column: 'Range pos', direction: 'asc' },
  },

  {
    id: 'ivr-high',
    title: 'High IV Rank',
    blurb: 'IV rank ≥ 80% of its 52-wk range, mcap ≥ $2B (optionable size)',
    filters: [expr('ivRank >= 0.8', 'IVR ≥ 0.8'), MCAP_2B_FILTER],
    columns: [...IVR_COLUMNS],
    sort: { column: 'IV rank', direction: 'desc' },
  },
  {
    id: 'ivr-low',
    title: 'Low IV Rank',
    blurb: 'IV rank ≤ 20% of its 52-wk range, mcap ≥ $2B (optionable size)',
    filters: [expr('ivRank <= 0.2', 'IVR ≤ 0.2'), MCAP_2B_FILTER],
    columns: [...IVR_COLUMNS],
    sort: { column: 'IV rank', direction: 'asc' },
  },

  {
    id: 'vol-spike',
    title: 'Volume Spike',
    blurb: "Today's volume ≥ 2× the 30-day average",
    filters: [expr(`${VOL_RATIO_EXPR} >= 2`, 'Vol ≥ 2× avg')],
    columns: [col('Vol × 30d avg', VOL_RATIO_EXPR)],
    sort: { column: 'Vol × 30d avg', direction: 'desc' },
  },

  {
    id: 'gainers',
    title: 'Daily Gainers',
    blurb: 'Positive % change from prior close, best first within the 200-row page',
    filters: [pctChangeFilter('>')],
    columns: [col('% Change'), col('Net change')],
    sort: { column: '% Change', direction: 'desc' },
  },
  {
    id: 'losers',
    title: 'Daily Losers',
    blurb: 'Negative % change from prior close, worst first within the 200-row page',
    filters: [pctChangeFilter('<')],
    columns: [col('% Change'), col('Net change')],
    sort: { column: '% Change', direction: 'asc' },
  },
];

/** Lookup a catalog recipe by its kebab-case id. */
export function scannerRecipeById(id: string): ScannerRecipe | undefined {
  return SCANNER_RECIPES.find((r) => r.id === id);
}

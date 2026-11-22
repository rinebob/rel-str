/**
 *
 * Paper-trading ID builders + the legacy→canonical group-id map.
 *
 * Since #1661 every paper-trading record lives under `st-paper-trading`
 * anchors; the legacy `paper-trading` root (and its cohorts/items path)
 * is retired. `cohortIdToGroupId` below bridges pre-cutover trade docs
 * whose `cohortId` predates the `positionGroupId` stamp.
 *
 * ID formats:
 *   account  acct-{userId}
 *   trade    YYMMDD-{origin}-{SYMBOL}-{desc}        origin: st|sig|man
 *            desc = EQ | EQV{n}{L|S} | {SPREAD}-{DELTA3}-{DTE2}
 *            collision suffix -HHMM
 *   stats    stats-{scope}
 *   rawQuote rq-{tradeId}-{YYMMDD}
 *   instance reuses generateInstanceId (see shared/strategy-instance-id.ts)
 */

import { formatDelta, formatDte, formatYYMMDD } from './id-format';
import { stPositionGroupId } from './st-ids';
import { TradeSide } from './common';
import { stPaperTradingItemsPath, StPaperTradingKind } from './st-collections';
// Type-only — paper-trading-contracts imports PaperTradingKind from this
// module as a value, so a runtime import here would create a cycle.
import type { PaperTradeSource } from './paper-trading-contracts';

/** Record kinds housed under the `paper-trading` root. */
export enum PaperTradingKind {
  ACCOUNT = 'account',
  INSTANCE = 'instance',
  TRADE = 'trade',
  STATS = 'stats',
  RAW_QUOTE = 'raw-quote',
  ANALYSIS_DATASET = 'analysis-dataset',
  ANALYSIS_SLICE = 'analysis-slice',
}

// ── Account ────────────────────────────────────────────────────────────────

export function buildAccountId(userId: string): string {
  return `acct-${userId}`;
}

// ── Trade ──────────────────────────────────────────────────────────────────

export type TradeOrigin = 'st' | 'sig' | 'man';
const TRADE_ORIGINS: ReadonlySet<string> = new Set(['st', 'sig', 'man']);

/**
 * Build a trade document id: `YYMMDD-{origin}-{SYMBOL}-{desc}[-HHMM]`.
 * `opts.timeSuffix` is a preformatted 'HHMM' string appended on same-day
 * collisions (caller checks existence, then retries with the suffix).
 */
export function buildTradeId(
  date: Date,
  origin: TradeOrigin,
  symbol: string,
  desc: string,
  opts?: { timeSuffix?: string },
): string {
  if (!TRADE_ORIGINS.has(origin)) {
    throw new Error(`unknown trade origin: ${origin}`);
  }
  const base = `${formatYYMMDD(date)}-${origin}-${symbol.toUpperCase()}-${desc}`;
  return opts?.timeSuffix ? `${base}-${opts.timeSuffix}` : base;
}

/** Equity (share) trade desc. */
export const EQUITY_TRADE_DESC = 'EQ';

// ── Auto-paper signal trades (Thread #904) ───────────────────────────────────

/**
 * Deterministic dedupe key for an auto-papered signal occurrence:
 * `{SYMBOL}_{signalType}_{barDate}`. One trade per signal per day across
 * timed and manual runs; a next-day re-fire has a new barDate → new key.
 * Stored on `trade.signalId`.
 */
export function signalDedupeKey(symbol: string, signalType: string, barDate: string): string {
  return `${symbol.toUpperCase()}_${signalType}_${barDate}`;
}

/**
 * Trade-id desc for an auto-papered signal: `EQ{Vn}{L|S}` derived from the
 * `D_ST_TREND_RIDER_V{n}_{LONG|SHORT}` signalType shape (e.g. V1 long → EQV1L).
 * Keeps the same symbol/day distinct per signal type so tradeId doubles as a
 * doc-existence dedupe key.
 *
 * Trend-rider daily signals only: a `W_`/`M_`-prefixed type, or a different
 * daily strategy, would map onto the same desc and silently collide on
 * tradeId — both throw here. New strategies/timeframes joining auto-paper
 * must extend the desc to stay distinct (e.g. a strategy or timeframe char).
 */
export function signalTradeDesc(signalType: string): string {
  const m = /^D_ST_TREND_RIDER_V(\d+)_(LONG|SHORT)$/.exec(signalType);
  if (!m) throw new Error(`signalTradeDesc: unsupported signal type '${signalType}'`);
  return `EQV${m[1]}${m[2] === 'LONG' ? 'L' : 'S'}`;
}

/** Spread desc `{CODE}-{DELTA3}-{DTE2}` — e.g. CSP-020-30 for 20Δ 30-DTE. */
export function buildSpreadTradeDesc(code: string, targetDelta: number, dte: number): string {
  return `${code.toUpperCase()}-${formatDelta(targetDelta)}-${formatDte(dte)}`;
}

export interface ParsedTradeId {
  date: string;      // YYMMDD
  origin: TradeOrigin;
  symbol: string;
  desc: string;      // EQ | EQV{n}{L|S} (auto-paper) | {CODE}-{DELTA}-{DTE}
  suffix?: string;   // HHMM collision suffix when present
}

/** Parse a trade doc id back into components; null when malformed. */
export function parseTradeId(id: string): ParsedTradeId | null {
  const m = /^(\d{6})-(st|sig|man)-([A-Z0-9]+)-([A-Z0-9]+(?:-\d{3}-\d{2})?)(?:-(\d{4}))?$/.exec(id);
  if (!m) return null;
  return { date: m[1], origin: m[2] as TradeOrigin, symbol: m[3], desc: m[4], suffix: m[5] };
}

// ── Stats ──────────────────────────────────────────────────────────────────

export function buildStatsId(scope: string): string {
  return `stats-${scope}`;
}

export function statsScopeAll(): string { return 'all'; }
export function statsScopeInstance(instanceId: string): string { return `inst-${instanceId}`; }
export function statsScopeVariant(variantKey: string): string { return `var-${variantKey}`; }
export function statsScopeCohort(cohortId: string): string {
  // cohort ids already carry the 'cohort-' prefix — don't double it.
  return cohortId.startsWith('cohort-') ? cohortId : `cohort-${cohortId}`;
}

/**
 * Maps a legacy cohort id to the canonical `st-position-groups` doc id:
 * `cohort-{YYMMDD}-{SYM}-{NN}` → `{SYM}-{YYMMDD}-grp-{NN}` (#1661). Null
 * on a malformed id; anything else (including a `grp-*` id, which is NOT
 * a cohort id) is left for the caller to handle via the union reads.
 */
export function cohortIdToGroupId(cohortId: string | null | undefined): string | null {
  const m = /^cohort-(\d{6})-(.+)-(\d+)$/.exec(cohortId ?? '');
  if (!m) return null;
  const [, yymmdd, symbol, seqStr] = m;
  try {
    const date = new Date(
      `20${yymmdd.slice(0, 2)}-${yymmdd.slice(2, 4)}-${yymmdd.slice(4, 6)}T12:00:00Z`,
    );
    return stPositionGroupId(symbol, date, Number(seqStr));
  } catch {
    return null;
  }
}
export function statsScopeSignal(signalId: string): string { return `sig-${signalId}`; }
export function statsScopeSymbol(symbol: string): string { return `sym-${symbol.toUpperCase()}`; }
/**
 * Per-source scope — `src-STRATEGY` / `src-SIGNAL` / `src-MANUAL`. The enum
 * values are lowercase; uppercased here like `statsScopeSymbol` so the doc
 * ids read `stats-src-STRATEGY` (population selector scopes, Thread #987).
 */
export function statsScopeSource(source: PaperTradeSource): string {
  return `src-${source.toUpperCase()}`;
}

// ── Auto-paper slice dimensions (Thread #904) ────────────────────────────────

/**
 * Lowercase slug for scope ids — [a-z0-9] runs joined with '-'.
 * Accepted collision: inputs that differ only by separator characters
 * ('A-B' vs 'A B') slugify identically — deliberate, matches how the
 * slice dims read; don't encode separators to "fix" it.
 */
function scopeSlug(value: string): string {
  const slug = value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  if (!slug) throw new Error(`scopeSlug: '${value}' produces an empty slug`);
  return slug;
}

export function statsScopeSignalType(signalType: string): string {
  return `sigtype-${scopeSlug(signalType)}`;
}
export function statsScopeDirection(side: TradeSide): string {
  return `dir-${side}`;
}
export function statsScopeSector(sector: string): string {
  return `sector-${scopeSlug(sector)}`;
}
export function statsScopeIndustry(industry: string): string {
  return `ind-${scopeSlug(industry)}`;
}
export function statsScopeCapTier(tier: string): string {
  return `captier-${scopeSlug(tier)}`;
}
export function statsScopeSignalStatus(status: string): string {
  return `sigstatus-${scopeSlug(status)}`;
}

/** Every scope-family prefix the builders above can emit — a stats doc
 *  id is `stats-{scope}` and its scope is canonical iff it is `all` or
 *  carries one of these prefixes. The legacy combined doc and
 *  `stats-{unprefixed-instanceId}` docs fail this check — the #1566
 *  cleanup enumerates `st-paper-trading/stats/items` on exactly this
 *  predicate. */
export const CANONICAL_STATS_SCOPE_PREFIXES = [
  'inst-', 'var-', 'cohort-', 'sig-', 'sym-', 'src-', 'sigtype-', 'dir-',
  'sector-', 'ind-', 'captier-', 'sigstatus-',
] as const;

export function isCanonicalStatsScope(scope: string): boolean {
  return (
    scope === 'all' ||
    CANONICAL_STATS_SCOPE_PREFIXES.some((p) => scope.startsWith(p))
  );
}

// ── Analysis datasets (Thread #1059) ─────────────────────────────────────────

/** `st-paper-trading/analysis-datasets/items` — dataset index collection. */
export function analysisDatasetsPath(): string {
  return stPaperTradingItemsPath(StPaperTradingKind.ANALYSIS_DATASET);
}

/** `st-paper-trading/analysis-slices/items` — saved slice collection. */
export function analysisSlicesPath(): string {
  return stPaperTradingItemsPath(StPaperTradingKind.ANALYSIS_SLICE);
}

/** GCS object path for a dataset's CSV payload: `analysis-datasets/{id}.csv`. */
export function analysisDatasetGcsPath(datasetId: string): string {
  return `analysis-datasets/${datasetId}.csv`;
}

// ── Raw quote ──────────────────────────────────────────────────────────────

export function buildRawQuoteId(tradeId: string, date: Date): string {
  return `rq-${tradeId}-${formatYYMMDD(date)}`;
}


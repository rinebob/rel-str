/**
 *
 * Paper-trading collection paths and human-readable ID builders.
 *
 * Layout (Blueprint #557): one root collection `paper-trading` holding a
 * small set of kind anchor docs; each anchor owns a single `items`
 * subcollection of records. Keeps the console navigable without scattering
 * types across root collections.
 *
 *   paper-trading/{anchor}/items/{docId}
 *
 * ID formats:
 *   account  acct-{userId}
 *   trade    YYMMDD-{origin}-{SYMBOL}-{desc}        origin: st|sig|man
 *            desc = EQ | {SPREAD}-{DELTA3}-{DTE2};  collision suffix -HHMM
 *   cohort   cohort-YYMMDD-{SYMBOL}-{seq2}
 *   stats    stats-{scope}
 *   rawQuote rq-{tradeId}-{YYMMDD}
 *   instance reuses generateInstanceId (see shared/strategy-instance-id.ts)
 */

import { formatDelta, formatDte, formatYYMMDD } from './id-format';

/** Root collection for all paper-trading records. */
export const PAPER_TRADING_ROOT = 'paper-trading';

/** Record kinds housed under the `paper-trading` root. */
export enum PaperTradingKind {
  ACCOUNT = 'account',
  INSTANCE = 'instance',
  COHORT = 'cohort',
  TRADE = 'trade',
  STATS = 'stats',
  RAW_QUOTE = 'raw-quote',
}

const KIND_ANCHORS: Record<PaperTradingKind, string> = {
  [PaperTradingKind.ACCOUNT]: 'accounts',
  [PaperTradingKind.INSTANCE]: 'instances',
  [PaperTradingKind.COHORT]: 'cohorts',
  [PaperTradingKind.TRADE]: 'trades',
  [PaperTradingKind.STATS]: 'stats',
  [PaperTradingKind.RAW_QUOTE]: 'raw-quotes',
};

/** Firestore collection path for a kind's `items` subcollection (odd segments). */
export function paperTradingItemsPath(kind: PaperTradingKind): string {
  return `${PAPER_TRADING_ROOT}/${KIND_ANCHORS[kind]}/items`;
}

/** Firestore document path for a record (even segments). */
export function paperTradingDocPath(kind: PaperTradingKind, id: string): string {
  return `${paperTradingItemsPath(kind)}/${id}`;
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

/** Spread desc `{CODE}-{DELTA3}-{DTE2}` — e.g. CSP-020-30 for 20Δ 30-DTE. */
export function buildSpreadTradeDesc(code: string, targetDelta: number, dte: number): string {
  return `${code.toUpperCase()}-${formatDelta(targetDelta)}-${formatDte(dte)}`;
}

export interface ParsedTradeId {
  date: string;      // YYMMDD
  origin: TradeOrigin;
  symbol: string;
  desc: string;      // EQ or {CODE}-{DELTA}-{DTE}
  suffix?: string;   // HHMM collision suffix when present
}

/** Parse a trade doc id back into components; null when malformed. */
export function parseTradeId(id: string): ParsedTradeId | null {
  const m = /^(\d{6})-(st|sig|man)-([A-Z0-9]+)-([A-Z0-9]+(?:-\d{3}-\d{2})?)(?:-(\d{4}))?$/.exec(id);
  if (!m) return null;
  return { date: m[1], origin: m[2] as TradeOrigin, symbol: m[3], desc: m[4], suffix: m[5] };
}

// ── Cohort ─────────────────────────────────────────────────────────────────

export function buildCohortId(date: Date, symbol: string, seq: number): string {
  return `cohort-${formatYYMMDD(date)}-${symbol.toUpperCase()}-${String(seq).padStart(2, '0')}`;
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
export function statsScopeSignal(signalId: string): string { return `sig-${signalId}`; }
export function statsScopeSymbol(symbol: string): string { return `sym-${symbol.toUpperCase()}`; }

// ── Raw quote ──────────────────────────────────────────────────────────────

export function buildRawQuoteId(tradeId: string, date: Date): string {
  return `rq-${tradeId}-${formatYYMMDD(date)}`;
}


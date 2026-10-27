/**
 * @topic #984 — ST Firestore Reorg (task #997)
 *
 * Canonical `st-`-prefixed Firestore paths for the data-plane consolidation.
 * Single source of truth shared by BE (functions) and FE (Angular) via the
 * `@st/collections` path alias — same pattern as `@paper-trading/ids`.
 *
 * These are the NEW roots. Legacy constants (`savant-trader/data/*`,
 * `paper-trading`, `portfolio/*`, `backtest-*`) stay live during the
 * dual-write migration; consumers cut over per-task and the legacy constants
 * are removed when the old roots are retired (BE task #1013).
 *
 * Scope: roots created or renamed by this reorg, plus new `st-` flat
 * roots from feature domains without a dedicated path module (e.g. the
 * `st-options-*` Selection Replay roots, Topic #1238). Domains that own a
 * contract/path module keep their roots there — `st-screenshots`
 * (@screenshot-capture/contracts), `st-swing-sets`/`st-swing-configs`
 * (swing-analysis services). Do not duplicate them here.
 *
 * Layout recap (ADR-009):
 *   flat roots          st-signals/{SYM}_{barDate}_{signalType}
 *                       st-order-tickets/{liv|pap}_{id}
 *                       st-position-groups/{SYM}-{YYMMDD}-grp-{NN}
 *                       st-strategy-instances/{id}
 *                       st-config/{docId}
 *                       st-symbol-lists/{uid}_{KEY}
 *                       st-symbols/{SYM}
 *                       st-runs/{runId}   st-runs/{runId}/jobs/{SYM}
 *   anchored roots      st-paper-trading/{kind-anchor}/items/{id}
 *                       st-portfolio/{kind-anchor}/items/{id}
 *                       st-scanner/{kind-anchor}/items/{id}
 *   backtest roots      st-backtest-runs/{runId}  st-backtest-permutations/{id}
 *   replay roots        st-options-replay-runs/{runId}
 *                       st-options-contract-lists/{runId}_{SYM}
 */

import type { PaperTradingKind } from './paper-trading-ids';

// ── Flat roots ─────────────────────────────────────────────────────────────

/** Symbol docs (config + overview/meta fields) — one doc per tracked symbol (merges savant-trader/data/symbols + symbol-meta). */
export const ST_SYMBOLS_ROOT = 'st-symbols';

/** Canonical signal occurrences — one doc per {symbol, barDate, signalType}. */
export const ST_SIGNALS_ROOT = 'st-signals';

/** Run records; per-symbol jobs live in the `jobs` subcollection (7-day TTL). */
export const ST_RUNS_ROOT = 'st-runs';

/** Universal order tickets — signal/program/manual/management origins (was savant-trader/data/order-intents). */
export const ST_ORDER_TICKETS_ROOT = 'st-order-tickets';

/** Position groups (was paper-trading cohorts + live groupings). */
export const ST_POSITION_GROUPS_ROOT = 'st-position-groups';

/** Strategy instances (was paper-trading/instances/items + options-strategy-instances). */
export const ST_STRATEGY_INSTANCES_ROOT = 'st-strategy-instances';

/** Config + status docs (was trading-config/*, status/current). */
export const ST_CONFIG_ROOT = 'st-config';

// ── st-config doc ids ────────────────────────────────────────────────────────

/** Doc id for the run-status singleton under st-config (was savant-trader/data/status/current). */
export const ST_CONFIG_STATUS_DOC = 'status';

/** `st-config/{docId}` — hosts heterogeneous singletons/user docs (status, autoPaper, {uid} trading config). */
export function stConfigDocPath(docId: string): string {
  return `${ST_CONFIG_ROOT}/${docId}`;
}

// ── Flat roots (cont.) ───────────────────────────────────────────────────────

/** User-defined symbol lists — {uid}_{KEY} doc ids (was savant-trader/data/symbol-lists). */
export const ST_SYMBOL_LISTS_ROOT = 'st-symbol-lists';

/** Backtest run/job metadata (was backtest-runs). */
export const ST_BACKTEST_RUNS_ROOT = 'st-backtest-runs';

/** Backtest permutation results (was backtest-permutations). */
export const ST_BACKTEST_PERMUTATIONS_ROOT = 'st-backtest-permutations';

/** Selection-replay run headers (Topic #1238, Thread #1240). */
export const ST_OPTIONS_REPLAY_RUNS_ROOT = 'st-options-replay-runs';

/** Selection-replay contract lists — one doc per symbol per run. */
export const ST_OPTIONS_CONTRACT_LISTS_ROOT = 'st-options-contract-lists';

/**
 * Contract-list doc id is deterministic: `{runId}_{symbol}` (symbol normalized
 * to uppercase, matching peer builders). Lets the worker and readers construct
 * the id without a lookup. Safe only because runIds are Firestore auto-ids,
 * which never contain `_`.
 */
export function stOptionsContractListDocId(runId: string, symbol: string): string {
  return `${runId}_${symbol.toUpperCase()}`;
}

// ── st-runs subcollections ─────────────────────────────────────────────────

/** Jobs subcollection name under a run doc — single source; functions barrel re-exports. */
export const ST_JOBS_SUBCOLLECTION_NAME = 'jobs';

/**
 * Jobs subcollection path for a run: `st-runs/{runId}/jobs`.
 * Job docs are ephemeral — deleted by the 7-day TTL pass (BE task #1010).
 */
export function stRunJobsPath(runId: string): string {
  return `${ST_RUNS_ROOT}/${runId}/${ST_JOBS_SUBCOLLECTION_NAME}`;
}

/** Job document path: `st-runs/{runId}/jobs/{SYM}` (even segments). Symbol normalized to uppercase, matching peer builders. */
export function stRunJobDocPath(runId: string, symbol: string): string {
  return `${stRunJobsPath(runId)}/${symbol.toUpperCase()}`;
}

// ── Anchored roots ─────────────────────────────────────────────────────────
// Same anchor pattern as paper-trading/portfolio: `{root}/{kind}/items/{id}`.
// st-paper-trading drops the legacy 'instances' kind (→ st-strategy-instances)
// and 'cohorts' kind (→ st-position-groups).

/** Root collection for all paper-trading records. */
export const ST_PAPER_TRADING_ROOT = 'st-paper-trading';

/**
 * Record kinds housed under the `st-paper-trading` root.
 * Values match PaperTradingKind spellings exactly (minus instances/cohorts,
 * which moved to st-strategy-instances / st-position-groups) so dual-write
 * code can pass a legacy PaperTradingKind straight through — the helpers
 * below accept both enums.
 */
export enum StPaperTradingKind {
  ACCOUNT = 'account',
  TRADE = 'trade',
  STATS = 'stats',
  RAW_QUOTE = 'raw-quote',
}

/**
 * Kinds accepted by the st-paper-trading path helpers — StPaperTradingKind
 * plus the legacy PaperTradingKind members (deliberately a plain union:
 * dual-write callers hold PaperTradingKind; instance/cohort are caught
 * loudly by the runtime guard rather than a compile error that would
 * complicate legitimate pass-through code).
 */
export type StPaperTradingPathKind = StPaperTradingKind | PaperTradingKind;

const ST_PAPER_TRADING_ANCHORS: Record<StPaperTradingKind, string> = {
  [StPaperTradingKind.ACCOUNT]: 'accounts',
  [StPaperTradingKind.TRADE]: 'trades',
  [StPaperTradingKind.STATS]: 'stats',
  [StPaperTradingKind.RAW_QUOTE]: 'raw-quotes',
};

function stPaperTradingAnchor(kind: StPaperTradingPathKind): string {
  // Own-property check — a truthy-lookup would also pass inherited
  // Object.prototype members ('toString', 'constructor', …).
  if (!Object.hasOwn(ST_PAPER_TRADING_ANCHORS, kind)) {
    // instance/cohort have no st-paper-trading anchor — they moved to
    // st-strategy-instances / st-position-groups.
    throw new Error(`st-paper-trading: no anchor for kind '${kind}'`);
  }
  return ST_PAPER_TRADING_ANCHORS[kind as StPaperTradingKind];
}

/** Collection path for a kind's `items` subcollection (odd segments). */
export function stPaperTradingItemsPath(kind: StPaperTradingPathKind): string {
  return `${ST_PAPER_TRADING_ROOT}/${stPaperTradingAnchor(kind)}/items`;
}

/** Document path for a paper-trading record (even segments). */
export function stPaperTradingDocPath(kind: StPaperTradingPathKind, id: string): string {
  return `${stPaperTradingItemsPath(kind)}/${id}`;
}

/** Root collection for portfolio records. */
export const ST_PORTFOLIO_ROOT = 'st-portfolio';

/** Record kinds housed under the `st-portfolio` root. */
export enum StPortfolioKind {
  BUCKET = 'bucket',
  ATTRIBUTION = 'attribution',
}

/** Anchor doc name per portfolio kind — exported so the #1007 mirror can
 *  invert it (legacy anchor → kind) instead of re-encoding the map. */
export const ST_PORTFOLIO_ANCHORS: Record<StPortfolioKind, string> = {
  [StPortfolioKind.BUCKET]: 'buckets',
  [StPortfolioKind.ATTRIBUTION]: 'attributions',
};

function stPortfolioAnchor(kind: StPortfolioKind): string {
  // Same own-property guard as the paper-trading helper — keeps cast/plural
  // anchors ('buckets' vs 'bucket') from producing 'st-portfolio/undefined/items'.
  if (!Object.hasOwn(ST_PORTFOLIO_ANCHORS, kind)) {
    throw new Error(`st-portfolio: no anchor for kind '${kind}'`);
  }
  return ST_PORTFOLIO_ANCHORS[kind];
}

/** Collection path for a kind's `items` subcollection (odd segments). */
export function stPortfolioItemsPath(kind: StPortfolioKind): string {
  return `${ST_PORTFOLIO_ROOT}/${stPortfolioAnchor(kind)}/items`;
}

/** Document path for a portfolio record (even segments). */
export function stPortfolioDocPath(kind: StPortfolioKind, id: string): string {
  return `${stPortfolioItemsPath(kind)}/${id}`;
}

/** Root collection for RH-scanner records (#1098). */
export const ST_SCANNER_ROOT = 'st-scanner';

/**
 * Record kinds housed under the `st-scanner` root. Only `proposals` exists
 * today — persisted curation proposals from scanner-vs-universe compares.
 * Named so IMPL-doc references and future kind-parameterized helpers have a
 * spelling to pin against; the current helpers are per-kind named functions
 * (arity-0) since a single kind needs no map/guard machinery.
 */
export type StScannerKind = 'proposals';

/** Anchor doc name for curation proposals. */
export const ST_SCANNER_PROPOSALS_ANCHOR = 'proposals';

/** Collection path for curation proposals (odd segments). */
export function stScannerProposalsPath(): string {
  return `${ST_SCANNER_ROOT}/${ST_SCANNER_PROPOSALS_ANCHOR}/items`;
}

/** Document path for a curation proposal (even segments). */
export function stScannerProposalDocPath(id: string): string {
  return `${stScannerProposalsPath()}/${id}`;
}

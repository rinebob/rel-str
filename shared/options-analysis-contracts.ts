/**
 * Backtest Analytics contracts (Topic #1238, Thread #1266).
 *
 * The exit-event matrix: every contract in a contract list × every registered
 * exit strategy, evaluated independently through expiration. Persisted under
 * `st-options-analysis-results/{contractListDocId}_{exitId}` — one doc per
 * (list × exit type) so doc size stays bounded and per-exit queries are cheap.
 *
 * `AnalysisTradeRecord` is a discriminated union on `outcome` (same pattern
 * as `ContractListRow`) — exit fields exist only on 'exit', expiry fields
 * only on 'expired', `error` only on 'error' — so invalid combos don't
 * compile and consumers narrow on `outcome`.
 *
 * Replay-callable payloads (optionsReplayRetry*) live in
 * `options-replay-contracts.ts` — replay-domain boundary contracts stay with
 * the replay feature.
 */

// ==========================
// Analysis trade record
// ==========================

/** Best/worst mark excursion + the date it occurred. */
export interface ExcursionPoint {
  value: number;
  date: string; // YYYY-MM-DD
}

/**
 * Fields every (contract-row × exit-strategy) record carries regardless of
 * outcome — the denormalized slice keys let records be grouped/filtered
 * across docs (and exit types) without joins.
 */
interface AnalysisTradeBase {
  /** Denormalized slice keys — repeated from the contract list doc. */
  runId: string;
  symbol: string;
  templateId: string;
  contractListDocId: string;
  /** The exit strategy this record was evaluated under (registry/fanout key,
   *  not from the list doc) — matches the result-doc key suffix. */
  exitId: string;

  /** From the pick row. */
  pickDate: string; // YYYY-MM-DD
  contractId: string;
  entryMark: number;

  /** Calendar days pickDate → exit/expiry; `0` on error records. */
  daysHeld: number;

  /** Excursion over this rule's own hold window (entry → exit/expiry).
   *  Error records (no series fetched) carry the entry-day placeholder
   *  `{ value: entryMark, date: pickDate }` — "no excursion observed" — so
   *  consumers never handle absent excursion data. Aggregates must still
   *  exclude error records from excursion stats. */
  mae: ExcursionPoint;
  mfe: ExcursionPoint;
}

/** The rule fired during the hold window. */
export interface AnalysisExitTrade extends AnalysisTradeBase {
  outcome: 'exit';
  exitDate: string; // YYYY-MM-DD
  exitPrice: number;
}

/** No rule fired AND the series reached the contract's expiration date.
 *  Writers MUST only emit 'expired' when the last series bar is the expiry
 *  bar — a series that ends early (delisting, corpus hole) is a data
 *  problem, not an expiry, and MUST be recorded as 'error' instead so
 *  fabricated expiry fields are never written. `assignmentDistancePct`
 *  is a PERCENT (×100, same convention as `hitRatePct`): how far the strike
 *  sits from the underlying close at expiry — "how far from current price
 *  are we forced to buy". */
export interface AnalysisExpiredTrade extends AnalysisTradeBase {
  outcome: 'expired';
  /** True when the contract expired in-the-money — put: close < strike;
   *  call: close > strike (option type from the SA response `type` field —
   *  the worker writes an 'error' record when it's missing/unusable). For a
   *  short template this means assignment (a loss); for BTO, a gain —
   *  interpretation depends on the template's side. */
  expiredItm: boolean;
  /** Intrinsic value at expiry — put: max(strike − close, 0);
   *  call: max(close − strike, 0). */
  intrinsicAtExpiry: number;
  /** |strike − underlyingClose| / underlyingClose × 100 at expiry. */
  assignmentDistancePct: number;
}

/** The contract's series could not be fetched OR ends before the expiry
 *  bar (truncated corpus) — carries no exit/expiry semantics;
 *  `daysHeld: 0` and mae/mfe = entry-day placeholder. */
export interface AnalysisErrorTrade extends AnalysisTradeBase {
  outcome: 'error';
  error: string;
}

/**
 * One (contract-row × exit-strategy) outcome — discriminated on `outcome`;
 * consumers narrow on the tag.
 */
export type AnalysisTradeRecord =
  | AnalysisExitTrade
  | AnalysisExpiredTrade
  | AnalysisErrorTrade;

/** Outcome vocabulary — derived so it can't drift from the union. */
export type AnalysisOutcome = AnalysisTradeRecord['outcome'];

// ==========================
// Per-exit-type aggregate
// ==========================

/** Per-exit-type aggregate block — the comparison surface. One "no data"
 *  convention throughout: a stat is ABSENT when its population is empty
 *  (consumers render '—', never branch on sentinel values). */
export interface ExitTypeAggregate {
  exitId: string;
  contractCount: number;
  exitedCount: number;
  expiredCount: number;
  errorCount: number;
  /** exitedCount / (contractCount − errorCount) × 100 — PERCENT convention;
   *  absent when every record errored (denominator 0). */
  hitRatePct?: number;
  /** Mean daysHeld over exited records; absent when nothing exited. */
  avgDaysToExit?: number;
  /** Mean (entryMark − exitPrice)/entryMark × 100 over exited records
   *  with entryMark > 0; absent when nothing exited (or no exited record
   *  has a positive entryMark). */
  avgPremiumCapturedPct?: number;
  /** Max mae.value over non-error records; absent when all errored. */
  worstMae?: number;
  /** Median/90th-pctile mae.value over non-error records; absent when
   *  all errored. */
  maeP50?: number;
  maeP90?: number;
}

// ==========================
// Firestore doc shape
// ==========================

export type AnalysisResultStatus = 'running' | 'success' | 'failed';
export const ANALYSIS_RESULT_STATUSES: readonly AnalysisResultStatus[] = [
  'running',
  'success',
  'failed',
];

/**
 * Persisted result doc —
 * `st-options-analysis-results/{contractListDocId}_{exitId}`.
 * One record per pick row of the source list (markers excluded).
 * On `failed` docs `trades` is empty and `aggregate` counts are zeroed
 * with all optional stats absent — counts are always present so consumers
 * never branch on doc completeness.
 */
export interface AnalysisResultDoc {
  /** The runId — list doc ids are 1:1 with runs (single-symbol runs, #1430). */
  contractListDocId: string;
  runId: string;
  symbol: string;
  templateId: string;
  exitId: string;
  /** EXIT_REGISTRY_VERSION at analysis time — stale docs detectable. */
  registryVersion: number;
  status: AnalysisResultStatus;
  trades: AnalysisTradeRecord[];
  aggregate: ExitTypeAggregate;
  /** ISO timestamp. */
  generatedAt: string;
  error?: string;
}

// ==========================
// Callable + task payloads
// ==========================

/** optionsAnalysisStart — kicks off analysis of one contract list. */
export interface OptionsAnalysisStartRequest {
  /** The list doc id — equal to the runId under single-symbol runs (#1430). */
  contractListDocId: string;
}

export interface OptionsAnalysisStartResponse {
  /** = contractListDocId for v1. */
  analysisId: string;
}

/** Cloud Task payload — one per contract list (all exit types evaluated). */
export interface OptionsAnalysisTaskPayload {
  contractListDocId: string;
  runId: string;
  symbol: string;
  templateId: string;
  registryVersion: number;
}

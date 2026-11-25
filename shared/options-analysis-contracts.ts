/**
 * Backtest Analytics contracts (Topic #1238, Thread #1266).
 *
 * The exit-event matrix: every contract in a contract list × every registered
 * exit strategy, evaluated independently through expiration. Persisted under
 * `st-options-analysis-results/{contractListDocId}_{exitId}` — one doc per
 * (list × exit type) so doc size stays bounded and per-exit queries are cheap.
 *
 * `AnalysisTradeRecord` is a discriminated union on `outcome` (same pattern
 * as `ContractListRowV1`) — exit fields exist only on 'exit', expiry fields
 * only on 'expired', `lastBarDate` only on 'open' (#1431 — a live position
 * whose series ends before its future expiry), `error` only on 'error' —
 * so invalid combos don't compile and consumers narrow on `outcome`.
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

  /** From the pick/position row. */
  pickDate: string; // YYYY-MM-DD — the position's entryDate
  /** One leg's contract id; multi-leg positions join leg ids with '+'
   *  (e.g. 'A+B' — OCC parsers return null on joined ids). */
  contractId: string;
  /** Net position mark at entry in posture-normalized space (#1500):
   *  cost-to-close for credit structures, liquidation value for debit —
   *  always ≥ 0, always decays as premium is lost. 1-leg rows carry the
   *  contract's own mark verbatim (v1 parity). */
  entryMark: number;

  /** Greeks at entry — the position's signed net delta + IV in the same
   *  posture space as entryMark (1-leg rows = SA's pick-day values
   *  verbatim; SA IV is a fraction — render `* 100` for percent).
   *  Present even on 'error' records (the pick row is known when the
   *  series isn't); absent when any leg can't contribute the field
   *  (a stock leg has no iv → the position's entryIv is absent). */
  entryDelta?: number;
  entryIv?: number;

  /** Terminal-side values resolved per outcome — the exit bar for
   *  'exit', the expiry bar for 'expired', the last series bar for
   *  'open'. `terminalMark` is the mark the outcome's economics resolved
   *  at (exitPrice / intrinsicAtExpiry / last-bar mark) so a row's
   *  terminalMark − entryMark always equals its displayed mark change.
   *  Delta/IV absent when the terminal observation carries no greeks;
   *  all three absent on 'error' records and pre-v2 docs. */
  terminalMark?: number;
  terminalDelta?: number;
  terminalIv?: number;

  /** Calendar days pickDate → exit/expiry; `0` on error records. */
  daysHeld: number;

  /** Excursion over this rule's own hold window (entry → exit/expiry).
   *  Error records (no series fetched) carry the entry-day placeholder
   *  `{ value: entryMark, date: pickDate }` — "no excursion observed" — so
   *  consumers never handle absent excursion data. Aggregates must still
   *  exclude error records from excursion stats. */
  mae: ExcursionPoint;
  mfe: ExcursionPoint;

  /** Intraday first-fire evidence written by the per-tick shadow-eval
   *  (#1713): ISO timestamp of the mark tick that first crossed this rule
   *  + the order-exit-price mark at that tick. Sticky once set — ticks and
   *  the EOD scan carry it forward; absent on series-only records (the
   *  scan's day-grain exitDate is its own fire evidence). */
  firstFiredAt?: string;
  firstFiredMark?: number;
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
  /** True when the position expired with net intrinsic value —
   *  `intrinsicAtExpiry > 0` in posture-normalized space (#1500). For a
   *  1-leg pick this is exactly the per-contract ITM test on the
   *  position's own side (short put ITM → loss; long put ITM → gain);
   *  for multi-leg positions it reads "the package settled worth
   *  something". Per-leg ITM flags don't generalize. */
  expiredItm: boolean;
  /** Signed net settlement at the position's last expiry, in the
   *  record's posture space — option legs at intrinsic, stock legs at
   *  their underlying close. 1-leg = the contract's intrinsic verbatim
   *  (v1 parity). */
  intrinsicAtExpiry: number;
  /** The CLOSEST option leg's distance-to-money at its own expiry —
   *  |strike − underlyingClose| / underlyingClose × 100 (the leg
   *  nearest the money drives assignment risk). 1-leg = v1 value. NB:
   *  the manage-exit-scan pass (#1544) takes the FARTHEST leg — the
   *  divergence is tracked in the #1500 code review. */
  assignmentDistancePct: number;
}

/** The contract's series could not be fetched OR ends before the expiry
 *  bar while expiry has already passed (truncated corpus) — carries no
 *  exit/expiry semantics; `daysHeld: 0` and mae/mfe = entry-day
 *  placeholder. A series ending early while expiry is still in the
 *  FUTURE is a live position — 'open', not 'error'. */
export interface AnalysisErrorTrade extends AnalysisTradeBase {
  outcome: 'error';
  error: string;
}

/** No rule fired AND the position is still live — the series' last bar
 *  predates expiry only because expiry hasn't happened yet (#1431: a
 *  future-expiry contract can never reach its expiry bar; recording it
 *  as 'error' inflated errorCount and lied in the event table). Carries
 *  the rule's real excursion + days-held-so-far — live data, not
 *  placeholders. Aggregates exclude open records from hit-rate
 *  denominators (an open position is no evidence about the exit rule). */
export interface AnalysisOpenTrade extends AnalysisTradeBase {
  outcome: 'open';
  /** Last observed series bar — the "as of" stamp for the open
   *  position (YYYY-MM-DD). */
  lastBarDate: string;
}

/**
 * One (contract-row × exit-strategy) outcome — discriminated on `outcome`;
 * consumers narrow on the tag.
 */
export type AnalysisTradeRecord =
  | AnalysisExitTrade
  | AnalysisExpiredTrade
  | AnalysisOpenTrade
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
  /** Positions still live (expiry in the future at analysis time). */
  openCount: number;
  errorCount: number;
  /** hitCount / (contractCount − errorCount − openCount) × 100 — PERCENT
   *  convention; absent when the denominator is 0. The numerator is
   *  per-strategy: exitedCount for firing rules, expiredCount for
   *  hold-to-expiry (reaching expiry IS its "hit" — #1431). */
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

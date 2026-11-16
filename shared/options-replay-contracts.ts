/**
 * Shared contracts for Selection Replay (Topic #1238, Thread #1240).
 *
 * A selection replay run is ONE (template, symbol, startDate) selection —
 * submitting N symbols creates N independent runs (#1430). A run fetches
 * the SA Pick Document for the template's coordinate and persists a
 * Contract List — one row per trading day, either a pick or an explicit
 * no-selection marker. Pure types; importable by both the Angular
 * frontend and Firebase functions.
 *
 * Timestamps are ISO strings at the shared layer (BE writers stamp
 * FieldValue server-side; the read shape here is what FE/BE consumers see).
 */

import { OptionType } from './options-common';
import { TradeSide } from './common';

// ==========================
// Templates
// ==========================

/** Expiration selector inside a pick-doc coordinate. */
export interface PickDocExpiry {
  mode: 'nearestDte';
  dte: number;
}

/** Pick-doc coordinate — the SA grid cell a template maps to. */
export interface PickDocCoordinate {
  type: OptionType;
  /** Signed delta target matching SA's convention (e.g. -0.20 for puts). */
  targetDelta: number;
  expiry: PickDocExpiry;
}

// ==========================
// Pick-doc grid
// ==========================

/**
 * The fixed pick-doc grid menu (Thread #1270 catalog): |Δ| 5–95 in steps
 * of `PICK_GRID_DELTA_STEP`, DTEs from `PICK_GRID_DTES`. Leg coordinates,
 * template-shape bands, and the registry validator (#1494) all resolve
 * against this menu — a leg is "on-grid" when |targetDelta| is a step
 * multiple inside [5, 95] and `dte` is a member of the menu.
 */
export const PICK_GRID_DTES: readonly number[] = [7, 14, 21, 30, 45, 60, 90, 120, 180, 365];

/** |Δ|% step between adjacent grid cells (5 → magnitudes 5,10,…,95). */
export const PICK_GRID_DELTA_STEP = 5;

/** |Δ|% bounds of the grid — magnitudes only; sign comes from option type. */
export const PICK_GRID_DELTA_BAND: readonly [number, number] = [5, 95];

/**
 * A curated time-based selection template. `side` stamps direction onto rows
 * at write time — pick docs are direction-neutral, so the same coordinate can
 * serve STO and BTO templates.
 */
export interface ReplayTemplate {
  /** Stable id, e.g. 'csp-45-20'. */
  id: string;
  /** Display name, e.g. '45DTE 20Δ put (CSP)'. */
  name: string;
  description: string;
  side: TradeSide;
  coordinate: PickDocCoordinate;
}

// ==========================
// Variant legs (Thread #1270 — Multi-leg Templates)
// ==========================

/**
 * Concrete option leg — a resolved pick-doc coordinate plus direction.
 * The same shape is the engine's concrete leg coordinate: `dte` replaces
 * the `dteMin`/`dteMax` window on pick-doc-driven configs. A bare template
 * leg carries bands instead; see `TemplateShapeLeg` (#1492).
 */
export interface OptionLeg {
  kind: 'option';
  type: OptionType;
  /** Signed delta target matching SA's convention (e.g. -0.20 for puts).
   *  Sign-vs-`type` parity and on-grid `dte` are NOT enforced here —
   *  they're data-carried conventions; the registry validator (#1494)
   *  and the #1498 request boundary enforce them. */
  targetDelta: number;
  /** Calendar days — one of the pick-doc grid's DTE cells. */
  dte: number;
  side: TradeSide;
}

/** Stock leg — no pick doc; marks at the underlying close. */
export interface StockLeg {
  kind: 'stock';
  side: TradeSide;
}

/** One leg of a variant — an option pick or a share of the underlying. */
export type VariantLeg = OptionLeg | StockLeg;

/** Map an option leg to its pick-doc coordinate — the single place the
 *  leg → coordinate derivation lives, so historical replay and live
 *  selection can't diverge. */
export function legToPickDocCoordinate(leg: OptionLeg): PickDocCoordinate {
  return {
    type: leg.type,
    targetDelta: leg.targetDelta,
    expiry: { mode: 'nearestDte', dte: leg.dte },
  };
}

/** Inverse of `legToPickDocCoordinate` — a legacy `ReplayTemplate` viewed
 *  as a 1-leg option leg. The migration shim resolving `templateId` runs
 *  to 1-leg variants goes through this (#1498). */
export function templateToOptionLeg(template: ReplayTemplate): OptionLeg {
  return {
    kind: 'option',
    type: template.coordinate.type,
    targetDelta: template.coordinate.targetDelta,
    dte: template.coordinate.expiry.dte,
    side: template.side,
  };
}

/**
 * A concrete, named, reusable configuration — `legs` are the recipe;
 * id/name are labels. Registry entries live in
 * `shared/options-replay-templates.ts` (#1492).
 */
export interface ReplayVariant {
  /** Stable id, e.g. 'pcs-45-20-10'. */
  id: string;
  /** Display name, e.g. '45DTE 20/10Δ put credit spread'. */
  name: string;
  description: string;
  /** Which template shape it was composed from, or 'custom'. */
  structure?: string;
  /** Concrete legs — every option leg has Δ/DTE pinned. Registry data —
   *  readonly so an importer can't mutate the shared curated array. */
  legs: readonly VariantLeg[];
}

/**
 * Variant as stamped on the run doc — self-describing, so later registry
 * edits can't rewrite history. The worker reads this, never the registry.
 */
export interface VariantSnapshot {
  /** Registry id when the run came from a named variant; absent for
   *  inline `legs` submissions. */
  variantId?: string;
  name: string;
  /** Stamped to the run doc — never mutated after write. readonly also
   *  keeps `variant.legs` assignable here without a copy (#1498). */
  legs: readonly VariantLeg[];
}

// ==========================
// SA Pick Document (wire shape)
// ==========================

/** One trading day's pick inside a PickDocument. Field-for-field identical to
 *  SA's `DayPick` (av-proxy-api shared/options/options-delta-picks.types.ts). */
export interface PickDocDay {
  underlyingClose: number;
  contractId: string;
  expiration: string;
  dte: number;
  strike: number;
  delta: number;
  iv: number;
  mark: number;
  bid: number;
  ask: number;
  volume: number;
  openInterest: number;
}

/** SA miss statuses — explicit no-pick entries inside the `days` map.
 *  `no_chain` = no corpus chain for that date (self-repairs upstream when the
 *  chain is later seeded); `no_match` = chain present but nothing selectable
 *  for this cell. */
export type PickDocMissStatus = 'no_chain' | 'no_match';

/** An explicit miss entry — mirrors SA's `DayMiss`. `underlyingClose` is
 *  present whenever an adjusted close exists for the date. */
export interface PickDocMiss {
  status: PickDocMissStatus;
  underlyingClose?: number;
  reason?: string;
}

/** One trading day's entry — a picked contract or an explicit miss. A pick
 *  entry carries no `status` field; presence of `contractId` means pick. */
export type PickDocDayEntry = PickDocDay | PickDocMiss;

/** Narrow a day entry to a pick — `contractId` is present only on picks.
 *  Mirrors SA's `isPickEntry` (null-safe, not just key presence). */
export function isPickDocPick(entry: PickDocDayEntry): entry is PickDocDay {
  return 'contractId' in entry && entry.contractId != null;
}

/** SA pick doc — one grid cell-year shard: the coordinate plus symbol, grid
 *  metadata, and day map. Matches SA's `CellYearDoc` (the storage doc is the
 *  wire contract; `updatedAt` is stamped by SA's materialization writer and
 *  passed through by the endpoint). */
export interface PickDocument extends PickDocCoordinate {
  symbol: string;
  gridVersion: number;
  firstDate: string;
  lastDate: string;
  pickCount: number;
  missCount: number;
  /** Trading date → pick or explicit miss. Every trading day in
   *  [firstDate, lastDate] carries an entry; absent keys are treated as
   *  no-selection defensively. */
  days: Record<string, PickDocDayEntry>;
  /** Server stamp — ISO string on the wire. */
  updatedAt?: string;
}

// ==========================
// Contract List
// ==========================

/**
 * Why a trading day produced no pick. Maps SA day-entry statuses:
 * 'miss' = SA `no_match` (chain existed, no contract met the criteria);
 * 'gap' = SA `no_chain` (market data hole — self-repairs upstream);
 * 'out-of-range' = past the doc's lastDate. Optional — writers populate when
 * the cause is known.
 */
export type NoSelectionReason = 'miss' | 'gap' | 'out-of-range';

/**
 * A day's pick. Extends the PickDocDay wire shape verbatim so SA field
 * changes propagate instead of silently drifting; `entryDate` is the map key
 * promoted to a field, `side` is stamped from the template, and
 * `repeatsPrevious` flags that the immediately preceding row picked the same
 * contractId (each repeated pick is still a distinct position entry).
 */
export interface ContractListPickRow extends PickDocDay {
  kind: 'pick';
  entryDate: string;
  side: TradeSide;
  repeatsPrevious: boolean;
}

/** Explicit marker for a trading day with no pick — never omitted. */
export interface ContractListNoSelectionRow {
  kind: 'no-selection';
  entryDate: string;
  reason?: NoSelectionReason;
}

/** One contract-list row — the day's pick or an explicit no-selection marker. */
export type ContractListRow = ContractListPickRow | ContractListNoSelectionRow;

/** Pick-doc provenance recorded on each list doc. */
export interface PickDocMeta {
  coordinate: PickDocCoordinate;
  gridVersion: number;
  pickCount: number;
  missCount: number;
  firstDate: string;
  lastDate: string;
}

// ==========================
// Firestore doc shapes
// ==========================

/** Run status vocabulary — mirrors BacktestRunStatus values. */
export type OptionsReplayRunStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
export const OPTIONS_REPLAY_RUN_STATUSES: readonly OptionsReplayRunStatus[] = [
  'pending',
  'running',
  'completed',
  'failed',
  'cancelled',
];

/** List-doc status vocabulary — mirrors BacktestPermutationStatus values. */
export type OptionsContractListStatus = 'pending' | 'running' | 'success' | 'failed';
export const OPTIONS_CONTRACT_LIST_STATUSES: readonly OptionsContractListStatus[] = [
  'pending',
  'running',
  'success',
  'failed',
];

/**
 * Run header — st-options-replay-runs/{runId}. A run is ONE (template,
 * symbol, startDate) selection: submitting N symbols to
 * `optionsReplayStart` creates N independent run docs — the multi-symbol
 * input is convenience fanout, not a batch (no grouping field, #1430).
 * The runId embeds the symbol (`{runIdPT}_{rand}_{SYMBOL}`), and the run's
 * status IS its contract list's status — the worker's terminal list
 * outcome writes the run's terminal status directly.
 */
export interface OptionsReplayRun {
  runId: string;
  /** Resolved registry id. #1498 decides how legs-form runs (no registry
   *  entry) carry identity — likely `variantSnapshot`, not an absent
   *  templateId. */
  templateId: string;
  symbol: string;
  startDate: string;
  status: OptionsReplayRunStatus;
  /** Self-describing variant the run resolved to — stamped at start so
   *  later registry edits can't rewrite history. Absent on runs created
   *  before the variant model (#1498 wires stamping). */
  variantSnapshot?: VariantSnapshot;
  /** ISO timestamps — BE writes FieldValue server-side. */
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
  error?: string;
}

/** Contract list — st-options-contract-lists/{runId} (docId IS the runId;
 *  run and list are 1:1 by construction). */
export interface OptionsContractListDoc {
  runId: string;
  symbol: string;
  /** Registry id the run resolved to. A failed stub written when the
   *  run doc itself is missing may omit it — merge-writes are Partial. */
  templateId: string;
  status: OptionsContractListStatus;
  rows: ContractListRow[];
  pickDocMeta: PickDocMeta;
  /** ISO timestamp. */
  generatedAt: string;
  error?: string;
}

// ==========================
// Callable + task payloads
// ==========================

/** Fields shared by every optionsReplayStart request form. */
interface OptionsReplayStartBase {
  symbols: string[];
  startDate: string; // YYYY-MM-DD
}

/** Form 1 — a named variant from the code-curated registry. */
export interface OptionsReplayStartVariantRequest extends OptionsReplayStartBase {
  variantId: string;
  legs?: never;
  templateId?: never;
  variantName?: never;
}

/** Form 2 — inline concrete legs composed by the spread builder.
 *  `legs: []` typechecks today (the runtime rejects every legs form
 *  until #1498); the non-empty/stock-only policy lands with #1498's
 *  boundary validation. */
export interface OptionsReplayStartLegsRequest extends OptionsReplayStartBase {
  legs: readonly VariantLeg[];
  /** Display-only label carried onto the run's snapshot — an inline
   *  submission has no registry name to borrow. */
  variantName?: string;
  variantId?: never;
  templateId?: never;
}

/** Legacy form — the v1 single-template picker, resolved to its 1-leg
 *  variant server-side. Retired once the builder dialog ships (#1507). */
export interface OptionsReplayStartTemplateRequest extends OptionsReplayStartBase {
  templateId: string;
  variantId?: never;
  legs?: never;
  variantName?: never;
}

/**
 * Request shape for the optionsReplayStart callable — exactly one of
 * `variantId` / `legs` / `templateId` identifies the variant. The three
 * forms are mutually exclusive in the type.
 */
export type OptionsReplayStartRequest =
  | OptionsReplayStartVariantRequest
  | OptionsReplayStartLegsRequest
  | OptionsReplayStartTemplateRequest;

/** One runId per submitted symbol — each is an independent run doc. */
export interface OptionsReplayStartResponse {
  runIds: string[];
}

/** Cloud Task payload — one per run (each run is a single symbol, #1430).
 *  Just the identity: every selection input (symbol included) is read
 *  off the run doc, so a stale payload can't disagree with it.
 *  `symbol` rides along solely so the worker can still label a
 *  meaningful failed list doc when the run doc itself is gone —
 *  the data path uses `run.symbol`. */
export interface OptionsReplayPermutationPayload {
  runId: string;
  symbol: string;
}

/** optionsReplayRetry — re-runs a failed single-symbol run in place
 *  (Thread #1266, task #1369; single-symbol model #1430). */
export interface OptionsReplayRetryRequest {
  runId: string;
}

export interface OptionsReplayRetryResponse {
  /** The retried run's symbol, or `null` when the call was a no-op
   *  (run not `failed`). */
  retriedSymbol: string | null;
}

/** optionsReplayDelete — cascade-deletes a run, its 1:1 contract list
 *  (docId == runId), and every analysis-result doc keyed off it
 *  (`contractListDocId == runId`). Idempotent: missing docs count as
 *  already-deleted, not errors (task #1439). */
export interface OptionsReplayDeleteRequest {
  runId: string;
}

export interface OptionsReplayDeleteResponse {
  /** True when the run doc existed and was deleted. */
  deletedRun: boolean;
  /** Contract-list docs deleted (0 or 1 — the model is 1:1). */
  deletedLists: number;
  /** st-options-analysis-results docs deleted. */
  deletedResults: number;
}

/**
 * Shared contracts for Selection Replay (Topic #1238, Thread #1240).
 *
 * A selection replay applies a named template to symbols + a start date,
 * fetches the SA Pick Document for the template's coordinate, and persists a
 * per-symbol Contract List — one row per trading day, either a pick or an
 * explicit no-selection marker. Pure types; importable by both the Angular
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

/** Run header — st-options-replay-runs/{runId}. */
export interface OptionsReplayRun {
  runId: string;
  templateId: string;
  symbols: string[];
  startDate: string;
  status: OptionsReplayRunStatus;
  totalLists: number;
  completedLists: number;
  failedLists: number;
  /** ISO timestamps — BE writes FieldValue server-side. */
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
  error?: string;
}

/** Per-symbol payload — st-options-contract-lists/{runId}_{symbol}. */
export interface OptionsContractListDoc {
  runId: string;
  symbol: string;
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

/** Request shape for the optionsReplayStart callable. */
export interface OptionsReplayStartRequest {
  templateId: string;
  symbols: string[];
  startDate: string; // YYYY-MM-DD
}

export interface OptionsReplayStartResponse {
  runId: string;
}

/** Cloud Task payload — one per symbol per run. */
export interface OptionsReplayPermutationPayload {
  runId: string;
  symbol: string;
  templateId: string;
  startDate: string;
}

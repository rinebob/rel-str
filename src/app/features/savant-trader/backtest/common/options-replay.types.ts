/**
 * Selection Replay UI types.
 *
 * UI-facing shapes for `st-options-replay-runs` and
 * `st-options-contract-lists` docs — the shared contracts with
 * Firestore timestamps flattened to ISO strings (same convention as
 * `backtest.types.ts`).
 */

import type {
  ContractListRow,
  OptionsContractListStatus,
  OptionsReplayRun,
  OptionsReplayRunStatus,
  PickDocMeta,
} from '@options-replay/contracts';
import type { BacktestSortDirection } from './backtest.types';

export type { ContractListRow, OptionsContractListStatus, OptionsReplayRunStatus, PickDocMeta };

/** Run header — UI view of `st-options-replay-runs/{runId}`. */
export interface OptionsReplayRunUi {
  runId: string;
  templateId: string;
  symbols: string[];
  startDate: string;
  status: OptionsReplayRunStatus;
  totalLists: number;
  completedLists: number;
  failedLists: number;
  /** Per-symbol list outcome stamped by the worker. Absent on legacy runs —
   *  absent entries derive as 'pending'. */
  listOutcomes?: OptionsReplayRun['listOutcomes'];
  createdAtIso: string;
  updatedAtIso?: string;
  completedAtIso?: string;
  error?: string;
}

/** Per-symbol contract list — UI view of `st-options-contract-lists/{runId}_{symbol}`. */
export interface OptionsContractListUi {
  listId: string;
  runId: string;
  symbol: string;
  templateId: string;
  status: OptionsContractListStatus;
  rows: ContractListRow[];
  /** Present on `success` docs only — the worker stamps it with the rows. */
  pickDocMeta?: PickDocMeta;
  generatedAtIso?: string;
  error?: string;
}

// ==========================
// Run-list rows + filters
// ==========================

/** Symbol-level outcome for a run-list row — the listOutcomes vocabulary
 *  plus 'pending' when the run doc hasn't recorded an outcome yet. */
export type ReplaySymbolStatus = 'pending' | 'success' | 'failed';

/** One row per (runId, symbol) — the unit the replay run list renders. */
export interface ReplayListRow {
  runId: string;
  symbol: string;
  templateId: string;
  startDate: string;
  createdAtIso: string;
  runStatus: OptionsReplayRunStatus;
  symbolStatus: ReplaySymbolStatus;
  /** Run-level progress counters carried onto each row for display. */
  completedLists: number;
  failedLists: number;
  totalLists: number;
}

/** Selection state — a run always carries its runId; the symbol is present
 *  only for row-level selection (run-level selection stores null). */
export interface ReplaySelection {
  runId: string;
  symbol: string | null;
}

/** Status filter composes on the row's symbolStatus, not the run status. */
export type ReplayStatusFilter = 'all' | ReplaySymbolStatus;
export type ReplaySortBy = 'createdAt' | 'startDate' | 'symbol';
export type ReplaySortDirection = BacktestSortDirection;

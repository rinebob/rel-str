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
  OptionsReplayRunStatus,
  PickDocMeta,
} from '@options-replay/contracts';
import type { BacktestSortDirection } from './backtest.types';

export type { ContractListRow, OptionsContractListStatus, OptionsReplayRunStatus, PickDocMeta };

/** Run header — UI view of `st-options-replay-runs/{runId}`. A run is ONE
 *  (template, symbol, startDate) selection (#1430) — its status IS its
 *  contract list's status. */
export interface OptionsReplayRunUi {
  runId: string;
  templateId: string;
  symbol: string;
  startDate: string;
  status: OptionsReplayRunStatus;
  createdAtIso: string;
  updatedAtIso?: string;
  completedAtIso?: string;
  error?: string;
}

/** Per-run contract list — UI view of `st-options-contract-lists/{runId}`
 *  (listId IS the runId under single-symbol runs). */
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

/** Row status vocabulary — the run's status with 'completed' mapped
 *  to 'success' (the contract-list vocabulary the row presents). */
export type ReplayRowStatus = 'pending' | 'running' | 'success' | 'failed' | 'cancelled';

/** One row per run — runs are single-symbol (#1430), so a row IS a run. */
export interface ReplayListRow {
  runId: string;
  symbol: string;
  templateId: string;
  startDate: string;
  createdAtIso: string;
  status: ReplayRowStatus;
}

/** Selection state — a row IS a run (#1430), so selection is just its
 *  runId; the symbol is always derivable from the run doc. */
export type ReplaySelection = string;

/** Status filter composes on the row's mapped status. */
export type ReplayStatusFilter = 'all' | ReplayRowStatus;
export type ReplaySortBy = 'createdAt' | 'startDate' | 'symbol';
export type ReplaySortDirection = BacktestSortDirection;

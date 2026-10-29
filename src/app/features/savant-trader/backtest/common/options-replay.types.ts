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

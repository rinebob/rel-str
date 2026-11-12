/**
 * Options Replay Run List Component
 *
 * Per-run rows table for the Selection Replay section — one row per run
 * doc (runs are single-symbol, #1430) derived upstream by
 * OptionsReplayStore.runRows / filteredRows. Rows are self-contained
 * (#1471 detail-panel removal): each row carries its feature actions —
 * Contracts (dialog), Analyze/Re-analyze, View Results — resolved from
 * the collection-wide contract-list and analysis-result state, plus the
 * run-level rerun (failed rows) and delete actions.
 */
import { Component, input, output, ChangeDetectionStrategy, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';

import type { OptionsContractListUi, ReplayListRow } from '../../common/options-replay.types';
import { getReplayTemplate } from '@options-replay/templates';
import { getBacktestStatusVisuals, formatBacktestTimestamp, formatBacktestRunId } from '../../utils/backtest.utils';
import { AppRoutes } from '../../../../../core/common/interfaces';

/** View model that pre-computes all display values for a run row. */
export interface OptionsReplayRunRow extends ReplayListRow {
  formattedRunId: string;
  formattedCreated: string;
  startDateText: string;
  templateName: string;
  statusColorName: string;
  statusIconName: string;
  /** The run's contract-list doc — null until the worker writes it. */
  list: OptionsContractListUi | null;
  /** A list doc exists — the dialog can render it (any status). */
  canViewContracts: boolean;
  /** List succeeded — analysis input exists. */
  canAnalyze: boolean;
  /** ≥1 success result doc — View Results routes to the analysis page. */
  hasResults: boolean;
  /** optionsAnalysisStart in flight for this row's list. */
  analyzing: boolean;
  /** '/options/strategy/backtest/analysis/{listDocId}' — rendered only
   *  when `hasResults` (the @if guards the link). */
  analysisLink: string;
  /** status === 'failed' — the rerun affordance exists only there. */
  showRerun: boolean;
  /** A retry already dispatched — the BE only retries `failed` runs, so
   *  the in-flight flag is the only disable that can apply here. */
  rerunDisabled: boolean;
  /** A delete already dispatched — holds until the run leaves the
   *  snapshot (or the call errors). */
  deleteDisabled: boolean;
}

@Component({
  selector: 'app-options-replay-run-list',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, RouterLink],
  templateUrl: './options-replay-run-list.component.html',
  styleUrl: './options-replay-run-list.component.scss',
})
export class OptionsReplayRunListComponent {
  /** Route template for a row's analysis-results page — the row swaps
   *  the `:listDocId` segment for its runId (listId IS runId, #1430). */
  private readonly analysisPath = AppRoutes.STRATEGY_BACKTEST_ANALYSIS;

  /** Derived run rows — store-side runRows/filteredRows. */
  readonly rows = input<ReplayListRow[]>([]);
  /** listId → contract-list doc — the row's Contracts/Analyze state. */
  readonly contractLists = input<ReadonlyMap<string, OptionsContractListUi>>(new Map());
  /** List docIds with ≥1 success analysis result doc — flips Analyze
   *  to View Results. */
  readonly analysisReadyListIds = input<ReadonlySet<string>>(new Set());
  /** List docIds with an in-flight optionsAnalysisStart call. */
  readonly analyzingListIds = input<ReadonlySet<string>>(new Set());
  readonly isLoading = input<boolean>(false);
  /** True when the store's filters are narrowing the row set — the empty
   *  state then reads as a filter miss, not an empty surface. */
  readonly hasActiveFilters = input<boolean>(false);
  /** Runs with an in-flight retry — the row's rerun action stays
   *  disabled until the store clears the flag (or the run doc flips
   *  back to running and hides it outright). */
  readonly retryingRunIds = input<ReadonlySet<string>>(new Set());
  /** Runs with an in-flight delete — the row's delete action stays
   *  disabled until the run doc leaves the snapshot (#1439). */
  readonly deletingRunIds = input<ReadonlySet<string>>(new Set());

  /** View Contracts — emits runId; the parent opens the list dialog. */
  readonly viewContracts = output<string>();
  /** Analyze/Re-analyze — emits the list docId (== runId, #1430). */
  readonly analyze = output<string>();
  /** Re-run a failed run — emits runId. */
  readonly rerun = output<string>();
  /** Delete a run (cascade run + list + results) — emits runId; the
   *  parent confirms before calling the store (#1439). */
  readonly deleteRun = output<string>();

  readonly viewRows = computed((): OptionsReplayRunRow[] => {
    const lists = this.contractLists();
    const ready = this.analysisReadyListIds();
    const analyzing = this.analyzingListIds();
    const retrying = this.retryingRunIds();
    const deleting = this.deletingRunIds();
    return this.rows().map((row) => {
      const list = lists.get(row.runId) ?? null;
      return {
        ...row,
        formattedRunId: formatBacktestRunId(row.runId),
        formattedCreated: formatBacktestTimestamp(row.createdAtIso),
        startDateText: row.startDate || '—',
        templateName: getReplayTemplate(row.templateId)?.name ?? row.templateId,
        statusColorName: getBacktestStatusVisuals(row.status).color,
        statusIconName: getBacktestStatusVisuals(row.status).icon,
        list,
        canViewContracts: list !== null,
        canAnalyze: list?.status === 'success',
        hasResults: ready.has(row.runId),
        analyzing: analyzing.has(row.runId),
        analysisLink: `/${this.analysisPath.replace(':listDocId', row.runId)}`,
        showRerun: row.status === 'failed',
        rerunDisabled: retrying.has(row.runId),
        deleteDisabled: deleting.has(row.runId),
      };
    });
  });

  onViewContracts(row: OptionsReplayRunRow): void {
    this.viewContracts.emit(row.runId);
  }

  onAnalyze(row: OptionsReplayRunRow): void {
    this.analyze.emit(row.runId);
  }

  onRerun(row: OptionsReplayRunRow): void {
    this.rerun.emit(row.runId);
  }

  /** Confirmation happens upstream (dashboard), keeping this component
   *  a dumb view. */
  onDelete(row: OptionsReplayRunRow): void {
    this.deleteRun.emit(row.runId);
  }
}

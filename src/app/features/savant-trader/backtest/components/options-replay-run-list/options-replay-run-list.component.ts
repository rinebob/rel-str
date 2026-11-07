/**
 * Options Replay Run List Component
 *
 * Per-run rows table for the Selection Replay section — one row per run
 * doc (runs are single-symbol, #1430) derived upstream by
 * OptionsReplayStore.runRows / filteredRows. Shows the run's status
 * ('completed' presented as 'success'), run ID, created timestamp, and
 * template name (resolved from the shared REPLAY_TEMPLATES registry).
 * Row click emits the runId. Failed rows get a rerun action (`rerun`
 * output) that re-queues the run via `optionsReplayRetry`;
 * `retryingRunIds` disables it while a retry is in flight. Every row
 * gets a delete action (`deleteRun` output, #1439) — the parent
 * confirms, then `optionsReplayDelete` cascades run + list + results;
 * `deletingRunIds` disables it while a delete is in flight.
 */
import { Component, input, output, ChangeDetectionStrategy, computed } from '@angular/core';
import { CommonModule } from '@angular/common';

import type { ReplayListRow, ReplaySelection } from '../../common/options-replay.types';
import { getReplayTemplate } from '@options-replay/templates';
import { getBacktestStatusVisuals, formatBacktestTimestamp, formatBacktestRunId } from '../../utils/backtest.utils';

/** View model that pre-computes all display values for a run row. */
export interface OptionsReplayRunRow extends ReplayListRow {
  formattedRunId: string;
  formattedCreated: string;
  startDateText: string;
  templateName: string;
  statusColorName: string;
  statusIconName: string;
  isSelected: boolean;
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
  imports: [CommonModule],
  templateUrl: './options-replay-run-list.component.html',
  styleUrl: './options-replay-run-list.component.scss',
})
export class OptionsReplayRunListComponent {
  /** Derived run rows — store-side runRows/filteredRows. */
  readonly rows = input<ReplayListRow[]>([]);
  readonly selectedRunId = input<string | null>(null);
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

  readonly selectRow = output<ReplaySelection>();
  /** Re-run a failed run — emits runId. */
  readonly rerun = output<string>();
  /** Delete a run (cascade run + list + results) — emits runId; the
   *  parent confirms before calling the store (#1439). */
  readonly deleteRun = output<string>();

  readonly viewRows = computed((): OptionsReplayRunRow[] => {
    const selRunId = this.selectedRunId();
    const retrying = this.retryingRunIds();
    const deleting = this.deletingRunIds();
    return this.rows().map((row) => ({
      ...row,
      formattedRunId: formatBacktestRunId(row.runId),
      formattedCreated: formatBacktestTimestamp(row.createdAtIso),
      startDateText: row.startDate || '—',
      templateName: getReplayTemplate(row.templateId)?.name ?? row.templateId,
      statusColorName: getBacktestStatusVisuals(row.status).color,
      statusIconName: getBacktestStatusVisuals(row.status).icon,
      isSelected: selRunId === row.runId,
      showRerun: row.status === 'failed',
      rerunDisabled: retrying.has(row.runId),
      deleteDisabled: deleting.has(row.runId),
    }));
  });

  onSelect(row: ReplayListRow): void {
    this.selectRow.emit(row.runId);
  }

  /** Row action — the button lives inside the clickable row, so swallow
   *  the click or it would also select the row. */
  onRerun(row: ReplayListRow, event: Event): void {
    event.stopPropagation();
    this.rerun.emit(row.runId);
  }

  /** Row action — the button lives inside the clickable row, so swallow
   *  the click or it would also select the row. Confirmation happens
   *  upstream (dashboard), keeping this component a dumb view. */
  onDelete(row: ReplayListRow, event: Event): void {
    event.stopPropagation();
    this.deleteRun.emit(row.runId);
  }
}

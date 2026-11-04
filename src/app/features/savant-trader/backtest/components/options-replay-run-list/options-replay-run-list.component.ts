/**
 * Options Replay Run List Component
 *
 * Per-symbol rows table for the Selection Replay section — one row per
 * (runId, symbol) derived upstream by OptionsReplayStore.runRows /
 * filteredRows. Shows symbol-level status (from the run's listOutcomes),
 * run ID, created timestamp, template name (resolved from the shared
 * REPLAY_TEMPLATES registry), and run-level progress context with a
 * failed badge. Row click emits the (runId, symbol) pair.
 */
import { Component, input, output, ChangeDetectionStrategy, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';

import type { ReplayListRow, ReplaySelection } from '../../common/options-replay.types';
import { getReplayTemplate } from '@options-replay/templates';
import { getBacktestStatusVisuals, formatBacktestTimestamp, formatBacktestRunId } from '../../utils/backtest.utils';

/** View model that pre-computes all display values for a per-symbol row. */
export interface OptionsReplaySymbolListRow extends ReplayListRow {
  formattedRunId: string;
  formattedCreated: string;
  startDateText: string;
  templateName: string;
  symbolStatusColorName: string;
  symbolStatusIconName: string;
  progressText: string;
  progressCompletedPercent: number;
  progressFailedPercent: number;
  isSelected: boolean;
}

@Component({
  selector: 'app-options-replay-run-list',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, MatIconModule, MatTooltipModule],
  templateUrl: './options-replay-run-list.component.html',
  styleUrl: './options-replay-run-list.component.scss',
})
export class OptionsReplayRunListComponent {
  /** Derived per-symbol rows — store-side runRows/filteredRows. */
  readonly rows = input<ReplayListRow[]>([]);
  readonly selectedRunId = input<string | null>(null);
  readonly selectedSymbol = input<string | null>(null);
  readonly isLoading = input<boolean>(false);
  /** True when the store's filters are narrowing the row set — the empty
   *  state then reads as a filter miss, not an empty surface. */
  readonly hasActiveFilters = input<boolean>(false);

  readonly selectRow = output<ReplaySelection>();

  readonly viewRows = computed((): OptionsReplaySymbolListRow[] => {
    const selRunId = this.selectedRunId();
    const selSymbol = this.selectedSymbol();
    return this.rows().map((row) => ({
      ...row,
      formattedRunId: formatBacktestRunId(row.runId),
      formattedCreated: formatBacktestTimestamp(row.createdAtIso),
      startDateText: row.startDate || '—',
      templateName: getReplayTemplate(row.templateId)?.name ?? row.templateId,
      symbolStatusColorName: getBacktestStatusVisuals(row.symbolStatus).color,
      symbolStatusIconName: getBacktestStatusVisuals(row.symbolStatus).icon,
      progressText: this.buildProgressText(row),
      progressCompletedPercent: this.buildProgressCompletedPercent(row),
      progressFailedPercent: this.buildProgressFailedPercent(row),
      isSelected: selRunId === row.runId && selSymbol === row.symbol,
    }));
  });

  onSelect(row: ReplayListRow): void {
    this.selectRow.emit({ runId: row.runId, symbol: row.symbol });
  }

  private buildProgressText(row: ReplayListRow): string {
    const total = row.totalLists || 0;
    if (total === 0) return '—';
    return `${row.completedLists || 0} / ${total}`;
  }

  private buildProgressCompletedPercent(row: ReplayListRow): number {
    const total = row.totalLists || 0;
    if (total === 0) return 0;
    return Math.round(((row.completedLists || 0) / total) * 100);
  }

  private buildProgressFailedPercent(row: ReplayListRow): number {
    const total = row.totalLists || 0;
    if (total === 0) return 0;
    return Math.round(((row.failedLists || 0) / total) * 100);
  }
}

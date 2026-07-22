/**
 * Backtest Run List Component
 *
 * Sortable/filtered table of backtest runs. Displays status, run ID,
 * created timestamp, strategy, progress, report tier, and quality designation.
 */
import { Component, input, output, ChangeDetectionStrategy, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';

import type { BacktestRunUi } from '../../common/backtest.types';
import { getBacktestStatusVisuals, formatBacktestTimestamp, formatBacktestDuration, formatBacktestRunId } from '../../utils/backtest.utils';

/** View model that pre-computes all display values for the run list row. */
export interface BacktestRunListRow extends BacktestRunUi {
  formattedRunId: string;
  formattedCreated: string;
  formattedDuration: string;
  statusColorName: string;
  statusIconName: string;
  progressText: string;
  progressCompletedPercent: number;
  progressFailedPercent: number;
}

@Component({
  selector: 'app-backtest-run-list',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, MatIconModule, MatTooltipModule],
  templateUrl: './backtest-run-list.component.html',
  styleUrl: './backtest-run-list.component.scss',
})
export class BacktestRunListComponent {
  readonly runs = input<BacktestRunUi[]>([]);
  readonly selectedRunId = input<string | null>(null);
  readonly hasActiveFilters = input<boolean>(false);

  readonly selectRun = output<string>();

  readonly viewRuns = computed((): BacktestRunListRow[] => {
    return this.runs().map((run) => ({
      ...run,
      formattedRunId: formatBacktestRunId(run.runId),
      formattedCreated: formatBacktestTimestamp(run.createdAtIso),
      formattedDuration: formatBacktestDuration(run.startedAtIso, run.completedAtIso),
      statusColorName: getBacktestStatusVisuals(run.status).color,
      statusIconName: getBacktestStatusVisuals(run.status).icon,
      progressText: this.buildProgressText(run),
      progressCompletedPercent: this.buildProgressCompletedPercent(run),
      progressFailedPercent: this.buildProgressFailedPercent(run),
    }));
  });

  onSelect(row: BacktestRunListRow): void {
    this.selectRun.emit(row.runId);
  }

  private buildProgressText(run: BacktestRunUi): string {
    const completed = run.completedPermutations || 0;
    const failed = run.failedPermutations || 0;
    const total = run.totalPermutations || 0;
    if (total === 0) return '—';
    return failed > 0 ? `${completed} / ${total} (${failed} failed)` : `${completed} / ${total}`;
  }

  private buildProgressCompletedPercent(run: BacktestRunUi): number {
    const total = run.totalPermutations || 0;
    if (total === 0) return 0;
    return Math.round(((run.completedPermutations || 0) / total) * 100);
  }

  private buildProgressFailedPercent(run: BacktestRunUi): number {
    const total = run.totalPermutations || 0;
    if (total === 0) return 0;
    return Math.round(((run.failedPermutations || 0) / total) * 100);
  }
}

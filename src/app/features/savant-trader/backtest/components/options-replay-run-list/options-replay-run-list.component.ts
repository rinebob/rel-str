/**
 * Options Replay Run List Component
 *
 * Runs table for the Selection Replay section — status, run ID, created
 * timestamp, template name (resolved from the shared REPLAY_TEMPLATES
 * registry), symbols, and list progress with a failed-count badge.
 */
import { Component, input, output, ChangeDetectionStrategy, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';

import type { OptionsReplayRunUi } from '../../common/options-replay.types';
import { getReplayTemplate } from '@options-replay/templates';
import { getBacktestStatusVisuals, formatBacktestTimestamp, formatBacktestRunId } from '../../utils/backtest.utils';

/** View model that pre-computes all display values for the run list row. */
export interface OptionsReplayRunListRow extends OptionsReplayRunUi {
  formattedRunId: string;
  formattedCreated: string;
  templateName: string;
  symbolsText: string;
  statusColorName: string;
  statusIconName: string;
  progressText: string;
  progressCompletedPercent: number;
  progressFailedPercent: number;
}

@Component({
  selector: 'app-options-replay-run-list',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, MatIconModule, MatTooltipModule],
  templateUrl: './options-replay-run-list.component.html',
  styleUrl: './options-replay-run-list.component.scss',
})
export class OptionsReplayRunListComponent {
  readonly runs = input<OptionsReplayRunUi[]>([]);
  readonly selectedRunId = input<string | null>(null);
  readonly isLoading = input<boolean>(false);

  readonly selectRun = output<string>();

  readonly viewRuns = computed((): OptionsReplayRunListRow[] => {
    return this.runs().map((run) => ({
      ...run,
      formattedRunId: formatBacktestRunId(run.runId),
      formattedCreated: formatBacktestTimestamp(run.createdAtIso),
      templateName: getReplayTemplate(run.templateId)?.name ?? run.templateId,
      symbolsText: run.symbols.join(', '),
      statusColorName: getBacktestStatusVisuals(run.status).color,
      statusIconName: getBacktestStatusVisuals(run.status).icon,
      progressText: this.buildProgressText(run),
      progressCompletedPercent: this.buildProgressCompletedPercent(run),
      progressFailedPercent: this.buildProgressFailedPercent(run),
    }));
  });

  onSelect(row: OptionsReplayRunListRow): void {
    this.selectRun.emit(row.runId);
  }

  private buildProgressText(run: OptionsReplayRunUi): string {
    const total = run.totalLists || 0;
    if (total === 0) return '—';
    return `${run.completedLists || 0} / ${total}`;
  }

  private buildProgressCompletedPercent(run: OptionsReplayRunUi): number {
    const total = run.totalLists || 0;
    if (total === 0) return 0;
    return Math.round(((run.completedLists || 0) / total) * 100);
  }

  private buildProgressFailedPercent(run: OptionsReplayRunUi): number {
    const total = run.totalLists || 0;
    if (total === 0) return 0;
    return Math.round(((run.failedLists || 0) / total) * 100);
  }
}

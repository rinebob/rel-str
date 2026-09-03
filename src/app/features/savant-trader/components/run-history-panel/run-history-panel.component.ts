/**
 * Run History Panel
 *
 * Displays agent runs as a sortable table with expandable detail rows
 * and per-run "Review Signals" action.
 */
import { Component, ChangeDetectionStrategy, input, output, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatTooltipModule } from '@angular/material/tooltip';
import { StRun } from '../../services/st.service';
import { getRunStatusColor, getRunStatusIcon } from '../../utils/utils';

@Component({
  selector: 'app-run-history-panel',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, MatIconModule, MatButtonModule, MatTooltipModule],
  templateUrl: './run-history-panel.component.html',
  styleUrl: './run-history-panel.component.scss',
})
export class RunHistoryPanelComponent {
  readonly runs        = input<StRun[]>([]);
  readonly selectedRunId = input<string | null>(null);

  readonly runSelected  = output<StRun>();
  readonly runClicked   = output<StRun>();
  readonly runDeselected = output<void>();

  readonly getRunStatusColor = getRunStatusColor;
  readonly getRunStatusIcon  = getRunStatusIcon;

  /** Tracks which run row is expanded for detail view. */
  readonly expandedRunId = signal<string | null>(null);

  toggleExpand(run: StRun): void {
    this.expandedRunId.set(this.expandedRunId() === run.id ? null : run.id);
    this.runClicked.emit(run);
  }

  reviewSignals(run: StRun, event: MouseEvent): void {
    event.stopPropagation();
    this.runSelected.emit(run);
  }

  formatDuration(run: StRun): string {
    if (!run.startedAt || !run.completedAt) return 'â€”';
    const ms = new Date(run.completedAt).getTime() - new Date(run.startedAt).getTime();
    const s = Math.round(ms / 1000);
    if (s < 60) return `${s}s`;
    return `${Math.floor(s / 60)}m ${s % 60}s`;
  }

  formatTime(iso: string): string {
    return new Intl.DateTimeFormat('en-US', {
      month: 'short', day: 'numeric',
      hour: 'numeric', minute: '2-digit',
      timeZone: 'America/Los_Angeles',
    }).format(new Date(iso));
  }
}

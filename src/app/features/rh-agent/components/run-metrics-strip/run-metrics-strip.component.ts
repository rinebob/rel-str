import {
  Component,
  input,
  ChangeDetectionStrategy,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';

import { RhAgentRun } from '../../services/rh-agent.service';
import { getRunStatusColor, getRunStatusIcon } from '../../utils/rh-agent.utils';

@Component({
  selector: 'app-run-metrics-strip',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, MatIconModule],
  templateUrl: './run-metrics-strip.component.html',
  styleUrl: './run-metrics-strip.component.scss',
})
export class RunMetricsStripComponent {
  readonly selectedRun = input<RhAgentRun | null>(null);
  readonly allRuns     = input<RhAgentRun[]>([]);

  readonly getRunStatusColor = getRunStatusColor;
  readonly getRunStatusIcon  = getRunStatusIcon;

  get runningCount(): number {
    return this.allRuns().filter((r) => r.status?.toUpperCase() === 'RUNNING').length;
  }

  get todayCount(): number {
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles' }).format(new Date());
    return this.allRuns().filter((r) => r.marketDate === today).length;
  }

  get latestRun(): RhAgentRun | null {
    const runs = this.allRuns();
    return runs.length > 0 ? runs[0] : null;
  }

  formatDuration(run: RhAgentRun): string {
    if (!run.startedAt || !run.completedAt) return '—';
    const ms = new Date(run.completedAt).getTime() - new Date(run.startedAt).getTime();
    const s = Math.round(ms / 1000);
    if (s < 60) return `${s}s`;
    return `${Math.floor(s / 60)}m ${s % 60}s`;
  }
}

import {
  Component,
  input,
  ChangeDetectionStrategy,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';

import { StRun } from '../../services/st.service';
import { getRunStatusColor, getRunStatusIcon, todayDate } from '../../utils/utils';

@Component({
  selector: 'app-run-metrics-strip',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, MatIconModule],
  templateUrl: './run-metrics-strip.component.html',
  styleUrl: './run-metrics-strip.component.scss',
})
export class RunMetricsStripComponent {
  readonly selectedRun = input<StRun | null>(null);
  readonly allRuns     = input<StRun[]>([]);

  readonly getRunStatusColor = getRunStatusColor;
  readonly getRunStatusIcon  = getRunStatusIcon;

  get runningCount(): number {
    return this.allRuns().filter((r) => r.status?.toUpperCase() === 'RUNNING').length;
  }

  get todayCount(): number {
    return this.allRuns().filter((r) => r.marketDate === todayDate()).length;
  }

  get latestRun(): StRun | null {
    const runs = this.allRuns();
    return runs.length > 0 ? runs[0] : null;
  }

  formatDuration(run: StRun): string {
    if (!run.startedAt || !run.completedAt) return 'â€”';
    const ms = new Date(run.completedAt).getTime() - new Date(run.startedAt).getTime();
    const s = Math.round(ms / 1000);
    if (s < 60) return `${s}s`;
    return `${Math.floor(s / 60)}m ${s % 60}s`;
  }
}

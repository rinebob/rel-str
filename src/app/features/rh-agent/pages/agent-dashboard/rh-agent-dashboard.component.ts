/**
 * RH Agent Dashboard Component
 *
 * UI for viewing agent status, triggering manual runs, and displaying trade signal history.
 * Uses NgRx SignalStore for state management.
 */
import {
  Component,
  inject,
  signal,
  ChangeDetectionStrategy,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { ReactiveFormsModule, FormGroup, FormControl } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatChipsModule } from '@angular/material/chips';
import { MatSnackBarModule } from '@angular/material/snack-bar';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatDatepickerModule } from '@angular/material/datepicker';
import { MatNativeDateModule } from '@angular/material/core';

import { RhAgentStore } from '../../stores/rh-agent.store';
import { RhAgentDashboardStore } from '../../stores/rh-agent-dashboard.store';
import { RhAgentGroupStore } from '../../stores/rh-agent-group.store';
import { RhAgentService } from '../../services/rh-agent.service';
import { Router } from '@angular/router';
import { MatSnackBar } from '@angular/material/snack-bar';
import { expandDateRange, getScheduleDescription } from '../../utils/rh-agent.utils';
import { AgentStatusBarComponent } from '../../components/agent-status-bar/agent-status-bar.component';
import { RunHistoryPanelComponent } from '../../components/run-history-panel/run-history-panel.component';

@Component({
  selector: 'app-rh-agent-dashboard',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    MatButtonModule,
    MatIconModule,
    MatProgressSpinnerModule,
    MatChipsModule,
    MatSnackBarModule,
    MatTooltipModule,
    MatFormFieldModule,
    MatInputModule,
    MatDatepickerModule,
    MatNativeDateModule,
    AgentStatusBarComponent,
    RunHistoryPanelComponent,
  ],
  templateUrl: './rh-agent-dashboard.component.html',
  styleUrl: './rh-agent-dashboard.component.scss',
  providers: [RhAgentStore, RhAgentDashboardStore], // Component-scoped stores
})
export class RhAgentDashboardComponent {
  // Inject the data store - manages all business logic and API calls
  readonly store = inject(RhAgentStore);
  readonly uiStore = inject(RhAgentDashboardStore);
  private readonly groupStore = inject(RhAgentGroupStore);
  private readonly router = inject(Router);
  private readonly rhService = inject(RhAgentService);
  private readonly snackBar = inject(MatSnackBar);

  readonly isSyncingOverview = signal(false);
  readonly scheduleDescription = getScheduleDescription();

  // Date range picker for manual runs
  readonly dateRange = new FormGroup({
    start: new FormControl<Date | null>(null),
    end: new FormControl<Date | null>(null),
  });

  /**
   * Load dashboard data on init.
   * The data store handles all API calls.
   */
  constructor() {
    this.store.loadData();
  }

  /** Refresh all dashboard data (status + runs). */
  refreshData(): void {
    this.store.loadData();
  }

  /**
   * Trigger a manual agent run.
   * If a date range is selected, enqueue one run per date in the range.
   */
  triggerManualRun(): void {
    const start = this.dateRange.value.start;
    const end = this.dateRange.value.end;
    if (!start) {
      this.store.triggerManualRun(undefined);
      return;
    }
    const dates = expandDateRange(start, end ?? start);
    for (const dateStr of dates) {
      this.store.triggerManualRun(dateStr);
    }
  }

  /** Navigate to the grouped review page, pre-seeding the active run from the latest run. */
  goToGroupedReview(): void {
    const latest = this.store.latestRun();
    if (latest?.id && latest?.marketDate) {
      this.groupStore.setActiveRun(latest.id, latest.marketDate);
    }
    this.router.navigate(['/rh-agent-grouped-review']);
  }

  /** Trigger a full company overview sync and show a snackbar with the result. */
  triggerOverviewSync(): void {
    this.isSyncingOverview.set(true);
    this.rhService.triggerOverviewSync(true).subscribe({
      next: (r: { enqueued: number; skipped: number; total: number }) => {
        this.isSyncingOverview.set(false);
        this.snackBar.open(`Overview sync enqueued: ${r.enqueued} symbols`, 'OK', { duration: 4000 });
      },
      error: (e: Error) => {
        this.isSyncingOverview.set(false);
        this.snackBar.open(`Sync failed: ${e?.message}`, 'OK', { duration: 5000 });
      },
    });
  }
}

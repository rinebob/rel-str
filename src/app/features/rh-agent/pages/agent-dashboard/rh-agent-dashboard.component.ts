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
  computed,
  effect,
  OnInit,
  OnDestroy,
  ChangeDetectionStrategy,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBarModule } from '@angular/material/snack-bar';

import { RhAgentStore } from '../../stores/rh-agent.store';
import { RhAgentDashboardStore } from '../../stores/rh-agent-dashboard.store';
import { RhAgentGroupStore } from '../../stores/rh-agent-group.store';
import { RhAgentRun } from '../../services/rh-agent.types';
import { RhAgentOverviewService } from '../../services/rh-agent-overview.service';
import { UiStateService } from '../../../../core/services/ui-state.service';
import { Router, RouterLink } from '@angular/router';
import { AppRoutes } from '../../../../core/common/interfaces';
import { MatSnackBar } from '@angular/material/snack-bar';
import { getScheduleDescription, formatTimestampPT, formatTimePt, getNextPdrWindowPt, getNextNightlyPt, todayDate } from '../../utils/rh-agent.utils';
import { AgentStatusBarComponent } from '../../components/agent-status-bar/agent-status-bar.component';
import { RunHistoryPanelComponent } from '../../components/run-history-panel/run-history-panel.component';
import { RunControlCardComponent } from '../../components/run-control-card/run-control-card.component';
import { RunMetricsStripComponent } from '../../components/run-metrics-strip/run-metrics-strip.component';

@Component({
  selector: 'app-rh-agent-dashboard',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    CommonModule,
    MatButtonModule,
    MatIconModule,
    MatProgressSpinnerModule,
    MatSnackBarModule,
    RouterLink,
    AgentStatusBarComponent,
    RunHistoryPanelComponent,
    RunControlCardComponent,
    RunMetricsStripComponent,
  ],
  templateUrl: './rh-agent-dashboard.component.html',
  styleUrl: './rh-agent-dashboard.component.scss',
  providers: [RhAgentDashboardStore],
})
export class RhAgentDashboardComponent implements OnInit, OnDestroy {
  // Inject the data store - manages all business logic and API calls
  readonly store = inject(RhAgentStore);
  readonly uiStore = inject(RhAgentDashboardStore);
  private readonly groupStore = inject(RhAgentGroupStore);
  private readonly uiState = inject(UiStateService);
  private readonly router = inject(Router);
  protected readonly appRoutes = AppRoutes;
  private readonly overviewService = inject(RhAgentOverviewService);
  private readonly snackBar = inject(MatSnackBar);

  readonly isSyncingOverview = signal(false);
  readonly scheduleSummary = computed(() => {
    const lastRunAt = this.store.status()?.lastRunAt;
    const lastRunType = this.store.latestCompletedRun()?.triggeredBy ?? 'nightly';
    const now = new Date();
    const todayStr = todayDate();
    const dateOf = (ts: string | Date | number): string =>
      new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles' }).format(new Date(ts));
    const formatRunTime = (ts: string | Date | number): string =>
      dateOf(ts) === todayStr ? formatTimePt(ts) : formatTimestampPT(ts);
    const parts: string[] = [];

    if (lastRunAt) {
      parts.push(`Last: ${formatRunTime(lastRunAt)} (${lastRunType})`);
    }

    const nextPdr = getNextPdrWindowPt(now);
    const nextNightly = getNextNightlyPt(now);
    const nextParts: string[] = [];
    if (nextPdr) nextParts.push(`${formatRunTime(nextPdr)} (pdr)`);
    if (nextNightly) nextParts.push(`${formatRunTime(nextNightly)} (nightly)`);
    if (nextParts.length) parts.push(`Next: ${nextParts.join(', ')}`);

    return parts.join(' • ') || getScheduleDescription();
  });

  /**
   * Load dashboard data on init.
   * The data store handles all API calls.
   */
  constructor() {
    this.store.loadData();

    /**
     * Default the dashboard metrics strip to the latest completed actionable run
     * so the active workflow entry point is clearly identified.
     */
    effect(() => {
      const latest = this.store.latestCompletedRun();
      if (!latest) return;
      if (this.uiStore.selectedRunId()) return;
      this.uiStore.selectRun(latest.id);
    });
  }

  /** Enter fullscreen mode when the dashboard is active. */
  ngOnInit(): void {
    this.uiState.setFullscreen(true);
  }

  /** Leave fullscreen mode when the dashboard is destroyed. */
  ngOnDestroy(): void {
    this.uiState.setFullscreen(false);
  }

  /** Refresh status — runs update automatically via the realtime listener. */
  refreshData(): void {
    this.store.refreshStatus();
  }

  /**
   * Trigger a manual agent run.
   * If a date range is selected, enqueue one run per date in the range.
   */
  triggerManualRun(): void {
    this.store.triggerManualRun(undefined);
  }

  /** Navigate to the signal review page, pre-seeding the active run from the latest completed run. */
  goToSignalReview(): void {
    const latest = this.store.latestCompletedRun();
    if (latest?.id && latest?.marketDate) {
      this.groupStore.setActiveRun(latest.id, latest.marketDate);
    }
    this.router.navigate(['/' + AppRoutes.SIGNAL_REVIEW]);
  }

  /** Review signals for a specific run selected from the run history panel. */
  onRunSelected(run: RhAgentRun): void {
    this.uiStore.selectRun(run.id);
    if (run.id && run.marketDate) {
      this.groupStore.setActiveRun(run.id, run.marketDate);
    }
    this.router.navigate(['/' + AppRoutes.SIGNAL_REVIEW]);
  }

  /** Trigger a full company overview sync and show a snackbar with the result. */
  triggerOverviewSync(): void {
    this.isSyncingOverview.set(true);
    this.overviewService.triggerOverviewSync(true).subscribe({
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

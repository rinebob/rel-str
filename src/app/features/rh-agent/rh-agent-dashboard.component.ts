/**
 * RH Agent Dashboard Component
 *
 * UI for viewing agent status, triggering manual runs, and displaying trade signal history.
 * Uses NgRx SignalStore for state management.
 */
import {
  Component,
  inject,
  ChangeDetectionStrategy,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule, ReactiveFormsModule, FormGroup, FormControl } from '@angular/forms';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatChipsModule } from '@angular/material/chips';
import { MatBadgeModule } from '@angular/material/badge';
import { MatListModule } from '@angular/material/list';
import { MatExpansionModule } from '@angular/material/expansion';
import { MatSnackBarModule } from '@angular/material/snack-bar';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatDatepickerModule } from '@angular/material/datepicker';
import { MatNativeDateModule } from '@angular/material/core';
import { RouterModule } from '@angular/router';

import { RhAgentStore } from './rh-agent.store';
import { RobinhoodTradePanelComponent } from '../rs/components/robinhood-trade-panel.component';
import { RhAgentDashboardStore } from './rh-agent-dashboard.store';
import { RhAgentService } from './rh-agent.service';
import { Router } from '@angular/router';
import { MatSnackBar } from '@angular/material/snack-bar';

@Component({
  selector: 'app-rh-agent-dashboard',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    CommonModule,
    FormsModule,
    ReactiveFormsModule,
    MatCardModule,
    MatButtonModule,
    MatIconModule,
    MatProgressSpinnerModule,
    MatChipsModule,
    MatBadgeModule,
    MatListModule,
    MatExpansionModule,
    MatSnackBarModule,
    MatTooltipModule,
    MatSlideToggleModule,
    MatFormFieldModule,
    MatInputModule,
    MatDatepickerModule,
    MatNativeDateModule,
    RobinhoodTradePanelComponent,
    RouterModule,
  ],
  templateUrl: './rh-agent-dashboard.component.html',
  styleUrl: './rh-agent-dashboard.component.scss',
  providers: [RhAgentStore, RhAgentDashboardStore], // Component-scoped stores
})
export class RhAgentDashboardComponent {
  // Inject the data store - manages all business logic and API calls
  readonly store = inject(RhAgentStore);
  readonly uiStore = inject(RhAgentDashboardStore);
  private readonly router = inject(Router);
  private readonly rhService = inject(RhAgentService);
  private readonly snackBar = inject(MatSnackBar);

  // Trade panel visibility
  showTradePanel = false;
  isSyncingOverview = false;

  // Date range picker for manual runs
  readonly dateRange = new FormGroup({
    start: new FormControl<Date | null>(null),
    end: new FormControl<Date | null>(null),
  });

  constructor() {
    console.log('[RH Agent Dashboard] Component initialized');
    // Load data on init - data store handles all the business logic
    this.store.loadData();
  }

  /**
   * Toggle trade panel visibility
   */
  toggleTradePanel(): void {
    this.showTradePanel = !this.showTradePanel;
  }

  /**
   * Refresh all dashboard data
   */
  refreshData(): void {
    this.store.loadData();
  }

  /**
   * Trigger a manual agent run
   */
  triggerManualRun(): void {
    const start = this.dateRange.value.start;
    const end = this.dateRange.value.end;
    if (!start) {
      this.store.triggerManualRun(undefined);
      return;
    }
    const dates = this.expandDateRange(start, end ?? start);
    for (const dateStr of dates) {
      this.store.triggerManualRun(dateStr);
    }
  }

  private expandDateRange(start: Date, end: Date): string[] {
    const dates: string[] = [];
    const cur = new Date(start);
    cur.setHours(0, 0, 0, 0);
    const last = new Date(end);
    last.setHours(0, 0, 0, 0);
    while (cur <= last) {
      const y = cur.getFullYear();
      const m = String(cur.getMonth() + 1).padStart(2, '0');
      const d = String(cur.getDate()).padStart(2, '0');
      dates.push(`${y}-${m}-${d}`);
      cur.setDate(cur.getDate() + 1);
    }
    return dates;
  }

  /**
   * Get the current trade batch for accepted signals
   */
  getTradeBatch() {
    const currentRun = this.uiStore.currentRun();
    if (!currentRun) return null;
    return this.uiStore.generateBatchTrade(currentRun.id);
  }

  /**
   * Check if there are accepted signals ready to trade
   */
  hasAcceptedSignals(): boolean {
    const currentRun = this.uiStore.currentRun();
    if (!currentRun) return false;
    return this.uiStore.getAcceptedSignalsForTrade(currentRun.id).length > 0;
  }

  /**
   * Navigate to the review page for current opportunities
   */
  goToReview(): void {
    this.router.navigate(['/rh-agent-review']);
  }

  goToGroupedReview(): void {
    this.router.navigate(['/rh-agent-grouped-review']);
  }

  triggerOverviewSync(): void {
    this.isSyncingOverview = true;
    this.rhService.triggerOverviewSync(true).subscribe({
      next: (r: { enqueued: number; skipped: number; total: number }) => {
        this.isSyncingOverview = false;
        this.snackBar.open(`Overview sync enqueued: ${r.enqueued} symbols`, 'OK', { duration: 4000 });
      },
      error: (e: Error) => {
        this.isSyncingOverview = false;
        this.snackBar.open(`Sync failed: ${e?.message}`, 'OK', { duration: 5000 });
      },
    });
  }
}

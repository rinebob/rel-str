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
import { FormsModule } from '@angular/forms';
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

import { RhAgentStore } from './rh-agent.store';

@Component({
  selector: 'app-rh-agent-dashboard',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    CommonModule,
    FormsModule,
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
  ],
  templateUrl: './rh-agent-dashboard.component.html',
  styleUrl: './rh-agent-dashboard.component.scss',
  providers: [RhAgentStore], // Component-scoped store
})
export class RhAgentDashboardComponent {
  // Inject the SignalStore - all state and methods available via this.store
  readonly store = inject(RhAgentStore);

  // UI state for expandable sections
  showAllRuns = false;
  symbolsPanelOpen = false;

  constructor() {
    console.log('[RH Agent Dashboard] Component initialized');
    // Load data on init - store handles all the logic
    this.store.loadData();
  }

  /**
   * Translate cron expression to Pacific Time human-readable format
   * Schedule is 12:00 PM PT Monday-Friday (0 12 * * 1-5)
   */
  getScheduleDescription(cron: string | undefined): string {
    if (!cron) return 'Not scheduled';
    
    // Parse cron: "0 12 * * 1-5" -> 12:00 PM PT, Monday-Friday
    const parts = cron.split(' ');
    if (parts.length !== 5) return cron;
    
    const [minute, hour, , , dayOfWeek] = parts;
    
    // Convert 24h to 12h format
    const hourNum = parseInt(hour, 10);
    const minNum = parseInt(minute, 10);
    const ampm = hourNum >= 12 ? 'PM' : 'AM';
    const hour12 = hourNum % 12 || 12;
    const minStr = minNum === 0 ? '' : `:${minNum.toString().padStart(2, '0')}`;
    const time = `${hour12}${minStr} ${ampm}`;
    
    // Day of week
    let days = '';
    if (dayOfWeek === '*') days = 'daily';
    else if (dayOfWeek === '1-5') days = 'Monday-Friday';
    else if (dayOfWeek === '0-6') days = 'daily';
    else if (dayOfWeek === '1') days = 'Mondays';
    else if (dayOfWeek === '5') days = 'Fridays';
    else days = dayOfWeek;
    
    return `${time} PT, ${days}`;
  }

  /**
   * Get the most recent run (current)
   */
  get currentRun() {
    return this.store.runs().length > 0 ? this.store.runs()[0] : null;
  }

  /**
   * Get previous runs (all except current)
   */
  get previousRuns() {
    return this.store.runs().slice(1);
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
    this.store.triggerManualRun();
  }

  /**
   * Get signals for a specific run
   */
  getSignalsForRun(runId: string) {
    return this.store.getSignalsForRun(runId);
  }

  /**
   * Get Material color for run status
   */
  getRunStatusColor(status: string): string {
    switch (status.toLowerCase()) {
      case 'success': return 'success';
      case 'failed': return 'error';
      case 'running': return 'primary';
      case 'partial': return 'accent';
      default: return '';
    }
  }

  /**
   * Get Material icon for run status
   */
  getRunStatusIcon(status: string): string {
    switch (status.toLowerCase()) {
      case 'success': return 'check_circle';
      case 'failed': return 'error';
      case 'running': return 'pending';
      case 'partial': return 'warning';
      default: return 'help';
    }
  }

  /**
   * Get Material icon for action type
   */
  getActionIcon(action: string): string {
    switch (action.toLowerCase()) {
      case 'buy': return 'trending_up';
      case 'sell': return 'trending_down';
      case 'hold': return 'remove_circle';
      default: return 'help';
    }
  }
}

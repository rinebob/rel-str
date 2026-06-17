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
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';

import { RhAgentStore } from './rh-agent.store';
import { RobinhoodTradePanelComponent } from '../rs/components/robinhood-trade-panel.component';
import { RhAgentDashboardStore } from './rh-agent-dashboard.store';

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
    MatFormFieldModule,
    MatInputModule,
    RobinhoodTradePanelComponent,
  ],
  templateUrl: './rh-agent-dashboard.component.html',
  styleUrl: './rh-agent-dashboard.component.scss',
  providers: [RhAgentStore, RhAgentDashboardStore], // Component-scoped stores
})
export class RhAgentDashboardComponent {
  // Inject the data store - manages all business logic and API calls
  readonly store = inject(RhAgentStore);
  
  // Inject the UI state store - manages all UI state (filters, selections, etc.)
  readonly uiStore = inject(RhAgentDashboardStore);

  // Trade panel visibility
  showTradePanel = false;

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
    this.store.triggerManualRun();
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
}

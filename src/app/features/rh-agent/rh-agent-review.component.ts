/**
 * RH Agent Review Component
 *
 * Master-detail interface for opportunity triage and trade execution.
 * Focuses on current signals from the latest run only.
 * URL: /rh-agent/review
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
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatTooltipModule } from '@angular/material/tooltip';

import { RhAgentStore } from './rh-agent.store';
import { RhAgentDashboardStore } from './rh-agent-dashboard.store';
import { SignalListComponent } from './components/signal-list/signal-list.component';
import { SignalDetailComponent } from './components/signal-detail/signal-detail.component';
import { ExecutionPanelComponent } from './components/execution-panel/execution-panel.component';

@Component({
  selector: 'app-rh-agent-review',
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
    MatFormFieldModule,
    MatInputModule,
    MatTooltipModule,
    SignalListComponent,
    SignalDetailComponent,
    ExecutionPanelComponent,
  ],
  templateUrl: './rh-agent-review.component.html',
  styleUrl: './rh-agent-review.component.scss',
  providers: [RhAgentStore, RhAgentDashboardStore],
})
export class RhAgentReviewComponent {
  readonly store = inject(RhAgentStore);
  readonly uiStore = inject(RhAgentDashboardStore);

  constructor() {
    console.log('[RH Agent Review] Component initialized');
    this.store.loadData();
  }

  refreshData(): void {
    this.store.loadData();
  }

  triggerManualRun(): void {
    this.store.triggerManualRun();
  }

  getTradeBatch() {
    const currentRun = this.uiStore.currentRun();
    if (!currentRun) return null;
    return this.uiStore.generateBatchTrade(currentRun.id);
  }

  hasAcceptedSignals(): boolean {
    const currentRun = this.uiStore.currentRun();
    if (!currentRun) return false;
    return this.uiStore.getAcceptedSignalsForTrade(currentRun.id).length > 0;
  }

  onSignalSelected(signal: any): void {
    // Signal is already selected via the store in the child component
    console.log('[RH Agent Review] Signal selected:', signal.symbol);
  }
}

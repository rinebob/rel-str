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
import { MatChipsModule, MatChipListbox, MatChipOption } from '@angular/material/chips';
import { MatBadgeModule } from '@angular/material/badge';
import { MatListModule } from '@angular/material/list';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';

import { RhAgentStore } from './rh-agent.store';
import { RhAgentDashboardStore } from './rh-agent-dashboard.store';
import { SignalListComponent } from './components/signal-list/signal-list.component';
import { SignalDetailComponent } from './components/signal-detail/signal-detail.component';
import { RobinhoodTradePanelComponent } from '../rs/components/robinhood-trade-panel.component';

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
    MatDialogModule,
    SignalListComponent,
    SignalDetailComponent,
  ],
  templateUrl: './rh-agent-review.component.html',
  styleUrl: './rh-agent-review.component.scss',
  providers: [RhAgentStore, RhAgentDashboardStore],
})
export class RhAgentReviewComponent {
  readonly store = inject(RhAgentStore);
  readonly uiStore = inject(RhAgentDashboardStore);
  readonly dialog = inject(MatDialog);

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
    console.log('[RH Agent Review] Signal selected:', signal.symbol);
  }

  acceptedCount(): number {
    const currentRun = this.uiStore.currentRun();
    if (!currentRun) return 0;
    return this.uiStore.getSignalsByStatus(currentRun.id, 'ACCEPTED').length;
  }

  consideredCount(): number {
    const currentRun = this.uiStore.currentRun();
    if (!currentRun) return 0;
    return this.uiStore.getSignalsByStatus(currentRun.id, 'CONSIDERED').length;
  }

  rejectedCount(): number {
    const currentRun = this.uiStore.currentRun();
    if (!currentRun) return 0;
    return this.uiStore.getSignalsByStatus(currentRun.id, 'REJECTED').length;
  }

  openTradeDialog(): void {
    const dialogRef = this.dialog.open(RobinhoodTradePanelComponent, {
      data: { batch: this.getTradeBatch() },
      width: '600px',
      maxHeight: '90vh',
      panelClass: 'trade-dialog'
    });

    // Handle trade removal - move from ACCEPTED to CONSIDERED
    dialogRef.componentInstance.tradeRemoved.subscribe((symbol: string) => {
      console.log('[Review] Removing trade for symbol:', symbol);
      // Find the accepted signal for this symbol and move it to considered
      const currentRun = this.uiStore.currentRun();
      if (currentRun) {
        const signal = this.uiStore.getSignalsByStatus(currentRun.id, 'ACCEPTED')
          .find(s => s.symbol === symbol);
        if (signal) {
          this.uiStore.considerSignal(signal.id);
          console.log('[Review] Moved signal to CONSIDERED:', symbol);
        }
      }
    });
  }

  // Selected signal status helpers
  getSelectedSignalStatus(): string {
    const signal = this.uiStore.selectedSignal();
    if (!signal) return 'PENDING';
    return this.uiStore.getSignalStatus(signal.id);
  }

  onAcceptSelected(): void {
    const signal = this.uiStore.selectedSignal();
    if (signal) {
      this.uiStore.acceptSignal(signal.id);
    }
  }

  onConsiderSelected(): void {
    const signal = this.uiStore.selectedSignal();
    if (signal) {
      this.uiStore.considerSignal(signal.id);
    }
  }

  onRejectSelected(): void {
    const signal = this.uiStore.selectedSignal();
    if (signal) {
      this.uiStore.rejectSignal(signal.id);
    }
  }
}

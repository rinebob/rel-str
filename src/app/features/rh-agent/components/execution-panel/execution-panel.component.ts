/**
 * Execution Panel Component
 *
 * Displays decision counts and trade generation controls.
 */
import { Component, inject, ChangeDetectionStrategy, input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';

import { RhAgentDashboardStore } from '../../stores/rh-agent-dashboard.store';
import { RobinhoodTradePanelComponent } from '../../../rs/components/robinhood-trade-panel.component';
import { TradeBatch } from '../../../rs/services/robinhood-trade.service';

@Component({
  selector: 'app-execution-panel',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, MatCardModule, MatIconModule, RobinhoodTradePanelComponent],
  templateUrl: './execution-panel.component.html',
  styleUrl: './execution-panel.component.scss',
})
export class ExecutionPanelComponent {
  readonly uiStore = inject(RhAgentDashboardStore);

  tradeBatch = input<TradeBatch | null>(null);
  hasAcceptedSignals = input<boolean>(false);

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
}

/**
 * Backtest Dashboard Component
 *
 * Phase 2 dashboard for the RH Agent strategy backtest run management UI.
 * Wires the run store, UI store, control strip, and run list together.
 */
import { Component, inject, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';

import { BacktestRunStore } from '../../stores/backtest-run.store';
import { BacktestUiStore } from '../../stores/backtest-ui.store';
import { BacktestRunControlComponent } from '../../components/backtest-run-control/backtest-run-control.component';
import { BacktestRunListComponent } from '../../components/backtest-run-list/backtest-run-list.component';

@Component({
  selector: 'app-backtest-dashboard',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, BacktestRunControlComponent, BacktestRunListComponent],
  templateUrl: './backtest-dashboard.component.html',
  styleUrl: './backtest-dashboard.component.scss',
})
export class BacktestDashboardComponent {
  readonly runStore = inject(BacktestRunStore);
  readonly uiStore = inject(BacktestUiStore);

  constructor() {
    this.runStore.loadRuns();
    this.runStore.loadStrategies();
  }
}

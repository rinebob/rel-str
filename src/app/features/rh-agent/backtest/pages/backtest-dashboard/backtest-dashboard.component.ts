/**
 * Backtest Dashboard Component
 *
 * Phase 2 dashboard for the RH Agent strategy backtest run management UI.
 * Wires the run store, UI store, control strip, and run list together.
 */
import { Component, computed, inject, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatDialogModule, MatDialog } from '@angular/material/dialog';

import { BacktestRunStore } from '../../stores/backtest-run.store';
import { BacktestUiStore } from '../../stores/backtest-ui.store';
import { BacktestRunControlComponent } from '../../components/backtest-run-control/backtest-run-control.component';
import { BacktestRunListComponent } from '../../components/backtest-run-list/backtest-run-list.component';
import { BacktestRunSummaryComponent } from '../../components/backtest-run-summary/backtest-run-summary.component';
import { BacktestPermutationDetailComponent } from '../../components/backtest-permutation-detail/backtest-permutation-detail.component';
import { BacktestNewRunDialogComponent } from '../../components/backtest-new-run-dialog/backtest-new-run-dialog.component';
import type { BacktestPermutationUi, BacktestStrategyMetadata, StartBacktestRequest } from '../../common/backtest.types';

@Component({
  selector: 'app-backtest-dashboard',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    CommonModule,
    MatDialogModule,
    BacktestRunControlComponent,
    BacktestRunListComponent,
    BacktestRunSummaryComponent,
    BacktestPermutationDetailComponent,
  ],
  templateUrl: './backtest-dashboard.component.html',
  styleUrl: './backtest-dashboard.component.scss',
})
export class BacktestDashboardComponent {
  readonly runStore = inject(BacktestRunStore);
  readonly uiStore = inject(BacktestUiStore);
  private readonly dialog = inject(MatDialog);

  readonly selectedPermutation = computed((): BacktestPermutationUi | null => {
    const id = this.uiStore.selectedPermutationId();
    return id ? this.runStore.permutations().find((p) => p.permutationId === id) ?? null : null;
  });

  constructor() {
    this.runStore.loadRuns();
    this.runStore.loadStrategies();
  }

  openNewRunDialog(): void {
    const ref = this.dialog.open<BacktestNewRunDialogComponent, { strategies: BacktestStrategyMetadata[] }, StartBacktestRequest | undefined>(
      BacktestNewRunDialogComponent,
      {
        width: '640px',
        maxWidth: '90vw',
        data: { strategies: this.runStore.strategies() },
      }
    );

    ref.afterClosed().subscribe((request) => {
      if (request) {
        this.runStore.startRun(request);
      }
    });
  }
}

/**
 * Backtest Dashboard Component
 *
 * Phase 2 dashboard for the RH Agent strategy backtest run management UI.
 * Wires the run store, UI store, control strip, and run list together.
 */
import { Component, computed, inject, ChangeDetectionStrategy, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatDialogModule, MatDialog } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { take } from 'rxjs';

import { BacktestRunStore } from '../../stores/backtest-run.store';
import { BacktestUiStore } from '../../stores/backtest-ui.store';
import { BacktestRunControlComponent } from '../../components/backtest-run-control/backtest-run-control.component';
import { BacktestRunListComponent } from '../../components/backtest-run-list/backtest-run-list.component';
import { BacktestNewRunDialogComponent } from '../../components/backtest-new-run-dialog/backtest-new-run-dialog.component';
import { BacktestReportDialogComponent } from '../../components/backtest-report-dialog/backtest-report-dialog.component';
import { BacktestRunService } from '../../services/backtest-run.service';
import { UiStateService } from '../../../../../core/services/ui-state.service';
import type { BacktestPermutationUi, BacktestStrategyMetadata, StartBacktestRequest } from '../../common/backtest.types';

@Component({
  selector: 'app-backtest-dashboard',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    CommonModule,
    MatDialogModule,
    BacktestRunControlComponent,
    BacktestRunListComponent,
  ],
  templateUrl: './backtest-dashboard.component.html',
  styleUrl: './backtest-dashboard.component.scss',
})
export class BacktestDashboardComponent implements OnInit, OnDestroy {
  readonly runStore = inject(BacktestRunStore);
  readonly uiStore = inject(BacktestUiStore);
  private readonly dialog = inject(MatDialog);
  private readonly runService = inject(BacktestRunService);
  private readonly snackBar = inject(MatSnackBar);
  readonly uiStateService = inject(UiStateService);

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

  ngOnInit(): void {
    this.uiStateService.setFullscreen(true);
  }

  ngOnDestroy(): void {
    this.uiStateService.setFullscreen(false);
  }

  onViewReport(runId: string): void {
    this.runService.watchPermutations(runId).pipe(take(1)).subscribe((permutations) => {
      const permutation = permutations[0];
      if (!permutation) {
        this.snackBar.open('No permutations found for this run', 'Dismiss', { duration: 5000 });
        return;
      }
      this.dialog.open(BacktestReportDialogComponent, {
        width: '95vw',
        maxWidth: '95vw',
        height: '90vh',
        maxHeight: '90vh',
        panelClass: 'backtest-report-dialog',
        data: { permutation, reportTier: permutation.reportTier },
      });
    });
  }
}

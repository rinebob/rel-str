/**
 * Backtest Permutation Detail Component
 *
 * Displays details for a single permutation: symbol, config, metrics,
 * errors/notes, and a mini equity-curve sparkline.
 */
import { Component, inject, input, computed, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatDialogModule, MatDialog } from '@angular/material/dialog';

import type { BacktestPermutationUi, BacktestReportTier } from '../../common/backtest.types';
import { BacktestReportDialogComponent } from '../backtest-report-dialog/backtest-report-dialog.component';
import { BacktestEquityCurveComponent, toEquityCurvePoints, type EquityCurvePoint } from '../backtest-equity-curve/backtest-equity-curve.component';
import { BacktestTradeTableComponent } from '../backtest-trade-table/backtest-trade-table.component';

@Component({
  selector: 'app-backtest-permutation-detail',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    CommonModule,
    MatIconModule,
    MatButtonModule,
    MatDialogModule,
    BacktestEquityCurveComponent,
    BacktestTradeTableComponent,
  ],
  templateUrl: './backtest-permutation-detail.component.html',
  styleUrl: './backtest-permutation-detail.component.scss',
})
export class BacktestPermutationDetailComponent {
  readonly permutation = input<BacktestPermutationUi | null>(null);
  readonly reportTier = input<BacktestReportTier | undefined>(undefined);
  private readonly dialog = inject(MatDialog);

  openFullReport(): void {
    const permutation = this.permutation();
    if (!permutation) return;
    this.dialog.open(BacktestReportDialogComponent, {
      width: '95vw',
      maxWidth: '95vw',
      height: '90vh',
      maxHeight: '90vh',
      panelClass: 'backtest-report-dialog',
      data: {
        permutation,
        reportTier: this.reportTier() ?? permutation.reportTier,
      },
    });
  }

  readonly chartData = computed((): EquityCurvePoint[] =>
    toEquityCurvePoints(this.permutation()?.equityCurve)
  );

  readonly configEntries = computed((): { key: string; value: string }[] => {
    const permutation = this.permutation();
    const config = permutation?.config ?? {};
    return Object.entries(config).map(([key, value]) => ({
      key,
      value: typeof value === 'object' ? JSON.stringify(value) : String(value),
    }));
  });
}

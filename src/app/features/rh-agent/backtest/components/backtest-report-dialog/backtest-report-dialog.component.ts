/**
 * Backtest Report Dialog
 *
 * Full-screen dialog that lays out a single permutation's performance report,
 * equity curve, underlying price + trade markers, and trade list in one view.
 */
import { Component, inject, ChangeDetectionStrategy, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MAT_DIALOG_DATA, MatDialogModule } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTabsModule } from '@angular/material/tabs';

import type { BacktestPermutationUi, BacktestReportTier } from '../../common/backtest.types';
import { buildBacktestMetricEntries } from '../../utils/backtest.utils';
import { BacktestEquityCurveComponent, toEquityCurvePoints, type EquityCurvePoint } from '../backtest-equity-curve/backtest-equity-curve.component';
import { BacktestTradeTableComponent } from '../backtest-trade-table/backtest-trade-table.component';
import { BacktestUnderlyingChartComponent, type UnderlyingPricePoint } from '../backtest-underlying-chart/backtest-underlying-chart.component';

export interface BacktestReportDialogData {
  permutation: BacktestPermutationUi;
  reportTier?: BacktestReportTier;
}

@Component({
  selector: 'app-backtest-report-dialog',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    CommonModule,
    MatDialogModule,
    MatButtonModule,
    MatIconModule,
    MatTabsModule,
    BacktestEquityCurveComponent,
    BacktestTradeTableComponent,
    BacktestUnderlyingChartComponent,
  ],
  templateUrl: './backtest-report-dialog.component.html',
  styleUrl: './backtest-report-dialog.component.scss',
})
export class BacktestReportDialogComponent {
  readonly data: BacktestReportDialogData = inject(MAT_DIALOG_DATA);

  readonly permutation = computed(() => this.data.permutation);

  readonly effectiveReportTier = computed<BacktestReportTier>(() => this.data.reportTier ?? this.permutation().reportTier ?? 'summary');

  readonly equityChartData = computed((): EquityCurvePoint[] =>
    toEquityCurvePoints(this.permutation().equityCurve)
  );

  readonly underlyingChartData = computed((): UnderlyingPricePoint[] => {
    return (this.permutation().underlyingBars ?? [])
      .filter((p) => p.date)
      .map((p) => ({ date: new Date(p.date), close: p.close }))
      .sort((a, b) => a.date.getTime() - b.date.getTime());
  });

  readonly metricEntries = computed(() => buildBacktestMetricEntries(this.permutation()));
}

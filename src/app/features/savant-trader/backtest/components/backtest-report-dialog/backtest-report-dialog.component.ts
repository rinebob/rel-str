/**
 * Backtest Report Dialog
 *
 * Full-screen dialog that lays out a single permutation's performance report,
 * equity curve, underlying price + trade markers, and trade list in one view.
 */
import { Component, inject, ChangeDetectionStrategy, computed, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { DS_DIALOG_DATA, DsDialogRef } from '../../../../../shared/ds/ds-dialog';


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
    BacktestEquityCurveComponent,
    BacktestTradeTableComponent,
    BacktestUnderlyingChartComponent],
  templateUrl: './backtest-report-dialog.component.html',
  styleUrl: './backtest-report-dialog.component.scss',
})
export class BacktestReportDialogComponent {
  readonly data: BacktestReportDialogData = inject(DS_DIALOG_DATA);
  protected readonly ref = inject(DsDialogRef<BacktestReportDialogComponent>);

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

  /** Active tab: 0 Report, 1 Equity Curve, 2 Trades, 3 Underlying. */
  readonly reportTab = signal(0);

  /** WAI-ARIA tabs keyboard nav: arrows move + activate, Home/End jump. */
  onTabKeydown(event: KeyboardEvent): void {
    const tabs = Array.from(
      (event.currentTarget as HTMLElement).querySelectorAll<HTMLElement>('.tab'),
    );
    const count = tabs.length;
    if (count === 0) return;
    let next: number | null = null;
    switch (event.key) {
      case 'ArrowRight': next = (this.reportTab() + 1) % count; break;
      case 'ArrowLeft':  next = (this.reportTab() - 1 + count) % count; break;
      case 'Home':       next = 0; break;
      case 'End':        next = count - 1; break;
      default: return;
    }
    event.preventDefault();
    this.reportTab.set(next);
    tabs[next]?.focus();
  }
}

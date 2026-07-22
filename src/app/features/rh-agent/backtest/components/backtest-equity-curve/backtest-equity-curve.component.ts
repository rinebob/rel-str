/**
 * Reusable single-series equity curve chart.
 */
import { Component, ChangeDetectionStrategy, input } from '@angular/core';
import { CommonModule } from '@angular/common';
import {
  ChartModule,
  LineSeriesService,
  DateTimeService,
  TooltipService,
  LegendService,
} from '@syncfusion/ej2-angular-charts';

import type { BacktestEquityPoint } from '../../common/backtest.types';

export interface EquityCurvePoint {
  date: Date;
  value: number;
}

/** Convert raw backtest equity points into chart-ready points. */
export function toEquityCurvePoints(points: BacktestEquityPoint[] | undefined): EquityCurvePoint[] {
  return (points ?? [])
    .filter((p) => p.date)
    .map((p) => ({ date: new Date(p.date), value: p.equity }))
    .sort((a, b) => a.date.getTime() - b.date.getTime());
}

@Component({
  selector: 'app-backtest-equity-curve',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, ChartModule],
  providers: [LineSeriesService, DateTimeService, TooltipService, LegendService],
  templateUrl: './backtest-equity-curve.component.html',
  styleUrl: './backtest-equity-curve.component.scss',
})
export class BacktestEquityCurveComponent {
  readonly dataSource = input.required<EquityCurvePoint[]>();
  readonly seriesName = input<string>('Equity');
  readonly lineWidth = input<number>(2);
  readonly legendSettings = input<{ visible: boolean }>({ visible: false });

  readonly primaryXAxis = {
    valueType: 'DateTime' as const,
    labelFormat: 'MMM d',
    majorGridLines: { width: 0 },
  };

  readonly primaryYAxis = {
    labelFormat: '${value}',
    rangePadding: 'Round' as const,
  };

  readonly tooltip = { enable: true };
  readonly animation = { enable: false };
}

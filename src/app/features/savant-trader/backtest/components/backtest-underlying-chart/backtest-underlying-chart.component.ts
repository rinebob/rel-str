/**
 * Underlying price chart with trade entry/exit markers.
 */
import { Component, ChangeDetectionStrategy, computed, input } from '@angular/core';
import { CommonModule } from '@angular/common';
import {
  ChartModule,
  LineSeriesService,
  ScatterSeriesService,
  DateTimeService,
  TooltipService,
  LegendService,
} from '@syncfusion/ej2-angular-charts';

import type { BacktestTradeUi } from '../../common/backtest.types';

export interface UnderlyingPricePoint {
  date: Date;
  close: number;
}

interface TradePoint {
  date: Date;
  value: number;
}

@Component({
  selector: 'app-backtest-underlying-chart',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, ChartModule],
  providers: [LineSeriesService, ScatterSeriesService, DateTimeService, TooltipService, LegendService],
  templateUrl: './backtest-underlying-chart.component.html',
  styleUrl: './backtest-underlying-chart.component.scss',
})
export class BacktestUnderlyingChartComponent {
  readonly priceData = input.required<UnderlyingPricePoint[]>();
  readonly trades = input<BacktestTradeUi[] | undefined>(undefined);

  readonly longColor = '#22c55e';
  readonly shortColor = '#ef4444';

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

  readonly longEntryPoints = computed((): TradePoint[] => this.buildTradePoints('entry', 'long'));
  readonly shortEntryPoints = computed((): TradePoint[] => this.buildTradePoints('entry', 'short'));
  readonly longExitPoints = computed((): TradePoint[] => this.buildTradePoints('exit', 'long'));
  readonly shortExitPoints = computed((): TradePoint[] => this.buildTradePoints('exit', 'short'));

  private buildTradePoints(kind: 'entry' | 'exit', side: 'long' | 'short'): TradePoint[] {
    return (this.trades() ?? [])
      .filter((t) => t.side === side)
      .map((t) => ({
        date: new Date(kind === 'entry' ? t.entryDate : t.exitDate),
        value: kind === 'entry' ? t.entryUnderlying : t.exitUnderlying,
      }))
      .filter((pt) => !Number.isNaN(pt.date.getTime()))
      .sort((a, b) => a.date.getTime() - b.date.getTime());
  }
}

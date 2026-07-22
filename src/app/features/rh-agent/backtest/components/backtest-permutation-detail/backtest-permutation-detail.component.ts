/**
 * Backtest Permutation Detail Component
 *
 * Displays details for a single permutation: symbol, config, metrics,
 * errors/notes, and a mini equity-curve sparkline.
 */
import { Component, input, computed, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';
import {
  ChartModule,
  LineSeriesService,
  DateTimeService,
  TooltipService,
  LegendService,
} from '@syncfusion/ej2-angular-charts';

import type { BacktestPermutationUi } from '../../common/backtest.types';

@Component({
  selector: 'app-backtest-permutation-detail',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, MatIconModule, ChartModule],
  providers: [LineSeriesService, DateTimeService, TooltipService, LegendService],
  templateUrl: './backtest-permutation-detail.component.html',
  styleUrl: './backtest-permutation-detail.component.scss',
})
export class BacktestPermutationDetailComponent {
  readonly permutation = input<BacktestPermutationUi | null>(null);

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
  readonly legendSettings = { visible: false };
  readonly animation = { enable: false };

  readonly chartData = computed((): { date: Date; equity: number }[] => {
    const permutation = this.permutation();
    return (permutation?.equityCurve ?? [])
      .filter((p) => p.date && p.equity !== undefined)
      .map((p) => ({ date: new Date(p.date), equity: Number(p.equity) }));
  });

  readonly configEntries = computed((): { key: string; value: string }[] => {
    const permutation = this.permutation();
    const config = permutation?.config ?? {};
    return Object.entries(config).map(([key, value]) => ({
      key,
      value: typeof value === 'object' ? JSON.stringify(value) : String(value),
    }));
  });
}

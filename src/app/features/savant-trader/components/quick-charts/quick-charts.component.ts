/**
 * Quick Charts Component
 *
 * Compact stacked M/W/D chart panel for the Grouped Review page.
 * Each chart shows 100 bars, no zoom controls.
 * Data is loaded on demand when a symbol is selected.
 */
import {
  Component,
  inject,
  input,
  effect,
  signal,
  computed,
  ChangeDetectionStrategy,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';

import { IndicatorSeriesStore } from '../../stores/indicator-series.store';
import { ChartStore } from '../../stores/chart.store';
import {
  DEFAULT_CHART_INTERVALS,
  DEFAULT_CHART_INDICATORS,
  DEFAULT_CHART_STRATEGIES,
} from '../../stores/chart.store';
import { FlexChartComponent } from '../../../shared/components/flex-chart/flex-chart.component';
import type { FlexChartConfig, IndicatorConfig } from '../../../shared/components/flex-chart/flex-chart.types';
import { ChartIntervalKey } from '../../../shared/components/flex-chart/flex-chart.types';
import {
  buildBaseIndicators,
  injectCallableIndicatorData,
  addChartExtras,
  createExtrasSignals,
  ST_ZONE_WINDOW_MONTHLY_INDICATOR,
  ST_ZONE_WINDOW_WEEKLY_INDICATOR,
} from '../../utils/chart-indicators';

const QUICK_BARS = 100;

@Component({
  selector: 'app-quick-charts',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, MatIconModule, MatProgressSpinnerModule, FlexChartComponent],
  templateUrl: './quick-charts.component.html',
  styleUrl: './quick-charts.component.scss',
})
export class QuickChartsComponent {
  readonly chartStore = inject(ChartStore);
  private readonly indicatorStore = inject(IndicatorSeriesStore);

  /** Symbol to display. When null/undefined, shows the empty placeholder. */
  symbol = input<string | null>(null);

  /** Cached indicator series response for the current symbol/version/filters. */
  indicatorResponse = computed(() => {
    const symbol = this.symbol();
    const version = this.chartStore.symbolDataVersion();
    if (!symbol || !version) return undefined;
    return this.indicatorStore.responseFor()(
      symbol,
      version,
      DEFAULT_CHART_INTERVALS,
      DEFAULT_CHART_INDICATORS,
      DEFAULT_CHART_STRATEGIES,
    );
  });

  /** Shared crosshair date and price — whichever chart is hovered broadcasts here; all charts receive it. */
  readonly sharedCrosshairDate = signal<Date | null>(null);
  readonly sharedCrosshairPrice = signal<number | null>(null);

  // ── Raw interval data from the callable response ─────────────────────────
  private readonly dailyIntervalData = computed(() => this.indicatorResponse()?.intervals?.daily);
  private readonly weeklyIntervalData = computed(() => this.indicatorResponse()?.intervals?.weekly);
  private readonly monthlyIntervalData = computed(() => this.indicatorResponse()?.intervals?.monthly);

  // ── Derived extras (HTF windows, signal dots, uptick dots) ──────────────────
  private readonly extras = createExtrasSignals(this.dailyIntervalData, this.weeklyIntervalData);

  // ── Chart configs ──────────────────────────────────────────────────────────
  private buildQuickChartConfig(interval: ChartIntervalKey, indicators: IndicatorConfig[]): FlexChartConfig {
    return {
      indicators,
      showCrosshair: true,
      showZoomToolbar: false,
      enableScrollbar: false,
      initialZoomDays: QUICK_BARS,
      interval,
    };
  }

  readonly monthlyConfig = computed<FlexChartConfig>(() => {
    const indicators = injectCallableIndicatorData(
      buildBaseIndicators(ChartIntervalKey.MONTHLY),
      this.monthlyIntervalData(),
      this.chartStore.monthlyData()?.bars ?? [],
    );
    return this.buildQuickChartConfig(ChartIntervalKey.MONTHLY, indicators);
  });

  readonly weeklyConfig = computed<FlexChartConfig>(() => {
    const indicators = addChartExtras(
      injectCallableIndicatorData(
        buildBaseIndicators(ChartIntervalKey.WEEKLY),
        this.weeklyIntervalData(),
        this.chartStore.weeklyData()?.bars ?? [],
      ),
      {
        htfWindow: { option: ST_ZONE_WINDOW_MONTHLY_INDICATOR, data: this.extras.windowDataMonthlyOnWeekly() },
        signalDots: this.extras.weeklySignalDots(),
        uptickDotsV1: this.extras.weeklyUptickDotsV1(),
        uptickDotsV2: this.extras.weeklyUptickDotsV2(),
      },
    );
    return this.buildQuickChartConfig(ChartIntervalKey.WEEKLY, indicators);
  });

  readonly dailyConfig = computed<FlexChartConfig>(() => {
    const indicators = addChartExtras(
      injectCallableIndicatorData(
        buildBaseIndicators(ChartIntervalKey.DAILY),
        this.dailyIntervalData(),
        this.chartStore.dailyData()?.bars ?? [],
      ),
      {
        htfWindow: { option: ST_ZONE_WINDOW_WEEKLY_INDICATOR, data: this.extras.windowDataWeeklyOnDaily() },
        signalDots: this.extras.dailySignalDots(),
        uptickDotsV1: this.extras.dailyUptickDotsV1(),
        uptickDotsV2: this.extras.dailyUptickDotsV2(),
      },
    );
    return this.buildQuickChartConfig(ChartIntervalKey.DAILY, indicators);
  });

  constructor() {
    effect(() => {
      const sym = this.symbol();
      if (!sym) {
        this.chartStore.clearCharts();
        return;
      }
      this.chartStore.loadCharts(sym);
    });
  }
}

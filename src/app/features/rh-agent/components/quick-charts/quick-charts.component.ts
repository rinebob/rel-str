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

import { RhAgentChartService } from '../../services/rh-agent-chart.service';
import { IndicatorSeriesStore } from '../../stores/indicator-series.store';
import { FlexChartComponent } from '../../../shared/components/flex-chart/flex-chart.component';
import type { ChartDataset } from '../../../heatmap-chart/heatmap-chart.types';
import type { FlexChartConfig } from '../../../shared/components/flex-chart/flex-chart.types';
import {
  buildBaseIndicators,
  computeHtfZoneV2,
  computeHtfWindowData,
  injectCallableIndicatorData,
  convertZoneSignals,
  addHtfZoneWindow,
  addUptickDots,
  ST_ZONE_WINDOW_MONTHLY_INDICATOR,
  ST_ZONE_WINDOW_WEEKLY_INDICATOR,
  ST_ZONE_V1_UPTICK_DOTS_INDICATOR,
  ST_ZONE_V2_UPTICK_DOTS_INDICATOR,
} from '../../utils/rh-agent-chart-indicators';
import { ChartInterval, IndicatorFamily, StrategyFamily } from '../../common/rh-agent-indicator.types';

const QUICK_BARS = 100;

@Component({
  selector: 'app-quick-charts',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, MatIconModule, MatProgressSpinnerModule, FlexChartComponent],
  templateUrl: './quick-charts.component.html',
  styleUrl: './quick-charts.component.scss',
})
export class QuickChartsComponent {
  private readonly chartService = inject(RhAgentChartService);
  private readonly indicatorStore = inject(IndicatorSeriesStore);

  /** Symbol to display. When null/undefined, shows the empty placeholder. */
  symbol = input<string | null>(null);

  // ── Local state ────────────────────────────────────────────────────────────
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);
  readonly dailyData = signal<ChartDataset | null>(null);
  readonly weeklyData = signal<ChartDataset | null>(null);
  readonly monthlyData = signal<ChartDataset | null>(null);
  readonly barsVersion = signal<string>('');

  /** Default indicator filters for the callable. */
  private readonly defaultIntervals = [ChartInterval.DAILY, ChartInterval.WEEKLY, ChartInterval.MONTHLY];
  private readonly defaultIndicators = [
    IndicatorFamily.ZONE_V1,
    IndicatorFamily.ZONE_V2,
    IndicatorFamily.TREND_STRENGTH,
    IndicatorFamily.TREND_BANDS,
  ];
  private readonly defaultStrategies = [
    StrategyFamily.ZONE_V1,
    StrategyFamily.ZONE_V2,
    StrategyFamily.TREND_STRENGTH,
  ];

  /** Cached indicator series response for the current symbol/version/filters. */
  indicatorResponse = computed(() => {
    const symbol = this.symbol();
    const version = this.barsVersion();
    if (!symbol || !version) return undefined;
    return this.indicatorStore.responseFor()(
      symbol,
      version,
      this.defaultIntervals,
      this.defaultIndicators,
      this.defaultStrategies,
    );
  });

  /** Shared crosshair date — whichever chart is hovered broadcasts here; all charts receive it. */
  readonly sharedCrosshairDate = signal<Date | null>(null);

  // ── HTF zones / windows / dots data (computed from chart data) ─────────────
  private readonly weeklyZoneV2 = computed(() => {
    const d = this.weeklyData();
    return d ? computeHtfZoneV2(d.bars) : [];
  });

  private readonly monthlyZoneV2 = computed(() => {
    const d = this.monthlyData();
    return d ? computeHtfZoneV2(d.bars) : [];
  });

  private readonly dailyWindowData = computed(() => {
    const d = this.dailyData();
    return d ? computeHtfWindowData(this.weeklyZoneV2(), d.bars) : [];
  });

  private readonly weeklyWindowData = computed(() => {
    const d = this.weeklyData();
    return d ? computeHtfWindowData(this.monthlyZoneV2(), d.bars) : [];
  });

  private readonly dailyIntervalData = computed(() => this.indicatorResponse()?.intervals?.daily);
  private readonly weeklyIntervalData = computed(() => this.indicatorResponse()?.intervals?.weekly);
  private readonly monthlyIntervalData = computed(() => this.indicatorResponse()?.intervals?.monthly);

  private readonly dailyDotsV1 = computed(() => {
    const d = this.dailyData();
    return d ? convertZoneSignals(this.dailyIntervalData(), d.bars, true) : [];
  });

  private readonly dailyDotsV2 = computed(() => {
    const d = this.dailyData();
    return d ? convertZoneSignals(this.dailyIntervalData(), d.bars, false) : [];
  });

  private readonly weeklyDotsV1 = computed(() => {
    const d = this.weeklyData();
    return d ? convertZoneSignals(this.weeklyIntervalData(), d.bars, true) : [];
  });

  private readonly weeklyDotsV2 = computed(() => {
    const d = this.weeklyData();
    return d ? convertZoneSignals(this.weeklyIntervalData(), d.bars, false) : [];
  });

  // ── Chart configs ──────────────────────────────────────────────────────────
  readonly monthlyConfig = computed<FlexChartConfig>(() => {
    const indicators = injectCallableIndicatorData(
      buildBaseIndicators('monthly'),
      this.monthlyIntervalData(),
      this.monthlyData()?.bars ?? [],
    );
    return {
      indicators,
      showCrosshair: true,
      showZoomToolbar: false,
      enableScrollbar: false,
      initialZoomDays: QUICK_BARS,
      interval: 'monthly',
    };
  });

  readonly weeklyConfig = computed<FlexChartConfig>(() => {
    const indicators = injectCallableIndicatorData(
      buildBaseIndicators('weekly'),
      this.weeklyIntervalData(),
      this.weeklyData()?.bars ?? [],
    );
    addHtfZoneWindow(indicators, ST_ZONE_WINDOW_MONTHLY_INDICATOR, this.weeklyWindowData());
    addUptickDots(indicators, ST_ZONE_V1_UPTICK_DOTS_INDICATOR, this.weeklyDotsV1());
    addUptickDots(indicators, ST_ZONE_V2_UPTICK_DOTS_INDICATOR, this.weeklyDotsV2());
    return {
      indicators,
      showCrosshair: true,
      showZoomToolbar: false,
      enableScrollbar: false,
      initialZoomDays: QUICK_BARS,
      interval: 'weekly',
    };
  });

  readonly dailyConfig = computed<FlexChartConfig>(() => {
    const indicators = injectCallableIndicatorData(
      buildBaseIndicators('daily'),
      this.dailyIntervalData(),
      this.dailyData()?.bars ?? [],
    );
    addHtfZoneWindow(indicators, ST_ZONE_WINDOW_WEEKLY_INDICATOR, this.dailyWindowData());
    addUptickDots(indicators, ST_ZONE_V1_UPTICK_DOTS_INDICATOR, this.dailyDotsV1());
    addUptickDots(indicators, ST_ZONE_V2_UPTICK_DOTS_INDICATOR, this.dailyDotsV2());
    return {
      indicators,
      showCrosshair: true,
      showZoomToolbar: false,
      enableScrollbar: false,
      initialZoomDays: QUICK_BARS,
      interval: 'daily',
    };
  });

  constructor() {
    effect(() => {
      const sym = this.symbol();
      if (!sym) {
        this.dailyData.set(null);
        this.weeklyData.set(null);
        this.monthlyData.set(null);
        this.error.set(null);
        return;
      }
      this.loadCharts(sym);
    });
  }

  /**
   * Load D/W/M chart data for the selected symbol from rs-bars.
   * Also fetches the backend indicator series via the store.
   */
  private loadCharts(symbol: string): void {
    this.loading.set(true);
    this.error.set(null);

    this.chartService.loadBars$(symbol).subscribe({
      next: (result) => {
        this.dailyData.set(result.daily);
        this.weeklyData.set(result.weekly);
        this.monthlyData.set(result.monthly);
        const version = result.version ?? '';
        this.barsVersion.set(version);
        if (version) {
          this.indicatorStore.loadIfNeeded(
            symbol,
            version,
            this.defaultIntervals,
            this.defaultIndicators,
            this.defaultStrategies,
          );
        }
        this.loading.set(false);
      },
      error: (err: unknown) => {
        const message = err instanceof Error ? err.message : 'Failed to load charts';
        this.error.set(message);
        this.loading.set(false);
      },
    });
  }
}

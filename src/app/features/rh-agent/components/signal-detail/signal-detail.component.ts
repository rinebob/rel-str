/**
 * Signal Detail Component
 *
 * Detail panel for the review interface.
 *
 * Supports two chart layouts:
 * - Single: one D/W/M chart controlled by `selectedInterval`.
 * - Triple: D/W/M charts stacked, with a shared crosshair for visual alignment.
 *
 * HTF-derived indicators (weekly zone windows on daily, monthly zone windows on weekly,
 * signal dots, and ST Trend Rider dots) are computed from the chart store data and injected
 * into the base indicator list before being passed to the flex chart component.
 */
import { Component, inject, ChangeDetectionStrategy, output, computed, signal, input, effect } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';

import { RhAgentChartStore } from '../../stores/rh-agent-chart.store';
import {
  DEFAULT_CHART_INTERVALS,
  DEFAULT_CHART_INDICATORS,
  DEFAULT_CHART_STRATEGIES,
} from '../../stores/rh-agent-chart.store';
import type { ChartDataset } from '../../../heatmap-chart/heatmap-chart.types';
import { FlexChartComponent } from '../../../shared/components/flex-chart/flex-chart.component';
import { BarsInterval } from '../../../../core/models/partner.types';
import { UiStateService } from '../../../../core/services/ui-state.service';
import type { FlexChartConfig, IndicatorConfig, IndicatorOption } from '../../../shared/components/flex-chart/flex-chart.types';
import { ChartIntervalKey, StIndicator } from '../../../shared/components/flex-chart/flex-chart.types';
import { ST_INDICATOR_OPTIONS } from '../../../shared/components/flex-chart/indicators/indicator-registry';
import { ST_SIGNAL_DOTS_INDICATOR } from '../../../shared/components/flex-chart/indicators/st-signal-dots.indicator';
import { ChartToolbarComponent } from '../chart-toolbar/chart-toolbar.component';
import {
  buildBaseIndicators,
  addRhAgentExtras,
  createRhAgentExtrasSignals,
  ST_ZONE_WINDOW_MONTHLY_INDICATOR,
  ST_ZONE_WINDOW_WEEKLY_INDICATOR,
  ST_ZONE_V1_UPTICK_DOTS_INDICATOR,
  ST_ZONE_V2_UPTICK_DOTS_INDICATOR,
  injectCallableIndicatorData,
} from '../../utils/rh-agent-chart-indicators';
import { RhAgentSymbolHistoryStore } from '../../stores/rh-agent-symbol-history.store';
import { IndicatorSeriesStore } from '../../stores/indicator-series.store';

// Approximate trading-bar counts used by rangeBarsFor().
const TRADING_DAYS_PER_YEAR = 252;
const WEEKS_PER_YEAR = 52;
const MONTHS_PER_YEAR = 12;
const TRADING_DAYS_PER_MONTH = 21;
const WEEKS_PER_MONTH = 4.33;
const RECENT_DAILY_BARS = 365;
const RECENT_WEEKLY_BARS = 104;
const RECENT_MONTHLY_BARS = 60;
const ALL_BARS_MAX = 99999;

@Component({
  selector: 'app-signal-detail',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, MatCardModule, MatButtonModule, MatIconModule, MatTooltipModule, MatProgressSpinnerModule, FlexChartComponent, ChartToolbarComponent],
  templateUrl: './signal-detail.component.html',
  styleUrl: './signal-detail.component.scss',
})
export class SignalDetailComponent {
  readonly chartStore = inject(RhAgentChartStore);
  readonly uiState = inject(UiStateService);
  readonly historyStore = inject(RhAgentSymbolHistoryStore);
  readonly indicatorStore = inject(IndicatorSeriesStore);

  /** Expose enum to template */
  readonly BarsInterval = BarsInterval;

  signalAccepted = output<string>();
  signalConsidered = output<string>();
  signalRejected = output<string>();

  /** Manual symbol override from parent (when user types a symbol directly) */
  manualSymbol = input<string | null>(null);

  /** Show chart when a manual symbol is entered */
  showChart = computed(() => !!this.manualSymbol());

  /** Shared price-axis scale setting across all charts in this view */
  logScale = signal<boolean>(false);

  /** Local reference to chart data for convenient access in this component. */
  readonly chartData = computed(() => this.chartStore.dailyData());
  readonly chartDataWeekly = computed(() => this.chartStore.weeklyData());
  readonly chartDataMonthly = computed(() => this.chartStore.monthlyData());
  readonly chartLoading = computed(() => this.chartStore.loading());

  /** Shared crosshair date and price for syncing across triple charts */
  crosshairDate = signal<Date | null>(null);
  crosshairPrice = signal<number | null>(null);

  /** Toggle zoom/pan toolbar visibility on all charts */
  showZoomToolbar = signal(false);

  /** All ST indicator options */
  readonly stIndicatorOptions = ST_INDICATOR_OPTIONS;

  /** Indicators available for each chart context — core ST indicators + callable signal markers */
  private static readonly INDICATORS_BY_INTERVAL: Record<ChartIntervalKey, string[]> = {
    [ChartIntervalKey.DAILY]:   [StIndicator.TREND_BANDS, StIndicator.TREND_STRENGTH, StIndicator.ZONE, StIndicator.ZONE_V2,
                                ST_SIGNAL_DOTS_INDICATOR.id, ST_ZONE_V1_UPTICK_DOTS_INDICATOR.id,
                                ST_ZONE_V2_UPTICK_DOTS_INDICATOR.id, ST_ZONE_WINDOW_WEEKLY_INDICATOR.id],
    [ChartIntervalKey.WEEKLY]:  [StIndicator.TREND_BANDS, StIndicator.TREND_STRENGTH, StIndicator.ZONE, StIndicator.ZONE_V2,
                                ST_SIGNAL_DOTS_INDICATOR.id, ST_ZONE_V1_UPTICK_DOTS_INDICATOR.id,
                                ST_ZONE_V2_UPTICK_DOTS_INDICATOR.id, ST_ZONE_WINDOW_MONTHLY_INDICATOR.id],
    [ChartIntervalKey.MONTHLY]: [StIndicator.TREND_BANDS, StIndicator.TREND_STRENGTH, StIndicator.ZONE, StIndicator.ZONE_V2],
  };

  /** Indicator options visible in the menu for the currently active chart */
  activeChartIndicatorOptions = computed<IndicatorOption[]>(() => {
    const key = SignalDetailComponent.intervalKey(this.activeChartInterval());
    const allowed = SignalDetailComponent.INDICATORS_BY_INTERVAL[key];
    return ST_INDICATOR_OPTIONS.filter(o => allowed.includes(o.id));
  });

  /** Per-interval selected indicator ID sets — all on by default */
  private selectedIdsByInterval = signal<Record<ChartIntervalKey, Set<string>>>({
    [ChartIntervalKey.DAILY]:   new Set(SignalDetailComponent.INDICATORS_BY_INTERVAL[ChartIntervalKey.DAILY]),
    [ChartIntervalKey.WEEKLY]:  new Set(SignalDetailComponent.INDICATORS_BY_INTERVAL[ChartIntervalKey.WEEKLY]),
    [ChartIntervalKey.MONTHLY]: new Set(SignalDetailComponent.INDICATORS_BY_INTERVAL[ChartIntervalKey.MONTHLY]),
  });

  /** Selected indicator IDs for the currently active chart interval. */
  activeSelectedIndicatorIds = computed<Set<string>>(() => {
    const key = SignalDetailComponent.intervalKey(this.activeChartInterval());
    return this.selectedIdsByInterval()[key];
  });

  /** Cached indicator series response for the current symbol/version/filters. */
  indicatorResponse = computed(() => {
    const symbol = this.manualSymbol();
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

  private dailyIntervalData = computed(() => this.indicatorResponse()?.intervals?.daily);
  private weeklyIntervalData = computed(() => this.indicatorResponse()?.intervals?.weekly);
  private monthlyIntervalData = computed(() => this.indicatorResponse()?.intervals?.monthly);

  /** Base active indicators for an interval, filtered by the user's current selection. */
  private baseIndicatorsFor(key: ChartIntervalKey): IndicatorConfig[] {
    const ids = this.selectedIdsByInterval()[key];
    const base = buildBaseIndicators(key).filter(cfg => ids.has(cfg.type));

    const response = this.indicatorResponse();
    const bars = key === ChartIntervalKey.WEEKLY ? this.chartDataWeekly()?.bars
      : key === ChartIntervalKey.MONTHLY ? this.chartDataMonthly()?.bars
      : this.chartData()?.bars;

    if (!response || !bars || bars.length === 0) return base;

    const intervalData = response.intervals[key];
    return injectCallableIndicatorData(base, intervalData, bars);
  }

  /** Base active indicators for the monthly chart */
  private monthlyIndicators = computed<IndicatorConfig[]>(() => this.baseIndicatorsFor(ChartIntervalKey.MONTHLY));

  /** Which chart the Indicators menu targets (daily by default) */
  activeChartInterval = signal<BarsInterval>(BarsInterval.DAILY);

  /** Selected chart interval */
  selectedInterval = signal<BarsInterval>(BarsInterval.DAILY);

  /** Selected chart time range */
  selectedRange = signal<'recent' | '6m' | '1y' | '5y' | 'all'>('recent');

  /** Number of bars to show based on the selected range and interval */
  rangeBars = computed(() => this.rangeBarsFor(this.selectedInterval()));

  private rangeBarsFor(interval: BarsInterval): number {
    const range = this.selectedRange();
    const barsPerYear = interval === BarsInterval.WEEKLY ? WEEKS_PER_YEAR
      : interval === BarsInterval.MONTHLY ? MONTHS_PER_YEAR
      : TRADING_DAYS_PER_YEAR;
    const barsPerMonth = interval === BarsInterval.WEEKLY ? WEEKS_PER_MONTH
      : interval === BarsInterval.MONTHLY ? 1
      : TRADING_DAYS_PER_MONTH;

    switch (range) {
      case 'recent': return interval === BarsInterval.WEEKLY ? RECENT_WEEKLY_BARS
        : interval === BarsInterval.MONTHLY ? RECENT_MONTHLY_BARS
        : RECENT_DAILY_BARS;
      case '6m': return Math.round(6 * barsPerMonth);
      case '1y': return barsPerYear;
      case '5y': return Math.round(5 * barsPerYear);
      case 'all': return ALL_BARS_MAX;
    }
  }

  /** Active chart dataset for single-mode based on the selected interval */
  activeChartData = computed<ChartDataset | null>(() => {
    const interval = this.selectedInterval();
    if (interval === BarsInterval.WEEKLY) return this.chartDataWeekly();
    if (interval === BarsInterval.MONTHLY) return this.chartDataMonthly();
    return this.chartData();
  });

  /** Dynamic chart config driven by user-added indicators (single mode) */
  chartConfig = computed<FlexChartConfig>(() => {
    const interval = this.selectedInterval();
    const key = SignalDetailComponent.intervalKey(interval);

    const indicators = interval === BarsInterval.DAILY
      ? this.dailyIndicators()
      : interval === BarsInterval.WEEKLY
        ? this.weeklyIndicators()
        : this.monthlyIndicators();

    return {
      indicators,
      showCrosshair: true,
      showZoomToolbar: this.showZoomToolbar(),
      enableScrollbar: true,
      initialZoomDays: this.rangeBars(),
      interval: key,
      logScale: this.logScale(),
    };
  });

  // =========================================================================
  // HTF windows / signal dots / ST Trend Rider dots data (from backend)
  // =========================================================================

  private readonly extras = createRhAgentExtrasSignals(this.dailyIntervalData, this.weeklyIntervalData);

  /** Daily chart indicators = base + conditionally-injected computed extras */
  private dailyIndicators = computed<IndicatorConfig[]>(() => {
    const sel = this.selectedIdsByInterval()[ChartIntervalKey.DAILY];
    return addRhAgentExtras(this.baseIndicatorsFor(ChartIntervalKey.DAILY), {
      htfWindow: sel.has(ST_ZONE_WINDOW_WEEKLY_INDICATOR.id)
        ? { option: ST_ZONE_WINDOW_WEEKLY_INDICATOR, data: this.extras.windowDataWeeklyOnDaily() }
        : undefined,
      signalDots: sel.has(ST_SIGNAL_DOTS_INDICATOR.id) ? this.extras.dailySignalDots() : undefined,
      uptickDotsV1: sel.has(ST_ZONE_V1_UPTICK_DOTS_INDICATOR.id) ? this.extras.dailyUptickDotsV1() : undefined,
      uptickDotsV2: sel.has(ST_ZONE_V2_UPTICK_DOTS_INDICATOR.id) ? this.extras.dailyUptickDotsV2() : undefined,
    });
  });

  /** Weekly chart indicators = base + conditionally-injected computed extras */
  private weeklyIndicators = computed<IndicatorConfig[]>(() => {
    const sel = this.selectedIdsByInterval()[ChartIntervalKey.WEEKLY];
    return addRhAgentExtras(this.baseIndicatorsFor(ChartIntervalKey.WEEKLY), {
      htfWindow: sel.has(ST_ZONE_WINDOW_MONTHLY_INDICATOR.id)
        ? { option: ST_ZONE_WINDOW_MONTHLY_INDICATOR, data: this.extras.windowDataMonthlyOnWeekly() }
        : undefined,
      signalDots: sel.has(ST_SIGNAL_DOTS_INDICATOR.id) ? this.extras.weeklySignalDots() : undefined,
      uptickDotsV1: sel.has(ST_ZONE_V1_UPTICK_DOTS_INDICATOR.id) ? this.extras.weeklyUptickDotsV1() : undefined,
      uptickDotsV2: sel.has(ST_ZONE_V2_UPTICK_DOTS_INDICATOR.id) ? this.extras.weeklyUptickDotsV2() : undefined,
    });
  });

  /** Build a triple-mode chart config shell for the given interval. */
  private buildTripleChartConfig(interval: BarsInterval, indicators: IndicatorConfig[]): FlexChartConfig {
    return {
      indicators,
      showCrosshair: true,
      showZoomToolbar: this.showZoomToolbar(),
      enableScrollbar: true,
      initialZoomDays: this.rangeBarsFor(interval),
      interval: SignalDetailComponent.intervalKey(interval),
      logScale: this.logScale(),
    };
  }

  /** Chart config for daily chart in triple mode */
  chartConfigDaily = computed<FlexChartConfig>(() =>
    this.buildTripleChartConfig(BarsInterval.DAILY, this.dailyIndicators()),
  );

  /** Chart config for weekly chart in triple mode */
  chartConfigWeekly = computed<FlexChartConfig>(() =>
    this.buildTripleChartConfig(BarsInterval.WEEKLY, this.weeklyIndicators()),
  );

  /** Chart config for monthly chart in triple mode */
  chartConfigMonthly = computed<FlexChartConfig>(() =>
    this.buildTripleChartConfig(BarsInterval.MONTHLY, this.monthlyIndicators()),
  );

  /** Toggle an indicator on/off for the currently active chart interval */
  onToggleIndicator(optionId: string): void {
    const key = SignalDetailComponent.intervalKey(this.activeChartInterval());
    this.selectedIdsByInterval.update(current => {
      const next = new Set(current[key]);
      if (next.has(optionId)) next.delete(optionId); else next.add(optionId);
      return { ...current, [key]: next };
    });
  }

  /** Whether a given indicator is active for the currently active chart interval */
  isIndicatorSelected(optionId: string): boolean {
    const key = SignalDetailComponent.intervalKey(this.activeChartInterval());
    return this.selectedIdsByInterval()[key].has(optionId);
  }

  /** Map BarsInterval to the canonical chart interval key. */
  private static intervalKey(interval: BarsInterval): ChartIntervalKey {
    return interval === BarsInterval.WEEKLY
      ? ChartIntervalKey.WEEKLY
      : interval === BarsInterval.MONTHLY
        ? ChartIntervalKey.MONTHLY
        : ChartIntervalKey.DAILY;
  }

  /** Set the active chart (for the indicator menu) — used by triple-mode chart label clicks */
  setActiveChart(interval: BarsInterval): void {
    this.activeChartInterval.set(interval);
  }

  /** Change the chart interval (D/W/M) — also sets activeChartInterval in single mode */
  onIntervalChange(interval: BarsInterval): void {
    this.selectedInterval.set(interval);
    this.activeChartInterval.set(interval);
  }

  /** Update shared crosshair date for triple-chart sync */
  onCrosshairChange(date: Date | null): void {
    this.crosshairDate.set(date);
  }

  /** Update shared crosshair price for triple-chart sync */
  onCrosshairPriceChange(price: number | null): void {
    this.crosshairPrice.set(price);
  }

  /** Toggle price-axis log/linear scale across all charts in this view */
  onToggleLogScale(): void {
    this.logScale.update(current => !current);
  }

  /**
   * Load chart data when a manual symbol is supplied (review page / order page).
   * The chart store handles the fetch, cancellation, and indicator series trigger.
   */
  constructor() {
    effect(() => {
      const symbol = this.manualSymbol();
      if (!symbol) {
        this.chartStore.clearCharts();
        return;
      }
      this.historyStore.loadSignalHistory(symbol);
      this.chartStore.loadCharts(symbol);
    });
  }
}

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

import { ChartStore } from '../../stores/chart.store';
import {
  DEFAULT_CHART_INTERVALS,
  DEFAULT_CHART_INDICATORS,
  DEFAULT_CHART_STRATEGIES,
} from '../../stores/chart.store';
import type { ChartDataset } from '../../../heatmap-chart/heatmap-chart.types';
import { FlexChartComponent } from '../../../shared/components/flex-chart/flex-chart.component';
import { BarsInterval } from '../../../../core/models/partner.types';
import { UiStateService, ChartLayout } from '../../../../core/services/ui-state.service';
import type { FlexChartConfig, IndicatorConfig, PriceBar, ChartRange } from '../../../shared/components/flex-chart/flex-chart.types';
import { ChartIntervalKey } from '../../../shared/components/flex-chart/flex-chart.types';
import { ST_SIGNAL_DOTS_INDICATOR } from '../../../shared/components/flex-chart/indicators/st-signal-dots.indicator';
import {
  ST_TRIGGER_BANDS_DOTS_INDICATOR,
  ST_TRIGGER_BANDS_INDICATOR,
} from '../../../shared/components/flex-chart/indicators/st-trigger-bands.indicator';
import { ChartToolbarComponent } from '../chart-toolbar/chart-toolbar.component';
import { SymbolListActionsComponent } from '../symbol-list-actions/symbol-list-actions.component';
import {
  buildBaseIndicators,
  buildConfigForId,
  addChartExtras,
  createExtrasSignals,
  ST_ZONE_WINDOW_MONTHLY_INDICATOR,
  ST_ZONE_WINDOW_WEEKLY_INDICATOR,
  ST_ZONE_V1_UPTICK_DOTS_INDICATOR,
  ST_ZONE_V2_UPTICK_DOTS_INDICATOR,
  injectCallableIndicatorData,
  injectTriggerBandsData,
  convertTriggerBandsDotMarkers,
  bindTriggerBandsRequest,
  chartIntervalKey,
} from '../../utils/chart-indicators';
import { ChartToolbarStateService } from '../../services/chart-toolbar-state.service';
import { SymbolHistoryStore } from '../../stores/symbol-history.store';
import { IndicatorSeriesStore } from '../../stores/indicator-series.store';
import type { IntervalData, SymbolIndicatorSeriesResponse } from '../../common/indicator.types';
import type { SymbolListDef } from '../../common/symbol-list-defs';

/** Approximate trading-bar counts used by {@link SignalDetailComponent.rangeBarsFor}. */
const TRADING_DAYS_PER_YEAR = 252;   /** ~252 trading sessions per calendar year. */
const WEEKS_PER_YEAR = 52;           /** Calendar weeks per year. */
const MONTHS_PER_YEAR = 12;          /** Calendar months per year. */
const TRADING_DAYS_PER_MONTH = 21;   /** ~21 trading sessions per calendar month. */
const WEEKS_PER_MONTH = 4.33;        /** Average calendar weeks per month (52/12). */
const RECENT_DAILY_BARS = 365;       /** 'recent' daily view: ~365 calendar days of bars (not trading days). */
const RECENT_WEEKLY_BARS = 104;      /** 'recent' weekly view: ~2 years of weekly bars. */
const RECENT_MONTHLY_BARS = 60;      /** 'recent' monthly view: 5 years of monthly bars. */
const ALL_BARS_MAX = 99999;          /** Sentinel passed to visibleBars to show all available bars. */

@Component({
  selector: 'app-signal-detail',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, MatCardModule, MatButtonModule, MatIconModule, MatTooltipModule, MatProgressSpinnerModule, FlexChartComponent, ChartToolbarComponent, SymbolListActionsComponent],
  templateUrl: './signal-detail.component.html',
  styleUrl: './signal-detail.component.scss',
})
export class SignalDetailComponent {

  // ==========================================================================
  // Static constants and pure functions
  // ==========================================================================

  /** Pure function: converts a range preset to an approximate bar count for the given interval.
   *  'recent' returns fixed well-known bar counts; other presets multiply calendar units
   *  by the average bars-per-period for that interval.
   */
  private static rangeBarsFor(interval: BarsInterval, range: ChartRange): number {
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
      default:   return ALL_BARS_MAX;
    }
  }

  /** Pure function: builds the filtered indicator config list for one interval.
   *  Starts from the registered base configs, keeps only IDs in `ids`, then overlays
   *  any callable-response data (zone values, band data) from `response` when available.
   *  Returns the base-filtered list unchanged when bars or response are absent.
   */
  private static baseIndicatorsFor(
    key: ChartIntervalKey,
    ids: Set<string>,
    response: SymbolIndicatorSeriesResponse | undefined,
    bars: PriceBar[] | undefined,
    triggerBandsIntervalData?: IntervalData,
  ): IndicatorConfig[] {
    const base = buildBaseIndicators(key).filter(cfg => ids.has(cfg.type));
    // Add configs for selected non-default indicators (e.g. STD_DEV_LINES)
    const defaultIds = new Set(base.map(cfg => cfg.type as string));
    const extras = [...ids]
      .filter(id => !defaultIds.has(id))
      .map(id => buildConfigForId(id))
      .filter((cfg): cfg is IndicatorConfig => cfg !== undefined);
    const all = [...base, ...extras];
    // TWO_DAY has no backend interval data — the response only carries
    // daily/weekly/monthly.
    const intervalData = key === ChartIntervalKey.TWO_DAY ? undefined : response?.intervals[key];
    const injected = !intervalData || !bars || bars.length === 0
      ? all
      : injectCallableIndicatorData(all, intervalData, bars, `signal-detail:${key}`);
    // Trigger Bands arrive on a separate opt-in response — its own injector so
    // the default path neither blanks nor is invalidated by it.
    return injectTriggerBandsData(injected, triggerBandsIntervalData, bars, `signal-detail:${key}`);
  }

  /** Pure function: assembles a `FlexChartConfig` for one chart in triple mode.
   *  Accepts all reactive values as explicit parameters so computed call sites
   *  control dependency tracking — no hidden signal reads inside this function.
   */
  private static tripleChartConfig(
    interval: BarsInterval,
    indicators: IndicatorConfig[],
    rangeBars: number,
    showZoomToolbar: boolean,
    logScale: boolean,
  ): FlexChartConfig {
    return {
      indicators,
      showCrosshair: true,
      showZoomToolbar,
      enableScrollbar: true,
      visibleBars: rangeBars,
      interval: chartIntervalKey(interval),
      logScale,
    };
  }

  // ==========================================================================
  // Injected services
  // ==========================================================================

  /** @internal */
  readonly chartStore = inject(ChartStore);
  /** @internal */
  readonly uiStateService = inject(UiStateService);
  /** @internal */
  readonly historyStore = inject(SymbolHistoryStore);
  /** @internal */
  readonly indicatorStore = inject(IndicatorSeriesStore);
  /** Page-scoped toolbar state — hoisted (#1232/#1255) so the page-level
   *  merged toolbar and this component's charts share one source. Provided
   *  by the hosting page component. */
  readonly toolbarState = inject(ChartToolbarStateService);

  // ==========================================================================
  // Enum re-exports, inputs, outputs
  // ==========================================================================

  /** Exposed for template comparisons — Angular templates cannot reference imported enums directly. */
  readonly BarsInterval = BarsInterval;
  readonly ChartLayout = ChartLayout;

  /** Symbol to display. When non-null the chart panel renders; null collapses it. */
  manualSymbol = input<string | null>(null);
  listCatalog = input.required<SymbolListDef[]>();
  /** 0-based index of this symbol within the review queue, or -1 when not in queue. */
  symbolIndex = input<number>(-1);
  /** Total number of symbols in the review queue. */
  symbolCount = input<number>(0);
  /** When false, the in-template toolbar is suppressed — the host page renders
   *  its own merged toolbar bound to the same `ChartToolbarStateService`
   *  (chart-view, #1232/#1255). Charts are unaffected. */
  showToolbar = input(true);

  /** Emits when the user toggles the active symbol's list membership. */
  toggleList = output<{ symbol: string; listKey: string }>();
  /** Emits when the user clicks the previous-symbol nav button. */
  prevSymbol = output<void>();
  /** Emits when the user clicks the next-symbol nav button. */
  nextSymbol = output<void>();

  // ==========================================================================
  // UI state signals
  // ==========================================================================

  /** True while `manualSymbol` is set — drives `@if (showChart())` in the template. */
  showChart = computed(() => !!this.manualSymbol());

  /** Crosshair date shared across all three charts in triple layout for visual alignment. */
  crosshairDate = signal<Date | null>(null);
  /** Crosshair price shared across all three charts in triple layout for visual alignment. */
  crosshairPrice = signal<number | null>(null);

  // Toolbar view state lives in the page-scoped ChartToolbarStateService —
  // aliased here so template bindings and local computeds stay unchanged.
  readonly selectedInterval = this.toolbarState.selectedInterval;
  readonly selectedRange = this.toolbarState.selectedRange;
  readonly showZoomToolbar = this.toolbarState.showZoomToolbar;
  readonly activeChartInterval = this.toolbarState.activeChartInterval;
  readonly logScale = this.toolbarState.logScale;
  private readonly selectedIdsByInterval = this.toolbarState.selectedIdsByInterval;
  private readonly indicatorScope = this.toolbarState.indicatorScope;
  readonly activeChartIndicatorOptions = this.toolbarState.activeChartIndicatorOptions;
  readonly activeSelectedIndicatorIds = this.toolbarState.activeSelectedIndicatorIds;

  // ==========================================================================
  // Chart store data aliases
  // ==========================================================================

  /** Daily price bars from the chart store, re-exposed for local computed use. */
  readonly chartData = computed(() => this.chartStore.dailyData());
  /** Weekly price bars from the chart store, re-exposed for local computed use. */
  readonly chartDataWeekly = computed(() => this.chartStore.weeklyData());
  /** Monthly price bars from the chart store, re-exposed for local computed use. */
  readonly chartDataMonthly = computed(() => this.chartStore.monthlyData());
  /** True while the chart store is fetching bars for the current symbol. */
  readonly chartLoading = computed(() => this.chartStore.loading());

  // ==========================================================================
  // Range bars
  // ==========================================================================

  /** Bar count for the active single-mode interval + selected range. Passed to `chartConfig`. */
  rangeBars        = computed(() => SignalDetailComponent.rangeBarsFor(this.selectedInterval(), this.selectedRange()));
  /** Bar count for the daily chart in triple mode. */
  private rangeBarsDaily   = computed(() => SignalDetailComponent.rangeBarsFor(BarsInterval.DAILY,   this.selectedRange()));
  /** Bar count for the weekly chart in triple mode. */
  private rangeBarsWeekly  = computed(() => SignalDetailComponent.rangeBarsFor(BarsInterval.WEEKLY,  this.selectedRange()));
  /** Bar count for the monthly chart in triple mode. */
  private rangeBarsMonthly = computed(() => SignalDetailComponent.rangeBarsFor(BarsInterval.MONTHLY, this.selectedRange()));

  // ==========================================================================
  // Active chart data and single-mode config
  // ==========================================================================

  /** Dataset for the single-chart view — switches between daily/weekly/monthly bars
   *  as `selectedInterval` changes. Not used in triple mode (each chart has its own input).
   */
  activeChartData = computed<ChartDataset | null>(() => {
    const interval = this.selectedInterval();
    if (interval === BarsInterval.WEEKLY) return this.chartDataWeekly();
    if (interval === BarsInterval.MONTHLY) return this.chartDataMonthly();
    return this.chartData();
  });

  /** Chart config for single-chart mode. Switches indicators and interval key with
   *  `selectedInterval`. For triple mode use `chartConfigDaily/Weekly/Monthly`.
   */
  chartConfig = computed<FlexChartConfig>(() => {
    const interval = this.selectedInterval();
    const indicators = interval === BarsInterval.DAILY
      ? this.dailyIndicators()
      : interval === BarsInterval.WEEKLY
        ? this.weeklyIndicators()
        : this.monthlyIndicators();
    return SignalDetailComponent.tripleChartConfig(
      interval, indicators, this.rangeBars(), this.showZoomToolbar(), this.logScale(),
    );
  });

  // ==========================================================================
  // Backend callable response + HTF extras
  // (dailyIntervalData / weeklyIntervalData must be declared before extras)
  // ==========================================================================

  /** Cached callable response containing backend-computed indicator series, signal dots,
   *  and HTF window data. Keyed by symbol + bars version + filter sets so stale data is
   *  never returned after a symbol change or bars refresh.
   */
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

  /** Daily interval slice of the callable response — fed into `createExtrasSignals`. */
  private dailyIntervalData = computed(() => this.indicatorResponse()?.intervals?.daily);
  /** Weekly interval slice of the callable response — fed into `createExtrasSignals`. */
  private weeklyIntervalData = computed(() => this.indicatorResponse()?.intervals?.weekly);

  /** True while a Trigger Bands option (bands or dots) is enabled on a
   *  supported (D/W) interval that is also in scope — the opt-in gate for the
   *  lean request. A monthly-only view doesn't fetch D/W data it won't draw. */
  private readonly triggerBandsSelected = computed(() => {
    const sel = this.selectedIdsByInterval();
    const scope = new Set(this.indicatorScope());
    return [ChartIntervalKey.DAILY, ChartIntervalKey.WEEKLY].some(
      (k) =>
        scope.has(k) &&
        (sel[k].has(ST_TRIGGER_BANDS_INDICATOR.id) || sel[k].has(ST_TRIGGER_BANDS_DOTS_INDICATOR.id)),
    );
  });

  /** Opt-in Trigger Bands response — a separate, lean callable result cached
   *  under its own IndicatorSeriesStore key; the default response is never
   *  refetched or invalidated. The binding also owns the request effect. */
  private readonly triggerBandsResponse = bindTriggerBandsRequest({
    enabled: this.triggerBandsSelected,
    symbol: this.manualSymbol,
    version: this.chartStore.symbolDataVersion,
    store: this.indicatorStore,
  });

  private readonly tbDailyIntervalData = computed(() => this.triggerBandsResponse()?.intervals?.daily);
  private readonly tbWeeklyIntervalData = computed(() => this.triggerBandsResponse()?.intervals?.weekly);

  /** Derived computed signals for all backend-supplied extras (HTF windows, signal dots,
   *  uptick dots). Centralised here so daily and weekly charts share the same conversions.
   *  Must be declared after `dailyIntervalData` and `weeklyIntervalData`.
   */
  private readonly extras = createExtrasSignals(
    this.dailyIntervalData, this.weeklyIntervalData,
  );

  // ==========================================================================
  // Per-interval indicator config computeds (daily / weekly / monthly)
  // ==========================================================================

  /** Full daily indicator config list: base ST indicators filtered by user selection,
   *  plus HTF weekly zone window, signal dots, and uptick dot overlays when enabled.
   */
  private dailyIndicators = computed<IndicatorConfig[]>(() => {
    const sel = this.selectedIdsByInterval()[ChartIntervalKey.DAILY];
    return addChartExtras(SignalDetailComponent.baseIndicatorsFor(
      ChartIntervalKey.DAILY, sel, this.indicatorResponse(), this.chartData()?.bars,
      this.tbDailyIntervalData(),
    ), {
      htfWindow: sel.has(ST_ZONE_WINDOW_WEEKLY_INDICATOR.id)
        ? { option: ST_ZONE_WINDOW_WEEKLY_INDICATOR, data: this.extras.windowDataWeeklyOnDaily() }
        : undefined,
      signalDots: sel.has(ST_SIGNAL_DOTS_INDICATOR.id) ? this.extras.dailySignalDots() : undefined,
      uptickDotsV1: sel.has(ST_ZONE_V1_UPTICK_DOTS_INDICATOR.id) ? this.extras.dailyUptickDotsV1() : undefined,
      uptickDotsV2: sel.has(ST_ZONE_V2_UPTICK_DOTS_INDICATOR.id) ? this.extras.dailyUptickDotsV2() : undefined,
      triggerBandsDots: sel.has(ST_TRIGGER_BANDS_DOTS_INDICATOR.id)
        ? convertTriggerBandsDotMarkers(this.tbDailyIntervalData())
        : undefined,
    });
  });

  /** Full weekly indicator config list: base ST indicators filtered by user selection,
   *  plus HTF monthly zone window, signal dots, and uptick dot overlays when enabled.
   */
  private weeklyIndicators = computed<IndicatorConfig[]>(() => {
    const sel = this.selectedIdsByInterval()[ChartIntervalKey.WEEKLY];
    return addChartExtras(SignalDetailComponent.baseIndicatorsFor(
      ChartIntervalKey.WEEKLY, sel, this.indicatorResponse(), this.chartDataWeekly()?.bars,
      this.tbWeeklyIntervalData(),
    ), {
      htfWindow: sel.has(ST_ZONE_WINDOW_MONTHLY_INDICATOR.id)
        ? { option: ST_ZONE_WINDOW_MONTHLY_INDICATOR, data: this.extras.windowDataMonthlyOnWeekly() }
        : undefined,
      signalDots: sel.has(ST_SIGNAL_DOTS_INDICATOR.id) ? this.extras.weeklySignalDots() : undefined,
      uptickDotsV1: sel.has(ST_ZONE_V1_UPTICK_DOTS_INDICATOR.id) ? this.extras.weeklyUptickDotsV1() : undefined,
      uptickDotsV2: sel.has(ST_ZONE_V2_UPTICK_DOTS_INDICATOR.id) ? this.extras.weeklyUptickDotsV2() : undefined,
      triggerBandsDots: sel.has(ST_TRIGGER_BANDS_DOTS_INDICATOR.id)
        ? convertTriggerBandsDotMarkers(this.tbWeeklyIntervalData())
        : undefined,
    });
  });

  /** Monthly chart indicator configs — base only, no HTF extras (monthly is the highest timeframe). */
  private monthlyIndicators = computed<IndicatorConfig[]>(() =>
    SignalDetailComponent.baseIndicatorsFor(
      ChartIntervalKey.MONTHLY,
      this.selectedIdsByInterval()[ChartIntervalKey.MONTHLY],
      this.indicatorResponse(),
      this.chartDataMonthly()?.bars,
    )
  );

  // ==========================================================================
  // Triple-mode chart configs
  // ==========================================================================

  /** Chart config for daily chart in triple mode */
  chartConfigDaily = computed<FlexChartConfig>(() =>
    SignalDetailComponent.tripleChartConfig(
      BarsInterval.DAILY, this.dailyIndicators(), this.rangeBarsDaily(),
      this.showZoomToolbar(), this.logScale(),
    )
  );

  /** Chart config for weekly chart in triple mode */
  chartConfigWeekly = computed<FlexChartConfig>(() =>
    SignalDetailComponent.tripleChartConfig(
      BarsInterval.WEEKLY, this.weeklyIndicators(), this.rangeBarsWeekly(),
      this.showZoomToolbar(), this.logScale(),
    )
  );

  /** Chart config for monthly chart in triple mode */
  chartConfigMonthly = computed<FlexChartConfig>(() =>
    SignalDetailComponent.tripleChartConfig(
      BarsInterval.MONTHLY, this.monthlyIndicators(), this.rangeBarsMonthly(),
      this.showZoomToolbar(), this.logScale(),
    )
  );

  // ==========================================================================
  // Constructor
  // ==========================================================================

  /**
   * Triggers chart and signal history loads whenever `manualSymbol` changes.
   * Clears all charts when the symbol is cleared. The chart store handles
   * in-flight cancellation and coordinates the indicator series callable trigger.
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

  // ==========================================================================
  // Public methods
  // ==========================================================================

  /** Receives a crosshair date change from any chart and broadcasts it to all others
   *  via `crosshairDate` for synchronized hover lines in triple layout.
   */
  onCrosshairChange(date: Date | null): void {
    this.crosshairDate.set(date);
  }

  /** Receives a crosshair price change from any chart and broadcasts it to all others
   *  via `crosshairPrice` for synchronized price labels in triple layout.
   */
  onCrosshairPriceChange(price: number | null): void {
    this.crosshairPrice.set(price);
  }
}

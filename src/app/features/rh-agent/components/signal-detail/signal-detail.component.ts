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
import { UiStateService, ChartLayout } from '../../../../core/services/ui-state.service';
import type { FlexChartConfig, IndicatorConfig, IndicatorOption, PriceBar } from '../../../shared/components/flex-chart/flex-chart.types';
import { ChartIntervalKey, StIndicator } from '../../../shared/components/flex-chart/flex-chart.types';
import { ST_INDICATOR_OPTIONS } from '../../../shared/components/flex-chart/indicators/indicator-registry';
import { ST_SIGNAL_DOTS_INDICATOR } from '../../../shared/components/flex-chart/indicators/st-signal-dots.indicator';
import { ChartToolbarComponent } from '../chart-toolbar/chart-toolbar.component';
import { SymbolListActionsComponent } from '../symbol-list-actions/symbol-list-actions.component';
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
import type { SymbolIndicatorSeriesResponse } from '../../common/rh-agent-indicator.types';
import { RhSymbolListName } from '../../common/rh-agent.constants';

/** RH Agent indicator menu options: shared ST base + RH Agent-specific HTF zone windows. */
const RH_AGENT_INDICATOR_OPTIONS: IndicatorOption[] = [
  ...ST_INDICATOR_OPTIONS,
  ST_ZONE_WINDOW_WEEKLY_INDICATOR,
  ST_ZONE_WINDOW_MONTHLY_INDICATOR,
];

/** Approximate trading-bar counts used by {@link SignalDetailComponent.rangeBarsFor}. */
const TRADING_DAYS_PER_YEAR = 252;   /** ~252 trading sessions per calendar year. */
const WEEKS_PER_YEAR = 52;           /** Calendar weeks per year. */
const MONTHS_PER_YEAR = 12;          /** Calendar months per year. */
const TRADING_DAYS_PER_MONTH = 21;   /** ~21 trading sessions per calendar month. */
const WEEKS_PER_MONTH = 4.33;        /** Average calendar weeks per month (52/12). */
const RECENT_DAILY_BARS = 365;       /** 'recent' daily view: ~365 calendar days of bars (not trading days). */
const RECENT_WEEKLY_BARS = 104;      /** 'recent' weekly view: ~2 years of weekly bars. */
const RECENT_MONTHLY_BARS = 60;      /** 'recent' monthly view: 5 years of monthly bars. */
const ALL_BARS_MAX = 99999;          /** Sentinel passed to initialZoomDays to show all available bars. */

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

  /** Indicator IDs available per interval — all IDs reference the same option objects used in the menu.
   *  StIndicator enum values equal the .id of their option object (id === type by convention).
   */
  private static readonly INDICATORS_BY_INTERVAL: Record<ChartIntervalKey, string[]> = {
    [ChartIntervalKey.DAILY]: [
      StIndicator.TREND_BANDS, StIndicator.TREND_STRENGTH, StIndicator.ZONE, StIndicator.ZONE_V2,
      ST_SIGNAL_DOTS_INDICATOR.id, ST_ZONE_V1_UPTICK_DOTS_INDICATOR.id,
      ST_ZONE_V2_UPTICK_DOTS_INDICATOR.id, ST_ZONE_WINDOW_WEEKLY_INDICATOR.id,
    ],
    [ChartIntervalKey.WEEKLY]: [
      StIndicator.TREND_BANDS, StIndicator.TREND_STRENGTH, StIndicator.ZONE, StIndicator.ZONE_V2,
      ST_SIGNAL_DOTS_INDICATOR.id, ST_ZONE_V1_UPTICK_DOTS_INDICATOR.id,
      ST_ZONE_V2_UPTICK_DOTS_INDICATOR.id, ST_ZONE_WINDOW_MONTHLY_INDICATOR.id,
    ],
    [ChartIntervalKey.MONTHLY]: [
      StIndicator.TREND_BANDS, StIndicator.TREND_STRENGTH, StIndicator.ZONE, StIndicator.ZONE_V2,
    ],
  };

  /** Maps a `BarsInterval` to its corresponding `ChartIntervalKey` enum value.
   *  Used wherever the two enums must be bridged (config building, INDICATORS_BY_INTERVAL lookup).
   */
  private static intervalKey(interval: BarsInterval): ChartIntervalKey {
    return interval === BarsInterval.WEEKLY
      ? ChartIntervalKey.WEEKLY
      : interval === BarsInterval.MONTHLY
        ? ChartIntervalKey.MONTHLY
        : ChartIntervalKey.DAILY;
  }

  /** Pure function: converts a range preset to an approximate bar count for the given interval.
   *  'recent' returns fixed well-known bar counts; other presets multiply calendar units
   *  by the average bars-per-period for that interval.
   */
  private static rangeBarsFor(interval: BarsInterval, range: string): number {
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
  ): IndicatorConfig[] {
    const base = buildBaseIndicators(key).filter(cfg => ids.has(cfg.type));
    if (!response || !bars || bars.length === 0) return base;
    return injectCallableIndicatorData(base, response.intervals[key], bars);
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
      initialZoomDays: rangeBars,
      interval: SignalDetailComponent.intervalKey(interval),
      logScale,
    };
  }

  // ==========================================================================
  // Injected services
  // ==========================================================================

  /** @internal */
  readonly chartStore = inject(RhAgentChartStore);
  /** @internal */
  readonly uiState = inject(UiStateService);
  /** @internal */
  readonly historyStore = inject(RhAgentSymbolHistoryStore);
  /** @internal */
  readonly indicatorStore = inject(IndicatorSeriesStore);

  // ==========================================================================
  // Enum re-exports, inputs, outputs
  // ==========================================================================

  /** Exposed for template comparisons — Angular templates cannot reference imported enums directly. */
  readonly BarsInterval = BarsInterval;
  readonly ChartLayout = ChartLayout;

  /** Symbol to display. When non-null the chart panel renders; null collapses it. */
  manualSymbol = input<string | null>(null);
  /** Map of list name -> symbols in that list. */
  symbolLists = input<Record<string, string[]>>({});
  /** Active list filter from the symbol list store. */
  activeListFilter = input<RhSymbolListName | 'ALL'>('ALL');
  /** 0-based index of this symbol within the review queue, or -1 when not in queue. */
  symbolIndex = input<number>(-1);
  /** Total number of symbols in the review queue. */
  symbolCount = input<number>(0);

  /** Emits the signal ID when the user marks a signal as accepted (A key / button). */
  signalAccepted = output<string>();
  /** Emits the signal ID when the user marks a signal as considered (C key / button). */
  signalConsidered = output<string>();
  /** Emits the signal ID when the user marks a signal as rejected (R key / button). */
  signalRejected = output<string>();
  /** Emits when the user toggles the active symbol's list membership. */
  toggleList = output<{ symbol: string; listName: RhSymbolListName }>();
  /** Emits when the user toggles the active symbol's monitor status. */
  monitor = output<string>();
  /** Emits when the user clicks the previous-symbol nav button. */
  prevSymbol = output<void>();
  /** Emits when the user clicks the next-symbol nav button. */
  nextSymbol = output<void>();

  // ==========================================================================
  // UI state signals
  // ==========================================================================

  /** True while `manualSymbol` is set — drives `@if (showChart())` in the template. */
  showChart = computed(() => !!this.manualSymbol());

  /** Price-axis scale mode shared across all charts in this view. */
  logScale = signal<boolean>(false);

  /** Whether the Syncfusion zoom/pan toolbar is visible on all charts in this view. */
  showZoomToolbar = signal(false);

  /** Crosshair date shared across all three charts in triple layout for visual alignment. */
  crosshairDate = signal<Date | null>(null);
  /** Crosshair price shared across all three charts in triple layout for visual alignment. */
  crosshairPrice = signal<number | null>(null);

  /** The interval currently rendered in single-chart mode. */
  selectedInterval = signal<BarsInterval>(BarsInterval.DAILY);

  /** Selected time-range preset controlling `initialZoomDays` on all charts. */
  selectedRange = signal<'recent' | '6m' | '1y' | '5y' | 'all'>('recent');

  /** The chart interval whose indicator menu badge is highlighted as 'active'.
   *  In single mode this tracks `selectedInterval`; in triple mode it tracks
   *  whichever chart the user last clicked.
   */
  activeChartInterval = signal<BarsInterval>(BarsInterval.DAILY);

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

  // ==========================================================================
  // Indicator menu state
  // ==========================================================================

  /** Per-interval selected indicator ID sets.
   *  Written atomically once per debounce window (see `onToggleIndicator`) so a single
   *  signal write triggers one reactive propagation through the indicator computed chain.
   */
  private selectedIdsByInterval = signal<Record<ChartIntervalKey, Set<string>>>({
    [ChartIntervalKey.DAILY]:   new Set(SignalDetailComponent.INDICATORS_BY_INTERVAL[ChartIntervalKey.DAILY]),
    [ChartIntervalKey.WEEKLY]:  new Set(SignalDetailComponent.INDICATORS_BY_INTERVAL[ChartIntervalKey.WEEKLY]),
    [ChartIntervalKey.MONTHLY]: new Set(SignalDetailComponent.INDICATORS_BY_INTERVAL[ChartIntervalKey.MONTHLY]),
  });

  /** The interval keys currently in scope for indicator menu actions.
   *  Triple layout: all three intervals.
   *  Single layout: the active interval only.
   */
  private indicatorScope = computed<ChartIntervalKey[]>(() => {
    if (this.uiState.chartLayout() === ChartLayout.TRIPLE) {
      return [ChartIntervalKey.DAILY, ChartIntervalKey.WEEKLY, ChartIntervalKey.MONTHLY];
    }
    return [SignalDetailComponent.intervalKey(this.activeChartInterval())];
  });

  /** Indicator options visible in the menu — union of all in-scope intervals. */
  activeChartIndicatorOptions = computed<IndicatorOption[]>(() => {
    const allowed = new Set(this.indicatorScope().flatMap(
      k => SignalDetailComponent.INDICATORS_BY_INTERVAL[k]
    ));
    return RH_AGENT_INDICATOR_OPTIONS.filter(o => allowed.has(o.id));
  });

  /** Selected indicator IDs for the menu.
   *  An indicator is checked only if it is on in ALL in-scope intervals that support it.
   */
  activeSelectedIndicatorIds = computed<Set<string>>(() => {
    const scope = this.indicatorScope();
    const current = this.selectedIdsByInterval();
    return new Set(
      RH_AGENT_INDICATOR_OPTIONS
        .filter(o => {
          const supportingKeys = scope.filter(
            k => SignalDetailComponent.INDICATORS_BY_INTERVAL[k].includes(o.id)
          );
          return supportingKeys.length > 0 && supportingKeys.every(k => current[k].has(o.id));
        })
        .map(o => o.id)
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

  /** Daily interval slice of the callable response — fed into `createRhAgentExtrasSignals`. */
  private dailyIntervalData = computed(() => this.indicatorResponse()?.intervals?.daily);
  /** Weekly interval slice of the callable response — fed into `createRhAgentExtrasSignals`. */
  private weeklyIntervalData = computed(() => this.indicatorResponse()?.intervals?.weekly);

  /** Derived computed signals for all backend-supplied extras (HTF windows, signal dots,
   *  uptick dots). Centralised here so daily and weekly charts share the same conversions.
   *  Must be declared after `dailyIntervalData` and `weeklyIntervalData`.
   */
  private readonly extras = createRhAgentExtrasSignals(this.dailyIntervalData, this.weeklyIntervalData);

  // ==========================================================================
  // Per-interval indicator config computeds (daily / weekly / monthly)
  // ==========================================================================

  /** Full daily indicator config list: base ST indicators filtered by user selection,
   *  plus HTF weekly zone window, signal dots, and uptick dot overlays when enabled.
   */
  private dailyIndicators = computed<IndicatorConfig[]>(() => {
    const sel = this.selectedIdsByInterval()[ChartIntervalKey.DAILY];
    return addRhAgentExtras(SignalDetailComponent.baseIndicatorsFor(
      ChartIntervalKey.DAILY, sel, this.indicatorResponse(), this.chartData()?.bars,
    ), {
      htfWindow: sel.has(ST_ZONE_WINDOW_WEEKLY_INDICATOR.id)
        ? { option: ST_ZONE_WINDOW_WEEKLY_INDICATOR, data: this.extras.windowDataWeeklyOnDaily() }
        : undefined,
      signalDots: sel.has(ST_SIGNAL_DOTS_INDICATOR.id) ? this.extras.dailySignalDots() : undefined,
      uptickDotsV1: sel.has(ST_ZONE_V1_UPTICK_DOTS_INDICATOR.id) ? this.extras.dailyUptickDotsV1() : undefined,
      uptickDotsV2: sel.has(ST_ZONE_V2_UPTICK_DOTS_INDICATOR.id) ? this.extras.dailyUptickDotsV2() : undefined,
    });
  });

  /** Full weekly indicator config list: base ST indicators filtered by user selection,
   *  plus HTF monthly zone window, signal dots, and uptick dot overlays when enabled.
   */
  private weeklyIndicators = computed<IndicatorConfig[]>(() => {
    const sel = this.selectedIdsByInterval()[ChartIntervalKey.WEEKLY];
    return addRhAgentExtras(SignalDetailComponent.baseIndicatorsFor(
      ChartIntervalKey.WEEKLY, sel, this.indicatorResponse(), this.chartDataWeekly()?.bars,
    ), {
      htfWindow: sel.has(ST_ZONE_WINDOW_MONTHLY_INDICATOR.id)
        ? { option: ST_ZONE_WINDOW_MONTHLY_INDICATOR, data: this.extras.windowDataMonthlyOnWeekly() }
        : undefined,
      signalDots: sel.has(ST_SIGNAL_DOTS_INDICATOR.id) ? this.extras.weeklySignalDots() : undefined,
      uptickDotsV1: sel.has(ST_ZONE_V1_UPTICK_DOTS_INDICATOR.id) ? this.extras.weeklyUptickDotsV1() : undefined,
      uptickDotsV2: sel.has(ST_ZONE_V2_UPTICK_DOTS_INDICATOR.id) ? this.extras.weeklyUptickDotsV2() : undefined,
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

  /** Apply a batch of toggled indicator IDs from the debounce window atomically.
   *  All IDs are applied in a single `selectedIdsByInterval.update()` call so Angular
   *  emits exactly one change notification regardless of batch size.
   *  In triple layout, each ID is toggled on every interval that supports it.
   */
  onToggleIndicator(optionIds: string[]): void {
    const scope = this.indicatorScope();
    this.selectedIdsByInterval.update(current => {
      const updated = { ...current };
      for (const optionId of optionIds) {
        const keysToUpdate = scope.filter(
          k => SignalDetailComponent.INDICATORS_BY_INTERVAL[k].includes(optionId)
        );
        for (const k of keysToUpdate) {
          const next = new Set(updated[k]);
          if (next.has(optionId)) next.delete(optionId); else next.add(optionId);
          updated[k] = next;
        }
      }
      return updated;
    });
  }

  /** Sets which chart's interval is shown in the toolbar badge.
   *  Called when the user clicks a chart cell in triple layout. */
  setActiveChart(interval: BarsInterval): void {
    this.activeChartInterval.set(interval);
  }

  /** Handles D/W/M interval button clicks from the toolbar.
   *  Updates both `selectedInterval` (drives single-mode data) and
   *  `activeChartInterval` (drives toolbar badge).
   */
  onIntervalChange(interval: BarsInterval): void {
    this.selectedInterval.set(interval);
    this.activeChartInterval.set(interval);
  }

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

  /** Toggles price-axis between logarithmic and linear scale on all charts. */
  onToggleLogScale(): void {
    this.logScale.update(current => !current);
  }
}

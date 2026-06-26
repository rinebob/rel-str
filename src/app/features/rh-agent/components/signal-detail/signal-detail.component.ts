/**
 * Signal Detail Component
 *
 * Detail panel for the review interface.
 */
import { Component, inject, ChangeDetectionStrategy, output, effect, computed, signal, input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatMenuModule } from '@angular/material/menu';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';

import { RhAgentDashboardStore } from '../../rh-agent-dashboard.store';
import { HeatmapChartStore } from '../../../heatmap-chart/heatmap-chart.store';
import { FlexChartComponent } from '../../../shared/components/flex-chart/flex-chart.component';
import { BarsInterval } from '../../../../core/models/partner.types';
import { UiStateService } from '../../../../core/services/ui-state.service';
import type { FlexChartConfig, IndicatorConfig, IndicatorPane } from '../../../shared/components/flex-chart/flex-chart.types';
import { ST_INDICATOR_OPTIONS, buildDefaultConfig } from '../../../shared/components/flex-chart/indicators/indicator-registry';
import { calculateStZone } from '../../../shared/components/flex-chart/indicators/st-zone.indicator';
import { calculateStZoneV2 } from '../../../shared/components/flex-chart/indicators/st-zone-v2.indicator';
import { calculateStTrendStrength } from '../../../shared/components/flex-chart/indicators/st-trend-strength.indicator';
import { ST_ZONE_WINDOW_MONTHLY_INDICATOR, ST_ZONE_WINDOW_WEEKLY_INDICATOR, computeZoneWindowData } from '../../../shared/components/flex-chart/indicators/st-zone-window.indicator';
import { ST_SIGNAL_DOTS_INDICATOR, computeSignalDots } from '../../../shared/components/flex-chart/indicators/st-signal-dots.indicator';
import { ST_ZONE_V1_UPTICK_DOTS_INDICATOR, ST_ZONE_V2_UPTICK_DOTS_INDICATOR, detectZoneUptickDots } from '../../../shared/components/flex-chart/indicators/st-zone-uptick-dots.indicator';
import { detectTrendStrengthSignals } from '../../../shared/components/flex-chart/signals';

@Component({
  selector: 'app-signal-detail',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, MatCardModule, MatButtonModule, MatIconModule, MatTooltipModule, MatMenuModule, MatProgressSpinnerModule, FlexChartComponent],
  templateUrl: './signal-detail.component.html',
  styleUrl: './signal-detail.component.scss',
})
export class SignalDetailComponent {
  readonly uiStore = inject(RhAgentDashboardStore);
  readonly chartStore = inject(HeatmapChartStore);
  readonly uiState = inject(UiStateService);

  /** Expose enum to template */
  readonly BarsInterval = BarsInterval;

  signalAccepted = output<string>();
  signalConsidered = output<string>();
  signalRejected = output<string>();

  /** Manual symbol override from parent (when user types a symbol directly) */
  manualSymbol = input<string | null>(null);

  signal = this.uiStore.selectedSignal;
  hasSignal = this.uiStore.hasSelectedSignal;
  /** Show chart when a signal is selected OR a manual symbol is entered */
  showChart = computed(() => this.hasSignal() || !!this.manualSymbol());
  chartData = this.chartStore.chartData;
  chartDataWeekly = this.chartStore.chartDataWeekly;
  chartDataMonthly = this.chartStore.chartDataMonthly;
  chartLoading = this.chartStore.loading;

  /** Shared crosshair date for syncing across triple charts */
  crosshairDate = signal<Date | null>(null);

  /** Toggle zoom/pan toolbar visibility on all charts */
  showZoomToolbar = signal(false);

  /** All ST indicator options */
  readonly stIndicatorOptions = ST_INDICATOR_OPTIONS;

  /** Full IndicatorConfig map keyed by option id — one config per option */
  private readonly allStConfigs = new Map<string, IndicatorConfig>((
    (() => {
      const m: [string, IndicatorConfig][] = [];
      for (const opt of ST_INDICATOR_OPTIONS) {
        const cfg = buildDefaultConfig(opt);
        if (opt.id === 'st-trend-strength') cfg.pane = 'lower-1';
        if (opt.id === 'st-zone') { cfg.pane = 'lower-2'; cfg.options = { ...cfg.options, name: 'ST-ZONE V1' }; }
        if (opt.id === 'st-zone-v2') { cfg.pane = 'lower-3'; cfg.options = { ...cfg.options, name: 'ST-ZONE V2' }; }
        m.push([opt.id, cfg]);
      }
      return m;
    })()
  ));

  /** Indicators available for each chart context (excludes auto-injected HTF extras) */
  private static readonly INDICATORS_BY_INTERVAL: Record<string, string[]> = {
    daily:   ['st-trend-bands', 'st-trend-strength', 'st-zone', 'st-zone-v2',
               'st-zone-window-weekly', 'st-signal-dots', 'st-zone-v1-uptick-dots', 'st-zone-v2-uptick-dots'],
    weekly:  ['st-trend-bands', 'st-trend-strength', 'st-zone', 'st-zone-v2',
               'st-zone-window-monthly', 'st-signal-dots', 'st-zone-v1-uptick-dots', 'st-zone-v2-uptick-dots'],
    monthly: ['st-trend-bands', 'st-trend-strength', 'st-zone', 'st-zone-v2'],
  };

  /** Indicator options visible in the menu for the currently active chart */
  activeChartIndicatorOptions = computed<typeof ST_INDICATOR_OPTIONS>(() => {
    const interval = this.activeChartInterval();
    const key = interval === BarsInterval.WEEKLY ? 'weekly' : interval === BarsInterval.MONTHLY ? 'monthly' : 'daily';
    const allowed = SignalDetailComponent.INDICATORS_BY_INTERVAL[key];
    return ST_INDICATOR_OPTIONS.filter(o => allowed.includes(o.id));
  });

  /** Per-interval selected indicator ID sets — all on by default */
  private selectedIdsByInterval = signal<Record<string, Set<string>>>({
    daily:   new Set(SignalDetailComponent.INDICATORS_BY_INTERVAL['daily']),
    weekly:  new Set(SignalDetailComponent.INDICATORS_BY_INTERVAL['weekly']),
    monthly: new Set(SignalDetailComponent.INDICATORS_BY_INTERVAL['monthly']),
  });

  /** IDs that require pre-computed runtime data \u2014 handled via extras injection, not allStConfigs */
  private static readonly COMPUTED_DATA_IDS = new Set([
    'st-zone-window-weekly', 'st-zone-window-monthly',
    'st-signal-dots', 'st-zone-v1-uptick-dots', 'st-zone-v2-uptick-dots',
  ]);

  /** Active IndicatorConfig[] for the base interval (used for monthly and as base for D/W) */
  private indicatorsForInterval(key: string): IndicatorConfig[] {
    const ids = this.selectedIdsByInterval()[key];
    return ST_INDICATOR_OPTIONS
      .filter(opt => ids.has(opt.id) && !SignalDetailComponent.COMPUTED_DATA_IDS.has(opt.id))
      .map(opt => this.allStConfigs.get(opt.id)!)
      .filter(Boolean);
  }

  /** Base active indicators for the selected single-mode interval */
  activeIndicators = computed<IndicatorConfig[]>(() => {
    const interval = this.selectedInterval();
    const key = interval === BarsInterval.WEEKLY ? 'weekly' : interval === BarsInterval.MONTHLY ? 'monthly' : 'daily';
    return this.indicatorsForInterval(key);
  });

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
    const barsPerYear = interval === BarsInterval.WEEKLY ? 52 : interval === BarsInterval.MONTHLY ? 12 : 252;
    const barsPerMonth = interval === BarsInterval.WEEKLY ? 4.33 : interval === BarsInterval.MONTHLY ? 1 : 21;

    switch (range) {
      case 'recent': return interval === BarsInterval.WEEKLY ? 104 : interval === BarsInterval.MONTHLY ? 60 : 365;
      case '6m': return Math.round(6 * barsPerMonth);
      case '1y': return barsPerYear;
      case '5y': return Math.round(5 * barsPerYear);
      case 'all': return 99999;
    }
  }

  /** Dynamic chart config driven by user-added indicators (single mode) */
  chartConfig = computed<FlexChartConfig>(() => {
    const interval = this.selectedInterval();

    const intervalHint = interval === BarsInterval.WEEKLY ? 'weekly'
      : interval === BarsInterval.MONTHLY ? 'monthly' : 'daily';

    // Include window data for D and W charts in single mode
    let indicators = this.activeIndicators();
    if (interval === BarsInterval.DAILY) {
      indicators = this.dailyIndicators();
    } else if (interval === BarsInterval.WEEKLY) {
      indicators = this.weeklyIndicators();
    }

    return {
      indicators,
      showCrosshair: true,
      showZoomToolbar: this.showZoomToolbar(),
      enableScrollbar: true,
      initialZoomDays: this.rangeBars(),
      interval: intervalHint as 'daily' | 'weekly' | 'monthly',
    };
  });

  // =========================================================================
  // Zone Window — pre-computed HTF zone data mapped to LTF dots
  // =========================================================================

  /** Monthly zone V2 data (computed from monthly bars) */
  private monthlyZoneV2 = computed(() => {
    const data = this.chartDataMonthly();
    if (!data || data.bars.length < 30) return [];
    return calculateStZoneV2(data.bars, {});
  });

  /** Weekly zone V2 data (computed from weekly bars) */
  private weeklyZoneV2 = computed(() => {
    const data = this.chartDataWeekly();
    if (!data || data.bars.length < 30) return [];
    return calculateStZoneV2(data.bars, {});
  });

  /** Window data: monthly zone → weekly dots */
  private windowDataMonthlyOnWeekly = computed(() => {
    const htfZone = this.monthlyZoneV2();
    const ltfData = this.chartDataWeekly();
    if (htfZone.length === 0 || !ltfData) return [];
    return computeZoneWindowData(htfZone, ltfData.bars);
  });

  /** Window data: weekly zone → daily dots */
  private windowDataWeeklyOnDaily = computed(() => {
    const htfZone = this.weeklyZoneV2();
    const ltfData = this.chartData();
    if (htfZone.length === 0 || !ltfData) return [];
    return computeZoneWindowData(htfZone, ltfData.bars);
  });

  /** Build a window IndicatorConfig with pre-computed data */
  private buildWindowConfig(option: typeof ST_ZONE_WINDOW_MONTHLY_INDICATOR, data: { x: Date; y: number; color?: string }[]): IndicatorConfig {
    const cfg = buildDefaultConfig(option);
    return { ...cfg, pane: 'lower-3' as IndicatorPane, data: data as any };
  }

  // =========================================================================
  // Signal Dots — Trend-Strength signals annotated on histogram
  // =========================================================================

  /** Signal dots for daily chart */
  private dailySignalDots = computed(() => {
    const data = this.chartData();
    if (!data || data.bars.length < 30) return [];
    const strengthData = calculateStTrendStrength(data.bars, {});
    const signals = detectTrendStrengthSignals(strengthData, data.bars);
    return computeSignalDots(signals, strengthData);
  });

  /** Signal dots for weekly chart */
  private weeklySignalDots = computed(() => {
    const data = this.chartDataWeekly();
    if (!data || data.bars.length < 30) return [];
    const strengthData = calculateStTrendStrength(data.bars, {});
    const signals = detectTrendStrengthSignals(strengthData, data.bars);
    return computeSignalDots(signals, strengthData);
  });

  /** Build signal dots IndicatorConfig with pre-computed data */
  private buildSignalDotsConfig(data: { x: Date; y: number; color?: string }[]): IndicatorConfig {
    const cfg = buildDefaultConfig(ST_SIGNAL_DOTS_INDICATOR);
    return { ...cfg, pane: 'lower-1' as IndicatorPane, data: data as any };
  }

  // =========================================================================
  // Zone Uptick Dots — V1 and V2 signals on main chart
  // =========================================================================

  // Colors: V1 green/red, V2 lime/orange
  private static readonly V1_LONG = '#4caf50';
  private static readonly V1_SHORT = '#f44336';
  private static readonly V2_LONG = '#8bc34a';
  private static readonly V2_SHORT = '#ff9800';

  /** Zone uptick dots for daily chart (weekly HTF context) */
  private dailyUptickDotsV1 = computed(() => {
    const data = this.chartData();
    const htfZone = this.weeklyZoneV2();
    if (!data || data.bars.length < 30 || htfZone.length === 0) return [];
    const zoneV1 = calculateStZone(data.bars, {});
    return detectZoneUptickDots(zoneV1, htfZone, data.bars, SignalDetailComponent.V1_LONG, SignalDetailComponent.V1_SHORT);
  });

  private dailyUptickDotsV2 = computed(() => {
    const data = this.chartData();
    const htfZone = this.weeklyZoneV2();
    if (!data || data.bars.length < 30 || htfZone.length === 0) return [];
    const zoneV2 = calculateStZoneV2(data.bars, {});
    return detectZoneUptickDots(zoneV2, htfZone, data.bars, SignalDetailComponent.V2_LONG, SignalDetailComponent.V2_SHORT);
  });

  /** Zone uptick dots for weekly chart (monthly HTF context) */
  private weeklyUptickDotsV1 = computed(() => {
    const data = this.chartDataWeekly();
    const htfZone = this.monthlyZoneV2();
    if (!data || data.bars.length < 30 || htfZone.length === 0) return [];
    const zoneV1 = calculateStZone(data.bars, {});
    return detectZoneUptickDots(zoneV1, htfZone, data.bars, SignalDetailComponent.V1_LONG, SignalDetailComponent.V1_SHORT);
  });

  private weeklyUptickDotsV2 = computed(() => {
    const data = this.chartDataWeekly();
    const htfZone = this.monthlyZoneV2();
    if (!data || data.bars.length < 30 || htfZone.length === 0) return [];
    const zoneV2 = calculateStZoneV2(data.bars, {});
    return detectZoneUptickDots(zoneV2, htfZone, data.bars, SignalDetailComponent.V2_LONG, SignalDetailComponent.V2_SHORT);
  });

  /** Build uptick dots IndicatorConfig (overlay on main chart) */
  private buildUptickDotsConfig(option: typeof ST_ZONE_V1_UPTICK_DOTS_INDICATOR, data: { x: Date; y: number; color?: string }[]): IndicatorConfig {
    const cfg = buildDefaultConfig(option);
    return { ...cfg, pane: 'overlay' as IndicatorPane, data: data as any };
  }

  /** Daily chart indicators = base + conditionally-injected computed extras */
  private dailyIndicators = computed<IndicatorConfig[]>(() => {
    const sel = this.selectedIdsByInterval()['daily'];
    const base = this.indicatorsForInterval('daily');
    const extras: IndicatorConfig[] = [];
    if (sel.has('st-zone-window-weekly')) {
      const windowData = this.windowDataWeeklyOnDaily();
      if (windowData.length > 0) extras.push(this.buildWindowConfig(ST_ZONE_WINDOW_WEEKLY_INDICATOR, windowData));
    }
    if (sel.has('st-signal-dots')) {
      const dots = this.dailySignalDots();
      if (dots.length > 0) extras.push(this.buildSignalDotsConfig(dots));
    }
    if (sel.has('st-zone-v1-uptick-dots')) {
      const v1 = this.dailyUptickDotsV1();
      if (v1.length > 0) extras.push(this.buildUptickDotsConfig(ST_ZONE_V1_UPTICK_DOTS_INDICATOR, v1));
    }
    if (sel.has('st-zone-v2-uptick-dots')) {
      const v2 = this.dailyUptickDotsV2();
      if (v2.length > 0) extras.push(this.buildUptickDotsConfig(ST_ZONE_V2_UPTICK_DOTS_INDICATOR, v2));
    }
    return extras.length > 0 ? [...base, ...extras] : base;
  });

  /** Weekly chart indicators = base + conditionally-injected computed extras */
  private weeklyIndicators = computed<IndicatorConfig[]>(() => {
    const sel = this.selectedIdsByInterval()['weekly'];
    const base = this.indicatorsForInterval('weekly');
    const extras: IndicatorConfig[] = [];
    if (sel.has('st-zone-window-monthly')) {
      const windowData = this.windowDataMonthlyOnWeekly();
      if (windowData.length > 0) extras.push(this.buildWindowConfig(ST_ZONE_WINDOW_MONTHLY_INDICATOR, windowData));
    }
    if (sel.has('st-signal-dots')) {
      const dots = this.weeklySignalDots();
      if (dots.length > 0) extras.push(this.buildSignalDotsConfig(dots));
    }
    if (sel.has('st-zone-v1-uptick-dots')) {
      const v1 = this.weeklyUptickDotsV1();
      if (v1.length > 0) extras.push(this.buildUptickDotsConfig(ST_ZONE_V1_UPTICK_DOTS_INDICATOR, v1));
    }
    if (sel.has('st-zone-v2-uptick-dots')) {
      const v2 = this.weeklyUptickDotsV2();
      if (v2.length > 0) extras.push(this.buildUptickDotsConfig(ST_ZONE_V2_UPTICK_DOTS_INDICATOR, v2));
    }
    return extras.length > 0 ? [...base, ...extras] : base;
  });

  /** Chart config for daily chart in triple mode */
  chartConfigDaily = computed<FlexChartConfig>(() => ({
    indicators: this.dailyIndicators(),
    showCrosshair: true,
    showZoomToolbar: this.showZoomToolbar(),
    enableScrollbar: true,
    initialZoomDays: this.rangeBarsFor(BarsInterval.DAILY),
    interval: 'daily' as const,
  }));

  /** Chart config for weekly chart in triple mode */
  chartConfigWeekly = computed<FlexChartConfig>(() => ({
    indicators: this.weeklyIndicators(),
    showCrosshair: true,
    showZoomToolbar: this.showZoomToolbar(),
    enableScrollbar: true,
    initialZoomDays: this.rangeBarsFor(BarsInterval.WEEKLY),
    interval: 'weekly' as const,
  }));

  /** Chart config for monthly chart in triple mode */
  chartConfigMonthly = computed<FlexChartConfig>(() => ({
    indicators: this.indicatorsForInterval('monthly'),
    showCrosshair: true,
    showZoomToolbar: this.showZoomToolbar(),
    enableScrollbar: true,
    initialZoomDays: this.rangeBarsFor(BarsInterval.MONTHLY),
    interval: 'monthly' as const,
  }));

  /** Toggle an indicator on/off for the currently active chart interval */
  onToggleIndicator(optionId: string): void {
    const interval = this.activeChartInterval();
    const key = interval === BarsInterval.WEEKLY ? 'weekly' : interval === BarsInterval.MONTHLY ? 'monthly' : 'daily';
    this.selectedIdsByInterval.update(current => {
      const next = new Set(current[key]);
      if (next.has(optionId)) next.delete(optionId); else next.add(optionId);
      return { ...current, [key]: next };
    });
  }

  /** Whether a given indicator is active for the currently active chart interval */
  isIndicatorSelected(optionId: string): boolean {
    const interval = this.activeChartInterval();
    const key = interval === BarsInterval.WEEKLY ? 'weekly' : interval === BarsInterval.MONTHLY ? 'monthly' : 'daily';
    return this.selectedIdsByInterval()[key].has(optionId);
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

  constructor() {
    // Load chart data when signal or interval changes
    effect(() => {
      const signal = this.signal();
      const interval = this.selectedInterval();
      if (signal) {
        this.chartStore.loadData({
          baseline: 'SPY',
          symbol: signal.symbol,
          interval,
        });
      }
    });

    // Load triple data when layout switches to triple or signal changes
    effect(() => {
      const signal = this.signal();
      const layout = this.uiState.chartLayout();
      if (signal && layout === 'triple') {
        this.chartStore.loadTripleData();
      }
    });

    // Load chart data when manual symbol is entered
    effect(() => {
      const symbol = this.manualSymbol();
      if (symbol) {
        const interval = this.selectedInterval();
        this.chartStore.loadData({
          baseline: 'SPY',
          symbol,
          interval,
        });
        const layout = this.uiState.chartLayout();
        if (layout === 'triple') {
          this.chartStore.loadTripleData();
        }
      }
    });
  }

  getStatus(): string {
    const s = this.signal();
    if (!s) return 'PENDING';
    return this.uiStore.getSignalStatus(s.id);
  }

  onAccept(signalId: string): void {
    this.uiStore.acceptSignal(signalId);
    this.signalAccepted.emit(signalId);
  }

  onConsider(signalId: string): void {
    this.uiStore.considerSignal(signalId);
    this.signalConsidered.emit(signalId);
  }

  onReject(signalId: string): void {
    this.uiStore.rejectSignal(signalId);
    this.signalRejected.emit(signalId);
  }
}

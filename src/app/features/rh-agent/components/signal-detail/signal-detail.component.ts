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

import { HeatmapChartStore } from '../../../heatmap-chart/heatmap-chart.store';
import { FlexChartComponent } from '../../../shared/components/flex-chart/flex-chart.component';
import { BarsInterval } from '../../../../core/models/partner.types';
import { UiStateService } from '../../../../core/services/ui-state.service';
import type { FlexChartConfig, IndicatorConfig } from '../../../shared/components/flex-chart/flex-chart.types';
import { ST_INDICATOR_OPTIONS } from '../../../shared/components/flex-chart/indicators/indicator-registry';
import {
  buildBaseIndicators,
  computeHtfZoneV2,
  computeHtfWindowData,
  computeSignalDotsData,
  computeUptickDotsV1,
  computeUptickDotsV2,
  addHtfZoneWindow,
  addSignalDots,
  addUptickDots,
  ST_ZONE_WINDOW_MONTHLY_INDICATOR,
  ST_ZONE_WINDOW_WEEKLY_INDICATOR,
  ST_ZONE_V1_UPTICK_DOTS_INDICATOR,
  ST_ZONE_V2_UPTICK_DOTS_INDICATOR,
} from '../../utils/rh-agent-chart-indicators';

@Component({
  selector: 'app-signal-detail',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, MatCardModule, MatButtonModule, MatIconModule, MatTooltipModule, MatMenuModule, MatProgressSpinnerModule, FlexChartComponent],
  templateUrl: './signal-detail.component.html',
  styleUrl: './signal-detail.component.scss',
})
export class SignalDetailComponent {
  readonly chartStore = inject(HeatmapChartStore);
  readonly uiState = inject(UiStateService);

  /** Expose enum to template */
  readonly BarsInterval = BarsInterval;

  signalAccepted = output<string>();
  signalConsidered = output<string>();
  signalRejected = output<string>();

  /** Manual symbol override from parent (when user types a symbol directly) */
  manualSymbol = input<string | null>(null);

  /** Show chart when a manual symbol is entered */
  showChart = computed(() => !!this.manualSymbol());
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

  /** Base active indicators for an interval, filtered by the user's current selection. */
  private baseIndicatorsFor(key: 'daily' | 'weekly' | 'monthly'): IndicatorConfig[] {
    const ids = this.selectedIdsByInterval()[key];
    return buildBaseIndicators(key).filter(cfg => ids.has(cfg.id));
  }

  /** Base active indicators for the selected single-mode interval */
  activeIndicators = computed<IndicatorConfig[]>(() => {
    const interval = this.selectedInterval();
    const key = interval === BarsInterval.WEEKLY ? 'weekly' : interval === BarsInterval.MONTHLY ? 'monthly' : 'daily';
    return this.baseIndicatorsFor(key);
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
  // HTF zones / windows / dots data (computed from chart data)
  // =========================================================================

  private weeklyZoneV2 = computed(() => {
    const data = this.chartDataWeekly();
    return data ? computeHtfZoneV2(data.bars) : [];
  });

  private monthlyZoneV2 = computed(() => {
    const data = this.chartDataMonthly();
    return data ? computeHtfZoneV2(data.bars) : [];
  });

  private windowDataWeeklyOnDaily = computed(() => {
    const ltf = this.chartData();
    return ltf ? computeHtfWindowData(this.weeklyZoneV2(), ltf.bars) : [];
  });

  private windowDataMonthlyOnWeekly = computed(() => {
    const ltf = this.chartDataWeekly();
    return ltf ? computeHtfWindowData(this.monthlyZoneV2(), ltf.bars) : [];
  });

  private dailySignalDots = computed(() => {
    const data = this.chartData();
    return data ? computeSignalDotsData(data.bars) : [];
  });

  private weeklySignalDots = computed(() => {
    const data = this.chartDataWeekly();
    return data ? computeSignalDotsData(data.bars) : [];
  });

  private dailyUptickDotsV1 = computed(() => {
    const data = this.chartData();
    return data ? computeUptickDotsV1(data.bars, this.weeklyZoneV2()) : [];
  });

  private dailyUptickDotsV2 = computed(() => {
    const data = this.chartData();
    return data ? computeUptickDotsV2(data.bars, this.weeklyZoneV2()) : [];
  });

  private weeklyUptickDotsV1 = computed(() => {
    const data = this.chartDataWeekly();
    return data ? computeUptickDotsV1(data.bars, this.monthlyZoneV2()) : [];
  });

  private weeklyUptickDotsV2 = computed(() => {
    const data = this.chartDataWeekly();
    return data ? computeUptickDotsV2(data.bars, this.monthlyZoneV2()) : [];
  });

  /** Daily chart indicators = base + conditionally-injected computed extras */
  private dailyIndicators = computed<IndicatorConfig[]>(() => {
    const sel = this.selectedIdsByInterval()['daily'];
    const indicators = this.baseIndicatorsFor('daily');
    if (sel.has('st-zone-window-weekly')) {
      addHtfZoneWindow(indicators, ST_ZONE_WINDOW_WEEKLY_INDICATOR, this.windowDataWeeklyOnDaily());
    }
    if (sel.has('st-signal-dots')) {
      addSignalDots(indicators, this.dailySignalDots());
    }
    if (sel.has('st-zone-v1-uptick-dots')) {
      addUptickDots(indicators, ST_ZONE_V1_UPTICK_DOTS_INDICATOR, this.dailyUptickDotsV1());
    }
    if (sel.has('st-zone-v2-uptick-dots')) {
      addUptickDots(indicators, ST_ZONE_V2_UPTICK_DOTS_INDICATOR, this.dailyUptickDotsV2());
    }
    return indicators;
  });

  /** Weekly chart indicators = base + conditionally-injected computed extras */
  private weeklyIndicators = computed<IndicatorConfig[]>(() => {
    const sel = this.selectedIdsByInterval()['weekly'];
    const indicators = this.baseIndicatorsFor('weekly');
    if (sel.has('st-zone-window-monthly')) {
      addHtfZoneWindow(indicators, ST_ZONE_WINDOW_MONTHLY_INDICATOR, this.windowDataMonthlyOnWeekly());
    }
    if (sel.has('st-signal-dots')) {
      addSignalDots(indicators, this.weeklySignalDots());
    }
    if (sel.has('st-zone-v1-uptick-dots')) {
      addUptickDots(indicators, ST_ZONE_V1_UPTICK_DOTS_INDICATOR, this.weeklyUptickDotsV1());
    }
    if (sel.has('st-zone-v2-uptick-dots')) {
      addUptickDots(indicators, ST_ZONE_V2_UPTICK_DOTS_INDICATOR, this.weeklyUptickDotsV2());
    }
    return indicators;
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
    indicators: this.baseIndicatorsFor('monthly'),
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
    // Load chart data when manual symbol or interval changes
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
}

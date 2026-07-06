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
import { RhAgentChartStore } from '../../stores/rh-agent-chart.store';
import {
  DEFAULT_CHART_INTERVALS,
  DEFAULT_CHART_INDICATORS,
  DEFAULT_CHART_STRATEGIES,
} from '../../stores/rh-agent-chart.store';
import { FlexChartComponent } from '../../../shared/components/flex-chart/flex-chart.component';
import type { FlexChartConfig } from '../../../shared/components/flex-chart/flex-chart.types';
import {
  buildBaseIndicators,
  injectCallableIndicatorData,
  convertZoneDotMarkers,
  convertTrendStrengthDotMarkers,
  convertHtfWindowData,
  addHtfZoneWindow,
  addSignalDots,
  addUptickDots,
  ST_ZONE_WINDOW_MONTHLY_INDICATOR,
  ST_ZONE_WINDOW_WEEKLY_INDICATOR,
  ST_ZONE_V1_UPTICK_DOTS_INDICATOR,
  ST_ZONE_V2_UPTICK_DOTS_INDICATOR,
} from '../../utils/rh-agent-chart-indicators';

const QUICK_BARS = 100;

@Component({
  selector: 'app-quick-charts',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, MatIconModule, MatProgressSpinnerModule, FlexChartComponent],
  templateUrl: './quick-charts.component.html',
  styleUrl: './quick-charts.component.scss',
})
export class QuickChartsComponent {
  readonly chartStore = inject(RhAgentChartStore);
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

  /** Shared crosshair date — whichever chart is hovered broadcasts here; all charts receive it. */
  readonly sharedCrosshairDate = signal<Date | null>(null);

  // ── HTF windows / signal dots / ST Trend Rider dots data (from backend) ────
  private readonly dailyWindowData = computed(() => {
    const start = performance.now();
    const result = convertHtfWindowData(this.dailyIntervalData(), 'weekly');
    console.log(`[QuickCharts] daily W window (backend): ${(performance.now() - start).toFixed(2)}ms, ${result.length} points`);
    return result;
  });

  private readonly weeklyWindowData = computed(() => {
    const start = performance.now();
    const result = convertHtfWindowData(this.weeklyIntervalData(), 'monthly');
    console.log(`[QuickCharts] weekly M window (backend): ${(performance.now() - start).toFixed(2)}ms, ${result.length} points`);
    return result;
  });

  private readonly dailySignalDots = computed(() => {
    const start = performance.now();
    const result = convertTrendStrengthDotMarkers(this.dailyIntervalData());
    console.log(`[QuickCharts] daily TS dots (backend): ${(performance.now() - start).toFixed(2)}ms, ${result.length} dots`);
    return result;
  });

  private readonly weeklySignalDots = computed(() => {
    const start = performance.now();
    const result = convertTrendStrengthDotMarkers(this.weeklyIntervalData());
    console.log(`[QuickCharts] weekly TS dots (backend): ${(performance.now() - start).toFixed(2)}ms, ${result.length} dots`);
    return result;
  });

  private readonly dailyIntervalData = computed(() => this.indicatorResponse()?.intervals?.daily);
  private readonly weeklyIntervalData = computed(() => this.indicatorResponse()?.intervals?.weekly);
  private readonly monthlyIntervalData = computed(() => this.indicatorResponse()?.intervals?.monthly);

  private readonly dailyDotsV1 = computed(() => {
    const start = performance.now();
    const result = convertZoneDotMarkers(this.dailyIntervalData(), true);
    console.log(`[QuickCharts] daily V1 dots (backend): ${(performance.now() - start).toFixed(2)}ms, ${result.length} dots`);
    return result;
  });

  private readonly dailyDotsV2 = computed(() => {
    const start = performance.now();
    const result = convertZoneDotMarkers(this.dailyIntervalData(), false);
    console.log(`[QuickCharts] daily V2 dots (backend): ${(performance.now() - start).toFixed(2)}ms, ${result.length} dots`);
    return result;
  });

  private readonly weeklyDotsV1 = computed(() => {
    const start = performance.now();
    const result = convertZoneDotMarkers(this.weeklyIntervalData(), true);
    console.log(`[QuickCharts] weekly V1 dots (backend): ${(performance.now() - start).toFixed(2)}ms, ${result.length} dots`);
    return result;
  });

  private readonly weeklyDotsV2 = computed(() => {
    const start = performance.now();
    const result = convertZoneDotMarkers(this.weeklyIntervalData(), false);
    console.log(`[QuickCharts] weekly V2 dots (backend): ${(performance.now() - start).toFixed(2)}ms, ${result.length} dots`);
    return result;
  });

  // ── Chart configs ──────────────────────────────────────────────────────────
  readonly monthlyConfig = computed<FlexChartConfig>(() => {
    const indicators = injectCallableIndicatorData(
      buildBaseIndicators('monthly'),
      this.monthlyIntervalData(),
      this.chartStore.monthlyData()?.bars ?? [],
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
      this.chartStore.weeklyData()?.bars ?? [],
    );
    addHtfZoneWindow(indicators, ST_ZONE_WINDOW_MONTHLY_INDICATOR, this.weeklyWindowData());
    addSignalDots(indicators, this.weeklySignalDots());
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
      this.chartStore.dailyData()?.bars ?? [],
    );
    addHtfZoneWindow(indicators, ST_ZONE_WINDOW_WEEKLY_INDICATOR, this.dailyWindowData());
    addSignalDots(indicators, this.dailySignalDots());
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
        this.chartStore.clearCharts();
        return;
      }
      this.chartStore.loadCharts(sym);
    });
  }
}

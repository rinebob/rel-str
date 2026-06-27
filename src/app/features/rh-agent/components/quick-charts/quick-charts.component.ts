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

import { HeatmapChartDataService } from '../../../heatmap-chart/heatmap-chart-data.service';
import { FlexChartComponent } from '../../../shared/components/flex-chart/flex-chart.component';
import { BarsInterval } from '../../../../core/models/partner.types';
import type { ChartDataset } from '../../../heatmap-chart/heatmap-chart.types';
import type { FlexChartConfig } from '../../../shared/components/flex-chart/flex-chart.types';
import {
  buildBaseIndicators,
  computeHtfZoneV2,
  computeHtfWindowData,
  computeUptickDotsV1,
  computeUptickDotsV2,
  addHtfZoneWindow,
  addUptickDots,
  ST_ZONE_WINDOW_MONTHLY_INDICATOR,
  ST_ZONE_WINDOW_WEEKLY_INDICATOR,
  ST_ZONE_V1_UPTICK_DOTS_INDICATOR,
  ST_ZONE_V2_UPTICK_DOTS_INDICATOR,
} from '../../utils/rh-agent-chart-indicators';
import { forkJoin } from 'rxjs';

const QUICK_BARS = 100;

@Component({
  selector: 'app-quick-charts',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, MatIconModule, MatProgressSpinnerModule, FlexChartComponent],
  templateUrl: './quick-charts.component.html',
  styleUrl: './quick-charts.component.scss',
})
export class QuickChartsComponent {
  private readonly dataService = inject(HeatmapChartDataService);

  /** Symbol to display. When null/undefined, shows the empty placeholder. */
  symbol = input<string | null>(null);

  // ── Local state ────────────────────────────────────────────────────────────
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);
  readonly dailyData = signal<ChartDataset | null>(null);
  readonly weeklyData = signal<ChartDataset | null>(null);
  readonly monthlyData = signal<ChartDataset | null>(null);

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

  private readonly dailyDotsV1 = computed(() => {
    const d = this.dailyData();
    return d ? computeUptickDotsV1(d.bars, this.weeklyZoneV2()) : [];
  });

  private readonly dailyDotsV2 = computed(() => {
    const d = this.dailyData();
    return d ? computeUptickDotsV2(d.bars, this.weeklyZoneV2()) : [];
  });

  private readonly weeklyDotsV1 = computed(() => {
    const d = this.weeklyData();
    return d ? computeUptickDotsV1(d.bars, this.monthlyZoneV2()) : [];
  });

  private readonly weeklyDotsV2 = computed(() => {
    const d = this.weeklyData();
    return d ? computeUptickDotsV2(d.bars, this.monthlyZoneV2()) : [];
  });

  // ── Chart configs ──────────────────────────────────────────────────────────
  readonly monthlyConfig: FlexChartConfig = {
    indicators: buildBaseIndicators('monthly'),
    showCrosshair: true,
    showZoomToolbar: false,
    enableScrollbar: false,
    initialZoomDays: QUICK_BARS,
    interval: 'monthly',
  };

  readonly weeklyConfig = computed<FlexChartConfig>(() => {
    const indicators = buildBaseIndicators('weekly');
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
    const indicators = buildBaseIndicators('daily');
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

  private loadCharts(symbol: string): void {
    this.loading.set(true);
    this.error.set(null);

    forkJoin({
      daily:   this.dataService.fetchChartData$('SPY', symbol, BarsInterval.DAILY),
      weekly:  this.dataService.fetchChartData$('SPY', symbol, BarsInterval.WEEKLY),
      monthly: this.dataService.fetchChartData$('SPY', symbol, BarsInterval.MONTHLY),
    }).subscribe({
      next: ({ daily, weekly, monthly }) => {
        this.dailyData.set(daily);
        this.weeklyData.set(weekly);
        this.monthlyData.set(monthly);
        this.loading.set(false);
      },
      error: (err: any) => {
        this.error.set(err?.message ?? 'Failed to load charts');
        this.loading.set(false);
      },
    });
  }
}

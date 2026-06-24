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
import type { FlexChartConfig, IndicatorConfig } from '../../../shared/components/flex-chart/flex-chart.types';
import { ST_INDICATOR_OPTIONS, buildDefaultConfig } from '../../../shared/components/flex-chart/indicators/indicator-registry';
import { calculateStZone } from '../../../shared/components/flex-chart/indicators/st-zone.indicator';
import { calculateStZoneV2 } from '../../../shared/components/flex-chart/indicators/st-zone-v2.indicator';
import { ST_ZONE_V1_UPTICK_DOTS_INDICATOR, ST_ZONE_V2_UPTICK_DOTS_INDICATOR, detectZoneUptickDots } from '../../../shared/components/flex-chart/indicators/st-zone-uptick-dots.indicator';
import type { IndicatorPane } from '../../../shared/components/flex-chart/flex-chart.types';
import { forkJoin } from 'rxjs';

const QUICK_BARS = 100;

/** Indicator IDs shown in each quick chart (all 4, each in their own lower pane). */
const BASE_INDICATORS: Record<string, string[]> = {
  daily:   ['st-trend-bands', 'st-trend-strength', 'st-zone', 'st-zone-v2'],
  weekly:  ['st-trend-bands', 'st-trend-strength', 'st-zone', 'st-zone-v2'],
  monthly: ['st-trend-bands', 'st-trend-strength', 'st-zone', 'st-zone-v2'],
};

/** Pre-built base IndicatorConfig map with pane assignments. */
function buildBaseConfigs(): Map<string, IndicatorConfig> {
  const m = new Map<string, IndicatorConfig>();
  for (const opt of ST_INDICATOR_OPTIONS) {
    const cfg = buildDefaultConfig(opt);
    if (opt.id === 'st-trend-strength') { cfg.pane = 'lower-1'; }
    if (opt.id === 'st-zone')    { cfg.pane = 'lower-2'; cfg.options = { ...cfg.options, name: 'ZONE V1' }; }
    if (opt.id === 'st-zone-v2') { cfg.pane = 'lower-3'; cfg.options = { ...cfg.options, name: 'ZONE V2' }; }
    m.set(opt.id, cfg);
  }
  return m;
}

const BASE_CONFIGS = buildBaseConfigs();

function baseIndicatorsFor(key: string): IndicatorConfig[] {
  return BASE_INDICATORS[key]
    .map(id => BASE_CONFIGS.get(id)!)
    .filter(Boolean);
}

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

  // ── Colors ─────────────────────────────────────────────────────────────────
  private static readonly V1_LONG  = '#4caf50';
  private static readonly V1_SHORT = '#f44336';
  private static readonly V2_LONG  = '#8bc34a';
  private static readonly V2_SHORT = '#ff9800';

  // ── HTF zone V2 (for dot gating) ──────────────────────────────────────────
  private readonly weeklyZoneV2 = computed(() => {
    const d = this.weeklyData();
    if (!d || d.bars.length < 30) return [];
    return calculateStZoneV2(d.bars, {});
  });

  private readonly monthlyZoneV2 = computed(() => {
    const d = this.monthlyData();
    if (!d || d.bars.length < 30) return [];
    return calculateStZoneV2(d.bars, {});
  });

  // ── Uptick dots: daily (gated by weekly HTF) ──────────────────────────────
  private readonly dailyDotsV1 = computed(() => {
    const d = this.dailyData();
    const htf = this.weeklyZoneV2();
    if (!d || d.bars.length < 30 || !htf.length) return [];
    return detectZoneUptickDots(calculateStZone(d.bars, {}), htf, d.bars,
      QuickChartsComponent.V1_LONG, QuickChartsComponent.V1_SHORT);
  });

  private readonly dailyDotsV2 = computed(() => {
    const d = this.dailyData();
    const htf = this.weeklyZoneV2();
    if (!d || d.bars.length < 30 || !htf.length) return [];
    return detectZoneUptickDots(calculateStZoneV2(d.bars, {}), htf, d.bars,
      QuickChartsComponent.V2_LONG, QuickChartsComponent.V2_SHORT);
  });

  // ── Uptick dots: weekly (gated by monthly HTF) ────────────────────────────
  private readonly weeklyDotsV1 = computed(() => {
    const d = this.weeklyData();
    const htf = this.monthlyZoneV2();
    if (!d || d.bars.length < 30 || !htf.length) return [];
    return detectZoneUptickDots(calculateStZone(d.bars, {}), htf, d.bars,
      QuickChartsComponent.V1_LONG, QuickChartsComponent.V1_SHORT);
  });

  private readonly weeklyDotsV2 = computed(() => {
    const d = this.weeklyData();
    const htf = this.monthlyZoneV2();
    if (!d || d.bars.length < 30 || !htf.length) return [];
    return detectZoneUptickDots(calculateStZoneV2(d.bars, {}), htf, d.bars,
      QuickChartsComponent.V2_LONG, QuickChartsComponent.V2_SHORT);
  });

  // ── Chart configs ──────────────────────────────────────────────────────────
  readonly monthlyConfig: FlexChartConfig = {
    indicators: baseIndicatorsFor('monthly'),
    showCrosshair: true,
    showZoomToolbar: false,
    enableScrollbar: false,
    initialZoomDays: QUICK_BARS,
    interval: 'monthly',
  };

  readonly weeklyConfig = computed<FlexChartConfig>(() => {
    const extras: IndicatorConfig[] = [];
    const v1 = this.weeklyDotsV1();
    if (v1.length) extras.push({ ...buildDefaultConfig(ST_ZONE_V1_UPTICK_DOTS_INDICATOR), pane: 'overlay' as IndicatorPane, data: v1 as any });
    const v2 = this.weeklyDotsV2();
    if (v2.length) extras.push({ ...buildDefaultConfig(ST_ZONE_V2_UPTICK_DOTS_INDICATOR), pane: 'overlay' as IndicatorPane, data: v2 as any });
    return {
      indicators: [...baseIndicatorsFor('weekly'), ...extras],
      showCrosshair: true,
      showZoomToolbar: false,
      enableScrollbar: false,
      initialZoomDays: QUICK_BARS,
      interval: 'weekly',
    };
  });

  readonly dailyConfig = computed<FlexChartConfig>(() => {
    const extras: IndicatorConfig[] = [];
    const v1 = this.dailyDotsV1();
    if (v1.length) extras.push({ ...buildDefaultConfig(ST_ZONE_V1_UPTICK_DOTS_INDICATOR), pane: 'overlay' as IndicatorPane, data: v1 as any });
    const v2 = this.dailyDotsV2();
    if (v2.length) extras.push({ ...buildDefaultConfig(ST_ZONE_V2_UPTICK_DOTS_INDICATOR), pane: 'overlay' as IndicatorPane, data: v2 as any });
    return {
      indicators: [...baseIndicatorsFor('daily'), ...extras],
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

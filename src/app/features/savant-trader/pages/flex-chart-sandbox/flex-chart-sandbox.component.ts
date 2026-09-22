/**
 * Flex Chart Sandbox Page
 *
 * Dev playground for flex-chart experiments — currently the proving ground for
 * the manual log-scale Y-axis work (Topic #468 / Thread #469). Auth-guarded
 * URL-only route; intentionally not in the nav menu.
 *
 * Hosts one FlexChartComponent fed by the real IndicatorSeriesStore path
 * (same as quick-charts), a D/W/M interval switcher, a linear/log toggle,
 * and a debug readout comparing the computed Y-axis viewport against the
 * visible-range high/low of the loaded bars.
 */
import {
  Component,
  computed,
  effect,
  inject,
  signal,
  ChangeDetectionStrategy,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';

import { ChartStore } from '../../stores/chart.store';
import { FlexChartComponent } from '../../../shared/components/flex-chart/flex-chart.component';
import type {
  FlexChartConfig,
  FlexChartDataset,
} from '../../../shared/components/flex-chart/flex-chart.types';
import { ChartIntervalKey } from '../../../shared/components/flex-chart/flex-chart.types';
import type { ChartDebugSnapshot } from '../../../shared/components/flex-chart/services/chart-instance.types';

const DEFAULT_SYMBOL = 'QQQ';
/** Sentinel — clamped to the loaded bar count, so "all of history". */
const SHOW_ALL_BARS = 1_000_000;

@Component({
  selector: 'app-flex-chart-sandbox',
  standalone: true,
  imports: [CommonModule, MatProgressSpinnerModule, FlexChartComponent],
  templateUrl: './flex-chart-sandbox.component.html',
  styleUrl: './flex-chart-sandbox.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FlexChartSandboxComponent {
  readonly ChartIntervalKey = ChartIntervalKey;
  readonly chartStore = inject(ChartStore);

  readonly symbol = signal(DEFAULT_SYMBOL);
  readonly interval = signal<ChartIntervalKey>(ChartIntervalKey.DAILY);
  readonly logScale = signal(true);
  readonly debugState = signal<ChartDebugSnapshot>({ viewport: null, axis: null, logTicks: [] });

  readonly chartData = computed<FlexChartDataset | null>(() => {
    switch (this.interval()) {
      case ChartIntervalKey.WEEKLY: return this.chartStore.weeklyData();
      case ChartIntervalKey.MONTHLY: return this.chartStore.monthlyData();
      default: return this.chartStore.dailyData();
    }
  });

  readonly config = computed<FlexChartConfig>(() => ({
    // Raw candles only — the sandbox exists to inspect Y-axis scaling,
    // not indicator overlays.
    indicators: [],
    showCrosshair: true,
    showZoomToolbar: true,
    enableScrollbar: true,
    showTooltips: true,
    initialZoomDays: SHOW_ALL_BARS,
    interval: this.interval(),
    logScale: this.logScale(),
  }));

  // ── Debug readout ──────────────────────────────────────────────────────

  readonly debugViewportText = computed(() => {
    const vp = this.debugState().viewport;
    if (!vp) return '—';
    return `${vp.min.toFixed(2)} – ${vp.max.toFixed(2)}`;
  });

  readonly debugAxisText = computed(() => {
    const axis = this.debugState().axis;
    if (!axis) return '—';
    const { min, max } = axis.yAxis.visibleRange;
    const base = `${min.toFixed(2)} – ${max.toFixed(2)} [${axis.yAxis.valueType}]`;
    return this.logScale() ? `${base} ≈ $${Math.pow(10, min).toFixed(2)} – $${Math.pow(10, max).toFixed(2)}` : base;
  });

  readonly debugTicksText = computed(() => {
    const ticks = this.debugState().logTicks;
    return ticks.length ? ticks.join(', ') : '—';
  });

  readonly debugVisibleText = computed(() => {
    const axis = this.debugState().axis;
    const bars = this.chartData()?.bars ?? [];
    if (!axis || bars.length === 0) return '—';
    const { min, max } = axis.xAxis.visibleRange;
    const lo = Math.max(0, Math.floor(min));
    const hi = Math.min(bars.length - 1, Math.ceil(max));
    if (lo > hi) return '—';
    let visibleHigh = -Infinity;
    let visibleLow = Infinity;
    for (let i = lo; i <= hi; i++) {
      const bar = bars[i];
      if (bar.high > visibleHigh) visibleHigh = bar.high;
      if (bar.low < visibleLow) visibleLow = bar.low;
    }
    return `${visibleLow.toFixed(2)} – ${visibleHigh.toFixed(2)}`;
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

  onSymbolChange(event: Event): void {
    const value = (event.target as HTMLInputElement).value.trim().toUpperCase();
    if (value && value !== this.symbol()) this.symbol.set(value);
  }

  setInterval(interval: ChartIntervalKey): void {
    this.interval.set(interval);
  }

  onLogToggle(event: Event): void {
    this.logScale.set((event.target as HTMLInputElement).checked);
  }

  onDebugStateChange(snapshot: ChartDebugSnapshot): void {
    this.debugState.set(snapshot);
  }
}

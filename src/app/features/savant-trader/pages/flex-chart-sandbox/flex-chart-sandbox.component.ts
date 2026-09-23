/**
 * Flex Chart Sandbox Page
 *
 * Dev playground for flex-chart experiments — currently the proving ground for
 * the manual log-scale Y-axis work (Topic #468 / Thread #469). Auth-guarded
 * URL-only route; intentionally not in the nav menu.
 *
 * Hosts one FlexChartComponent fed by the real ChartStore path (same as
 * quick-charts) or by a deterministic synthetic generator (mode toggle) for
 * axis-stressing presets: 100x ranges, sub-$1 prices, corrupt ≤0 prints.
 * Plus a D/W/M interval switcher, a linear/log toggle, and a debug readout
 * comparing the computed Y-axis viewport against the visible-range high/low.
 */
import {
  Component,
  computed,
  effect,
  ElementRef,
  HostListener,
  inject,
  signal,
  ChangeDetectionStrategy,
  OnDestroy,
  OnInit,
  ViewChild,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';

import { UiStateService } from '../../../../core/services/ui-state.service';

import { ChartStore } from '../../stores/chart.store';
import { FlexChartComponent } from '../../../shared/components/flex-chart/flex-chart.component';
import type {
  FlexChartConfig,
  FlexChartDataset,
} from '../../../shared/components/flex-chart/flex-chart.types';
import { ChartIntervalKey } from '../../../shared/components/flex-chart/flex-chart.types';
import type { ChartDebugSnapshot } from '../../../shared/components/flex-chart/services/chart-instance.types';
import { BarsInterval } from '../../../../core/models/partner.types';
import {
  ST_INDICATOR_OPTIONS,
  buildDefaultConfig,
} from '../../../shared/components/flex-chart/indicators/indicator-registry';
import {
  generateSyntheticBars,
  SYNTHETIC_PRESETS,
  type SyntheticPreset,
} from './synthetic-data';

const DEFAULT_SYMBOL = 'QQQ';
/** Sentinel — clamped to the loaded bar count, so "all of history". */
const SHOW_ALL_BARS = 1_000_000;

type DataMode = 'real' | 'synthetic';

const INTERVAL_TO_BARS: Record<ChartIntervalKey, BarsInterval> = {
  [ChartIntervalKey.DAILY]: BarsInterval.DAILY,
  [ChartIntervalKey.WEEKLY]: BarsInterval.WEEKLY,
  [ChartIntervalKey.MONTHLY]: BarsInterval.MONTHLY,
};

@Component({
  selector: 'app-flex-chart-sandbox',
  standalone: true,
  imports: [CommonModule, MatProgressSpinnerModule, FlexChartComponent],
  templateUrl: './flex-chart-sandbox.component.html',
  styleUrl: './flex-chart-sandbox.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FlexChartSandboxComponent implements OnInit, OnDestroy {
  readonly ChartIntervalKey = ChartIntervalKey;
  readonly chartStore = inject(ChartStore);
  private readonly ui = inject(UiStateService);

  readonly symbol = signal(DEFAULT_SYMBOL);
  readonly interval = signal<ChartIntervalKey>(ChartIntervalKey.DAILY);
  readonly logScale = signal(true);
  readonly dataMode = signal<DataMode>('real');
  readonly preset = signal<SyntheticPreset>('wide-ratio');
  readonly presets = SYNTHETIC_PRESETS;
  /** ST indicator option ids currently enabled — the overlay-alignment
   *  verification target for log mode (trend bands / std-dev lines /
   *  zigzag on the price pane; lower-pane ST series stay raw). */
  readonly enabledIndicators = signal<ReadonlySet<string>>(new Set());
  readonly indicatorOptions = ST_INDICATOR_OPTIONS;
  readonly debugState = signal<ChartDebugSnapshot>({ viewport: null, axis: null, logTicks: [] });

  @ViewChild('indicatorPicker') private indicatorPicker?: ElementRef<HTMLDetailsElement>;

  /** Memoized by the computed — bars regenerate only when the preset changes,
   *  so an unrelated signal flip doesn't produce a fresh array identity. */
  private readonly syntheticBars = computed(() => generateSyntheticBars(this.preset()));

  readonly chartData = computed<FlexChartDataset | null>(() => {
    if (this.dataMode() === 'synthetic') {
      // Synthetic mode bypasses ChartStore entirely — same FlexChartDataset
      // shape, so the chart exercises the identical config/adapter path.
      // Bars are daily cadence; the interval label stays honest by disabling
      // the D/W/M buttons in synthetic mode.
      return {
        symbol: `SYN-${this.preset().toUpperCase()}`,
        interval: INTERVAL_TO_BARS[this.interval()],
        bars: this.syntheticBars(),
      };
    }
    switch (this.interval()) {
      case ChartIntervalKey.WEEKLY: return this.chartStore.weeklyData();
      case ChartIntervalKey.MONTHLY: return this.chartStore.monthlyData();
      default: return this.chartStore.dailyData();
    }
  });

  readonly config = computed<FlexChartConfig>(() => ({
    indicators: ST_INDICATOR_OPTIONS
      .filter((o) => this.enabledIndicators().has(o.id))
      .map(buildDefaultConfig),
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

  readonly debugSourceText = computed(() =>
    this.dataMode() === 'synthetic' ? `synthetic:${this.preset()}` : `real:${this.symbol()}`,
  );

  /** Full-screen page like the other savant-trader tools — the chart
   *  wants the whole viewport. */
  ngOnInit(): void {
    this.ui.setFullscreen(true);
  }

  ngOnDestroy(): void {
    this.ui.setFullscreen(false);
  }

  constructor() {
    effect(() => {
      const sym = this.symbol();
      if (this.dataMode() === 'synthetic' || !sym) {
        this.chartStore.clearCharts();
        return;
      }
      this.chartStore.loadCharts(sym);
    });
  }

  setDataMode(mode: DataMode): void {
    this.dataMode.set(mode);
  }

  onPresetChange(event: Event): void {
    const value = (event.target as HTMLSelectElement).value as SyntheticPreset;
    this.preset.set(value);
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

  toggleIndicator(id: string, event: Event): void {
    const next = new Set(this.enabledIndicators());
    if ((event.target as HTMLInputElement).checked) next.add(id);
    else next.delete(id);
    this.enabledIndicators.set(next);
  }

  onDebugStateChange(snapshot: ChartDebugSnapshot): void {
    this.debugState.set(snapshot);
  }

  /** Native <details> doesn't close on outside click or Escape — do both. */
  @HostListener('document:click', ['$event'])
  onDocumentClick(event: MouseEvent): void {
    const picker = this.indicatorPicker?.nativeElement;
    if (picker?.open && !picker.contains(event.target as Node)) picker.open = false;
  }

  @HostListener('document:keydown.escape')
  onEscape(): void {
    const picker = this.indicatorPicker?.nativeElement;
    if (picker?.open) picker.open = false;
  }
}

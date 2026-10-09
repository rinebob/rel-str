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
  viewChild,
  ChangeDetectionStrategy,
  OnDestroy,
  untracked,

  ViewChild,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatDatepickerModule } from '@angular/material/datepicker';
import { MatNativeDateModule } from '@angular/material/core';

import { UiStateService } from '../../../../core/services/ui-state.service';

import {
  ChartStore,
  DEFAULT_CHART_INDICATORS,
  DEFAULT_CHART_INTERVALS,
  DEFAULT_CHART_STRATEGIES,
  TRIGGER_BANDS_CHART_INTERVALS,
  TRIGGER_BANDS_CHART_INDICATORS,
  TRIGGER_BANDS_CHART_STRATEGIES,
} from '../../stores/chart.store';
import { IndicatorSeriesStore } from '../../stores/indicator-series.store';
import {
  addChartExtras,
  createExtrasSignals,
  injectTriggerBandsData,
  convertTriggerBandsDotMarkers,
} from '../../utils/chart-indicators';
import { FlexChartComponent } from '../../../shared/components/flex-chart/flex-chart.component';
import type {
  FlexChartConfig,
  FlexChartDataset,
  IndicatorParamDef,
} from '../../../shared/components/flex-chart/flex-chart.types';
import { formatLocalDate } from '../../utils/utils';
import { parseIsoDateLocal } from '../../../shared/utils/date.util';
import { ChartIntervalKey, StIndicator } from '../../../shared/components/flex-chart/flex-chart.types';
import type { ChartDebugSnapshot } from '../../../shared/components/flex-chart/services/chart-instance.types';
import { BarsInterval } from '../../../../core/models/partner.types';
import {
  ST_INDICATOR_OPTIONS,
  ST_DEV_INDICATOR_OPTIONS,
  buildDefaultConfig,
  ST_ANCHORED_VWAP_INDICATOR,
} from '../../../shared/components/flex-chart/indicators/indicator-registry';
import { ST_SIGNAL_DOTS_INDICATOR } from '../../../shared/components/flex-chart/indicators/st-signal-dots.indicator';
import { ST_TRIGGER_BANDS_INDICATOR } from '../../../shared/components/flex-chart/indicators/st-trigger-bands.indicator';
import {
  ST_ZONE_V1_UPTICK_DOTS_INDICATOR,
  ST_ZONE_V2_UPTICK_DOTS_INDICATOR,
} from '../../../shared/components/flex-chart/indicators/st-trend-rider-dots.indicator';
import {
  generateSyntheticBars,
  SYNTHETIC_PRESETS,
  type SyntheticPreset,
} from './synthetic-data';

const DEFAULT_SYMBOL = 'QQQ';
/** Sentinel — clamped to the loaded bar count, so "all of history". */
const SHOW_ALL_BARS = 1_000_000;

/** Roughly two years of bars per interval (trading days for daily). */
const TWO_YEAR_BARS: Record<ChartIntervalKey, number> = {
  [ChartIntervalKey.DAILY]: 504,
  [ChartIntervalKey.WEEKLY]: 104,
  [ChartIntervalKey.MONTHLY]: 24,
};

const DEFAULT_ENABLED_INDICATORS = new Set<string>([
  StIndicator.TREND_BANDS,
  StIndicator.TREND_STRENGTH,
  StIndicator.ZONE,
  StIndicator.ZONE_V2,
  ST_SIGNAL_DOTS_INDICATOR.id,
  ST_ZONE_V1_UPTICK_DOTS_INDICATOR.id,
  ST_ZONE_V2_UPTICK_DOTS_INDICATOR.id,
]);

type DataMode = 'real' | 'synthetic';

const INTERVAL_TO_BARS: Record<ChartIntervalKey, BarsInterval> = {
  [ChartIntervalKey.DAILY]: BarsInterval.DAILY,
  [ChartIntervalKey.WEEKLY]: BarsInterval.WEEKLY,
  [ChartIntervalKey.MONTHLY]: BarsInterval.MONTHLY,
};

@Component({
  selector: 'app-flex-chart-sandbox',
  standalone: true,
  imports: [CommonModule, MatProgressSpinnerModule, MatDatepickerModule, MatNativeDateModule, FlexChartComponent],
  templateUrl: './flex-chart-sandbox.component.html',
  styleUrl: './flex-chart-sandbox.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FlexChartSandboxComponent implements OnDestroy {
  readonly ChartIntervalKey = ChartIntervalKey;
  readonly chartStore = inject(ChartStore);
  private readonly indicatorStore = inject(IndicatorSeriesStore);
  private readonly ui = inject(UiStateService);

  readonly symbol = signal(DEFAULT_SYMBOL);
  readonly interval = signal<ChartIntervalKey>(ChartIntervalKey.DAILY);
  readonly logScale = signal(true);
  readonly dataMode = signal<DataMode>('real');
  readonly preset = signal<SyntheticPreset>('wide-ratio');
  readonly presets = SYNTHETIC_PRESETS;
  /** ST indicator option ids currently enabled — default to the core ST
   *  suite (trend bands + trend strength + zones V1/V2). */
  readonly enabledIndicators = signal<ReadonlySet<string>>(DEFAULT_ENABLED_INDICATORS);
  /** Picker list: the prod ST options plus the dev-only options — dev
   *  indicators are offered here and nowhere else. */
  readonly indicatorOptions = [...ST_INDICATOR_OPTIONS, ...ST_DEV_INDICATOR_OPTIONS];
  /** Dev-option ids — their checkboxes are disabled in synthetic mode because
   *  generated bars have no callable response to draw from. */
  readonly devOptionIds = new Set(ST_DEV_INDICATOR_OPTIONS.map((o) => o.id));
  /** Dev toggle: Trigger Bands pullback/breakout dots. Off by default — the
   *  band state transitions are inspected without the marker noise; flip on
   *  to check the dots themselves. Sandbox-only control, not part of the
   *  indicator contract. */
  readonly triggerBandsDots = signal(false);
  readonly tbIndicatorId = ST_TRIGGER_BANDS_INDICATOR.id;
  readonly debugState = signal<ChartDebugSnapshot>({ viewport: null, axis: null, logTicks: [] });

  // ── ST Anchored VWAP params (#872) ───────────────────────────────────────
  // Sandbox-local overrides merged over the indicator's declared defaults in
  // `config()`. Kept across enable/disable so toggling off to compare doesn't
  // lose tuning. `historyStart` is an ISO 'YYYY-MM-DD' string passed through
  // to the engine, which compares it against each pivot bar's session `date`.
  readonly avwapIndicatorId = ST_ANCHORED_VWAP_INDICATOR.id;
  readonly avwapParams = ST_ANCHORED_VWAP_INDICATOR.params;
  readonly avwapHistoryParam = this.avwapParams.find((p) => p.key === 'historyStart')!;
  readonly avwapEnabled = computed(() => this.enabledIndicators().has(this.avwapIndicatorId));
  readonly avwapOverrides = signal<Record<string, number | string>>({});
  readonly avwapValues = computed<Record<string, number | string | boolean>>(() => ({
    ...Object.fromEntries(this.avwapParams.map((p) => [p.key, p.default])),
    ...this.avwapOverrides(),
  }));
  /** The picker's selected date — follows both the calendar and the ISO text
   *  input, so clearing un-highlights and typing syncs the calendar. */
  readonly avwapHistoryDate = computed(() => {
    const v = this.avwapValues()['historyStart'];
    return typeof v === 'string' ? parseIsoDateLocal(v) : null;
  });

  @ViewChild('indicatorPicker') private indicatorPicker?: ElementRef<HTMLDetailsElement>;
  private readonly flexChart = viewChild(FlexChartComponent);

  /** Live palette/band colors as the adapter actually emits them — debug aid
   *  for verifying theme remapping reaches the rendered series. */
  readonly debugThemeText = computed(() => {
    const fc = this.flexChart();
    if (!fc) return '—';
    const bands = fc.trendBandSeries();
    const bandTxt = bands.length
      ? bands.map((b) => `b${b.bandIndex}:${b.bullColor}/${b.bearColor}`).join(' ')
      : 'none';
    return `${fc.appearance()} | ${bandTxt}`;
  });

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

  /** Clamp the sandbox chart to the last two years of bars per interval. */
  readonly clippedData = computed<FlexChartDataset | null>(() => {
    const data = this.chartData();
    if (!data) return null;
    const maxBars = TWO_YEAR_BARS[this.interval()];
    if (data.bars.length <= maxBars) return data;
    return { ...data, bars: data.bars.slice(-maxBars) };
  });

  /** Cached indicator series response for the loaded symbol (real mode only) —
   *  same lookup quick-charts and signal-detail use. */
  private readonly indicatorResponse = computed(() => {
    const symbol = this.symbol();
    const version = this.chartStore.symbolDataVersion();
    if (this.dataMode() === 'synthetic' || !symbol || !version) return undefined;
    return this.indicatorStore.responseFor()(
      symbol,
      version,
      DEFAULT_CHART_INTERVALS,
      DEFAULT_CHART_INDICATORS,
      DEFAULT_CHART_STRATEGIES,
    );
  });

  private readonly dailyIntervalData = computed(() => this.indicatorResponse()?.intervals?.daily);
  private readonly weeklyIntervalData = computed(() => this.indicatorResponse()?.intervals?.weekly);

  /** Opt-in Trigger Bands response — a separate, lean callable result cached
   *  under its own IndicatorSeriesStore key. Undefined until the dev indicator
   *  is enabled and the request lands (an older backend that ignores the
   *  family returns data without `triggerBands`: nothing draws). */
  private readonly triggerBandsResponse = computed(() => {
    const symbol = this.symbol();
    const version = this.chartStore.symbolDataVersion();
    if (
      this.dataMode() === 'synthetic' ||
      !this.enabledIndicators().has(ST_TRIGGER_BANDS_INDICATOR.id) ||
      !symbol || !version
    ) return undefined;
    return this.indicatorStore.responseFor()(
      symbol,
      version,
      TRIGGER_BANDS_CHART_INTERVALS,
      TRIGGER_BANDS_CHART_INDICATORS,
      TRIGGER_BANDS_CHART_STRATEGIES,
    );
  });

  private readonly tbDaily = computed(() => this.triggerBandsResponse()?.intervals?.daily);
  private readonly tbWeekly = computed(() => this.triggerBandsResponse()?.intervals?.weekly);

  /** Backend signal dots / Trend Rider dots, converted by the shared helper. */
  private readonly extras = createExtrasSignals(this.dailyIntervalData, this.weeklyIntervalData);

  readonly config = computed<FlexChartConfig>(() => {
    const enabled = this.enabledIndicators();
    const interval = this.interval();
    const has = (id: string) => enabled.has(id);
    // Dev indicator merge: bands ride on the config's triggerBandData; the
    // pullback/breakout dots come from the same lean response. Monthly is not
    // in the lean request, so the toggle draws nothing on M.
    const tbData = has(ST_TRIGGER_BANDS_INDICATOR.id)
      ? interval === ChartIntervalKey.DAILY
        ? this.tbDaily()
        : interval === ChartIntervalKey.WEEKLY
          ? this.tbWeekly()
          : undefined
      : undefined;
    const tbDots = tbData && this.triggerBandsDots() ? convertTriggerBandsDotMarkers(tbData) : undefined;
    const avwapOverrides = this.avwapOverrides();
    const base = injectTriggerBandsData(
      this.indicatorOptions.filter((o) => enabled.has(o.id)).map((o) => {
        const cfg = buildDefaultConfig(o);
        return o.id === this.avwapIndicatorId
          ? { ...cfg, params: { ...cfg.params, ...avwapOverrides } }
          : cfg;
      }),
      tbData,
    );
    const indicators =
      interval === ChartIntervalKey.DAILY
        ? addChartExtras(base, {
            signalDots: has(ST_SIGNAL_DOTS_INDICATOR.id) ? this.extras.dailySignalDots() : undefined,
            uptickDotsV1: has(ST_ZONE_V1_UPTICK_DOTS_INDICATOR.id) ? this.extras.dailyUptickDotsV1() : undefined,
            uptickDotsV2: has(ST_ZONE_V2_UPTICK_DOTS_INDICATOR.id) ? this.extras.dailyUptickDotsV2() : undefined,
            triggerBandsDots: tbDots,
          })
        : interval === ChartIntervalKey.WEEKLY
          ? addChartExtras(base, {
              signalDots: has(ST_SIGNAL_DOTS_INDICATOR.id) ? this.extras.weeklySignalDots() : undefined,
              uptickDotsV1: has(ST_ZONE_V1_UPTICK_DOTS_INDICATOR.id) ? this.extras.weeklyUptickDotsV1() : undefined,
              uptickDotsV2: has(ST_ZONE_V2_UPTICK_DOTS_INDICATOR.id) ? this.extras.weeklyUptickDotsV2() : undefined,
              triggerBandsDots: tbDots,
            })
          : base;
    return {
      indicators,
      showCrosshair: true,
      showZoomToolbar: true,
      enableScrollbar: true,
      showTooltips: true,
      visibleBars: SHOW_ALL_BARS,
      interval,
      logScale: this.logScale(),
      // Dev-mode gate — the sandbox is where in-development indicators run.
      dev: true,
    };
  });

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

  /** Temporary diagnostic — shows whether the X-axis range matches the data. */
  readonly debugXRangeText = computed(() => {
    const axis = this.debugState().axis;
    const bars = this.clippedData()?.bars ?? [];
    if (!axis || bars.length === 0) return '—';
    const { min, max } = axis.xAxis.visibleRange;
    const lastIdx = bars.length - 1;
    return `bars=${bars.length} lastIdx=${lastIdx} visibleMin=${min.toFixed(2)} visibleMax=${max.toFixed(2)}`;
  });

  readonly debugSourceText = computed(() =>
    this.dataMode() === 'synthetic' ? `synthetic:${this.preset()}` : `real:${this.symbol()}`,
  );

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

    // Opt-in request: only while the dev Trigger Bands indicator is enabled
    // in real mode — the lean bands+dots filter set under its own cache key;
    // the default response is never refetched or invalidated.
    effect(() => {
      const symbol = this.symbol();
      const version = this.chartStore.symbolDataVersion();
      if (
        this.dataMode() === 'synthetic' ||
        !this.enabledIndicators().has(ST_TRIGGER_BANDS_INDICATOR.id) ||
        !symbol || !version
      ) return;
      untracked(() =>
        this.indicatorStore.loadIfNeeded(
          symbol,
          version,
          TRIGGER_BANDS_CHART_INTERVALS,
          TRIGGER_BANDS_CHART_INDICATORS,
          TRIGGER_BANDS_CHART_STRATEGIES,
        ),
      );
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

  onTriggerBandsDotsToggle(event: Event): void {
    this.triggerBandsDots.set((event.target as HTMLInputElement).checked);
  }

  toggleIndicator(id: string, event: Event): void {
    const next = new Set(this.enabledIndicators());
    if ((event.target as HTMLInputElement).checked) next.add(id);
    else next.delete(id);
    this.enabledIndicators.set(next);
  }

  /** Single override-mutation seam — `undefined` removes the key so the param
   *  falls back to its declared default. */
  private setAvwapOverride(key: string, value: number | string | undefined): void {
    const next = { ...this.avwapOverrides() };
    if (value === undefined) delete next[key];
    else next[key] = value;
    this.avwapOverrides.set(next);
  }

  /** Commit an AVWAP control — an empty or non-numeric input deletes the
   *  override so the param falls back to its declared default. (Check the
   *  raw string: Number('') is 0, which would silently pin the param.) */
  onAvwapParam(p: IndicatorParamDef, event: Event): void {
    const raw = (event.target as HTMLInputElement).value.trim();
    if (p.input === 'number') {
      const n = Number(raw);
      this.setAvwapOverride(p.key, raw === '' || !Number.isFinite(n) ? undefined : n);
    } else {
      this.setAvwapOverride(p.key, raw === '' ? undefined : raw);
    }
  }

  /** Datepicker commit — formatLocalDate gives local Y/M/D. NativeDateAdapter
   *  produces local-midnight Dates; toISOString would shift back a day in US
   *  timezones. */
  onAvwapHistoryDate(d: Date | null): void {
    this.setAvwapOverride('historyStart', d && Number.isFinite(d.getTime()) ? formatLocalDate(d) : undefined);
  }

  clearAvwapHistory(): void {
    this.setAvwapOverride('historyStart', undefined);
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

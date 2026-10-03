/**
 * Quick Charts Component
 *
 * Compact stacked D/W/M chart panel for the Grouped Review page.
 * Per-interval visibleBars windows (D 30 / W 30 / M 100). The daily chart
 * has +/-50 bar buttons to widen or narrow its window.
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
import { ChartStore } from '../../stores/chart.store';
import {
  DEFAULT_CHART_INTERVALS,
  DEFAULT_CHART_INDICATORS,
  DEFAULT_CHART_STRATEGIES,
} from '../../stores/chart.store';
import { FlexChartComponent } from '../../../shared/components/flex-chart/flex-chart.component';
import type { FlexChartConfig, IndicatorConfig } from '../../../shared/components/flex-chart/flex-chart.types';
import { ChartIntervalKey } from '../../../shared/components/flex-chart/flex-chart.types';
import {
  buildBaseIndicators,
  injectCallableIndicatorData,
  addChartExtras,
  createExtrasSignals,
  ST_ZONE_WINDOW_MONTHLY_INDICATOR,
  ST_ZONE_WINDOW_WEEKLY_INDICATOR,
} from '../../utils/chart-indicators';

/** Per-interval initial windows — daily/weekly stay dense (30 bars ≈ 6 weeks /
 *  ~7 months); monthly keeps the long-context 100-bar view. */
const QUICK_VISIBLE_BARS: Record<ChartIntervalKey, number> = {
  [ChartIntervalKey.DAILY]: 30,
  [ChartIntervalKey.WEEKLY]: 30,
  [ChartIntervalKey.MONTHLY]: 100,
};

const DEFAULT_CELL_HEIGHT_PX = 560;

/** Daily window step and floor for the +/- bar buttons. */
const DAILY_BAR_STEP = 50;
const MIN_DAILY_VISIBLE_BARS = 30;

/** Wait for the symbol to settle before loading charts — rapid prev/next
 *  navigation shouldn't fire a data load per intermediate symbol. */
const CHART_LOAD_DEBOUNCE_MS = 250;

@Component({
  selector: 'app-quick-charts',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, MatIconModule, MatProgressSpinnerModule, FlexChartComponent],
  templateUrl: './quick-charts.component.html',
  styleUrl: './quick-charts.component.scss',
})
export class QuickChartsComponent {
  readonly chartStore = inject(ChartStore);
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

  /** Whether each chart in this panel should render its Y-axis in log scale.
   *  Owned by the page-level wrapper so all three charts stay in sync.
   */
  readonly logScale = input<boolean>(true);

  /** Height (px) of each chart cell in the stack. */
  readonly cellHeight = input<number>(DEFAULT_CELL_HEIGHT_PX);

  /** Shared crosshair date and price — whichever chart is hovered broadcasts here; all charts receive it. */
  readonly sharedCrosshairDate = signal<Date | null>(null);
  readonly sharedCrosshairPrice = signal<number | null>(null);

  /** Daily visible-bar window, adjustable via the +/-50 buttons. */
  readonly dailyVisibleBars = signal(QUICK_VISIBLE_BARS[ChartIntervalKey.DAILY]);

  readonly canRemoveDailyBars = computed(() => this.dailyVisibleBars() > MIN_DAILY_VISIBLE_BARS);
  readonly canAddDailyBars = computed(
    () => this.dailyVisibleBars() < (this.chartStore.dailyData()?.bars.length ?? 0),
  );

  adjustDailyBars(delta: number): void {
    const bars = this.chartStore.dailyData()?.bars.length ?? 0;
    const ceiling = Math.max(bars, MIN_DAILY_VISIBLE_BARS);
    this.dailyVisibleBars.update((v) => Math.max(MIN_DAILY_VISIBLE_BARS, Math.min(v + delta, ceiling)));
  }

  // ── Raw interval data from the callable response ─────────────────────────
  private readonly dailyIntervalData = computed(() => this.indicatorResponse()?.intervals?.daily);
  private readonly weeklyIntervalData = computed(() => this.indicatorResponse()?.intervals?.weekly);
  private readonly monthlyIntervalData = computed(() => this.indicatorResponse()?.intervals?.monthly);

  // ── Derived extras (HTF windows, signal dots, uptick dots) ────────────────
  private readonly extras = createExtrasSignals(
    this.dailyIntervalData, this.weeklyIntervalData,
  );

  // ── Chart configs ──────────────────────────────────────────────────────────
  private buildQuickChartConfig(interval: ChartIntervalKey, indicators: IndicatorConfig[]): FlexChartConfig {
    return {
      indicators,
      showCrosshair: true,
      showZoomToolbar: false,
      enableScrollbar: false,
      visibleBars:
        interval === ChartIntervalKey.DAILY
          ? this.dailyVisibleBars()
          : QUICK_VISIBLE_BARS[interval],
      interval,
      logScale: this.logScale(),
    };
  }

  readonly monthlyConfig = computed<FlexChartConfig>(() => {
    const indicators = injectCallableIndicatorData(
      buildBaseIndicators(ChartIntervalKey.MONTHLY),
      this.monthlyIntervalData(),
      this.chartStore.monthlyData()?.bars ?? [],
      'monthly',
    );
    return this.buildQuickChartConfig(ChartIntervalKey.MONTHLY, indicators);
  });

  readonly weeklyConfig = computed<FlexChartConfig>(() => {
    const indicators = addChartExtras(
      injectCallableIndicatorData(
        buildBaseIndicators(ChartIntervalKey.WEEKLY),
        this.weeklyIntervalData(),
        this.chartStore.weeklyData()?.bars ?? [],
        'weekly',
      ),
      {
        htfWindow: { option: ST_ZONE_WINDOW_MONTHLY_INDICATOR, data: this.extras.windowDataMonthlyOnWeekly() },
        signalDots: this.extras.weeklySignalDots(),
        uptickDotsV1: this.extras.weeklyUptickDotsV1(),
        uptickDotsV2: this.extras.weeklyUptickDotsV2(),
      },
    );
    return this.buildQuickChartConfig(ChartIntervalKey.WEEKLY, indicators);
  });

  readonly dailyConfig = computed<FlexChartConfig>(() => {
    const indicators = addChartExtras(
      injectCallableIndicatorData(
        buildBaseIndicators(ChartIntervalKey.DAILY),
        this.dailyIntervalData(),
        this.chartStore.dailyData()?.bars ?? [],
        'daily',
      ),
      {
        htfWindow: { option: ST_ZONE_WINDOW_WEEKLY_INDICATOR, data: this.extras.windowDataWeeklyOnDaily() },
        signalDots: this.extras.dailySignalDots(),
        uptickDotsV1: this.extras.dailyUptickDotsV1(),
        uptickDotsV2: this.extras.dailyUptickDotsV2(),
      },
    );
    return this.buildQuickChartConfig(ChartIntervalKey.DAILY, indicators);
  });

  constructor() {
    effect((onCleanup) => {
      const sym = this.symbol();
      if (!sym) {
        this.chartStore.clearCharts();
        return;
      }
      const timer = setTimeout(() => this.chartStore.loadCharts(sym), CHART_LOAD_DEBOUNCE_MS);
      onCleanup(() => clearTimeout(timer));
    });
  }
}

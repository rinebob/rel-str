import { Injectable, Signal, computed, signal } from '@angular/core';
import type {
  FlexChartConfig,
  FlexChartDataset,
  ComputedIndicatorSeries,
  IndicatorPane,
} from '../flex-chart.types';
import { StIndicator } from '../flex-chart.types';
import { computeIndicators, groupIndicatorsByPane } from '../flex-chart-calculations';
import { computeAllBands, type BandSeriesData } from '../indicators/st-trend-bands.indicator';

export interface LowerPaneView {
  /** The pane slot ID (e.g. 'lower-1'). */
  id: IndicatorPane;
  /** Syncfusion Y-axis name bound to this pane (e.g. 'lowerYAxis1'). */
  axisName: string;
  /** Computed series assigned to this pane. Empty when the pane is inactive. */
  series: ComputedIndicatorSeries[];
  /** True when any series uses `axisScale: 'fixed-0-100'` — forces Y min=0, max=100. */
  useFixedScale: boolean;
  /** Fixed Y-axis minimum from the first series with `axisScale: 'fixed'`; undefined otherwise. */
  axisMin: number | undefined;
  /** Fixed Y-axis maximum from the first series with `axisScale: 'fixed'`; undefined otherwise. */
  axisMax: number | undefined;
}

export interface ChartAxisView {
  /** Syncfusion axis name — must match the `yAxisName` on each series assigned to this pane. */
  name: string;
  /** Always 'Double' — all lower-pane indicators use numeric Y values. */
  valueType: 'Double';
  /** True — lower axes are rendered on the right side opposite the price axis. */
  opposedPosition: boolean;
  /** Row index into `chartRows`; 0–3 for lower panes (same order as LOWER_PANE_SLOTS). */
  rowIndex: number;
  /** Y-axis minimum. Undefined lets Syncfusion auto-range; set for fixed-scale indicators. */
  minimum: number | undefined;
  /** Y-axis maximum. Undefined lets Syncfusion auto-range; set for fixed-scale indicators. */
  maximum: number | undefined;
  /** Label format string; empty string hides labels on inactive (empty) panes. */
  labelFormat: string;
  /** Grid line style — hidden (width 0) on inactive panes. */
  majorGridLines: { width: number; color: string };
  /** Axis border line style — hidden (width 0) on inactive panes. */
  lineStyle: { width: number; color: string };
  /** Crosshair tooltip disabled on all lower axes — crosshair is price-axis only. */
  crosshairTooltip: { enable: boolean };
  /** No range padding — indicators define their own meaningful Y extents. */
  rangePadding: 'None';
  stripLines: {
    start: number;
    size: number;
    sizeType: 'Pixel';
    color: string;
    dashArray: string;
    visible: boolean;
    opacity: number;
    zIndex: 'Over';
    text: string;
    textStyle: { color: string; size: string };
    horizontalAlignment: 'End';
    verticalAlignment: 'Middle';
  }[];
}

/**
 * Transforms `FlexChartDataset` into chart-ready series, panes, axes, and row
 * definitions. Keeps all X-axis index mapping in one place so the shell
 * component does not own data-transformation logic.
 */
@Injectable()
export class ChartDataAdapter {
  /** References to the component's input signals. Defaults are only used if any
   *  computed is read before `connect()` is called.
   */
  private chartData: Signal<FlexChartDataset | null> = signal(null);
  private config: Signal<FlexChartConfig> = signal({ indicators: [] });

  /** Bind the adapter to the component's input signals once. */
  connect(
    chartData: Signal<FlexChartDataset | null>,
    config: Signal<FlexChartConfig>,
  ): void {
    this.chartData = chartData;
    this.config = config;
  }

  /** Bars mapped to Category-axis index values with display labels. */
  categoryBars = computed(() => {
    const data = this.chartData();
    if (!data) return [];

    return data.bars.map((bar, index) => {
      const d = bar.x;
      const label = d.toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        timeZone: 'UTC',
      });
      return {
        index,
        open: bar.open,
        high: bar.high,
        low: bar.low,
        close: bar.close,
        volume: bar.volume,
        date: bar.x,
        label,
      };
    });
  });

  /** Date-to-index lookup built from bars — keyed only on `chartData` so it is not
   *  rebuilt on every indicator config change (which also triggers `computedSeries`).
   */
  private dateToIndex = computed<Map<number, number>>(() => {
    const data = this.chartData();
    const map = new Map<number, number>();
    if (!data) return map;
    data.bars.forEach((bar, idx) => map.set(bar.x.getTime(), idx));
    return map;
  });

  /** Indicator series with index-based x values for the Category axis. */
  computedSeries = computed<ComputedIndicatorSeries[]>(() => {
    const data = this.chartData();
    const cfg = this.config();
    if (!data || data.bars.length === 0 || cfg.indicators.length === 0) {
      return [];
    }

    const originalSeries = computeIndicators(data.bars, cfg.indicators);
    const dateToIndex = this.dateToIndex();

    return originalSeries.map((series) => ({
      ...series,
      data: series.data
        .map((point) => {
          if (!point.x) return { ...point, index: -1 };
          const index = dateToIndex.get(point.x.getTime());
          return { ...point, index: index ?? -1 };
        })
        .filter((p) => p.index >= 0),
    }));
  });

  /** Computed series grouped by pane ID — shared source for `mainPaneSeries` and `lowerPanes`. */
  private groupedSeries = computed(() => groupIndicatorsByPane(this.computedSeries()));

  mainPaneSeries = computed(() => this.groupedSeries()['main'] || []);

  /** Fallback band data computed from bars — memoized separately so the expensive
   *  `computeAllBands` (4× O(n) EMA passes) only reruns when `chartData` changes,
   *  not on every indicator config or selection change.
   */
  private fallbackBandData = computed<BandSeriesData[]>(() => {
    const data = this.chartData();
    if (!data || data.bars.length < 30) return [];
    return computeAllBands(data.bars);
  });

  /** ST Trend Band candle series — uses pre-computed `bandData` from the callable response
   *  when available; falls back to inline computation from bars otherwise.
   */
  trendBandSeries = computed<BandSeriesData[]>(() => {
    const mainSeries = this.mainPaneSeries();
    const trendBands = mainSeries.find((s) => s.config.type === StIndicator.TREND_BANDS);
    if (!trendBands) return [];

    if (trendBands.config.bandData && trendBands.config.bandData.length > 0) {
      return trendBands.config.bandData;
    }

    return this.fallbackBandData();
  });

  /** Fixed set of lower-pane slot IDs — always emitted so Syncfusion never sees a
   *  structural axes/rows change (which triggers a full chart reinit and 3-5 second
   *  delay on indicator toggle). Panes with no active series get 0% height.
   *  @note Keep in sync with pane assignments in `base-indicators.ts` (BASE_CONFIGS).
   *  Do NOT derive from indicator `defaultPane` values — BASE_CONFIGS overrides panes at
   *  runtime (e.g. Zone V2 defaultPane is lower-1 but BASE_CONFIGS assigns it to lower-3).
   */
  private static readonly LOWER_PANE_SLOTS: IndicatorPane[] = ['lower-1', 'lower-2', 'lower-3', 'lower-4'];

  /** All lower pane slots, each populated with its active series (empty array when inactive). */
  lowerPanes = computed<LowerPaneView[]>(() => {
    const grouped = this.groupedSeries();
    return ChartDataAdapter.LOWER_PANE_SLOTS.map((paneId) => {
      const series = grouped[paneId] ?? [];
      const axisName = `lowerYAxis${paneId.replace('lower-', '')}`;
      const useFixedScale = series.some((s) => s.config.options.axisScale === 'fixed-0-100');
      const fixedIndicator = series.find((s) => s.config.options.axisScale === 'fixed');
      const axisMin = fixedIndicator?.config.options.axisMin;
      const axisMax = fixedIndicator?.config.options.axisMax;
      return { id: paneId, axisName, series, useFixedScale, axisMin, axisMax };
    });
  });

  /** Y-axes for all lower panes — reflects active indicators including strip lines,
   *  min/max, and grid line visibility. Depends on `lowerPanes()` so it updates
   *  whenever the indicator config changes.
   */
  chartAxes = computed<ChartAxisView[]>(() => {
    return this.lowerPanes().map((pane, index) => {
      const stripLines = pane.series
        .flatMap((s) => s.config.options.referenceLines || [])
        .map((ref) => ({
          start: ref.value,
          size: 1,
          sizeType: 'Pixel' as const,
          color: ref.color,
          dashArray: ref.dashArray || '',
          visible: true,
          opacity: 1,
          zIndex: 'Over' as const,
          text: '',
          textStyle: { color: ref.color, size: '10px' },
          horizontalAlignment: 'End' as const,
          verticalAlignment: 'Middle' as const,
        }));

      return {
        name: pane.axisName,
        valueType: 'Double' as const,
        opposedPosition: true,
        rowIndex: index,
        minimum: pane.useFixedScale ? 0 : pane.axisMin,
        maximum: pane.useFixedScale ? 100 : pane.axisMax,
        labelFormat: pane.series.length > 0 ? '{value}' : '',
        majorGridLines: { width: pane.series.length > 0 ? 0.5 : 0, color: 'rgba(158,158,158,0.3)' },
        lineStyle: { width: pane.series.length > 0 ? 1 : 0, color: '#9e9e9e' },
        crosshairTooltip: { enable: false },
        rangePadding: 'None' as const,
        stripLines,
      };
    });
  });

  /** Row heights for all panes — collapses inactive lower panes to 0% so they
   *  don't consume space. Depends on `lowerPanes()` so it updates with indicator config.
   */
  chartRows = computed(() => {
    const panes = this.lowerPanes();
    const activePaneCount = panes.filter((p) => p.series.length > 0).length;
    const lowerPct = activePaneCount > 0 ? Math.floor(55 / activePaneCount) : 0;
    const rows = panes.map((pane) => ({ height: pane.series.length > 0 ? `${lowerPct}%` : '0%' }));
    rows.push({ height: `${100 - lowerPct * activePaneCount}%` });
    return rows;
  });
}

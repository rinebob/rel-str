import { Injectable, Signal, effect, inject, signal, untracked } from '@angular/core';
import type { ComputedIndicatorSeries, FlexChartConfig, FlexChartDataset, PriceBar } from '../flex-chart.types';
import { ChartViewportStore } from '../store/chart-viewport.store';
import { ChartYAxisViewportController } from './chart-y-axis-viewport-controller.service';
import type { ChartAxisState, SfChartInstance } from './chart-instance.types';

/**
 * Wraps the Syncfusion Chart instance and centralizes every imperative
 * operation the component used to perform directly: dataBind/refresh,
 * zoom positioning, and Y-axis viewport application.
 *
 * The component only tells the facade *what* should happen (initial zoom,
 * visible range snap); the facade decides *how* to mutate the chart and
 * when to rebind it.
 */
@Injectable()
export class ChartLifecycleFacade {
  private readonly viewport = inject(ChartViewportStore);
  private readonly yAxisController = inject(ChartYAxisViewportController);

  /** References to the component's input signals. Initialized with defaults so
   *  methods can be called safely before `connectAndActivate()`; effects are
   *  registered there so they track the actual input signals.
   */
  private chartSignal: Signal<SfChartInstance | null> = signal(null);
  private chartData: Signal<FlexChartDataset | null> = signal(null);
  private config: Signal<FlexChartConfig> = signal({ indicators: [] });
  private computedSeries: Signal<ComputedIndicatorSeries[]> = signal([]);

  /** Idempotency key for the initial-zoom effect — prevents re-applying zoom when only
   *  indicator configs change (same dataset, same interval, same zoom days).
   */
  private readonly lastZoomKey = signal<string | null>(null);
  /** Last chartData reference seen by the dataBind effect — used to skip dataBind
   *  on a fresh dataset change and only call it for async series updates on the same dataset.
   */
  private lastDataBindDataset: FlexChartDataset | null = null;
  /** Last-seen value of `showZoomToolbar` — guards the toolbar-change effect so a full
   *  chart refresh only fires when the setting actually flips, not on every config read.
   */
  private readonly lastShowToolbar = signal<boolean | null>(null);
  /** Writable backing signal for `chartState`; updated after every dataBind/viewport change. */
  private readonly chartStateSignal = signal<ChartAxisState | null>(null);
  static readonly RIGHT_MARGIN_BARS = 5;

  /** Read-only snapshot of the current chart axis state (rects, ranges, value types) */
  readonly chartState: Signal<ChartAxisState | null> = this.chartStateSignal.asReadonly();

  /** Bind the facade to the component's typed chart reference and inputs, and register lifecycle effects.
   */
  connectAndActivate(
    chart: Signal<SfChartInstance | null>,
    chartData: Signal<FlexChartDataset | null>,
    config: Signal<FlexChartConfig>,
    computedSeries: Signal<ComputedIndicatorSeries[]>,
  ): void {
    this.chartSignal = chart;
    this.chartData = chartData;
    this.config = config;
    this.computedSeries = computedSeries;

    // Applies initial zoom whenever the chart becomes available, the dataset
    // changes, or the zoom range config changes. Keyed so it does not re-apply
    // for indicator-only config changes.
    effect(() => {
      const chart = this.chartSignal();
      const data = this.chartData();
      const config = this.config();
      if (!chart || !data || data.bars.length === 0) return;

      const key = `${config.initialZoomDays ?? 0}-${config.interval ?? ''}-${data.bars.length}`;
      if (untracked(this.lastZoomKey) === key) return;
      this.lastZoomKey.set(key);

      this.applyInitialZoom();
      this.viewport.setLifecycle('ready');
    });

    // Rebinds when indicator data changes — Syncfusion doesn't pick up [dataSource]
    // updates on existing series when async callable data arrives (e.g. dot markers).
    // dataBind() is much cheaper than refresh() and still forces Syncfusion to read
    // the latest series dataSource arrays.
    // Skip when chartData itself just changed — Syncfusion's declarative bindings handle
    // the full re-render; calling dataBind() concurrently causes a getVisibleSeries crash.
    effect(() => {
      const series = this.computedSeries();
      const currentData = untracked(this.chartData);
      const key = series.map((s) => s.data.length).join(',');
      if (key === '') return;

      // Dataset changed — record it and let the declarative render handle initialization.
      if (currentData !== this.lastDataBindDataset) {
        this.lastDataBindDataset = currentData;
        return;
      }

      const chart = untracked(this.chartSignal);
      if (!chart || !chart.series?.length) return;
      chart.animateSeries = false;
      try { chart.dataBind(); } catch { /* suppress residual Syncfusion race */ }
    });

    // Refreshes the chart when zoom toolbar visibility changes — Syncfusion ignores
    // runtime zoomSettings updates so a full refresh is required, but only when
    // the setting actually changes to avoid unnecessary full renders.
    effect(() => {
      const showToolbar = this.config().showZoomToolbar ?? false;
      const last = untracked(this.lastShowToolbar);
      this.lastShowToolbar.set(showToolbar);
      if (last === null || last === showToolbar) return;

      const chart = this.chartSignal();
      if (!chart) return;
      chart.animateSeries = false;
      chart.refresh();
    });

    // Applies Y-axis viewport changes imperatively and rebinds. This is the single
    // place where Y-axis min/max or zoomFactor/zoomPosition are written to the
    // Syncfusion instance.
    effect(() => {
      const chart = this.chartSignal();
      const viewport = this.viewport.yAxisViewport();
      if (!chart || !viewport) return;

      if (chart.primaryYAxis) {
        if (viewport.valueType === 'Double') {
          chart.primaryYAxis.minimum = viewport.min;
          chart.primaryYAxis.maximum = viewport.max;
        } else if (
          viewport.zoomFactor !== undefined &&
          viewport.zoomPosition !== undefined
        ) {
          chart.primaryYAxis.zoomFactor = viewport.zoomFactor;
          chart.primaryYAxis.zoomPosition = viewport.zoomPosition;
        }
      }

      chart.animateSeries = false;
      chart.dataBind();

      // Re-captures axis rects/ranges so overlay and crosshair logic can react
      // to the updated viewport without reading the chart instance directly.
      this.refreshChartState();
    });
  }

  /** Hard refresh — re-renders the full chart. Use when series data shape changes. */
  refresh(): void {
    const chart = this.chartSignal();
    if (!chart) return;
    chart.animateSeries = false;
    chart.refresh();
  }

  /** Apply initial X-axis zoom and Y-axis range for the current dataset. */
  applyInitialZoom(): void {
    const chart = this.chartSignal();
    const data = this.chartData();
    const config = this.config();
    if (!chart || !data || data.bars.length === 0) return;

    const margin = ChartLifecycleFacade.RIGHT_MARGIN_BARS;
    const totalCategories = data.bars.length + margin;
    const initialDays = config.initialZoomDays ?? 60;
    const visibleCount = Math.max(1, Math.min(initialDays, data.bars.length - 1));
    const visibleRange = visibleCount + margin;
    const zoomFactor = visibleRange / totalCategories;
    const zoomPosition = (data.bars.length - visibleCount) / totalCategories;

    if (chart.primaryXAxis) {
      chart.primaryXAxis.minimum = 0;
      chart.primaryXAxis.maximum = data.bars.length - 1 + margin;
      chart.primaryXAxis.zoomFactor = zoomFactor;
      chart.primaryXAxis.zoomPosition = zoomPosition;
    }

    const visibleStart = Math.max(0, data.bars.length - visibleCount);
    const visibleBars = data.bars.slice(visibleStart);
    this.setYAxisViewport(data.bars, !!config.logScale, visibleBars);
  }

  /** Snap the Y-axis to the visible bar range after zoom/scroll. */
  snapYAxisToVisibleRange(rangeMin: number, rangeMax: number): void {
    const data = this.chartData();
    if (!data || data.bars.length === 0) return;

    const minIdx = Math.max(0, Math.floor(rangeMin));
    const maxIdx = Math.min(data.bars.length - 1, Math.ceil(rangeMax));
    const visibleBars = data.bars.slice(minIdx, maxIdx + 1);
    const config = this.config();
    this.setYAxisViewport(data.bars, !!config.logScale, visibleBars);
  }

  /** Snap the Y-axis to whatever the chart's current X-axis visible range is. */
  snapYAxisToCurrentVisibleRange(): void {
    const chart = this.chartSignal();
    const data = this.chartData();
    if (!chart || !data || data.bars.length === 0) return;

    const xAxis = chart.axisCollections?.[0];
    if (!xAxis?.visibleRange) return;

    this.snapYAxisToVisibleRange(
      xAxis.visibleRange.min ?? 0,
      xAxis.visibleRange.max ?? 0,
    );
    this.refreshChartState();
  }

  /** Capture the current axis rects/ranges from the Syncfusion instance.
   *  Also flushes a dataBind so any series updates that arrived before the
   *  chart finished its initial render are applied now that series are populated.
   */
  refreshChartState(): void {
    const chart = this.chartSignal();
    if (!chart) {
      this.chartStateSignal.set(null);
      return;
    }
    if (chart.series?.length) {
      chart.animateSeries = false;
      try { chart.dataBind(); } catch { /* suppress Syncfusion race during initial render */ }
    }
    const xAxis = chart.axisCollections?.[0];
    const yAxis = chart.primaryYAxis;
    if (!xAxis?.visibleRange || !xAxis?.rect || !yAxis?.visibleRange || !yAxis?.rect) {
      this.chartStateSignal.set(null);
      return;
    }
    this.chartStateSignal.set({
      xAxis: {
        visibleRange: xAxis.visibleRange,
        rect: xAxis.rect,
      },
      yAxis: {
        visibleRange: yAxis.visibleRange,
        rect: yAxis.rect,
        valueType: yAxis.valueType ?? 'Double',
      },
    });
  }


  private setYAxisViewport(allBars: PriceBar[], logScale: boolean, visibleBars: PriceBar[]): void {
    if (allBars.length === 0) return;
    const viewport = this.yAxisController.computeViewport(logScale, allBars, visibleBars);
    this.viewport.setYAxisViewport(viewport);
  }
}

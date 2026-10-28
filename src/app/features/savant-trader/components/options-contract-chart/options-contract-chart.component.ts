/**
 * Options Contract Chart Component
 *
 * Dedicated Syncfusion chart for options contract time-series data.
 * Uses a Category axis so series align by date value across differing
 * observation sets (mark lines render missing dates as gaps; the
 * underlying overlay drops empties so it stays continuous).
 * Main pane: one mark line per plotted contract + per-contract strike-span
 * markers + underlying close on the opposed axis.
 * Lower panes (single contract only): IV, Greeks (Delta left, Gamma right),
 * Volume/OI. Y-axes snap to the visible data range on zoom/pan/scroll.
 *
 * Series construction lives in options-contract-chart-series.builder.ts —
 * this file is signal wiring plus chart event handlers.
 */
import { Component, input, output, computed, ChangeDetectionStrategy, viewChild, signal, effect } from '@angular/core';
import { CommonModule } from '@angular/common';
import {
  ChartModule,
  ChartComponent as SfChartComponent,
  IZoomCompleteEventArgs,
  IAxisLabelRenderEventArgs,
  LineSeriesService,
  ColumnSeriesService,
  CategoryService,
  ZoomService,
  ScrollBarService,
  LegendService,
  CrosshairService,
  TooltipService,
  StripLineService,
} from '@syncfusion/ej2-angular-charts';

import type { OHLCDatum } from '../../../shared/types/rs.interfaces';
import type { ParsedObservation } from '../../utils/contract-observation.utils';
import { formatUtcDate } from '../../utils/utils';
import { alignSeriesToLabels, minMaxInRange } from '../../utils/chart-series.utils';
import {
  MARKER_NAME_PREFIX,
  LOWER_PANE_AXES,
  computeMarkerSpans,
  unionAxisLabels,
  buildSeriesCollection,
  type PlottedChartContract,
  type ChartPoint,
  type ChartSeriesSpec,
} from './options-contract-chart-series.builder';

export { MARKER_NAME_PREFIX };
export type { PlottedChartContract, ChartSeriesSpec };

@Component({
  selector: 'app-options-contract-chart',
  standalone: true,
  imports: [CommonModule, ChartModule],
  providers: [
    LineSeriesService,
    ColumnSeriesService,
    CategoryService,
    ZoomService,
    ScrollBarService,
    LegendService,
    CrosshairService,
    TooltipService,
    StripLineService,
  ],
  templateUrl: './options-contract-chart.component.html',
  styleUrl: './options-contract-chart.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class OptionsContractChartComponent {
  /** One entry per plotted contract; a 1-element array is the single-contract case. */
  plottedSeries = input<PlottedChartContract[]>([]);
  /** Category axis labels — the rendered dates. The chart unions in marker
   *  span endpoints itself (see axisLabels), so callers only supply dates. */
  xLabels = input.required<string[]>();
  underlyingBars = input<OHLCDatum[]>([]);
  showUnderlying = input(true);
  showGreeks = input(true);
  showVolumeOI = input(false);
  padDays = input(0);
  /** Contract id to emphasize — dims every other mark/marker series. */
  highlightedContractId = input<string | null>(null);

  /** Pointer over a mark line, span marker, or legend entry emits that
   *  contract id; pointer anywhere else (or leaving the chart) emits null. */
  seriesHovered = output<string | null>();

  private readonly chart = viewChild<SfChartComponent>('chart');
  private readonly visibleRange = signal<{ min: number; max: number } | null>(null);

  /** Lower panes only exist for the single-contract view. */
  readonly hasLowerPanes = computed(() => {
    const s = this.plottedSeries();
    return s.length === 1 && s[0].points.length > 0;
  });

  /** Strike-span markers: openDate (or first observation) → expiration at strike. */
  readonly markerSpans = computed(() => computeMarkerSpans(this.plottedSeries()));

  /** The real category axis — rendered dates unioned with marker endpoints
   *  so span markers always land on a category, even when open/expiration
   *  dates aren't observation dates. This invariant lives here, not with
   *  whoever feeds xLabels. */
  readonly axisLabels = computed(() => unionAxisLabels(this.xLabels(), this.markerSpans()));

  /** Mark series aligned to the union axis — nulls where a contract lacks a date. */
  readonly alignedMarks = computed<ChartPoint[][]>(() => {
    const labels = this.axisLabels();
    return this.plottedSeries().map((c) =>
      alignSeriesToLabels(c.points, labels, (p) =>
        p.mark != null && Number.isFinite(p.mark) ? p.mark : null,
      ),
    );
  });

  /** Underlying bars aligned to the union axis by date. */
  readonly underlyingData = computed<ChartPoint[]>(() => {
    const labels = this.axisLabels();
    if (!labels.length) return [];
    const bars = this.underlyingBars().filter(
      (b): b is OHLCDatum & { date: string } => !!b.date && Number.isFinite(b.close),
    );
    return alignSeriesToLabels(bars, labels, (b) => b.close);
  });

  /** Single contract's observations aligned to the union axis (lower panes). */
  private readonly singleObsAligned = computed(() => {
    const series = this.plottedSeries();
    if (series.length !== 1 || series[0].points.length === 0) return [];
    const map = new Map(series[0].points.map((p) => [p.date, p]));
    return this.axisLabels().map((d) => map.get(d) ?? null);
  });

  /** Visible-range min/max for every Y-axis. */
  readonly axisRanges = computed(() => {
    const range = this.visibleRange();
    const labels = this.axisLabels();
    const marks = this.alignedMarks();
    const underlying = this.underlyingData();
    const single = this.singleObsAligned();
    if (!range || !labels.length) return null;

    const scalar = (pick: (i: number) => number | null) =>
      minMaxInRange(range, labels.length, (i) => [pick(i)]) ?? { min: 0, max: 1 };

    // The underlying axis must cover the span-marker strikes as well as the
    // bar closes — a marker sits ON this axis, so a strike outside the close
    // range (deep OTM sets, or no bars at all) would render invisible.
    const startDate = labels[Math.max(0, Math.floor(range.min))];
    const endDate = labels[Math.min(labels.length - 1, Math.ceil(range.max))];
    const strikes = this.markerSpans()
      .filter((s) => s.start <= endDate && s.end >= startDate)
      .map((s) => s.strike)
      .filter(Number.isFinite);
    const closes = minMaxInRange(range, labels.length, (i) => [underlying[i]?.value ?? null]);
    const underlyingVals = [...(closes ? [closes.min, closes.max] : []), ...strikes];
    let underlyingRange = underlyingVals.length
      ? { min: Math.min(...underlyingVals), max: Math.max(...underlyingVals) }
      : { min: 0, max: 1 };
    if (underlyingRange.min === underlyingRange.max) {
      const pad = Math.abs(underlyingRange.min) > 0 ? Math.abs(underlyingRange.min) * 0.1 : 0.5;
      underlyingRange = { min: underlyingRange.min - pad, max: underlyingRange.max + pad };
    }
    const markRange =
      minMaxInRange(range, labels.length, (i) => marks.map((m) => m[i]?.value)) ?? underlyingRange;

    const field = (f: Exclude<keyof ParsedObservation, 'date'>) =>
      scalar((i) => single[i]?.[f] ?? null);

    return {
      mark: markRange,
      underlying: underlyingRange,
      iv: field('iv'),
      delta: field('delta'),
      gamma: field('gamma'),
      volume: field('volume'),
      openInterest: field('openInterest'),
    };
  });

  /** Visible chart extents: date range and underlying price range. */
  readonly visibleExtents = computed(() => {
    const range = this.visibleRange();
    const labels = this.axisLabels();
    const ranges = this.axisRanges();
    if (!range || !labels.length || !ranges) return null;

    const startIdx = Math.max(0, Math.floor(range.min));
    const endIdx = Math.min(labels.length - 1, Math.ceil(range.max));
    return {
      startDate: labels[startIdx] ?? null,
      endDate: labels[endIdx] ?? null,
      priceLow: ranges.underlying.min,
      priceHigh: ranges.underlying.max,
    };
  });

  // Reset visible range when the dataset or padding changes.
  readonly initVisibleRange = effect(() => {
    const labels = this.axisLabels();
    const pad = this.padDays();
    const hasPoints = this.plottedSeries().some((c) => c.points.length > 0);
    if (labels.length > 0) {
      this.visibleRange.set(
        hasPoints
          ? { min: -pad, max: labels.length - 1 + pad }
          : { min: 0, max: labels.length - 1 },
      );
    } else {
      this.visibleRange.set(null);
    }

    // Reset the chart's internal zoom/scroll state so the X-axis
    // redraws fully instead of retaining the previous zoom position.
    const chart = this.chart();
    if (chart) {
      const xAxis = chart.primaryXAxis;
      if (xAxis) {
        xAxis.zoomFactor = 1;
        xAxis.zoomPosition = 0;
      }
      const axisCol = chart.axisCollections;
      if (axisCol?.length) {
        axisCol[0].zoomFactor = 1;
        axisCol[0].zoomPosition = 0;
      }
      chart.animateSeries = false;
      chart.refresh();
    }
  });

  // Apply min/max to every Y-axis whenever the visible range or data changes.
  readonly applyYAxisViewport = effect(() => {
    const ranges = this.axisRanges();
    const chart = this.chart();
    if (!chart || !ranges) return;

    if (chart.primaryYAxis) {
      chart.primaryYAxis.minimum = ranges.mark.min;
      chart.primaryYAxis.maximum = ranges.mark.max;
    }

    const findAxis = (name: string) => chart.axisCollections?.find((a) => a.name === name);
    const AXIS_MAP: Record<string, { min: number; max: number }> = {
      underlyingAxis: ranges.underlying,
      ivAxis: ranges.iv,
      greeksAxis: ranges.delta,
      gammaAxis: ranges.gamma,
      volumeAxis: ranges.volume,
      oiAxis: ranges.openInterest,
    };
    for (const [name, range] of Object.entries(AXIS_MAP)) {
      const axis = findAxis(name);
      if (axis) {
        axis.minimum = range.min;
        axis.maximum = range.max;
      }
    }

    chart.animateSeries = false;
    chart.dataBind();
  });

  // Axis configurations
  // literal-sweep exception #1214: chart-lib config literals (grid/axis/
  // crosshair colors) — canvas-rendered, var() can't resolve (#1164).
  readonly primaryXAxis = computed(() => {
    const count = this.axisLabels().length;
    const interval = count > 0 ? Math.max(1, Math.floor(count / 6)) : 1;
    return {
      valueType: 'Category' as const,
      labelIntersectAction: 'Rotate45' as const,
      interval,
      majorGridLines: { width: 0.5, color: '#e0e0e0' },
      labelStyle: { size: '10px' },
    };
  });

  readonly primaryYAxis = computed(() => ({
    labelFormat: '${value}',
    lineStyle: { color: '#e0e0e0' },
    majorTickLines: { width: 0 },
    labelStyle: { size: '11px' },
    rangePadding: 'None' as const,
    rowIndex: this.hasLowerPanes() ? 3 : 0,
  }));

  readonly underlyingAxis = computed(() => ({
    name: 'underlyingAxis',
    opposedPosition: true,
    labelFormat: '${value}',
    lineStyle: { color: '#ff9800', width: 1 },
    majorTickLines: { width: 0 },
    labelStyle: { size: '11px', color: '#ff9800' },
    rangePadding: 'None' as const,
    rowIndex: this.hasLowerPanes() ? 3 : 0,
    crosshairTooltip: { enable: true },
  }));

  readonly axes = computed(() => [
    this.underlyingAxis(),
    ...(this.hasLowerPanes() ? LOWER_PANE_AXES : []),
  ]);

  /** Row layout — single pane unless the one-contract lower panes are active. */
  readonly rows = computed(() => {
    if (!this.hasLowerPanes()) {
      return [{ height: '100%' }];
    }
    return [
      { height: '15%' }, // bottom: Volume/OI
      { height: '15%' }, //        Greeks
      { height: '15%' }, //        IV
      { height: '55%' }, // top:    Price
    ];
  });

  // Zoom settings
  readonly zoomSettings = {
    enablePinchZooming: true,
    enableSelectionZooming: false,
    enableMouseWheelZooming: true,
    enablePan: true,
    enableScrollbar: true,
    mode: 'X' as const,
    toolbarItems: ['Zoom', 'ZoomIn', 'ZoomOut', 'Pan', 'Reset'] as const,
  };

  readonly crosshair = { enable: true, lineType: 'Both' as const, lineColor: '#ccc', snapToData: false };
  readonly tooltip = { enable: true, shared: true, format: '${point.x}: ${point.y}' };
  readonly legend = { visible: true, position: 'Bottom' as const, toggleVisibility: true };
  readonly chartBorder = { width: 0 };
  readonly chartArea = { border: { width: 0 } };

  // Chart height fills the parent container.
  readonly chartHeight = '100%';

  readonly seriesCollection = computed<ChartSeriesSpec[]>(() =>
    buildSeriesCollection({
      contracts: this.plottedSeries(),
      alignedMarks: this.alignedMarks(),
      underlying: this.underlyingData(),
      markers: this.markerSpans(),
      showUnderlying: this.showUnderlying(),
      showGreeks: this.showGreeks(),
      showVolumeOI: this.showVolumeOI(),
      highlightedContractId: this.highlightedContractId(),
    }),
  );

  /** Series-collection index → contractId. Mark spec names are labels (not
   *  ids) so marks map through plottedSeries; marker names carry the id via
   *  MARKER_NAME_PREFIX; underlying/pane entries are not contracts. */
  private readonly seriesContractIds = computed<(string | null)[]>(() => {
    const idByLabel = new Map(this.plottedSeries().map((c) => [c.label, c.contractId]));
    return this.seriesCollection().map((s) => {
      if (s.role === 'mark') return idByLabel.get(s.name) ?? null;
      if (s.role === 'marker') return s.name.slice(MARKER_NAME_PREFIX.length);
      return null;
    });
  });

  private lastHoverEmitted: string | null | undefined;

  private emitHover(id: string | null): void {
    if (id !== this.lastHoverEmitted) {
      this.lastHoverEmitted = id;
      this.seriesHovered.emit(id);
    }
  }

  /** Syncfusion embeds the series index in rendered element ids —
   *  `{chartId}_Series_{i}_…` and `{chartId}_chart_legend_g_{i}` for legend
   *  items. Markers are legend-cancelled, so legend indices skip them and
   *  line up 1:1 with the mark order (then underlying/panes → null). */
  onChartMouseMove(event: { target?: string }): void {
    const target = event.target ?? '';
    const series = /_Series_(\d+)/.exec(target);
    if (series) {
      this.emitHover(this.seriesContractIds()[Number(series[1])] ?? null);
      return;
    }
    // Legend items render ids for the group, text label, and shape glyph —
    // all carry the same trailing legend index.
    const legend = /_chart_legend_(?:g|text|shape(?:_marker)?)_(\d+)/.exec(target);
    if (legend) {
      this.emitHover(this.plottedSeries()[Number(legend[1])]?.contractId ?? null);
      return;
    }
    this.emitHover(null);
  }

  onChartMouseLeave(): void {
    this.emitHover(null);
  }

  onAxisLabelRender(args: IAxisLabelRenderEventArgs): void {
    if (args.axis?.name === 'primaryXAxis' && args.text) {
      args.text = formatUtcDate(args.text, { month: 'short', day: '2-digit' });
    }
  }

  /** Span markers never appear in the legend — their names are internal. */
  onLegendRender(args: { text?: string; cancel: boolean }): void {
    if (args.text?.startsWith(MARKER_NAME_PREFIX)) {
      args.cancel = true;
    }
  }

  onZoomComplete(event: IZoomCompleteEventArgs): void {
    const range = event.currentVisibleRange;
    if (range?.min != null && range?.max != null) {
      this.visibleRange.set({ min: range.min, max: range.max });
    }
  }

  onScrollEnd(): void {
    const visibleRange = this.chart()?.axisCollections?.[0]?.visibleRange;
    if (visibleRange?.min != null && visibleRange?.max != null) {
      this.visibleRange.set({ min: visibleRange.min, max: visibleRange.max });
    }
  }

}

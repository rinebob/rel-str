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
import { Component, input, output, model, computed, ChangeDetectionStrategy, viewChild, signal, effect, inject, ElementRef, NgZone, OnDestroy, HostListener } from '@angular/core';
import { CommonModule } from '@angular/common';
import {
  ChartModule,
  ChartComponent as SfChartComponent,
  IZoomCompleteEventArgs,
  IAxisLabelRenderEventArgs,
  IMouseEventArgs,
  ISharedTooltipRenderEventArgs,
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
import type { StudyRange } from '../../utils/option-group-generator.utils';
import { formatUtcDate } from '../../utils/utils';
import { alignSeriesToLabels, minMaxInRange } from '../../utils/chart-series.utils';
import type { SfChartInstance, SfChartAxisRect } from '../../../shared/components/flex-chart/services/chart-instance.types';
import {
  categoryIndexToPx,
  nearestIndexByDate,
  pxToCategoryIndex,
  resolveBrushRange,
  type AxisSpace,
} from './options-contract-chart-brush.utils';
import {
  MARKER_NAME_PREFIX,
  LOWER_PANE_AXES,
  UNDERLYING_COLOR,
  plottedSeriesColor,
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
export class OptionsContractChartComponent implements OnDestroy {
  /** One entry per plotted contract; a 1-element array is the single-contract case. */
  plottedSeries = input<PlottedChartContract[]>([]);
  /** Category axis labels — the rendered dates. The chart unions in marker
   *  span endpoints itself (see axisLabels), so callers only supply dates. */
  xLabels = input.required<string[]>();
  underlyingBars = input<OHLCDatum[]>([]);
  showUnderlying = input(true);
  showGreeks = input(true);
  showVolumeOI = input(false);
  /** Contract id to emphasize — dims every other mark/marker series. */
  highlightedContractId = input<string | null>(null);
  /** Data-window (shared tooltip) placement — floats with the cursor,
   *  pinned to the chart's upper-left corner, or off entirely. */
  tooltipMode = input<'float' | 'anchor' | 'hidden'>('float');

  /** Arm/disarm the study-range brush — two-way bound by the page; Esc
   *  disarms through the model. */
  brushArmed = model(false);
  /** Snapping domain — the drawer's corpusDates; axis labels when empty. */
  brushCorpus = input<string[]>([]);
  /** Active refine bound — renders as a faint band until it clears. */
  activeStudyRange = input<StudyRange | null>(null);

  /** Pointer over a mark line, span marker, or legend entry emits that
   *  contract id; pointer anywhere else (or leaving the chart) emits null. */
  seriesHovered = output<string | null>();

  /** Study-range brush result — emitted by the brush overlay (FE-4);
   *  routed by the page into the generator store's alive-range bound.
   *  Clearing is the drawer's clear-bound path, not a brush emission. */
  studyRange = output<StudyRange>();

  private readonly chart = viewChild<SfChartComponent>('chart');
  private readonly visibleRange = signal<{ min: number; max: number } | null>(null);

  private readonly el = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly zone = inject(NgZone);
  private resizeObserver: ResizeObserver | null = null;
  private pendingResizeRaf: number | null = null;
  private lastObservedWidth = 0;
  private lastObservedHeight = 0;

  /** Lower panes only exist for the single-contract view. */
  readonly hasLowerPanes = computed(() => {
    const s = this.plottedSeries();
    return s.length === 1 && s[0].points.length > 0;
  });

  /** Strike-span markers: earliest pick day → expiration at strike, a dot
   *  per pick day (computeMarkerSpans). */
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

  // Reset visible range when the dataset changes. Pad days arrive as real
  // trailing/leading categories in xLabels (padDateLabels), so the visible
  // window is always the full domain.
  readonly initVisibleRange = effect(() => {
    const labels = this.axisLabels();
    this.plottedSeries(); // tracked — a set swap with identical labels still resets zoom
    this.visibleRange.set(labels.length > 0 ? { min: 0, max: labels.length - 1 } : null);

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
      this.axisTick.update((t) => t + 1); // relayout may shift the plot rect
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
    this.axisTick.update((t) => t + 1); // label-width changes can shift the plot rect
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
  /** Shared data window — row keys are the series label (contract / pane
   *  name), not the point's date. 'anchor' keeps the layer enabled (it's
   *  the same svg the crosshair + axis labels live in — disabling it
   *  killed the date/price tags) and hides just the box group via the
   *  .dw-pinned CSS while the custom .dw-panel carries the rows; that
   *  panel exists because the Syncfusion box is unscrollable SVG text.
   *  'hidden' disables the window; the crosshair stays on in every mode. */
  readonly tooltip = computed(() => {
    if (this.tooltipMode() === 'hidden') return { enable: false };
    return { enable: true, shared: true, format: '${series.name}: ${point.y}' };
  });
  /** Legend off — the chips row is the series roster (marks + underlying
   *  chip); a second one at the bottom duplicated it. The legendRender
   *  marker-cancel + legend-id hover parsing stay so re-enabling is a flag. */
  readonly legend = { visible: false, position: 'Bottom' as const, toggleVisibility: true };
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

  /** Series-collection index → contractId. Mark/marker specs carry their
   *  contractId on the spec — the map survives the builder's z-order
   *  reorder, which an ordinal/index map would not. Underlying/pane
   *  entries are not contracts. */
  private readonly seriesContractIds = computed<(string | null)[]>(() =>
    this.seriesCollection().map((s) => s.contractId ?? null),
  );

  private lastHoverEmitted: string | null = null;

  /** A plotted-set change can strand the emitted id — clear it so a stale
   *  highlight can't dim the whole new set until the next pointer event. */
  readonly resetHoverOnSetChange = effect(() => {
    this.plottedSeries();
    this.lastHoverEmitted = null;
    this.emitHover(null);
  });

  private emitHover(id: string | null): void {
    if (id !== this.lastHoverEmitted) {
      this.lastHoverEmitted = id;
      this.seriesHovered.emit(id);
    }
  }

  /** Syncfusion embeds the series index in rendered element ids —
   *  `{chartId}_Series_{i}_…` for series/points/symbols and
   *  `{chartId}_chart_legend_{g|text|shape}_{i}` for legend items. Legend
   *  indices are visibleSeries positions — the same domain as the series
   *  collection — so cancelled markers still consume their slots (marks
   *  are always 0..n-1 either way). */
  /** The cursor's category — feeds the anchored data window. Kept after
   *  mouse-leave so the pinned panel stays populated while the user
   *  moves into it to scroll. */
  private readonly hoveredAxisIndex = signal<number | null>(null);

  /** 'anchor' data window — an HTML panel because Syncfusion's tooltip is
   *  SVG-rendered (unscrollable, and every positioning seam drags the
   *  shared crosshair svg). Rows mirror the shared tooltip's semantics:
   *  each series' nearest point to the hovered date, keyed by label.
   *  Span-marker rows are folded into the contract row — the strike is
   *  already in the label. */
  readonly pinnedWindow = computed(() => {
    if (this.tooltipMode() !== 'anchor') return null;
    const idx = this.hoveredAxisIndex();
    const labels = this.axisLabels();
    if (idx == null || !labels.length) return null;
    const date = labels[Math.min(idx, labels.length - 1)];
    const rows: { key: string; value: string; color: string }[] = [];
    this.plottedSeries().forEach((c, i) => {
      if (!c.points.length) return;
      const at = Math.max(0, nearestIndexByDate(date, c.points.map((p) => p.date)));
      const mark = c.points[at]?.mark;
      rows.push({ key: c.label, value: mark == null ? '—' : `$${mark.toFixed(2)}`, color: plottedSeriesColor(i) });
    });
    const bars = this.underlyingBars();
    const dated = bars.filter((b): b is OHLCDatum & { date: string } => !!b.date);
    if (this.showUnderlying() && dated.length) {
      const at = Math.max(0, nearestIndexByDate(date, dated.map((b) => b.date)));
      rows.push({ key: 'Underlying', value: `$${dated[at].close.toFixed(2)}`, color: UNDERLYING_COLOR });
    }
    return rows.length ? { date, rows } : null;
  });

  /** Cursor-following date tag at the chart's top edge, visible in all
   *  data-window modes (it's chart furniture like the crosshair's price
   *  tag, not part of the data window). In float/hidden it hides on
   *  mouse-leave; in anchor it keeps the last hovered category like the
   *  panel. Snaps to the category center. */
  readonly cursorDateTag = computed(() => {
    const idx = this.hoveredAxisIndex();
    const labels = this.axisLabels();
    const space = this.axisSpace();
    if (idx == null || !labels.length || !space) return null;
    return { date: labels[Math.min(idx, labels.length - 1)], left: categoryIndexToPx(idx, space) };
  });

  onChartMouseMove(event: IMouseEventArgs): void {
    const space = this.axisSpace();
    if (space) {
      this.hoveredAxisIndex.set(pxToCategoryIndex(event.x, space, this.axisLabels().length));
    }
    // Armed brush: mouse semantics are drag, not hover.
    if (this.brushArmed()) return;
    const target = event.target ?? '';
    const series = /_Series_(\d+)/.exec(target);
    if (series) {
      this.emitHover(this.seriesContractIds()[Number(series[1])] ?? null);
      return;
    }
    const legend = /_chart_legend_(?:g|text|shape(?:_marker)?)_(\d+)/.exec(target);
    if (legend) {
      this.emitHover(this.seriesContractIds()[Number(legend[1])] ?? null);
      return;
    }
    this.emitHover(null);
  }

  onChartMouseLeave(): void {
    this.emitHover(null);
    // Anchor keeps the last category (the panel must stay populated for
    // scrolling); float/hidden clear so the tag vanishes with the cursor.
    if (this.tooltipMode() !== 'anchor') this.hoveredAxisIndex.set(null);
  }

  // ── Study-range brush (FE-4) ───────────────────────────────────────
  // An armed capture layer sits over the chart; drags resolve px →
  // category index → axis label → nearest corpus date. The overlay is
  // decorative — the axis is never mutated (no selectionMode, no
  // visibleRange writes).

  private readonly brushDrag = signal<{ startPx: number; currentPx: number } | null>(null);

  /** Bumped whenever the axis may have re-measured (zoom, scroll,
   *  resize) — `axisCollections[0].rect` is a plain mutable property, so
   *  computeds need this signal to track it. */
  private readonly axisTick = signal(0);

  /** Axis geometry from the primary category axis — null until the chart
   *  reports its plot rect (also null in spec stubs without one). */
  private axisSpace(): AxisSpace | null {
    this.axisTick(); // track — the underlying rect is mutable
    const chart = this.chart() as (SfChartComponent & SfChartInstance) | undefined;
    const axis = chart?.axisCollections?.[0];
    const rect = axis?.rect;
    const vr = axis?.visibleRange;
    // The SDK seeds rect as Rect(undefined, undefined, 0, 0) pre-layout —
    // bail rather than emit a degenerate range from a NaN/zero-width space.
    if (!rect || !vr || !Number.isFinite(rect.x) || !Number.isFinite(rect.width) || rect.width <= 0) {
      return null;
    }
    // The X-axis rect is the label strip BELOW the plot (height ≈ 0), not
    // the plot itself — vertical extent comes from the plot column's
    // seriesClipRect (what Syncfusion's own X-mode zoom rect uses), with
    // the primary Y-axis rect as fallback before the layout panel fills.
    const clip =
      (chart as { chartAxisLayoutPanel?: { seriesClipRect?: SfChartAxisRect } })
        ?.chartAxisLayoutPanel?.seriesClipRect ?? chart?.primaryYAxis?.rect;
    return {
      x: rect.x,
      y: clip?.y ?? 0,
      width: rect.width,
      height: clip?.height ?? 0,
      min: vr.min,
      delta: vr.delta ?? vr.max - vr.min,
    };
  }

  /** The in-flight drag as a plot-height rect. Once the gesture spans
   *  ≥2px the edges live-snap to the resolved {start,end} — the rect
   *  previews exactly what mouseup emits, at the same slot-center
   *  geometry the applied band uses. Sub-2px gestures track raw px.
   *  Disarming mid-drag drops the gesture so a re-arm always starts
   *  fresh (single active gesture). */
  readonly dragRect = computed(() => {
    if (!this.brushArmed()) return null;
    const d = this.brushDrag();
    const space = this.axisSpace();
    if (!d || !space) return null;
    const clamp = (px: number) => Math.min(space.x + space.width, Math.max(space.x, px));
    let left = clamp(Math.min(d.startPx, d.currentPx));
    let right = clamp(Math.max(d.startPx, d.currentPx));
    // Live snap — resolve() + nearestIndexByDate mirror brushUpAt's emit
    // and brushBand's positioning, so the band lands where the rect is.
    if (right - left >= 2) {
      const labels = this.axisLabels();
      const range = resolveBrushRange(d.startPx, d.currentPx, space, labels, this.brushCorpus());
      if (range) {
        const s = nearestIndexByDate(range.start, labels);
        const e = nearestIndexByDate(range.end, labels);
        if (s >= 0 && e >= 0) {
          left = clamp(categoryIndexToPx(Math.min(s, e), space));
          right = clamp(categoryIndexToPx(Math.max(s, e), space));
        }
      }
    }
    return { left, width: Math.max(0, right - left), top: space.y, height: space.height };
  });

  /** The active refine bound as a faint band, positioned at the bound
   *  dates' nearest axis categories; recomputes on zoom/pan via
   *  visibleRange. */
  readonly brushBand = computed(() => {
    this.visibleRange();
    const range = this.activeStudyRange();
    const space = this.axisSpace();
    if (!range || !space) return null;
    const labels = this.axisLabels();
    // A bound fully outside the rendered domain would clamp onto an edge
    // category and paint a band where it isn't — suppress instead.
    if (!labels.length || range.end < labels[0] || range.start > labels[labels.length - 1]) return null;
    const s = nearestIndexByDate(range.start, labels);
    const e = nearestIndexByDate(range.end, labels);
    if (s < 0 || e < 0) return null;
    // Fully off-screen (both edges past one end of the plot) → nothing
    // visible; partially off-screen → paint only the visible portion.
    const x0 = space.x, x1 = space.x + space.width;
    const lo = categoryIndexToPx(Math.min(s, e), space);
    const hi = categoryIndexToPx(Math.max(s, e), space);
    if (hi < x0 || lo > x1) return null;
    const left = Math.min(x1, Math.max(x0, lo));
    const right = Math.min(x1, Math.max(x0, hi));
    // Min 1px so a same-day bound stays visible as a sliver.
    return { left, width: Math.max(1, right - left), top: space.y, height: space.height };
  });

  /** px within the chart for a capture-layer mouse event. */
  pxFromEvent(event: MouseEvent): number {
    const host = event.currentTarget as HTMLElement;
    return event.clientX - host.getBoundingClientRect().left;
  }

  /** Gesture start — ignored unless the left button is down and the
   *  chart has reported its axis geometry. */
  brushDownAt(px: number, button = 0): void {
    // Left button only — a right-click while armed must not commit a
    // gesture (its mouseup would emit a same-day bound).
    if (button !== 0 || !this.axisSpace()) return;
    this.brushDrag.set({ startPx: px, currentPx: px });
  }

  /** Track the drag edge — no-op outside a gesture. */
  brushMoveTo(px: number): void {
    const d = this.brushDrag();
    if (d) this.brushDrag.set({ ...d, currentPx: px });
  }

  /** Gesture end — snap both edges and emit; clicks (<2px) emit nothing.
   *  Non-left-button releases are ignored so a right-mouseup can't end a
   *  left-drag early and emit a partial span. */
  brushUpAt(px: number, button = 0): void {
    if (button !== 0) return;
    const d = this.brushDrag();
    const space = this.axisSpace();
    this.brushDrag.set(null);
    // Sub-2px gestures are clicks, not selections — don't silently apply
    // an accidental same-day bound.
    if (!d || !space || Math.abs(px - d.startPx) < 2) return;
    const range = resolveBrushRange(d.startPx, px, space, this.axisLabels(), this.brushCorpus());
    if (range) this.studyRange.emit(range);
  }

  /** Disarm mid-drag drops the gesture so a re-arm starts fresh —
   *  prevents a stray mouseup emitting from a stale start px. Arming
   *  also clears any frozen hover highlight (mouse = drag, not hover). */
  readonly clearDragOnDisarm = effect(() => {
    if (this.brushArmed()) this.emitHover(null);
    else this.brushDrag.set(null);
  });

  /** Pointer left the chart mid-drag — drop the gesture, keep armed. */
  brushCancel(): void {
    this.brushDrag.set(null);
  }

  /** Esc cancels an in-flight drag and disarms. */
  @HostListener('document:keydown.escape')
  onEscapeKey(): void {
    this.brushDrag.set(null);
    if (this.brushArmed()) this.brushArmed.set(false);
  }

  constructor() {
    // Syncfusion measures the container once at render — layout shifts
    // (sidenav toggle, chips/metadata rows appearing) leave the SVG at a
    // stale width that overflows the container's right edge. Re-measure on
    // host resize. Dedupe on measured size + rAF-throttle so consecutive
    // resize events don't trigger repeated refreshes (same pattern as
    // flex-chart's container watcher).
    this.zone.runOutsideAngular(() => {
      this.resizeObserver = new ResizeObserver(() => {
        const { clientWidth, clientHeight } = this.el.nativeElement;
        if (clientWidth === this.lastObservedWidth && clientHeight === this.lastObservedHeight) return;
        this.lastObservedWidth = clientWidth;
        this.lastObservedHeight = clientHeight;
        if (this.pendingResizeRaf) cancelAnimationFrame(this.pendingResizeRaf);
        this.pendingResizeRaf = requestAnimationFrame(() => {
          this.pendingResizeRaf = null;
          this.chart()?.refresh();
          // The axis rect lands with the refreshed paint — bump next
          // frame so brush computeds re-read the new geometry.
          requestAnimationFrame(() => this.axisTick.update((t) => t + 1));
        });
      });
      this.resizeObserver.observe(this.el.nativeElement);
    });
  }

  ngOnDestroy(): void {
    if (this.pendingResizeRaf) cancelAnimationFrame(this.pendingResizeRaf);
    this.resizeObserver?.disconnect();
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

  /** Span-marker rows relabel to "{label} strike" — the series keys carry
   *  the contract label, but marker series names are internal
   *  (`__span__{contractId}`) and would leak as tooltip keys. */
  onSharedTooltipRender(args: ISharedTooltipRenderEventArgs): void {
    const labels = new Map(this.plottedSeries().map((c) => [c.contractId, c.label]));
    args.series?.forEach((s, i) => {
      const name = (s as { name?: string }).name ?? '';
      if (!name.startsWith(MARKER_NAME_PREFIX)) return;
      const label = labels.get(name.slice(MARKER_NAME_PREFIX.length));
      if (label && args.text?.[i] != null) {
        args.text[i] = args.text[i].replace(name, `${label} strike`);
      }
    });
  }

  onZoomComplete(event: IZoomCompleteEventArgs): void {
    const range = event.currentVisibleRange;
    if (range?.min != null && range?.max != null) {
      this.visibleRange.set({ min: range.min, max: range.max });
      this.axisTick.update((t) => t + 1);
    }
  }

  onScrollEnd(): void {
    const visibleRange = this.chart()?.axisCollections?.[0]?.visibleRange;
    if (visibleRange?.min != null && visibleRange?.max != null) {
      this.visibleRange.set({ min: visibleRange.min, max: visibleRange.max });
      this.axisTick.update((t) => t + 1);
    }
  }

}

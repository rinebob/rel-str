/**
 * Chart render model — the seam between the data assembler (#767) and the
 * SVG renderer (#766).
 *
 * The assembler translates bars + indicator-series output into this fully
 * normalized shape: every series carries bar-index x positions (no date
 * lookups), resolved pane assignment, and final resolved colors — the
 * assembler applies the palette remap (the `ChartDataAdapter.themeColor`
 * equivalent) so the renderer paints colors verbatim. Note the FE's split
 * behavior: indicator colors are light-vocabulary and get remapped, while
 * palette-owned colors (price candles, scatter connectors) are bound
 * directly — only the assembler knows which is which. The renderer is a
 * dumb painter — series order inside each pane IS the paint order, so the
 * assembler encodes the flex-chart z-order rules (e.g. trend-band candles
 * before price candles, HTF column behind its primary, connector line
 * behind scatter dots).
 * Pane background windows (HTF zone shading) are not series — they're a
 * pane-level field so paint order stays purely data-driven.
 *
 * Parity reference: `src/app/features/shared/components/flex-chart/`
 * (template series branches + chart-data-adapter.service.ts).
 *
 * Every series positions points by bar index — x is an integer offset into
 * `ChartRenderModel.bars`. Sparse series simply omit uncovered indices.
 * Non-finite values are skipped by the renderer (line gaps split the
 * polyline, matching FE emptyPointSettings 'Gap').
 */

import type { CaptureEvent, CaptureInterval, PositionType } from '@screenshot-capture/contracts';

/** OHLC bar. `date` feeds the x-tick labels ('yyyy-MM-dd'). */
export interface RenderBar {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
}

/** Main price pane plus the four lower-pane slots flex-chart supports. */
export type RenderPaneId = 'main' | 'lower-1' | 'lower-2' | 'lower-3' | 'lower-4';

export interface CandlePoint {
  x: number;
  open: number;
  high: number;
  low: number;
  close: number;
}

/** Price candles and trend-band candles share the shape. Trend bands emit one
 *  CandleSeriesSpec per band (up/down colors per band, per FE BandSeriesData). */
export interface CandleSeriesSpec {
  kind: 'candle';
  data: CandlePoint[];
  /** Fill for close >= open (price: palette candleUp; bands: BandSeriesData.bullColor). */
  upColor: string;
  /** Fill for close < open (price: palette candleDown; bands: bearColor). */
  downColor: string;
  opacity?: number;
  /** Body width as a fraction of the bar slot. Default 1.0 (FE columnWidth). */
  widthFactor?: number;
}

export interface ScalarPoint {
  x: number;
  y: number;
}

/** Plain polyline. The assembler emits companion pieces as separate series —
 *  a signal line is another `line`, a MACD-style histogram another `column`,
 *  a scatter connector another thin `line` — ordered for correct stacking. */
export interface LineSeriesSpec {
  kind: 'line';
  data: ScalarPoint[];
  color: string;
  width?: number;
  dashArray?: string;
  opacity?: number;
}

export interface ScatterPoint {
  x: number;
  y: number;
  /** Per-point color override (FE pointColorMapping). */
  color?: string;
}

export interface ScatterSeriesSpec {
  kind: 'scatter';
  data: ScatterPoint[];
  /** Fallback fill when a point carries no color. */
  color: string;
  /** Dot radius in px (FE marker diameter / 2 — e.g. 5 for the 10px uptick
   *  overlay dots, 2 for the 4px lower-pane dots). */
  radius: number;
}

export interface ColumnPoint {
  x: number;
  y: number;
  color?: string;
}

/** Histogram bars from the pane baseline (default y=0) to y. Negative values
 *  extend below the baseline. */
export interface ColumnSeriesSpec {
  kind: 'column';
  data: ColumnPoint[];
  color: string;
  /** Column width as a fraction of the bar slot (FE columnWidth — 1.0
   *  primary, 0.75 HTF companion, 0.6 line-histogram). */
  widthFactor?: number;
  opacity?: number;
  /** Baseline value in pane units; default 0. */
  baseline?: number;
}

export interface RangePoint {
  x: number;
  high: number;
  low: number;
}

/** Filled band between an upper and lower line (FE RangeArea — std-dev fill
 *  zones). */
export interface RangeSeriesSpec {
  kind: 'range';
  data: RangePoint[];
  color: string;
  opacity: number;
}

/** One shaded window: covers bar slots x0 through x1 inclusive. */
export interface WindowRange {
  x0: number;
  x1: number;
}

export type RenderSeries =
  | CandleSeriesSpec
  | LineSeriesSpec
  | ScatterSeriesSpec
  | ColumnSeriesSpec
  | RangeSeriesSpec;

/** Horizontal reference line within a pane (FE `options.referenceLines`). */
export interface RenderReferenceLine {
  value: number;
  color: string;
  dashArray?: string;
}

/** Pane background shading layer — vertical windows over bar ranges (HTF
 *  zone windows — the shaded-rect representation from the IMPL doc).
 *  Painted behind every series in the pane, full inner height. A pane can
 *  carry several layers (e.g. long-window green + short-window red + a
 *  neutral-window layer from the same HTF window set). */
export interface RenderPaneWindowLayer {
  data: WindowRange[];
  color: string;
  opacity: number;
}

export interface RenderPane {
  id: RenderPaneId;
  /** Series in paint order (first emitted sits furthest back). */
  series: RenderSeries[];
  /** Background shading layers, painted behind all series in layer order. */
  windows?: RenderPaneWindowLayer[];
  /** Fixed axis bounds (FE axisScale 'fixed' / 'fixed-0-100'). When either is
   *  absent the pane auto-ranges over its series values. Ignored for `main` —
   *  the price axis derives from the visible bars, matching computeViewport. */
  axisMin?: number;
  axisMax?: number;
  referenceLines?: RenderReferenceLine[];
}

export interface ChartRenderModel {
  symbol: string;
  interval: CaptureInterval;
  event: CaptureEvent;
  positionType: PositionType;
  refId?: string;
  /** Capture timestamp shown in the header (ISO — rendered verbatim). */
  timestampIso: string;
  width: number;
  height: number;
  /** Log10-transform the main-pane price axis (quick-charts default true). */
  logScale?: boolean;
  /** Oldest → newest. The assembler slices to visibleBars before building. */
  bars: RenderBar[];
  /** Visual top → bottom order (main first). Inactive panes are omitted by
   *  the assembler rather than rendered at zero height.
   *
   *  Assembler contract — FE pane numbering is bottom-up: Syncfusion stacks
   *  chartRows from the bottom, so the flex-chart visual order is main,
   *  lower-4, lower-3, lower-2, lower-1. Emit panes in that order. */
  panes: RenderPane[];
  /** Bar index carrying the lifecycle-event marker. Default: last bar. */
  eventBarIndex?: number;
}

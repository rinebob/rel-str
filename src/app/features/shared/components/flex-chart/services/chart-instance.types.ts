/**
 * Typed wrapper for the Syncfusion EJ2 Angular Chart instance.
 *
 * Syncfusion's public typings do not expose the runtime properties we need
 * (axisCollections, visibleRange, rect, zoomFactor, etc.). This file declares a
 * narrow facade around those properties so that the rest of the codebase can
 * avoid `any` casts. The single boundary assertion lives in the component's
 * `typedChart` accessor; everything downstream uses these types.
 */

export interface SfChartAxisRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface SfChartVisibleRange {
  min: number;
  max: number;
  delta: number;
}

/** Minimal stripLine model — the fields this component writes. A stripLine
 *  with `sizeType: 'Pixel'` and `size: 1` renders as a horizontal line at the
 *  `start` axis value; `text` renders on the line. */
export interface SfChartStripLine {
  start: number;
  size: number;
  sizeType: 'Pixel';
  color: string;
  visible: boolean;
  opacity: number;
  zIndex: 'Over' | 'Behind';
  text?: string;
  textStyle?: { color: string; size: string };
  horizontalAlignment: 'Start' | 'Middle' | 'End';
  verticalAlignment: 'Start' | 'Middle' | 'End';
}

export interface SfChartAxisLike {
  visibleRange?: SfChartVisibleRange;
  rect?: SfChartAxisRect;
  valueType?: 'Logarithmic' | 'Double';
  zoomFactor?: number;
  zoomPosition?: number;
  minimum?: number;
  maximum?: number;
  stripLines?: SfChartStripLine[];
}

export interface SfChartSeriesLike {
  dataSource?: Array<{ date?: Date | string; x?: Date | string }>;
}

export interface SfChartInstance {
  primaryXAxis?: SfChartAxisLike;
  primaryYAxis?: SfChartAxisLike;
  axisCollections?: SfChartAxisLike[];
  series?: SfChartSeriesLike[];
  rows?: { height: string }[];
  animateSeries?: boolean;
  setProperties(props: Record<string, unknown>, muteOnChange?: boolean): void;
  dataBind(): void;
  refresh(): void;
}

/** Snapshot of the X and Y axis state used by crosshair and overlay logic */
export interface ChartAxisState {
  xAxis: Required<Pick<SfChartAxisLike, 'visibleRange' | 'rect'>>;
  yAxis: Required<Pick<SfChartAxisLike, 'visibleRange' | 'rect' | 'valueType'>>;
}

/** Syncfusion axis label render event payload */
export interface SfAxisLabelRenderArgs {
  axis: { name: string; valueType?: 'Logarithmic' | 'Double' };
  value: unknown;
  text: string;
}

/** Debug snapshot emitted by FlexChartComponent whenever the computed Y-axis
 *  viewport or the captured axis state changes. Used by dev tooling (e.g. the
 *  flex-chart sandbox page) to inspect axis extents without reaching into
 *  component-scoped providers. `viewport` units are whatever the active scale
 *  strategy produces — log units in log mode. */
export interface ChartDebugSnapshot {
  viewport: import('../store/chart-viewport.store').ChartYAxisViewport | null;
  axis: ChartAxisState | null;
  /** Round-price ticks the log axis draws (empty in linear mode). */
  logTicks: number[];
}


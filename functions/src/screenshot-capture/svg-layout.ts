/**
 * Screenshot SVG layout — pane stack geometry, axis scales, tick selection,
 * and the bar-grid metadata the client uses for viewBox cropping.
 *
 * Mirrors flex-chart semantics over the shared scale math
 * (`@flex-chart/scale-math` — the canonical module both sides import):
 *  - Pane heights: main pane takes MAIN_PANE_PERCENT of the stack; active
 *    lower panes split the remainder evenly with the floor residue back on
 *    main — same math as `ChartDataAdapter.chartRows`.
 *  - Main-pane y range: bars' high/low + 3% pad (linear) or log-space pad —
 *    `ChartYAxisViewportController.computeViewport`. Overlays may exceed it
 *    and are clipped.
 *  - Log scale: manual log10 transform over a linear axis +
 *    `nicePriceTicks` gridlines — `LogarithmicScaleStrategy` over
 *    `@flex-chart/scale-math`.
 *  - Lower panes: fixed axisMin/axisMax or auto-range over series values with
 *    no padding; 8px plot offsets keep series off the pane borders —
 *    `ChartDataAdapter.chartAxes`. The primary axis has no plot offset, so
 *    the main pane gets no inset.
 */

import {
  fromLogAxis,
  nicePriceTicks,
  formatPrice,
  toLogAxis,
} from '@flex-chart/scale-math';
import type { ChartRenderModel, RenderPane } from './render-model';

// ── Geometry constants ──────────────────────────────────────────────────────

export const HEADER_HEIGHT = 26;
export const X_AXIS_HEIGHT = 18;
export const AXIS_GUTTER_WIDTH = 60;
export const PLOT_LEFT = 4;
/** quick-charts default: `FlexChartConfig.mainPanePercent` = 60. */
export const MAIN_PANE_PERCENT = 60;
/** Vertical insets inside lower panes (FE plotOffsetTop/Bottom). The primary
 *  axis sets no plotOffset, so the main pane gets no inset. */
export const LOWER_PANE_INSET = 8;
/** Max date labels under the bottom pane. */
export const MAX_X_TICKS = 6;
/** Tick count on lower-pane axes. */
const LOWER_TICK_COUNT = 3;
const MONTH_ABBR = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// ── Layout types ────────────────────────────────────────────────────────────

export interface RectPx {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface AxisTick {
  /** Pixel y inside the pane rect. */
  py: number;
  /** Display label. */
  label: string;
}

export interface PaneLayout {
  pane: RenderPane;
  /** Plot rect (border included). */
  rect: RectPx;
  /** Inner drawing area after plot insets. */
  inner: RectPx;
  clipId: string;
  /** Data value → inner-area pixel y (main pane transforms through the
   *  active scale; lower panes are linear). */
  toY: (value: number) => number;
  ticks: AxisTick[];
}

export interface XTick {
  index: number;
  px: number;
  label: string;
}

export interface ChartLayout {
  height: number;
  headerHeight: number;
  /** Left edge of the bar grid. */
  plotX: number;
  /** Right edge of the bar grid (axis gutter starts here). */
  plotRight: number;
  slotWidth: number;
  barCount: number;
  /** Whether the main pane renders through the log10 transform — also
   *  selects the log gridline color (FE parity: log mode uses the brighter
   *  stripLine tone, linear + lower panes use gridLine). */
  logScale: boolean;
  /** Top→bottom visual order — main pane first. */
  panes: PaneLayout[];
  xTicks: XTick[];
  /** Bar index → slot-center pixel x. */
  xCenter: (index: number) => number;
}

// ── Layout computation ──────────────────────────────────────────────────────

/** 'yyyy-MM-dd' → 'Mar 5, 2026'. Deliberately carries the year — the FE's
 *  live axis drops it ('Mar 5'), but a static capture artifact is clearer
 *  with it. Falls back to the raw string on unexpected input. */
function shortDate(date: string): string {
  const parts = date.split('-');
  if (parts.length !== 3) return date;
  const m = MONTH_ABBR[Number(parts[1]) - 1];
  return m ? `${m} ${Number(parts[2])}, ${parts[0]}` : date;
}

/** Collect every finite numeric value a series contributes to pane
 *  auto-ranging. Non-finite points are skipped — a single NaN would poison
 *  Math.min/max and collapse the pane range. */
function seriesValues(pane: RenderPane): number[] {
  const out: number[] = [];
  const push = (v: number): void => { if (Number.isFinite(v)) out.push(v); };
  for (const s of pane.series) {
    switch (s.kind) {
      case 'candle':
      case 'range':
        for (const p of s.data) { push(p.high); push(p.low); }
        break;
      case 'line':
      case 'scatter':
      case 'column':
        for (const p of s.data) push(p.y);
        break;
      default: {
        const exhaustive: never = s;
        throw new Error(`Unhandled series kind: ${JSON.stringify(exhaustive)}`);
      }
    }
  }
  return out;
}

/** Lower-pane Y range: explicit axisMin/axisMax win; otherwise auto-range
 *  over the pane's series values (rangePadding 'None' parity). */
function lowerPaneRange(pane: RenderPane): { min: number; max: number } {
  const vals = seriesValues(pane);
  let min = pane.axisMin ?? Math.min(...vals);
  let max = pane.axisMax ?? Math.max(...vals);
  if (!Number.isFinite(min) || !Number.isFinite(max)) {
    min = 0;
    max = 1;
  }
  if (min === max) {
    min -= 1;
    max += 1;
  }
  return { min, max };
}

/** Main-pane Y range over the visible bars — `computeViewport` parity:
 *  linear = high/low ±3% clamped ≥0; log = log-space ±3% (flat → ±0.01).
 *  Flat/non-finite inputs fall back rather than collapsing: the FE can hand
 *  a degenerate range to Syncfusion, which expands it internally — the SVG
 *  has no such engine, so the guard lives here (deliberate divergence, not
 *  a port drift). */
function mainPaneRange(bars: { high: number; low: number }[], logScale: boolean): { min: number; max: number } {
  const finite = bars.filter((b) => Number.isFinite(b.low) && Number.isFinite(b.high));
  if (finite.length === 0) return { min: 0, max: 1 };
  const rawMin = Math.min(...finite.map((b) => b.low));
  const rawMax = Math.max(...finite.map((b) => b.high));
  if (logScale) {
    const lo = toLogAxis(rawMin);
    const hi = toLogAxis(rawMax);
    const pad = hi - lo > 0 ? (hi - lo) * 0.03 : 0.01;
    return { min: lo - pad, max: hi + pad };
  }
  const spread = rawMax - rawMin;
  const pad = spread > 0 ? spread * 0.03 : Math.max(rawMax * 0.01, 0.01);
  return { min: Math.max(0, rawMin - pad), max: rawMax + pad };
}

function lowerPaneTicks(min: number, max: number, toY: (v: number) => number): AxisTick[] {
  const ticks: AxisTick[] = [];
  for (let i = 0; i < LOWER_TICK_COUNT; i++) {
    const v = min + ((max - min) * i) / (LOWER_TICK_COUNT - 1);
    const label = Number.isInteger(v) ? v.toString() : v.toFixed(2);
    ticks.push({ py: toY(v), label });
  }
  return ticks;
}

function mainPaneTicks(range: { min: number; max: number }, logScale: boolean, toY: (v: number) => number): AxisTick[] {
  const priceLo = logScale ? fromLogAxis(range.min) : range.min;
  const priceHi = logScale ? fromLogAxis(range.max) : range.max;
  return nicePriceTicks(priceLo, priceHi).map((price) => ({
    py: toY(price),
    label: formatPrice(price),
  }));
}

/** Compute the full chart geometry for a render model. */
export function computeLayout(model: ChartRenderModel): ChartLayout {
  const barCount = model.bars.length;
  const plotX = PLOT_LEFT;
  const plotRight = model.width - AXIS_GUTTER_WIDTH;
  const plotWidth = Math.max(1, plotRight - plotX);
  const slotWidth = plotWidth / Math.max(1, barCount);
  const xCenter = (index: number): number => plotX + (index + 0.5) * slotWidth;

  // Pane stack — top→bottom per the model's pane order (main first).
  // Heights mirror chartRows: lower panes split (100 - mainPct) evenly via
  // Math.floor; the residue lands on main.
  const stackTop = HEADER_HEIGHT;
  const stackHeight = Math.max(0, model.height - HEADER_HEIGHT - X_AXIS_HEIGHT);
  const lowerPanes = model.panes.filter((p) => p.id !== 'main');
  const lowerShare = lowerPanes.length > 0
    ? Math.floor((100 - MAIN_PANE_PERCENT) / lowerPanes.length) / 100
    : 0;
  const mainShare = lowerPanes.length > 0 ? 1 - lowerShare * lowerPanes.length : 1;
  const shareOf = (id: RenderPane['id']): number => (id === 'main' ? mainShare : lowerShare);

  const logScale = model.logScale ?? true;
  const mainRange = mainPaneRange(model.bars, logScale);

  const panes: PaneLayout[] = [];
  let cursorY = stackTop;
  model.panes.forEach((pane, i) => {
    const height = i === model.panes.length - 1
      ? stackTop + stackHeight - cursorY // last pane absorbs rounding residue
      : stackHeight * shareOf(pane.id);
    const isMain = pane.id === 'main';
    const inner: RectPx = {
      x: plotX,
      y: cursorY + (isMain ? 0 : LOWER_PANE_INSET),
      width: plotWidth,
      height: Math.max(1, height - (isMain ? 0 : 2 * LOWER_PANE_INSET)),
    };
    const range = isMain ? mainRange : lowerPaneRange(pane);
    const transform = isMain && logScale ? toLogAxis : (v: number): number => v;
    const toY = (v: number): number =>
      inner.y + ((range.max - transform(v)) / (range.max - range.min)) * inner.height;
    const ticks = isMain
      ? mainPaneTicks(range, logScale, toY)
      : lowerPaneTicks(range.min, range.max, toY);
    panes.push({
      pane,
      rect: { x: plotX, y: cursorY, width: plotWidth, height },
      inner,
      clipId: `clip-${pane.id}`,
      toY,
      ticks,
    });
    cursorY += height;
  });

  // X ticks — ≤6 evenly spaced date labels under the bottom pane.
  const xTicks: XTick[] = [];
  if (barCount > 0) {
    const step = Math.max(1, Math.ceil(barCount / MAX_X_TICKS));
    for (let i = 0; i < barCount; i += step) {
      const bar = model.bars[i];
      xTicks.push({ index: i, px: xCenter(i), label: shortDate(bar.date) });
    }
  }

  return {
    height: model.height,
    headerHeight: HEADER_HEIGHT,
    plotX,
    plotRight,
    slotWidth,
    barCount,
    logScale,
    panes,
    xTicks,
    xCenter,
  };
}

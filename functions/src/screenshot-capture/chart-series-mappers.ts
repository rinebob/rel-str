/**
 * Chart series mappers — per-family translations from the indicator-series
 * response into render-model series (task #767).
 *
 * One function per FE series family, mirroring the flex-chart conversion
 * path (`indicator-converters`, `signal-marker-converters`, the per-indicator
 * calculators, and `computeStdDevLinesSeries`). All mappers are pure: they
 * consume full-history series plus the slice window (`offset`/`len`) and
 * emit bar-index positions inside `[0, len)` — inputs longer than the bar
 * array are clamped so the model's bounds invariant holds by construction.
 * Colors are remapped to the dark palette here; the model carries final
 * colors and the renderer paints verbatim (see render-model.ts).
 */

import { computeStdDevLines } from '../indicators/std-dev-lines';
import { barsToOhlcv } from '../st-cloud-function/indicator-computation';
import type {
  DotMarker,
  HtfWindowPoint,
  TrendBandsPoint,
  TrendStrengthPoint,
  ZoneV1Point,
  ZoneV2Point,
} from '../st-cloud-function/indicator-computation';
import type { OhlcBar } from '../common/market-data-types';
import {
  ST_ZONE_COLORS,
  ST_ZONE_FALLBACK_COLOR,
  ST_TREND_STRENGTH_COLORS,
  ST_STD_DEV_PERIOD,
  ST_STD_DEV_CENTER_COLOR,
  ST_STD_DEV_REGULAR_COLORS,
  ST_STD_DEV_FIB_COLORS,
  ST_STD_DEV_FILL_OPACITY,
  ST_STD_DEV_REGULAR_DASH,
  ST_STD_DEV_FIB_DASH,
  ST_HTF_WINDOW,
} from '@flex-chart/indicator-visuals';
import { SCREENSHOT_DARK_PALETTE, remapSeriesColor } from './chart-theme';
import type {
  CandleSeriesSpec,
  ColumnSeriesSpec,
  LineSeriesSpec,
  RangeSeriesSpec,
  RenderPaneWindowLayer,
  ScatterSeriesSpec,
  WindowRange,
} from './render-model';

// ── Mapper-local constants (capture-only, not FE vocabulary) ────────────────

/** Marker radii — FE marker width/2 (10px overlay dots, 4px lower-pane). */
export const OVERLAY_DOT_RADIUS = 5;
export const LOWER_DOT_RADIUS = 2;

/** Main-pane HTF window shading alpha — capture-only representation
 *  (FE renders these as lower-3 dots, which are also emitted). */
const WINDOW_OPACITY = 0.1;

/** Connector line style behind zone scatter (FE `scatterConnector`). */
const CONNECTOR_WIDTH = 1;
const CONNECTOR_OPACITY = 0.5;

// ── Helpers ─────────────────────────────────────────────────────────────────

/** Rebase a full-series bar index into the sliced window; null = outside. */
function rebaseIndex(index: number, offset: number, len: number): number | null {
  const x = index - offset;
  return x >= 0 && x < len ? x : null;
}

/** End bound for full-history series — clamps inputs longer than the bar
 *  array so no point can escape the [0, len) window. */
function windowEnd(seriesLength: number, offset: number, len: number): number {
  return Math.min(seriesLength, offset + len);
}

// ── Per-family mappers ──────────────────────────────────────────────────────

/** Trend bands → one candle series per bandIndex (ascending), painted behind
 *  price. Mirrors `trendBandsToChartData`: null-OHLC points are skipped and
 *  each band's bull/bear colors come from the response. */
export function bandCandleSeries(
  trendBands: TrendBandsPoint[] | undefined,
  offset: number,
  len: number,
): CandleSeriesSpec[] {
  if (!trendBands?.length) return [];
  const byBand = new Map<number, CandleSeriesSpec>();
  const end = windowEnd(trendBands.length, offset, len);
  for (let i = offset; i < end; i++) {
    const x = i - offset;
    for (const b of trendBands[i].bands) {
      if (b.open === null || b.high === null || b.low === null || b.close === null) continue;
      let s = byBand.get(b.bandIndex);
      if (!s) {
        s = {
          kind: 'candle',
          data: [],
          upColor: remapSeriesColor(b.bullColor),
          downColor: remapSeriesColor(b.bearColor),
          opacity: SCREENSHOT_DARK_PALETTE.bandOpacity,
        };
        byBand.set(b.bandIndex, s);
      }
      s.data.push({ x, open: b.open, high: b.high, low: b.low, close: b.close });
    }
  }
  return [...byBand.entries()]
    .sort(([a], [b]) => a - b)
    .map(([, s]) => s);
}

/** std-dev lines + fills on the FULL history, then sliced — mirrors
 *  `computeStdDevLinesSeries` (combined mode: center + 5 regular pairs +
 *  3 fib pairs + a fill between each regular line and its nearest fib). */
export function stdDevSeries(
  bars: OhlcBar[],
  offset: number,
  len: number,
): { lines: LineSeriesSpec[]; fills: RangeSeriesSpec[] } {
  const { regularBands, fibBands, centerLine } = computeStdDevLines(barsToOhlcv(bars), {
    centerLineType: 'sma',
    period: ST_STD_DEV_PERIOD,
  });

  const linePoints = (values: number[]): { x: number; y: number }[] => {
    const data: { x: number; y: number }[] = [];
    const end = windowEnd(values.length, offset, len);
    for (let i = offset; i < end; i++) {
      if (Number.isFinite(values[i])) data.push({ x: i - offset, y: values[i] });
    }
    return data;
  };

  const lines: LineSeriesSpec[] = [];
  lines.push({ kind: 'line', data: linePoints(centerLine), color: remapSeriesColor(ST_STD_DEV_CENTER_COLOR), width: 2 });

  regularBands.forEach((band, idx) => {
    const color = remapSeriesColor(ST_STD_DEV_REGULAR_COLORS[idx % ST_STD_DEV_REGULAR_COLORS.length]);
    lines.push({ kind: 'line', data: linePoints(band.upper), color, width: 1, dashArray: ST_STD_DEV_REGULAR_DASH });
    lines.push({ kind: 'line', data: linePoints(band.lower), color, width: 1, dashArray: ST_STD_DEV_REGULAR_DASH });
  });
  fibBands.forEach((band, idx) => {
    const color = remapSeriesColor(ST_STD_DEV_FIB_COLORS[idx % ST_STD_DEV_FIB_COLORS.length]);
    lines.push({ kind: 'line', data: linePoints(band.upper), color, width: 1, dashArray: ST_STD_DEV_FIB_DASH });
    lines.push({ kind: 'line', data: linePoints(band.lower), color, width: 1, dashArray: ST_STD_DEV_FIB_DASH });
  });

  // Fills: each regular band fills to its nearest fib level (FE combined).
  const fills: RangeSeriesSpec[] = [];
  regularBands.forEach((regBand, regIdx) => {
    let nearest = 0;
    let dist = Infinity;
    fibBands.forEach((fibBand, fibIdx) => {
      const d = Math.abs(regBand.level - fibBand.level);
      if (d < dist) { dist = d; nearest = fibIdx; }
    });
    const fibBand = fibBands[nearest];
    const color = remapSeriesColor(ST_STD_DEV_REGULAR_COLORS[regIdx % ST_STD_DEV_REGULAR_COLORS.length]);
    const fill = (a: number[], bArr: number[]): RangeSeriesSpec => ({
      kind: 'range',
      color,
      opacity: ST_STD_DEV_FILL_OPACITY,
      data: a
        .map((v, i) => ({ v, w: bArr[i], i }))
        .filter((p) => p.i >= offset && p.i < offset + len && Number.isFinite(p.v) && Number.isFinite(p.w))
        .map((p) => ({ x: p.i - offset, high: Math.max(p.v, p.w), low: Math.min(p.v, p.w) })),
    });
    fills.push(fill(regBand.upper, fibBand.upper));
    fills.push(fill(regBand.lower, fibBand.lower));
  });

  return { lines, fills };
}

/** Zone V1/V2 → connector line + colored scatter (FE lower-pane scatter gets
 *  a thin connector unless it's a window/signal-dots series). Returns null
 *  when the family is absent; empty-data output is still possible for
 *  all-null inputs — the assembler drops contentless panes. */
export function zoneSeries(
  points: (ZoneV1Point | ZoneV2Point)[] | undefined,
  offset: number,
  len: number,
): { connector: LineSeriesSpec; dots: ScatterSeriesSpec } | null {
  if (!points?.length) return null;
  const data = points
    .map((p, i) => ({ p, x: rebaseIndex(i, offset, len) }))
    .filter((e): e is { p: ZoneV1Point | ZoneV2Point; x: number } => e.x !== null)
    .filter((e) => e.p.zone !== null && Number.isFinite(e.p.zone))
    .map((e) => ({
      x: e.x,
      y: e.p.zone as number,
      color: remapSeriesColor(ST_ZONE_COLORS[e.p.zone as number] ?? ST_ZONE_FALLBACK_COLOR),
    }));
  return {
    connector: {
      kind: 'line',
      data: data.map((p) => ({ x: p.x, y: p.y })),
      color: SCREENSHOT_DARK_PALETTE.scatterConnector,
      width: CONNECTOR_WIDTH,
      opacity: CONNECTOR_OPACITY,
    },
    dots: {
      kind: 'scatter',
      data,
      color: remapSeriesColor(ST_ZONE_FALLBACK_COLOR),
      radius: LOWER_DOT_RADIUS,
    },
  };
}

/** Trend strength → HTF column behind the primary column, per-point colors. */
export function trendStrengthSeries(
  points: TrendStrengthPoint[] | undefined,
  offset: number,
  len: number,
): ColumnSeriesSpec[] {
  if (!points) return [];
  const primary: ColumnSeriesSpec = {
    kind: 'column',
    data: [],
    color: remapSeriesColor(ST_TREND_STRENGTH_COLORS.primaryUp),
    widthFactor: 1.0,
  };
  const htf: ColumnSeriesSpec = {
    kind: 'column',
    data: [],
    color: remapSeriesColor(ST_TREND_STRENGTH_COLORS.htfUp),
    widthFactor: 0.75,
  };
  const end = windowEnd(points.length, offset, len);
  for (let i = offset; i < end; i++) {
    const p = points[i];
    const x = i - offset;
    if (p.diHist !== null && Number.isFinite(p.diHist)) {
      primary.data.push({ x, y: p.diHist, color: remapSeriesColor(p.diHist > 0 ? ST_TREND_STRENGTH_COLORS.primaryUp : ST_TREND_STRENGTH_COLORS.primaryDown) });
    }
    if (p.htfDiHist !== null && Number.isFinite(p.htfDiHist)) {
      htf.data.push({ x, y: p.htfDiHist, color: remapSeriesColor(p.htfDiHist > 0 ? ST_TREND_STRENGTH_COLORS.htfUp : ST_TREND_STRENGTH_COLORS.htfDown) });
    }
  }
  return [htf, primary];
}

/** Signal/uptick dot markers → scatter. `index` rebases into the window. */
export function dotMarkerSeries(
  markers: DotMarker[] | undefined,
  offset: number,
  len: number,
  colors: { long: string; short: string },
  radius: number,
): ScatterSeriesSpec | null {
  const data = (markers ?? [])
    .map((m) => ({ m, x: rebaseIndex(m.index, offset, len) }))
    .filter((e): e is { m: DotMarker; x: number } => e.x !== null)
    .map((e) => ({
      x: e.x,
      y: e.m.y,
      color: remapSeriesColor(e.m.direction === 'long' ? colors.long : colors.short),
    }));
  if (data.length === 0) return null;
  return {
    kind: 'scatter',
    data,
    color: remapSeriesColor(ST_ZONE_FALLBACK_COLOR),
    radius,
  };
}

/** HTF window dots → lower-3 scatter (FE parity — both dots of a neutral
 *  zone render, exactly as the backend emits them). */
export function htfWindowDots(
  points: HtfWindowPoint[] | undefined,
  indexByDate: Map<string, number>,
): ScatterSeriesSpec | null {
  const data = (points ?? [])
    .map((p) => ({ p, x: indexByDate.get(p.d) }))
    .filter((e): e is { p: HtfWindowPoint; x: number } => e.x !== undefined)
    .map((e) => ({ x: e.x, y: e.p.y, color: remapSeriesColor(e.p.color) }));
  if (data.length === 0) return null;
  return { kind: 'scatter', data, color: remapSeriesColor(ST_ZONE_FALLBACK_COLOR), radius: LOWER_DOT_RADIUS };
}

/** HTF window dots → main-pane shaded ranges (capture-only representation).
 *  A neutral HTF zone emits BOTH dots on the same bar — shading resolves
 *  each bar to one layer (long / short / neutral) so the two colors never
 *  double-paint over the same range. Consecutive same-layer bars coalesce
 *  into a single WindowRange. */
export function htfWindowLayers(
  points: HtfWindowPoint[] | undefined,
  indexByDate: Map<string, number>,
): RenderPaneWindowLayer[] {
  const colorsAt = new Map<number, Set<string>>();
  for (const p of points ?? []) {
    const x = indexByDate.get(p.d);
    if (x === undefined) continue;
    let set = colorsAt.get(x);
    if (!set) colorsAt.set(x, (set = new Set()));
    set.add(p.color);
  }
  if (colorsAt.size === 0) return [];

  // One layer color per bar: its single dot color, or neutral when both
  // long and short dots sit on the same bar.
  const colorAt = new Map<number, string>();
  for (const [x, set] of colorsAt) {
    colorAt.set(x, set.size === 1 ? [...set][0] : ST_HTF_WINDOW.neutralColor);
  }

  const xs = [...colorAt.keys()].sort((a, b) => a - b);
  const runsByColor = new Map<string, WindowRange[]>();
  let i = 0;
  while (i < xs.length) {
    const color = colorAt.get(xs[i])!;
    const x0 = xs[i];
    let j = i;
    while (j + 1 < xs.length && xs[j + 1] === xs[j] + 1 && colorAt.get(xs[j + 1]) === color) j++;
    let runs = runsByColor.get(color);
    if (!runs) runsByColor.set(color, (runs = []));
    runs.push({ x0, x1: xs[j] });
    i = j + 1;
  }

  return [...runsByColor].map(([color, data]) => ({
    data,
    color: remapSeriesColor(color),
    opacity: WINDOW_OPACITY,
  }));
}

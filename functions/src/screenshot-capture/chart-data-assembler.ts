/**
 * Chart data assembler — bars + indicator-series response → render model
 * (task #767).
 *
 * Pure mapping layer mirroring what the FE pipeline produces:
 * `injectCallableIndicatorData` + `signal-marker-converters` +
 * `computeStdDevLinesSeries` + `ChartDataAdapter`. The assembler consumes the
 * in-process indicator-series output (never a self-callable) and emits the
 * normalized `ChartRenderModel` — bar-index positions, resolved panes,
 * final colors (palette remap applied in the mappers; the renderer paints
 * verbatim). Per-family translation lives in `chart-series-mappers.ts`.
 *
 * Slicing: indicators are computed on the full history; `visibleBars` only
 * truncates the render window (last N bars), index-rebasing every series.
 * Zone uptick dots, trend-strength signal dots, and HTF windows arrive
 * pre-computed inside the response (`dotMarkers`, `htfWindows`) — mapped,
 * not recomputed. Zigzag is never emitted (per spec).
 *
 * Panes: inactive panes are omitted — a lower pane is emitted only when it
 * has at least one series with points. Stricter than `chartRows` (which keys
 * on series presence): a pane whose series exist but carry no points is
 * dropped too, since an empty scatter still earned a row there.
 */

import type { OhlcBar } from '../common/market-data-types';
import type { IntervalData } from '../st-cloud-function/indicator-computation';
import {
  DEFAULT_CAPTURE_HEIGHT,
  DEFAULT_CAPTURE_VISIBLE_BARS,
  DEFAULT_CAPTURE_WIDTH,
  VISIBLE_BARS_ALL,
} from '@screenshot-capture/contracts';
import type {
  CaptureEvent,
  CaptureInterval,
  PositionType,
  VisibleBars,
} from '@screenshot-capture/contracts';
import { ChartInterval } from '@screenshot-capture/contracts';
import {
  ST_SIGNAL_DOT_COLORS,
  ST_TREND_STRENGTH_AXIS_MAX,
  ST_TREND_STRENGTH_AXIS_MIN,
  ST_TREND_STRENGTH_REFLINES,
  ST_UPTICK_DOT_COLORS,
  ST_ZONE_NEUTRAL_REFLINE,
  ST_ZONE_V2_AXIS_MAX,
  ST_ZONE_V2_AXIS_MIN,
} from '@flex-chart/indicator-visuals';
import { SCREENSHOT_DARK_PALETTE } from './chart-theme';
import {
  LOWER_DOT_RADIUS,
  OVERLAY_DOT_RADIUS,
  bandCandleSeries,
  dotMarkerSeries,
  htfWindowDots,
  htfWindowLayers,
  stdDevSeries,
  trendStrengthSeries,
  zoneSeries,
} from './chart-series-mappers';
import type {
  ChartRenderModel,
  RenderBar,
  RenderPane,
  RenderSeries,
} from './render-model';

// ── Options ─────────────────────────────────────────────────────────────────

export interface AssembleRenderModelOptions {
  symbol: string;
  interval: CaptureInterval;
  event: CaptureEvent;
  positionType: PositionType;
  refId?: string;
  /** Capture timestamp rendered in the header (ISO). */
  timestampIso: string;
  /** Full-history bars for the interval, oldest → newest. */
  bars: OhlcBar[];
  /** The interval's slice of `SymbolIndicatorSeriesResponse`. Undefined →
   *  price + std-dev only (no ST panes). */
  intervalData?: IntervalData;
  width?: number;
  height?: number;
  /** Last-N render window (default 30); 'all' renders the full series. */
  visibleBars?: VisibleBars;
  /** Log price axis — quick-charts default true. */
  logScale?: boolean;
}

// ── Assembly ────────────────────────────────────────────────────────────────

/** Which HTF window set a chart reads: daily → weekly windows, weekly →
 *  monthly (matches `extras-signals.ts` pane wiring). Exhaustive over
 *  CaptureInterval — a new interval forces a compile error here. */
const HTF_WINDOW_KEY: Record<CaptureInterval, 'weekly' | 'monthly'> = {
  [ChartInterval.DAILY]: 'weekly',
  [ChartInterval.WEEKLY]: 'monthly',
};

/** A pane earns its row only when at least one series has points —
 *  stricter than `chartRows`, which only checks that a series exists. */
function hasPoints(series: RenderSeries[]): boolean {
  return series.some((s) => s.data.length > 0);
}

/** Build the render model for one interval from its bars + indicator data. */
export function assembleRenderModel(opts: AssembleRenderModelOptions): ChartRenderModel {
  const visible = opts.visibleBars ?? DEFAULT_CAPTURE_VISIBLE_BARS;
  if (visible !== VISIBLE_BARS_ALL && (!Number.isInteger(visible) || visible < 1)) {
    throw new Error(
      `assembleRenderModel: visibleBars must be a positive integer or '${VISIBLE_BARS_ALL}' (got ${JSON.stringify(visible)})`,
    );
  }
  const sliced = visible === VISIBLE_BARS_ALL ? opts.bars : opts.bars.slice(-visible);
  const offset = opts.bars.length - sliced.length;
  const len = sliced.length;
  const indexByDate = new Map<string, number>(sliced.map((b, i) => [b.d, i]));

  const bars: RenderBar[] = sliced.map((b) => ({ date: b.d, open: b.o, high: b.h, low: b.l, close: b.c }));
  const palette = SCREENSHOT_DARK_PALETTE;
  const data = opts.intervalData;
  const htfPoints = data?.htfWindows?.[HTF_WINDOW_KEY[opts.interval]];

  // ── Main pane: windows → band candles → price → fills → lines → dots ──
  const main: RenderSeries[] = [
    ...bandCandleSeries(data?.indicators?.trendBands, offset, len),
    {
      kind: 'candle',
      data: bars.map((b, i) => ({ x: i, open: b.open, high: b.high, low: b.low, close: b.close })),
      upColor: palette.candleUp,
      downColor: palette.candleDown,
    },
  ];
  const std = stdDevSeries(opts.bars, offset, len);
  main.push(...std.fills, ...std.lines);
  const zoneV1Upticks = dotMarkerSeries(data?.dotMarkers?.zoneV1, offset, len,
    { long: ST_UPTICK_DOT_COLORS.v1Long, short: ST_UPTICK_DOT_COLORS.v1Short }, OVERLAY_DOT_RADIUS);
  const zoneV2Upticks = dotMarkerSeries(data?.dotMarkers?.zoneV2, offset, len,
    { long: ST_UPTICK_DOT_COLORS.v2Long, short: ST_UPTICK_DOT_COLORS.v2Short }, OVERLAY_DOT_RADIUS);
  if (zoneV1Upticks) main.push(zoneV1Upticks);
  if (zoneV2Upticks) main.push(zoneV2Upticks);

  const panes: RenderPane[] = [{
    id: 'main',
    series: main,
    windows: htfWindowLayers(htfPoints, indexByDate),
  }];

  if (data) {
    // ── lower-3: zone V2 (+ connector) + HTF window dots, fixed ±7 ──
    const v2 = zoneSeries(data.indicators?.zoneV2, offset, len);
    const windowDots = htfWindowDots(htfPoints, indexByDate);
    const lower3Series: RenderSeries[] = [];
    if (v2) lower3Series.push(v2.connector, v2.dots);
    if (windowDots) lower3Series.push(windowDots);
    const v2HasData = (v2?.dots.data.length ?? 0) > 0;
    if (hasPoints(lower3Series)) {
      panes.push({
        id: 'lower-3',
        series: lower3Series,
        // Fixed ±7 comes from the zone V2 indicator's axis config — absent
        // when only window dots are present (window's own axis is unbounded).
        ...(v2HasData ? { axisMin: ST_ZONE_V2_AXIS_MIN, axisMax: ST_ZONE_V2_AXIS_MAX } : {}),
        ...(v2HasData ? { referenceLines: [ST_ZONE_NEUTRAL_REFLINE] } : {}),
      });
    }

    // ── lower-2: zone V1 (+ connector), auto axis, refline 0 ──
    const v1 = zoneSeries(data.indicators?.zoneV1, offset, len);
    const lower2Series: RenderSeries[] = v1 ? [v1.connector, v1.dots] : [];
    if (hasPoints(lower2Series)) {
      panes.push({
        id: 'lower-2',
        series: lower2Series,
        referenceLines: [ST_ZONE_NEUTRAL_REFLINE],
      });
    }

    // ── lower-1: HTF column behind primary + signal dots, fixed ±50 ──
    const cols = trendStrengthSeries(data.indicators?.trendStrength, offset, len)
      .filter((c) => c.data.length > 0);
    const signalDots = dotMarkerSeries(data.dotMarkers?.trendStrength, offset, len,
      { long: ST_SIGNAL_DOT_COLORS.long, short: ST_SIGNAL_DOT_COLORS.short }, LOWER_DOT_RADIUS);
    const lower1Series: RenderSeries[] = [...cols];
    if (signalDots) lower1Series.push(signalDots);
    const hasTs = cols.length > 0;
    if (hasPoints(lower1Series)) {
      panes.push({
        id: 'lower-1',
        series: lower1Series,
        ...(hasTs ? { axisMin: ST_TREND_STRENGTH_AXIS_MIN, axisMax: ST_TREND_STRENGTH_AXIS_MAX } : {}),
        ...(hasTs ? { referenceLines: ST_TREND_STRENGTH_REFLINES } : {}),
      });
    }
  }

  return {
    symbol: opts.symbol,
    interval: opts.interval,
    event: opts.event,
    positionType: opts.positionType,
    refId: opts.refId,
    timestampIso: opts.timestampIso,
    width: opts.width ?? DEFAULT_CAPTURE_WIDTH,
    height: opts.height ?? DEFAULT_CAPTURE_HEIGHT,
    logScale: opts.logScale ?? true,
    bars,
    panes,
    eventBarIndex: bars.length - 1,
  };
}

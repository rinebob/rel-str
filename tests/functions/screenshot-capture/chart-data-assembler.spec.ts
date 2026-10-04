/**
 * Chart data assembler tests — the seam between the indicator-series
 * pipeline and the render model (task #767).
 *
 * The primary fixture runs the real `computeSymbolIndicatorSeries` over a
 * deterministic bar walk so assertions cover actual indicator output, not a
 * hand-shaped stand-in. Sparse-marker cases (dot rebase, window runs) use a
 * minimal hand-built IntervalData to guarantee presence regardless of
 * whether the synthetic walk happens to fire signals.
 */
import {
  assembleRenderModel,
  type AssembleRenderModelOptions,
} from '../../../functions/src/screenshot-capture/chart-data-assembler';
import { computeSymbolIndicatorSeries } from '../../../functions/src/st-cloud-function/indicator-computation';
import type {
  DotMarker,
  IntervalData,
} from '../../../functions/src/st-cloud-function/indicator-computation';
import type { OhlcBar } from '../../../functions/src/common/market-data-types';
import { computeStdDevLinesSeries } from '../../../src/app/features/shared/components/flex-chart/indicators/st-std-dev-lines.indicator';
import { SCREENSHOT_DARK_PALETTE, remapSeriesColor } from '../../../functions/src/screenshot-capture/chart-theme';
import { ST_HTF_WINDOW } from '@flex-chart/indicator-visuals';
import type {
  CandleSeriesSpec,
  ChartRenderModel,
  ColumnSeriesSpec,
  LineSeriesSpec,
  RangeSeriesSpec,
  RenderPane,
  ScatterSeriesSpec,
} from '../../../functions/src/screenshot-capture/render-model';
import {
  CaptureEvent,
  ChartInterval,
  PositionType,
} from '@screenshot-capture/contracts';

// ── Fixtures ────────────────────────────────────────────────────────────────

const DAY_MS = 24 * 60 * 60 * 1000;

/** Deterministic OHLC walk — sine + drift, no RNG so assertions are stable. */
function makeOhlcBars(count: number, startEpoch: number, stepDays: number): OhlcBar[] {
  const bars: OhlcBar[] = [];
  let prevClose = 100;
  for (let i = 0; i < count; i++) {
    const close = 100 + 0.3 * i + 12 * Math.sin(i / 6);
    const open = i === 0 ? close - 0.4 : prevClose;
    const d = new Date(startEpoch + i * stepDays * DAY_MS).toISOString().slice(0, 10);
    bars.push({ d, o: open, h: Math.max(open, close) + 1.5, l: Math.min(open, close) - 1.5, c: close, v: 1000 + i });
    prevClose = close;
  }
  return bars;
}

const DAILY_BARS = makeOhlcBars(90, Date.UTC(2026, 0, 1), 1);
const WEEKLY_BARS = makeOhlcBars(50, Date.UTC(2025, 0, 6), 7);
const MONTHLY_BARS = makeOhlcBars(35, Date.UTC(2023, 0, 1), 30);
const SERIES = computeSymbolIndicatorSeries('TEST', DAILY_BARS, WEEKLY_BARS, MONTHLY_BARS);

function baseOptions(
  overrides: Partial<AssembleRenderModelOptions> = {},
): Omit<AssembleRenderModelOptions, 'bars' | 'intervalData'> {
  return {
    symbol: 'TEST',
    interval: ChartInterval.DAILY,
    event: CaptureEvent.ORDER_FILLED,
    positionType: PositionType.STOCK,
    refId: 'ord123',
    timestampIso: '2026-10-04T14:30:00Z',
    width: 800,
    height: 560,
    visibleBars: 30,
    ...overrides,
  };
}

function pane(model: ChartRenderModel, id: string): RenderPane {
  const p = model.panes.find((x) => x.id === id);
  if (!p) throw new Error(`pane ${id} missing — panes: ${model.panes.map((x) => x.id).join(',')}`);
  return p;
}

const candlesOf = (p: RenderPane): CandleSeriesSpec[] =>
  p.series.filter((s): s is CandleSeriesSpec => s.kind === 'candle');
const linesOf = (p: RenderPane): LineSeriesSpec[] =>
  p.series.filter((s): s is LineSeriesSpec => s.kind === 'line');
const scattersOf = (p: RenderPane): ScatterSeriesSpec[] =>
  p.series.filter((s): s is ScatterSeriesSpec => s.kind === 'scatter');
const columnsOf = (p: RenderPane): ColumnSeriesSpec[] =>
  p.series.filter((s): s is ColumnSeriesSpec => s.kind === 'column');

function allSeriesPoints(model: ChartRenderModel): number[] {
  return model.panes.flatMap((p) => p.series.flatMap((s) => s.data.map((pt) => pt.x)));
}

// ── Real-pipeline model ─────────────────────────────────────────────────────

describe('assembleRenderModel — real indicator pipeline', () => {
  const model = assembleRenderModel({
    ...baseOptions(),
    bars: DAILY_BARS,
    intervalData: SERIES.intervals.daily,
  });

  it('emits panes in FE visual order: main, lower-3, lower-2, lower-1 (lower-4 absent by default)', () => {
    expect(model.panes.map((p) => p.id)).toEqual(['main', 'lower-3', 'lower-2', 'lower-1']);
  });

  it('slices bars to the last visibleBars and rebases every series point into the window', () => {
    expect(model.bars).toHaveLength(30);
    expect(model.bars[0].date).toBe(DAILY_BARS[DAILY_BARS.length - 30].d);
    expect(model.bars[29].date).toBe(DAILY_BARS[DAILY_BARS.length - 1].d);
    const xs = allSeriesPoints(model);
    expect(xs.length).toBeGreaterThan(0);
    expect(Math.min(...xs)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...xs)).toBeLessThan(30);
  });

  it('keeps the full series when visibleBars is "all"', () => {
    const full = assembleRenderModel({
      ...baseOptions({ visibleBars: 'all' }),
      bars: DAILY_BARS,
      intervalData: SERIES.intervals.daily,
    });
    expect(full.bars).toHaveLength(DAILY_BARS.length);
    const xs = allSeriesPoints(full);
    expect(Math.max(...xs)).toBeLessThan(DAILY_BARS.length);
  });

  it('clamps visibleBars larger than the bar count to the full series', () => {
    const m = assembleRenderModel({
      ...baseOptions({ visibleBars: DAILY_BARS.length + 500 }),
      bars: DAILY_BARS,
      intervalData: undefined,
    });
    expect(m.bars).toHaveLength(DAILY_BARS.length);
  });

  it('rejects non-positive or non-integer visibleBars', () => {
    for (const v of [0, -5, 2.5]) {
      expect(() => assembleRenderModel({ ...baseOptions({ visibleBars: v }), bars: DAILY_BARS }))
        .toThrow(/visibleBars/);
    }
  });

  it('paints band candles behind the price candle, overlays after it', () => {
    const main = pane(model, 'main');
    const candleSeries = candlesOf(main);
    const priceIdx = main.series.findIndex(
      (s) => s.kind === 'candle' && s.upColor === SCREENSHOT_DARK_PALETTE.candleUp,
    );
    expect(priceIdx).toBeGreaterThan(0);
    expect(candleSeries.length).toBeGreaterThanOrEqual(2); // ≥1 band + price
    // Every candle before the price candle is a band layer (behind = earlier).
    main.series.slice(0, priceIdx).forEach((s) => expect(s.kind).toBe('candle'));
    // Fills + lines + overlay dots all paint over price.
    main.series.slice(priceIdx + 1).forEach((s) =>
      expect(['range', 'line', 'scatter']).toContain(s.kind),
    );
  });

  it('emits price candles with the dark palette colors — no remap of palette-owned hexes', () => {
    const main = pane(model, 'main');
    const price = candlesOf(main).find((c) => c.upColor === SCREENSHOT_DARK_PALETTE.candleUp);
    expect(price).toBeDefined();
    // '#ef5350' collides with a remap-table key; FE binds the palette value
    // directly so the model must carry it verbatim (not '#ff5252').
    expect(price!.downColor).toBe('#ef5350');
  });

  it('remaps band colors through the dark palette', () => {
    const main = pane(model, 'main');
    const priceIdx = main.series.findIndex(
      (s) => s.kind === 'candle' && s.upColor === SCREENSHOT_DARK_PALETTE.candleUp,
    );
    const band = main.series[0] as CandleSeriesSpec;
    expect(band.kind).toBe('candle');
    expect(priceIdx).toBeGreaterThan(0);
    // BE band1 bull '#ffeb3b' passes through; bear '#2196f3' → '#3da5ff'.
    expect(band.upColor).toBe('#ffeb3b');
    expect(band.downColor).toBe('#3da5ff');
  });

  it('assembles std-dev lines matching the FE computeStdDevLinesSeries output', () => {
    const main = pane(model, 'main');
    const fe = computeStdDevLinesSeries(
      DAILY_BARS.map((b) => ({ date: b.d, x: new Date(b.d), open: b.o, high: b.h, low: b.l, close: b.c })),
      { period: 50, maType: 'sma', displayMode: 'combined' },
    );
    const offset = DAILY_BARS.length - 30;
    const lines = linesOf(main);
    const fills = main.series.filter((s): s is RangeSeriesSpec => s.kind === 'range');
    expect(lines).toHaveLength(fe.lines.length); // center + 5 regular pairs + 3 fib pairs
    expect(fills).toHaveLength(fe.fills.length); // upper + lower fill per regular level
    // Deep parity — EVERY emitted line/fill diffs against the real FE
    // series, not just the center line. FE points are full-history
    // {index,…}; the model rebases to [0, 30).
    fe.lines.forEach((feLine, i) => {
      expect(lines[i].data).toEqual(
        feLine.data
          .filter((p) => p.index >= offset)
          .map((p) => ({ x: p.index - offset, y: p.y })),
      );
      expect(lines[i].width).toBe(feLine.width);
      expect(lines[i].dashArray ?? '').toBe(feLine.dashArray);
      expect(lines[i].color).toBe(remapSeriesColor(feLine.color));
    });
    fe.fills.forEach((feFill, i) => {
      expect(fills[i].data).toEqual(
        feFill.data
          .filter((p) => p.index >= offset)
          .map((p) => ({ x: p.index - offset, high: p.high, low: p.low })),
      );
      expect(fills[i].opacity).toBe(feFill.opacity);
      expect(fills[i].color).toBe(remapSeriesColor(feFill.color));
    });
    expect(lines[0].color).toBe('#3399ff'); // '#1976d2' remapped
  });

  it('lower-1 carries HTF column behind the primary column, fixed ±50 axis, threshold reflines', () => {
    const p1 = pane(model, 'lower-1');
    expect(p1.axisMin).toBe(-50);
    expect(p1.axisMax).toBe(50);
    expect(p1.referenceLines?.map((r) => r.value)).toEqual([0, 10, -10]);
    const cols = columnsOf(p1);
    expect(cols).toHaveLength(2);
    // HTF companion first (behind), narrower.
    expect(cols[0].widthFactor).toBe(0.75);
    expect(cols[1].widthFactor).toBe(1.0);
    expect(cols[1].data.every((pt) => pt.color !== undefined)).toBe(true);
  });

  it('lower-2 carries the zone V1 connector line behind its scatter, auto axis, refline 0', () => {
    const p2 = pane(model, 'lower-2');
    expect(p2.axisMin).toBeUndefined();
    expect(p2.axisMax).toBeUndefined();
    expect(p2.referenceLines?.map((r) => r.value)).toEqual([0]);
    expect(p2.series.map((s) => s.kind)).toEqual(['line', 'scatter']);
    const connector = p2.series[0] as LineSeriesSpec;
    expect(connector.color).toBe(SCREENSHOT_DARK_PALETTE.scatterConnector);
    expect(connector.width).toBe(1);
    expect(connector.opacity).toBe(0.5);
    // Connector shares the scatter's points — same data, same order.
    const scatter = p2.series[1] as ScatterSeriesSpec;
    expect(connector.data).toEqual(scatter.data.map((pt) => ({ x: pt.x, y: pt.y })));
    expect(scatter.radius).toBe(2);
  });

  it('lower-3 carries zone V2 (+ connector) and HTF window dots on a fixed ±7 axis', () => {
    const p3 = pane(model, 'lower-3');
    expect(p3.axisMin).toBe(-7);
    expect(p3.axisMax).toBe(7);
    const kinds = p3.series.map((s) => s.kind);
    // connector line → zone V2 scatter → window dots scatter
    expect(kinds).toEqual(['line', 'scatter', 'scatter']);
    const windowDots = p3.series[2] as ScatterSeriesSpec;
    expect(windowDots.data.every((pt) => pt.y === -6 || pt.y === 6)).toBe(true);
  });

  it('derives main-pane shaded-window layers from the HTF window dots, grouped by color', () => {
    const main = pane(model, 'main');
    expect(Array.isArray(main.windows)).toBe(true);
    for (const layer of main.windows ?? []) {
      expect(layer.data.length).toBeGreaterThan(0);
      for (const w of layer.data) {
        expect(w.x0).toBeGreaterThanOrEqual(0);
        expect(w.x1).toBeLessThan(30);
        expect(w.x1).toBeGreaterThanOrEqual(w.x0);
      }
    }
  });

  it('propagates header fields, defaults logScale on, and marks the last bar', () => {
    expect(model.symbol).toBe('TEST');
    expect(model.event).toBe(CaptureEvent.ORDER_FILLED);
    expect(model.interval).toBe(ChartInterval.DAILY);
    expect(model.refId).toBe('ord123');
    expect(model.timestampIso).toBe('2026-10-04T14:30:00Z');
    expect(model.logScale).toBe(true);
    expect(model.eventBarIndex).toBe(29);
  });

  it('never emits zigzag series', () => {
    expect(JSON.stringify(model)).not.toContain('zigzag');
  });

  it('assembles the weekly interval from weekly bars + monthly HTF windows', () => {
    const weekly = assembleRenderModel({
      ...baseOptions({ interval: ChartInterval.WEEKLY, visibleBars: 'all' }),
      bars: WEEKLY_BARS,
      intervalData: SERIES.intervals.weekly,
    });
    expect(weekly.interval).toBe(ChartInterval.WEEKLY);
    expect(weekly.bars).toHaveLength(WEEKLY_BARS.length);
    // Monthly window dots must be wired through the weekly→monthly key —
    // if the key flipped to 'weekly', these would silently be empty.
    const monthlyPts = SERIES.intervals.weekly?.htfWindows?.monthly ?? [];
    expect(monthlyPts.length).toBeGreaterThan(0);
    const p3 = pane(weekly, 'lower-3');
    const windowDots = scattersOf(p3).find((s) => s.data.some((pt) => pt.y === 6 || pt.y === -6));
    expect(windowDots).toBeDefined();
    expect(windowDots!.data.length).toBeGreaterThan(0);
    expect(pane(weekly, 'main').windows!.length).toBeGreaterThan(0);
  });
});

// ── Sparse-marker fixtures (guaranteed presence) ────────────────────────────

function marker(overrides: Partial<DotMarker>): DotMarker {
  return {
    d: '2026-01-01',
    index: 0,
    direction: 'long',
    y: 50,
    version: 'TS',
    signalType: 'cross-zero',
    ...overrides,
  };
}

function intervalData(partial: Partial<IntervalData>): IntervalData {
  return { indicators: {}, signals: {}, ...partial };
}

describe('assembleRenderModel — sparse markers', () => {
  const bars = DAILY_BARS;

  it('rebases trend-strength dot markers by bar index into the sliced window', () => {
    const offset = bars.length - 30;
    const model = assembleRenderModel({
      ...baseOptions(),
      bars,
      intervalData: intervalData({
        dotMarkers: {
          trendStrength: [
            marker({ index: offset + 5, d: bars[offset + 5].d, y: 12 }),
            marker({ index: 3, d: bars[3].d, y: -8 }), // outside the window
          ],
        },
      }),
    });
    const p1 = pane(model, 'lower-1');
    const dots = scattersOf(p1)[0];
    expect(dots.radius).toBe(2);
    expect(dots.data).toHaveLength(1);
    expect(dots.data[0].x).toBe(5);
    expect(dots.data[0].y).toBe(12);
    // long → '#4caf50' remapped to '#33d17a'
    expect(dots.data[0].color).toBe('#33d17a');
  });

  it('maps zone dot markers to main-pane uptick scatters with per-version colors', () => {
    const offset = bars.length - 30;
    const model = assembleRenderModel({
      ...baseOptions(),
      bars,
      intervalData: intervalData({
        dotMarkers: {
          zoneV1: [marker({ index: offset + 2, d: bars[offset + 2].d, version: 'V1', direction: 'short', y: 130 })],
          zoneV2: [marker({ index: offset + 4, d: bars[offset + 4].d, version: 'V2', direction: 'long', y: 70 })],
        },
      }),
    });
    const main = pane(model, 'main');
    const dots = scattersOf(main);
    expect(dots).toHaveLength(2);
    expect(dots[0].radius).toBe(5);
    // V1 short: '#f44336' → '#ff5252'; V2 long: '#8bc34a' passes through.
    expect(dots[0].data[0].color).toBe('#ff5252');
    expect(dots[1].data[0].color).toBe('#8bc34a');
    expect(dots[0].data[0].x).toBe(2);
  });

  it('colors zone scatters via the ±4 converter table (remapped)', () => {
    const offset = bars.length - 30;
    const model = assembleRenderModel({
      ...baseOptions(),
      bars,
      intervalData: intervalData({
        indicators: {
          zoneV1: bars.map((b, i) => ({ d: b.d, zone: i === offset + 1 ? 3 : i === offset + 2 ? -2 : null })),
        },
      }),
    });
    const p2 = pane(model, 'lower-2');
    const scatter = scattersOf(p2)[0];
    expect(scatter.data.map((pt) => pt.x)).toEqual([1, 2]);
    // zone 3 '#2196f3' → '#3da5ff'; zone -2 '#f44336' → '#ff5252'
    expect(scatter.data[0].color).toBe('#3da5ff');
    expect(scatter.data[1].color).toBe('#ff5252');
  });

  it('groups consecutive same-color HTF window dots into shaded ranges', () => {
    const offset = bars.length - 30;
    const pts = [0, 1, 2, 5].map((i) => ({
      d: bars[offset + i].d,
      y: -6,
      color: '#4caf50',
    }));
    pts.push({ d: bars[offset + 3].d, y: 6, color: '#f44336' });
    const model = assembleRenderModel({
      ...baseOptions(),
      bars,
      intervalData: intervalData({ htfWindows: { weekly: pts } }),
    });
    const main = pane(model, 'main');
    const green = main.windows?.find((l) => l.color === '#33d17a');
    const red = main.windows?.find((l) => l.color === '#ff5252');
    expect(green?.data).toEqual([
      { x0: 0, x1: 2 },
      { x0: 5, x1: 5 },
    ]);
    expect(red?.data).toEqual([{ x0: 3, x1: 3 }]);
    // The dots still render on lower-3 for FE parity.
    const p3 = pane(model, 'lower-3');
    const dots = scattersOf(p3).find((s) => s.data.some((pt) => pt.y === 6 || pt.y === -6));
    expect(dots?.data).toHaveLength(5);
  });

  it('renders a main-only model when intervalData is undefined', () => {
    const model = assembleRenderModel({
      ...baseOptions(),
      bars,
      intervalData: undefined,
    });
    // Price candles + std-dev survive without indicator data.
    expect(model.panes.map((p) => p.id)).toEqual(['main']);
    expect(pane(model, 'main').series.length).toBeGreaterThan(0);
  });

  it('omits all lower panes when the indicators object is empty', () => {
    const model = assembleRenderModel({
      ...baseOptions(),
      bars,
      intervalData: intervalData({}),
    });
    expect(model.panes.map((p) => p.id)).toEqual(['main']);
  });

  it('omits a pane when its series are present but empty — all-null zone data', () => {
    // The real pipeline emits all-null zone arrays when bars < warmup —
    // present-but-empty must not produce a zero-point pane.
    const model = assembleRenderModel({
      ...baseOptions(),
      bars,
      intervalData: intervalData({
        indicators: {
          zoneV1: bars.map((b) => ({ d: b.d, zone: null })),
          zoneV2: bars.map((b) => ({ d: b.d, zone: null })),
        },
      }),
    });
    expect(model.panes.map((p) => p.id)).toEqual(['main']);
  });

  it('resolves a bar carrying both window colors to one neutral layer — no double-paint', () => {
    const offset = bars.length - 30;
    // A neutral HTF zone emits BOTH dots on the same bar; shading must not
    // stack green + red over it.
    const pts = [
      { d: bars[offset + 1].d, y: -ST_HTF_WINDOW.y, color: ST_HTF_WINDOW.longColor },
      { d: bars[offset + 1].d, y: ST_HTF_WINDOW.y, color: ST_HTF_WINDOW.shortColor },
      { d: bars[offset + 2].d, y: -ST_HTF_WINDOW.y, color: ST_HTF_WINDOW.longColor },
    ];
    const model = assembleRenderModel({
      ...baseOptions(),
      bars,
      intervalData: intervalData({ htfWindows: { weekly: pts } }),
    });
    const main = pane(model, 'main');
    expect(main.windows).toHaveLength(2);
    const neutral = main.windows!.find((l) => l.color === remapSeriesColor(ST_HTF_WINDOW.neutralColor));
    const long = main.windows!.find((l) => l.color === remapSeriesColor(ST_HTF_WINDOW.longColor));
    expect(neutral?.data).toEqual([{ x0: 1, x1: 1 }]);
    expect(long?.data).toEqual([{ x0: 2, x1: 2 }]);
    // Every bar index is covered by exactly one layer.
    const covered = main.windows!.flatMap((l) =>
      l.data.flatMap((w) => Array.from({ length: w.x1 - w.x0 + 1 }, (_, k) => w.x0 + k)));
    expect(new Set(covered).size).toBe(covered.length);
    // The dots themselves still render both markers on lower-3 (FE parity).
    const p3 = pane(model, 'lower-3');
    expect(scattersOf(p3)[0].data).toHaveLength(3);
  });
});

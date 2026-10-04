/**
 * SVG renderer tests — fixed render-model fixture → structural invariants.
 * The fixture exercises every series kind plus the header/marker/metadata
 * requirements from task #766's acceptance criteria. Pane order mirrors the
 * flex-chart visual stack (main, lower-4→lower-1 top→bottom).
 */
import { renderChartSvg } from '../../../functions/src/screenshot-capture/svg-renderer';
import type { ChartRenderModel } from '../../../functions/src/screenshot-capture/render-model';
import {
  CaptureEvent,
  ChartInterval,
  PositionType,
} from '@screenshot-capture/contracts';

/** Deterministic up/down bars — 30 daily bars walking between 95 and 115. */
function makeBars(count = 30): ChartRenderModel['bars'] {
  const bars: ChartRenderModel['bars'] = [];
  for (let i = 0; i < count; i++) {
    const close = 100 + 10 * Math.sin(i / 4);
    const open = 100 + 10 * Math.sin((i - 1) / 4);
    const day = String((i % 28) + 1).padStart(2, '0');
    const month = String(Math.floor(i / 28) + 1).padStart(2, '0');
    bars.push({
      date: `2026-${month}-${day}`,
      open,
      close,
      high: Math.max(open, close) + 2,
      low: Math.min(open, close) - 2,
    });
  }
  return bars;
}

/** Full-featured model: band candles behind price, range fill + line overlay,
 *  uptick scatter, HTF window, signal-dot pane (lower-3 above), zone pane
 *  (lower-1, bottom) with reflines — FE visual order main → lower-3 →
 *  lower-1. */
function makeModel(overrides: Partial<ChartRenderModel> = {}): ChartRenderModel {
  const bars = makeBars();
  return {
    symbol: 'GOOG',
    interval: ChartInterval.DAILY,
    event: CaptureEvent.ORDER_FILLED,
    positionType: PositionType.STOCK,
    refId: 'ord123',
    timestampIso: '2026-10-03T14:30:22Z',
    width: 800,
    height: 560,
    logScale: true,
    bars,
    panes: [
      {
        id: 'main',
        windows: [{ data: [{ x0: 5, x1: 12 }], color: '#2196f3', opacity: 0.12 }],
        series: [
          {
            kind: 'candle',
            data: bars.map((b, i) => ({ x: i, open: b.open + 1, high: b.high + 1, low: b.low + 1, close: b.close + 1 })),
            upColor: '#ffeb3b',
            downColor: '#2196f3',
          },
          {
            kind: 'candle',
            data: bars.map((b, i) => ({ x: i, open: b.open, high: b.high, low: b.low, close: b.close })),
            upColor: '#26a69a',
            downColor: '#ef5350',
          },
          {
            kind: 'range',
            data: bars.map((b, i) => ({ x: i, high: b.high + 6, low: b.low - 6 })),
            color: '#9e9e9e',
            opacity: 0.15,
          },
          {
            kind: 'line',
            data: bars.map((b, i) => ({ x: i, y: (b.high + b.low) / 2 })),
            color: '#e0e0e0',
            width: 1,
            dashArray: '4,2',
          },
          {
            kind: 'scatter',
            data: [{ x: 10, y: 112, color: '#4caf50' }, { x: 20, y: 108 }],
            color: '#f44336',
            radius: 5,
          },
        ],
      },
      {
        id: 'lower-3',
        axisMin: -7,
        axisMax: 7,
        series: [
          {
            kind: 'scatter',
            data: bars.filter((_, i) => i % 5 === 0).map((_, i) => ({ x: i * 5, y: Math.sin(i) * 5 })),
            color: '#9e9e9e',
            radius: 2,
          },
        ],
      },
      {
        id: 'lower-1',
        axisMin: -50,
        axisMax: 50,
        referenceLines: [{ value: 0, color: '#9e9e9e', dashArray: '4,3' }],
        series: [
          {
            kind: 'column',
            data: bars.map((_, i) => ({ x: i, y: 40 * Math.sin(i / 3), color: i % 2 ? '#2196f3' : '#4caf50' })),
            color: '#2196f3',
          },
          {
            kind: 'scatter',
            data: [{ x: 8, y: 20, color: '#4caf50' }, { x: 22, y: -15, color: '#f44336' }],
            color: '#9e9e9e',
            radius: 2,
          },
        ],
      },
    ],
    ...overrides,
  };
}

describe('renderChartSvg — well-formed output', () => {
  const svg = renderChartSvg(makeModel());

  it('is a single-rooted svg element with xmlns and viewBox', () => {
    expect(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg"')).toBe(true);
    expect(svg).toContain('viewBox="0 0 800 560"');
    expect(svg.endsWith('</svg>')).toBe(true);
    // Balanced element count — every opened tag class closes or self-closes.
    expect((svg.match(/<svg/g) ?? []).length).toBe(1);
    expect(svg).not.toContain('undefined');
    expect(svg).not.toContain('NaN');
  });

  it('emits candle rects and wick lines for price + band series', () => {
    // Exact rect count: background(1) + clip rects(3) + window(1) +
    // 60 candle bodies (2 series × 30) + 30 columns.
    const bodies = svg.match(/<rect /g) ?? [];
    expect(bodies.length).toBe(95);
    const wicks = svg.match(/<line [^>]*stroke="#/g) ?? [];
    expect(wicks.length).toBeGreaterThanOrEqual(60);
  });

  it('emits line paths, scatter circles, a range fill, and a window rect', () => {
    expect(svg).toContain('<path d="M'); // line + range paths
    expect(svg).toContain('stroke-dasharray="4,2"'); // dashed std-dev line
    expect(svg).toContain('<circle'); // uptick dots + lower dots
    expect(svg).toContain('Z" fill='); // closed range fill
  });

  it('writes the metadata header text with every field', () => {
    expect(svg).toContain('GOOG');
    expect(svg).toContain('order-filled');
    expect(svg).toContain('2026-10-03T14:30:22Z');
    expect(svg).toContain('stock');
    expect(svg).toContain('ord123');
    expect(svg).toContain('daily');
  });

  it('omits the refId segment when absent', () => {
    const noRef = renderChartSvg(makeModel({ refId: undefined }));
    expect(noRef).not.toContain('ord123');
    expect(noRef).toContain('order-filled');
  });

  it('escapes XML-unsafe header text', () => {
    const evil = renderChartSvg(makeModel({ symbol: 'A<&"B', refId: 'x<y' }));
    expect(evil).toContain('A&lt;&amp;&quot;B');
    expect(evil).toContain('x&lt;y');
    expect(evil).not.toContain('A<&"B');
  });

  it('carries bar-grid metadata on the root element', () => {
    expect(svg).toContain('data-bar-count="30"');
    expect(svg).toContain('data-plot-x="4"');
    // Full precision — the client multiplies this by bar index for cropping.
    expect(svg).toContain('data-bar-width="24.53');
  });

  it('draws the event marker on the latest bar by default', () => {
    expect(svg).toContain('stroke="#ffb300"');
    expect(svg).toContain('x1="727.73"'); // 4 + 29.5 × (736/30) → n2
  });

  it('honors an explicit eventBarIndex', () => {
    const mid = renderChartSvg(makeModel({ eventBarIndex: 10 }));
    expect(mid).toContain('x1="261.6"'); // 4 + 10.5 × 24.5333
  });

  it('is deterministic — identical input yields identical output', () => {
    const a = renderChartSvg(makeModel());
    const b = renderChartSvg(makeModel());
    expect(a).toBe(b);
  });

  it('does not mutate the model (re-render produces identical output)', () => {
    const model = makeModel();
    renderChartSvg(model);
    expect(model.panes[0].series[0].kind).toBe('candle');
    expect(renderChartSvg(model)).toBe(svg);
  });
});

describe('renderChartSvg — scale + layout behavior', () => {
  it('renders differently under log vs linear scale (transform applied)', () => {
    const log = renderChartSvg(makeModel({ logScale: true }));
    const lin = renderChartSvg(makeModel({ logScale: false }));
    expect(log).not.toBe(lin);
  });

  it('emits no NaN for a flat linear price range', () => {
    const flat = makeBars(30).map((b) => ({ ...b, open: 100, high: 100, low: 100, close: 100 }));
    const svg = renderChartSvg(makeModel({
      logScale: false,
      bars: flat,
      panes: [{
        id: 'main',
        series: [{
          kind: 'candle',
          data: flat.map((b, i) => ({ x: i, open: b.open, high: b.high, low: b.low, close: b.close })),
          upColor: '#26a69a',
          downColor: '#ef5350',
        }],
      }],
    }));
    expect(svg).not.toContain('NaN');
    expect(svg).toContain('data-bar-count="30"');
  });

  it('splits a line series into separate paths at non-finite points (FE Gap parity)', () => {
    const svg = renderChartSvg(makeModel({
      panes: [{
        id: 'main',
        series: [{
          kind: 'line',
          data: [
            { x: 0, y: 100 }, { x: 1, y: 101 }, { x: 2, y: NaN },
            { x: 3, y: 103 }, { x: 4, y: 104 },
          ],
          color: '#3da5ff',
        }],
      }],
    }));
    const paths = svg.match(/<path d="M/g) ?? [];
    expect(paths.length).toBe(2); // [0,1] and [3,4] — the NaN breaks the line
  });

  it('renders a bars-only model (no panes configured still draws price)', () => {
    // The model requires explicit panes; a main-only model is the degenerate case.
    const svg = renderChartSvg(makeModel({
      panes: [{
        id: 'main',
        series: [{
          kind: 'candle',
          data: makeBars(30).map((b, i) => ({ x: i, open: b.open, high: b.high, low: b.low, close: b.close })),
          upColor: '#26a69a',
          downColor: '#ef5350',
        }],
      }],
    }));
    expect(svg).toContain('data-bar-count="30"');
    expect(svg.match(/<rect /g)?.length).toBe(32); // 30 bodies + bg + clip
  });

  it('clips every pane body to its plot rect', () => {
    const svg = renderChartSvg(makeModel());
    const clips = svg.match(/<clipPath id="clip-/g) ?? [];
    expect(clips.length).toBe(3); // main + lower-3 + lower-1
    const groups = svg.match(/<g clip-path="url\(#clip-/g) ?? [];
    expect(groups.length).toBe(3);
  });

  it('uses the brighter log-tick gridline only on the log-scale main pane', () => {
    const svg = renderChartSvg(makeModel({ logScale: true }));
    expect(svg).toContain('rgba(240,243,250,0.14)'); // logTickLine on main
    expect(svg).toContain('rgba(240,243,250,0.08)'); // gridLine on lower panes
  });
});

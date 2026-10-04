/**
 * Layout tests — pane-stack split, scale transforms, tick selection, and
 * bar-grid math. Parity targets: ChartDataAdapter.chartRows height split,
 * ChartYAxisViewportController 3% viewport pad. Scale/tick/format helpers
 * come from the shared `@flex-chart/scale-math` module — the same code the
 * FE runs.
 */
import {
  computeLayout,
  AXIS_GUTTER_WIDTH,
  HEADER_HEIGHT,
  MAIN_PANE_PERCENT,
  PLOT_LEFT,
  X_AXIS_HEIGHT,
} from '../../../functions/src/screenshot-capture/svg-layout';
import {
  formatPrice,
  fromLogAxis,
  nicePriceTicks,
  toLogAxis,
} from '@flex-chart/scale-math';
import type { ChartRenderModel } from '../../../functions/src/screenshot-capture/render-model';
import { CaptureEvent, ChartInterval, PositionType } from '@screenshot-capture/contracts';

function bars(n: number): ChartRenderModel['bars'] {
  return Array.from({ length: n }, (_, i) => ({
    date: `2026-10-${String(i + 1).padStart(2, '0')}`,
    open: 100, high: 110, low: 90, close: 105,
  }));
}

function model(overrides: Partial<ChartRenderModel>): ChartRenderModel {
  return {
    symbol: 'TEST',
    interval: ChartInterval.DAILY,
    event: CaptureEvent.MANUAL,
    positionType: PositionType.STOCK,
    timestampIso: '2026-10-03T00:00:00Z',
    width: 800,
    height: 560,
    logScale: true,
    bars: bars(30),
    panes: [{ id: 'main', series: [] }],
    ...overrides,
  };
}

describe('computeLayout — bar grid', () => {
  it('slots bars evenly across the plot width', () => {
    const l = computeLayout(model({}));
    expect(l.plotX).toBe(PLOT_LEFT);
    expect(l.plotRight).toBe(800 - AXIS_GUTTER_WIDTH);
    expect(l.slotWidth).toBeCloseTo((800 - PLOT_LEFT - AXIS_GUTTER_WIDTH) / 30, 5);
    expect(l.xCenter(0)).toBeCloseTo(PLOT_LEFT + l.slotWidth / 2, 5);
    expect(l.xCenter(29)).toBeCloseTo(l.plotRight - l.slotWidth / 2, 5);
  });

  it('emits ≤6 evenly spaced x ticks with FE date labels', () => {
    const l = computeLayout(model({}));
    expect(l.xTicks.length).toBeLessThanOrEqual(6);
    expect(l.xTicks.length).toBeGreaterThanOrEqual(4);
    expect(l.xTicks[0].label).toBe('Oct 1, 2026');
    expect(l.xTicks[0].index).toBe(0);
  });
});

describe('computeLayout — pane stack', () => {
  it('gives main the dominant share; actives split the remainder evenly', () => {
    const l = computeLayout(model({
      panes: [
        { id: 'main', series: [] },
        { id: 'lower-3', series: [{ kind: 'scatter', data: [{ x: 0, y: 1 }], color: '#fff', radius: 2 }] },
        { id: 'lower-2', series: [{ kind: 'scatter', data: [{ x: 0, y: 1 }], color: '#fff', radius: 2 }] },
        { id: 'lower-1', series: [{ kind: 'scatter', data: [{ x: 0, y: 1 }], color: '#fff', radius: 2 }] },
      ],
    }));
    const stack = 560 - HEADER_HEIGHT - X_AXIS_HEIGHT;
    // chartRows parity: floor(40/3)=13% each → main 61%.
    const main = l.panes[0];
    expect(main.pane.id).toBe('main');
    expect(main.rect.y).toBe(HEADER_HEIGHT);
    expect(main.rect.height).toBeCloseTo(stack * (1 - 3 * 0.13), 1);
    for (const pl of l.panes.slice(1)) {
      expect(pl.rect.height).toBeCloseTo(stack * 0.13, 1);
    }
    // Last pane ends at the bottom of the stack.
    const last = l.panes[l.panes.length - 1];
    expect(last.rect.y + last.rect.height).toBeCloseTo(560 - X_AXIS_HEIGHT, 1);
  });

  it('main-only layout takes the full stack', () => {
    const l = computeLayout(model({}));
    expect(l.panes[0].rect.height).toBeCloseTo(560 - HEADER_HEIGHT - X_AXIS_HEIGHT, 5);
  });

  it('renders panes in model order top→bottom (FE visual stack)', () => {
    const l = computeLayout(model({
      panes: [
        { id: 'main', series: [] },
        { id: 'lower-3', series: [{ kind: 'scatter', data: [{ x: 0, y: 1 }], color: '#fff', radius: 2 }] },
        { id: 'lower-1', series: [{ kind: 'scatter', data: [{ x: 0, y: 1 }], color: '#fff', radius: 2 }] },
      ],
    }));
    expect(l.panes.map((p) => p.pane.id)).toEqual(['main', 'lower-3', 'lower-1']);
    for (let i = 1; i < l.panes.length; i++) {
      expect(l.panes[i].rect.y).toBeGreaterThan(l.panes[i - 1].rect.y);
    }
  });

  it('main pane gets no inset; lower panes inset 8px (FE plotOffset parity)', () => {
    const l = computeLayout(model({
      panes: [
        { id: 'main', series: [] },
        { id: 'lower-1', series: [{ kind: 'scatter', data: [{ x: 0, y: 1 }], color: '#fff', radius: 2 }] },
      ],
    }));
    expect(l.panes[0].inner.y).toBe(l.panes[0].rect.y);
    expect(l.panes[1].inner.y).toBe(l.panes[1].rect.y + 8);
  });
});

describe('computeLayout — y scales', () => {
  it('main pane maps bar low/high into the inner rect with 3% pad (linear)', () => {
    const l = computeLayout(model({ logScale: false }));
    const main = l.panes[0];
    const pad = 20 * 0.03;
    const min = 90 - pad; // rawMin 90, rawMax 110
    const max = 110 + pad;
    expect(main.toY(max)).toBeCloseTo(main.inner.y, 3);
    expect(main.toY(min)).toBeCloseTo(main.inner.y + main.inner.height, 3);
    // Midpoint
    expect(main.toY((min + max) / 2)).toBeCloseTo(main.inner.y + main.inner.height / 2, 3);
  });

  it('flat linear range falls back to a ±1% band instead of NaN', () => {
    const flat = bars(30).map((b) => ({ ...b, high: 100, low: 100 }));
    const l = computeLayout(model({ logScale: false, bars: flat }));
    const main = l.panes[0];
    // rawMin === rawMax === 100 → ±1 pad
    expect(main.toY(101)).toBeCloseTo(main.inner.y, 3);
    expect(main.toY(99)).toBeCloseTo(main.inner.y + main.inner.height, 3);
    expect(Number.isFinite(main.toY(100))).toBe(true);
  });

  it('main pane applies log10 transform in log mode', () => {
    const l = computeLayout(model({ logScale: true }));
    const main = l.panes[0];
    const lo = toLogAxis(90);
    const hi = toLogAxis(110);
    const pad = (hi - lo) * 0.03;
    // Top of pane = highest log value.
    expect(main.toY(fromLogAxis(hi + pad))).toBeCloseTo(main.inner.y, 3);
    expect(main.toY(fromLogAxis(lo - pad))).toBeCloseTo(main.inner.y + main.inner.height, 3);
  });

  it('lower pane honors fixed axisMin/axisMax', () => {
    const l = computeLayout(model({
      panes: [
        { id: 'main', series: [] },
        { id: 'lower-1', axisMin: -50, axisMax: 50, series: [] },
      ],
    }));
    const low = l.panes[1];
    expect(low.toY(50)).toBeCloseTo(low.inner.y, 3);
    expect(low.toY(-50)).toBeCloseTo(low.inner.y + low.inner.height, 3);
    expect(low.toY(0)).toBeCloseTo(low.inner.y + low.inner.height / 2, 3);
  });

  it('lower pane auto-ranges over series values when unfixed', () => {
    const l = computeLayout(model({
      panes: [
        { id: 'main', series: [] },
        {
          id: 'lower-2',
          series: [{ kind: 'line', data: [{ x: 0, y: -2 }, { x: 1, y: 6 }], color: '#fff' }],
        },
      ],
    }));
    const low = l.panes[1];
    expect(low.toY(6)).toBeCloseTo(low.inner.y, 3);
    expect(low.toY(-2)).toBeCloseTo(low.inner.y + low.inner.height, 3);
  });

  it('non-finite series points do not collapse the pane auto-range', () => {
    const l = computeLayout(model({
      panes: [
        { id: 'main', series: [] },
        {
          id: 'lower-1',
          series: [{ kind: 'line', data: [{ x: 0, y: -2 }, { x: 1, y: NaN }, { x: 2, y: 6 }], color: '#fff' }],
        },
      ],
    }));
    const low = l.panes[1];
    expect(low.toY(6)).toBeCloseTo(low.inner.y, 3);
    expect(low.toY(-2)).toBeCloseTo(low.inner.y + low.inner.height, 3);
  });
});

describe('shared scale + format helpers (re-exported from @flex-chart/scale-math)', () => {
  it('nicePriceTicks stays within range and picks round values', () => {
    const ticks = nicePriceTicks(90, 110);
    expect(ticks.length).toBeGreaterThan(0);
    for (const t of ticks) {
      expect(t).toBeGreaterThanOrEqual(90);
      expect(t).toBeLessThanOrEqual(110);
      expect(t % 1).toBe(0); // round-dollar ticks for a ~$20 range
    }
  });

  it('nicePriceTicks uses a decade grid across multi-decade ranges', () => {
    const ticks = nicePriceTicks(1, 1000);
    expect(ticks).toContain(1);
    expect(ticks).toContain(10);
    expect(ticks).toContain(100);
    expect(ticks).toContain(1000);
  });

  it('formatPrice follows the FE convention', () => {
    expect(formatPrice(1234)).toBe('$1,234');
    // toLocaleString caps at 3 fraction digits, so sub-dollar prices round.
    expect(formatPrice(0.123456)).toBe('$0.124');
    expect(formatPrice(0.5)).toBe('$0.5');
  });

  it('toLogAxis floors non-positive prices', () => {
    expect(toLogAxis(0)).toBe(toLogAxis(0.001));
    expect(toLogAxis(-5)).toBe(toLogAxis(0.001));
  });
});

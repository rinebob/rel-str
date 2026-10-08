import { ST_ANCHORED_VWAP_INDICATOR, computeAnchoredVwapSeries } from './st-anchored-vwap.indicator';
import type { AnchoredVwapLineSeries } from './st-anchored-vwap.indicator';
import { computeAnchoredVwap } from './st-anchored-vwap.engine';
import type { AnchoredVwapConfig, AnchoredVwapSegment } from './st-anchored-vwap.types';
import { StIndicator } from '../flex-chart.types';
import type { PriceBar } from '../flex-chart.types';

// =============================================================================
// Test helpers
// =============================================================================

/** Bars whose typical price equals the close: high = c+1, low = c-1. */
function barsFromCloses(closes: number[]): PriceBar[] {
  return closes.map((c, i) => ({
    date: `d${i}`,
    x: new Date(2026, 0, 1 + i),
    open: c,
    high: c + 1,
    low: c - 1,
    close: c,
    volume: 1000,
  }));
}

/** Six straight legs, 31 bars: with depth 2/2 the pivots are high@5, low@10, high@15, low@20, high@25. */
const CLOSES = [
  100, 104, 108, 112, 116, 120,
  116, 112, 108, 104, 100,
  106, 112, 118, 124, 130,
  126, 122, 118, 114, 110,
  116, 122, 128, 134, 140,
  136, 132, 128, 124, 120,
];

/** Deterministic pseudo-random walk (LCG) with random volume including zero-volume bars. */
function makeWalk(seed: number, n: number): PriceBar[] {
  let s = seed;
  const rnd = () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
  const bars: PriceBar[] = [];
  let close = 100;
  for (let i = 0; i < n; i++) {
    const open = close;
    close = open * (1 + (rnd() - 0.5) * 0.06);
    bars.push({
      date: `d${i}`,
      x: new Date(2026, 0, 1 + i),
      open,
      high: Math.max(open, close) * (1 + rnd() * 0.01),
      low: Math.min(open, close) * (1 - rnd() * 0.01),
      close,
      volume: rnd() < 0.1 ? 0 : Math.floor(rnd() * 5000),
    });
  }
  return bars;
}

const PARAMS = {
  smallRetracementPct: 5,
  largeRetracementPct: 25,
  leftDepth: 2,
  rightDepth: 2,
  maxHistory: 100,
};

const EXPECTED_KEYS = (['small', 'large'] as const).flatMap((scale) =>
  (['high', 'low'] as const).flatMap((side) =>
    ['history-a', 'history-b', 'active'].map((kind) => `${scale}-${side}-${kind}`),
  ),
);

const byKey = (series: AnchoredVwapLineSeries[], key: string): AnchoredVwapLineSeries =>
  series.find((s) => s.key === key)!;

/** Split a series' data at its null break points into the segments it packs. */
function chunks(series: AnchoredVwapLineSeries): { index: number; y: number }[][] {
  const out: { index: number; y: number }[][] = [[]];
  for (const p of series.data) {
    if (p.y === null) out.push([]);
    else out[out.length - 1].push({ index: p.index, y: p.y });
  }
  return out.filter((c) => c.length > 0);
}

// =============================================================================
// Definition
// =============================================================================

describe('ST_ANCHORED_VWAP_INDICATOR', () => {
  it('has the expected identity and renders on the price overlay', () => {
    expect(ST_ANCHORED_VWAP_INDICATOR.id).toBe('st-anchored-vwap');
    expect(ST_ANCHORED_VWAP_INDICATOR.type).toBe(StIndicator.ST_ANCHORED_VWAP);
    expect(ST_ANCHORED_VWAP_INDICATOR.label).toBe('ST Anchored VWAP');
    expect(ST_ANCHORED_VWAP_INDICATOR.defaultPane).toBe('overlay');
    expect(ST_ANCHORED_VWAP_INDICATOR.axisScale).toBe('price');
  });

  it('declares every param with its default', () => {
    const defaults = Object.fromEntries(ST_ANCHORED_VWAP_INDICATOR.params.map((p) => [p.key, p.default]));
    expect(defaults).toEqual({
      smallRetracementPct: 2,
      largeRetracementPct: 5,
      leftDepth: 5,
      rightDepth: 5,
      smallHighColor: '#FF8CFF',
      smallLowColor: '#8CF5FF',
      largeHighColor: '#FF00E6',
      largeLowColor: '#00E5FF',
      maxHistory: 100,
    });
  });
});

// =============================================================================
// Fixed-slot series
// =============================================================================

describe('computeAnchoredVwapSeries — fixed slots', () => {
  it.each([
    ['empty bars', [] as PriceBar[]],
    ['a flat series with no pivots', barsFromCloses(Array.from({ length: 30 }, () => 100))],
    ['the hand-built fixture', barsFromCloses(CLOSES)],
    ['a random walk', makeWalk(7, 300)],
  ])('always returns the same 12 keys in the same order — %s', (_label, bars) => {
    expect(computeAnchoredVwapSeries(bars, PARAMS).map((s) => s.key)).toEqual(EXPECTED_KEYS);
  });

  it('orders each slot history first and active last, and the large scale after the small, so the live and large lines draw on top', () => {
    expect(EXPECTED_KEYS.slice(0, 3)).toEqual(['small-high-history-a', 'small-high-history-b', 'small-high-active']);
    expect(EXPECTED_KEYS.indexOf('large-high-history-a')).toBeGreaterThan(EXPECTED_KEYS.indexOf('small-low-active'));
  });

  it('draws the live line in the active series and the older segments in history, alternating', () => {
    const series = computeAnchoredVwapSeries(barsFromCloses(CLOSES), PARAMS);
    // small-high: terminated [7..17], [17..27] then active [27..30]
    expect(byKey(series, 'small-high-history-a').data.map((p) => p.index)).toEqual(
      Array.from({ length: 11 }, (_, i) => 7 + i),
    );
    expect(byKey(series, 'small-high-history-b').data.map((p) => p.index)).toEqual(
      Array.from({ length: 11 }, (_, i) => 17 + i),
    );
    expect(byKey(series, 'small-high-active').data.map((p) => p.index)).toEqual([27, 28, 29, 30]);
  });

  it('leaves the history and active series of a side with no anchors empty', () => {
    const series = computeAnchoredVwapSeries(barsFromCloses(CLOSES), PARAMS);
    for (const kind of ['history-a', 'history-b', 'active']) {
      expect(byKey(series, `large-low-${kind}`).data).toEqual([]);
    }
  });

  it('carries the engine’s values: every packed chunk equals a segment’s points', () => {
    const bars = barsFromCloses(CLOSES);
    const segments = computeAnchoredVwap(bars, { ...PARAMS, historyStart: undefined });
    const series = computeAnchoredVwapSeries(bars, PARAMS);
    const seg = (scale: string, side: string, pivotBar: number): AnchoredVwapSegment =>
      segments.find((s) => s.scale === scale && s.side === side && s.pivotBar === pivotBar)!;
    expect(chunks(byKey(series, 'small-high-history-a'))[0]).toEqual(seg('small', 'high', 5).points);
    expect(chunks(byKey(series, 'small-high-history-b'))[0]).toEqual(seg('small', 'high', 15).points);
    expect(byKey(series, 'small-high-active').data).toEqual(seg('small', 'high', 25).points);
  });
});

describe('computeAnchoredVwapSeries — packing on varied series', () => {
  const config: AnchoredVwapConfig = { ...PARAMS, historyStart: undefined };
  for (const seed of [1, 3, 4]) {
    describe(`random walk, seed ${seed}`, () => {
      const bars = makeWalk(seed, 320);
      const series = computeAnchoredVwapSeries(bars, PARAMS);
      const segments = computeAnchoredVwap(bars, config);

      it('never puts two points at one index, and indices strictly increase within a series', () => {
        for (const s of series) {
          const idx = s.data.map((p) => p.index);
          expect(idx).toEqual([...idx].sort((a, b) => a - b));
          expect(new Set(idx).size).toBe(idx.length);
        }
      });

      it('separates packed segments with exactly one null break, never leading or trailing', () => {
        for (const s of series) {
          const ys = s.data.map((p) => p.y);
          if (ys.length === 0) continue;
          expect(ys[0]).not.toBeNull();
          expect(ys[ys.length - 1]).not.toBeNull();
          for (let i = 1; i < ys.length; i++) expect(ys[i] === null && ys[i - 1] === null).toBe(false);
        }
      });

      it('packs the terminated segments of each slot alternately into history-a and history-b, and the live one into active', () => {
        for (const scale of ['small', 'large'] as const) {
          for (const side of ['high', 'low'] as const) {
            const slot = segments.filter((s) => s.scale === scale && s.side === side).sort((a, b) => a.startBar - b.startBar);
            const terminated = slot.filter((s) => !s.active);
            const a = chunks(byKey(series, `${scale}-${side}-history-a`));
            const b = chunks(byKey(series, `${scale}-${side}-history-b`));
            expect(a).toEqual(terminated.filter((_, k) => k % 2 === 0).map((s) => s.points));
            expect(b).toEqual(terminated.filter((_, k) => k % 2 === 1).map((s) => s.points));
            const live = slot.find((s) => s.active);
            expect(byKey(series, `${scale}-${side}-active`).data).toEqual(live ? live.points : []);
          }
        }
      });
    });
  }

  it('honours maxHistory per scale across both sides', () => {
    const bars = makeWalk(1, 320);
    const series = computeAnchoredVwapSeries(bars, { ...PARAMS, maxHistory: 3 });
    for (const scale of ['small', 'large']) {
      const total = series
        .filter((s) => s.key.startsWith(scale) && s.key.includes('history'))
        .reduce((n, s) => n + chunks(s).length, 0);
      expect(total).toBeLessThanOrEqual(3);
      expect(total).toBeGreaterThan(0);
    }
  });
});

// =============================================================================
// Styling and params
// =============================================================================

describe('computeAnchoredVwapSeries — styling', () => {
  const series = computeAnchoredVwapSeries(barsFromCloses(CLOSES), PARAMS);

  it('draws the large scale thicker than the small scale', () => {
    expect(byKey(series, 'large-high-active').width).toBeGreaterThan(byKey(series, 'small-high-active').width);
    expect(byKey(series, 'large-low-active').width).toBeGreaterThan(byKey(series, 'small-low-active').width);
  });

  it('keeps the width and colour of history identical to the active line — no fading', () => {
    for (const slot of ['small-high', 'small-low', 'large-high', 'large-low']) {
      const active = byKey(series, `${slot}-active`);
      for (const kind of ['history-a', 'history-b']) {
        const h = byKey(series, `${slot}-${kind}`);
        expect(h.color).toBe(active.color);
        expect(h.width).toBe(active.width);
        expect(h.name).toBe(active.name);
      }
    }
  });

  it('uses the default colours, hue encoding the side', () => {
    expect(byKey(series, 'small-high-active').color).toBe('#FF8CFF');
    expect(byKey(series, 'small-low-active').color).toBe('#8CF5FF');
    expect(byKey(series, 'large-high-active').color).toBe('#FF00E6');
    expect(byKey(series, 'large-low-active').color).toBe('#00E5FF');
  });

  it('applies colour params', () => {
    const custom = computeAnchoredVwapSeries(barsFromCloses(CLOSES), { ...PARAMS, smallHighColor: '#123456' });
    expect(byKey(custom, 'small-high-active').color).toBe('#123456');
    expect(byKey(custom, 'small-low-active').color).toBe('#8CF5FF');
  });

  it('names lines by side and retracement percentage', () => {
    expect(byKey(series, 'small-high-active').name).toBe('AVWAP-H 5%');
    expect(byKey(series, 'small-low-active').name).toBe('AVWAP-L 5%');
    expect(byKey(series, 'large-high-active').name).toBe('AVWAP-H 25%');
    expect(byKey(series, 'large-low-active').name).toBe('AVWAP-L 25%');
  });
});

describe('computeAnchoredVwapSeries — params', () => {
  it('uses the declared defaults when no params are supplied', () => {
    const series = computeAnchoredVwapSeries(makeWalk(2, 300), {});
    expect(series.map((s) => s.key)).toEqual(EXPECTED_KEYS);
    expect(byKey(series, 'small-high-active').name).toBe('AVWAP-H 2%');
    expect(byKey(series, 'large-high-active').name).toBe('AVWAP-H 5%');
  });

  it('falls back to defaults for non-numeric params and clamps out-of-range ones', () => {
    const series = computeAnchoredVwapSeries(makeWalk(2, 300), {
      smallRetracementPct: 'abc',
      largeRetracementPct: Number.NaN,
      leftDepth: 0,
      rightDepth: -3,
      maxHistory: -5,
    });
    expect(series.map((s) => s.key)).toEqual(EXPECTED_KEYS);
    expect(byKey(series, 'small-high-active').name).toBe('AVWAP-H 2%');
    // maxHistory clamps to 0: no history anywhere, active lines still draw.
    expect(series.filter((s) => s.key.includes('history')).every((s) => s.data.length === 0)).toBe(true);
    expect(series.some((s) => s.key.endsWith('active') && s.data.length > 0)).toBe(true);
  });

  it('ignores non-string colour params', () => {
    const series = computeAnchoredVwapSeries(barsFromCloses(CLOSES), { ...PARAMS, smallHighColor: 7 });
    expect(byKey(series, 'small-high-active').color).toBe('#FF8CFF');
  });
});

import * as engine from './st-zigzag.engine';
import { computeZigZagAnchorEvents, computeZigZagPivots } from './st-zigzag.pivots';
import type { AnchorEvent, ZigZagConfig } from './st-zigzag.types';
import type { PriceBar } from '../flex-chart.types';

// =============================================================================
// Test helpers
// =============================================================================

type P = { o: number; h: number; l: number; c: number; v?: number };

function makeBars(prices: P[]): PriceBar[] {
  return prices.map((p, i) => ({
    date: `2026-01-${String(i + 1).padStart(2, '0')}`,
    x: new Date(2026, 0, i + 1),
    open: p.o,
    high: p.h,
    low: p.l,
    close: p.c,
    volume: p.v,
  }));
}

function makeSinglePeakBars(): PriceBar[] {
  const highs = [11, 12, 13, 14, 15, 16, 17, 18, 17, 16, 15, 14, 13, 12, 11];
  const lows  = [ 9, 10, 11, 12, 13, 14, 15, 16, 15, 14, 13, 12, 11, 10,  9];
  return makeBars(highs.map((h, i) => ({ o: h - 1, h, l: lows[i], c: h - 1, v: 1000 })));
}

/** Deterministic pseudo-random walk (LCG) — varied swings without a fixture file. */
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
    const high = Math.max(open, close) * (1 + rnd() * 0.01);
    const low = Math.min(open, close) * (1 - rnd() * 0.01);
    bars.push({ date: `d${i}`, x: new Date(2026, 0, 1 + i), open, high, low, close, volume: 1000 });
  }
  return bars;
}

const TEST_CONFIG: ZigZagConfig = {
  devThreshold: 5.0,
  leftDepth: 2,
  rightDepth: 2,
  allowZigZagOnOneBar: true,
  projectionPivots: false,
  lineColor: '#1976d2',
};

const sig = (p: { barIndex: number; isHigh: boolean; price: number }): string =>
  `${p.barIndex}${p.isHigh ? 'H' : 'L'}@${p.price.toFixed(2)}`;

const eventSig = (e: AnchorEvent): string => sig({ barIndex: e.pivotBar, isHigh: e.isHigh, price: e.price });

// =============================================================================
// computeZigZagPivots — frozen output (guards the walk refactor)
//
// The goldens below were captured from computeZigZagPivots BEFORE the shared
// walk was extracted. They are a characterization net: any change to the
// surviving-pivot output (including projection) fails here.
// =============================================================================

const GOLDEN: { name: string; seed: number; n: number; config: ZigZagConfig; pivots: string; projection: string }[] = [
  {
    name: 'A: dev 3, depth 3/3, one-bar, no projection',
    seed: 1, n: 400,
    config: { ...TEST_CONFIG, devThreshold: 3, leftDepth: 3, rightDepth: 3, projectionPivots: false },
    pivots: '6H@107.36 9L@100.44 13H@109.00 22L@98.90 33H@108.20 37L@98.93 44H@105.36 56L@93.74 65H@104.29 68L@100.65 74H@112.21 76L@104.69 84H@115.57 91L@109.62 109H@127.10 111L@118.50 123H@131.76 139L@110.68 154H@131.67 161L@124.40 177H@146.88 181L@138.06 185H@148.67 189L@138.89 192H@144.72 195L@135.31 199H@140.16 204L@128.14 215H@145.47 225L@135.12 228H@141.84 234L@131.04 243H@138.69 250L@125.15 257H@136.93 266L@123.59 273H@133.09 284L@111.28 287H@114.66 289L@109.06 293H@118.94 296L@114.68 297H@119.69 306L@111.69 313H@124.35 326L@107.97 332H@113.27 333L@108.97 339H@113.76 342L@103.94 346H@111.53 352L@106.37 360H@114.81 364L@109.61 367H@116.10 375L@105.18 378H@108.60 381L@103.13 385H@111.03 392L@100.07 396H@105.15',
    projection: 'none',
  },
  {
    name: 'B: dev 5, depth 5/5, one-bar, projection on',
    seed: 2, n: 400,
    config: { ...TEST_CONFIG, devThreshold: 5, leftDepth: 5, rightDepth: 5, projectionPivots: true },
    pivots: '7H@103.99 13L@98.22 24H@110.10 26L@103.03 44H@111.31 47L@104.30 52H@111.57 55L@105.52 60H@111.74 73L@99.45 79H@108.95 96L@90.86 133H@130.20 139L@121.62 148H@130.21 182L@110.14 195H@123.59 203L@113.18 209H@124.08 211L@116.39 224H@128.60 229L@115.06 235H@121.73 246L@111.21 258H@123.07 260L@114.04 278H@125.33 281L@118.61 311H@144.39 316L@129.38 331H@146.05 336L@134.63 344H@149.86 349L@138.34 368H@163.60 381L@133.08 385H@146.42',
    projection: 'none',
  },
  {
    name: 'C: dev 2, depth 2/4, one-bar off, projection on',
    seed: 3, n: 400,
    config: { ...TEST_CONFIG, devThreshold: 2, leftDepth: 2, rightDepth: 4, allowZigZagOnOneBar: false, projectionPivots: true },
    pivots: '6H@105.57 25L@85.53 29H@91.26 31L@84.67 35H@89.85 43L@85.19 47H@92.77 54L@83.43 55H@88.35 59L@85.06 67H@95.58 71L@87.86 78H@95.60 84L@88.97 86H@95.70 89L@90.20 92H@95.17 97L@92.22 102H@97.73 123L@74.30 134H@80.73 136L@75.96 148H@86.82 151L@84.03 168H@100.37 189L@86.09 194H@90.87 203L@79.34 210H@82.61 224L@73.79 227H@76.97 233L@71.58 250H@84.05 263L@74.27 265H@79.65 272L@71.76 275H@76.17 281L@71.39 286H@75.77 291L@70.36 310H@82.46 313L@77.76 323H@81.05 325L@75.76 328H@82.33 332L@75.46 337H@80.11 350L@68.43 353H@72.81 355L@68.13 373H@77.13 375L@73.07 378H@76.02 382L@71.79 390H@80.71',
    projection: '399L@73.26',
  },
  {
    name: 'D: dev 8, depth 4/2, one-bar, no projection',
    seed: 4, n: 300,
    config: { ...TEST_CONFIG, devThreshold: 8, leftDepth: 4, rightDepth: 2, projectionPivots: false },
    pivots: '11H@105.79 23L@96.39 41H@112.43 67L@100.70 109H@137.88 119L@124.64 133H@139.48 154L@111.38 175H@130.77 182L@119.62 191H@134.75 205L@120.82 221H@141.99 235L@123.62 276H@155.87 283L@142.03',
    projection: 'none',
  },
];

describe('computeZigZagPivots — surviving output unchanged by the shared walk', () => {
  for (const g of GOLDEN) {
    it(`matches the pre-refactor output — ${g.name}`, () => {
      const result = computeZigZagPivots(makeWalk(g.seed, g.n), g.config);
      expect(result.pivots.map(sig).join(' ')).toBe(g.pivots);
      expect(result.projection ? sig(result.projection) : 'none').toBe(g.projection);
    });
  }
});

// =============================================================================
// computeZigZagAnchorEvents
// =============================================================================

describe('computeZigZagAnchorEvents', () => {
  it('returns no events for empty bars, a single bar, or too few bars to confirm', () => {
    expect(computeZigZagAnchorEvents([], TEST_CONFIG)).toEqual([]);
    expect(computeZigZagAnchorEvents(makeBars([{ o: 100, h: 101, l: 99, c: 100, v: 1000 }]), TEST_CONFIG)).toEqual([]);
    expect(computeZigZagAnchorEvents(makeSinglePeakBars().slice(0, 3), TEST_CONFIG)).toEqual([]);
  });

  it('a single peak yields one new event confirmed rightDepth bars after the pivot bar', () => {
    const bars = makeSinglePeakBars();
    const events = computeZigZagAnchorEvents(bars, TEST_CONFIG);
    // Peak is bar 7 (high 18); rightDepth 2 → knowable on bar 9.
    expect(events).toEqual<AnchorEvent[]>([
      { confirmBar: 9, pivotBar: 7, time: bars[7].x.getTime(), price: 18, isHigh: true, replaced: false },
    ]);
  });

  it('confirmBar follows rightDepth, including asymmetric depths', () => {
    const events = computeZigZagAnchorEvents(makeSinglePeakBars(), { ...TEST_CONFIG, leftDepth: 2, rightDepth: 4 });
    expect(events).toHaveLength(1);
    expect(events[0].pivotBar).toBe(7);
    expect(events[0].confirmBar).toBe(11);
  });

  it('clamps rightDepth below 2 to 2 for the confirmation bar', () => {
    const events = computeZigZagAnchorEvents(makeSinglePeakBars(), { ...TEST_CONFIG, leftDepth: 1, rightDepth: 1 });
    expect(events).toHaveLength(1);
    expect(events[0].confirmBar).toBe(9);
  });

  it('a more extreme same-side pivot is a replaced event; the replaced anchor stays in the events but not in the surviving pivots', () => {
    // Same fixture as the ZigZag "extends the last pivot" spec: a high at bar 4,
    // a shallow dip (below the 50% threshold), then a higher high at bar 9.
    const prices: P[] = [];
    for (let i = 0; i < 5; i++) prices.push({ o: 100 + i * 10, h: 105 + i * 10, l: 95 + i * 10, c: 100 + i * 10, v: 1000 });
    prices.push({ o: 135, h: 140, l: 130, c: 132, v: 1000 });
    for (let i = 0; i < 4; i++) prices.push({ o: 132 + i * 10, h: 137 + i * 10, l: 127 + i * 10, c: 132 + i * 10, v: 1000 });
    prices.push({ o: 160, h: 165, l: 155, c: 158, v: 1000 });
    prices.push({ o: 155, h: 160, l: 150, c: 153, v: 1000 });
    const bars = makeBars(prices);
    const config = { ...TEST_CONFIG, devThreshold: 50 };

    const events = computeZigZagAnchorEvents(bars, config);
    expect(events.map((e) => ({ p: e.pivotBar, c: e.confirmBar, price: e.price, r: e.replaced }))).toEqual([
      { p: 4, c: 6, price: 145, r: false },
      { p: 9, c: 11, price: 167, r: true },
    ]);
    // Survivors keep only the replacement — the replaced anchor is what the events add.
    expect(computeZigZagPivots(bars, config).pivots.map((p) => p.barIndex)).toEqual([9]);
  });

  it('an alternating high then low yields two non-replaced events in confirmation order', () => {
    const prices: P[] = [];
    for (let i = 0; i < 5; i++) prices.push({ o: i + 1, h: i + 2, l: i, c: i + 1, v: 1000 });
    for (let i = 0; i < 5; i++) prices.push({ o: 5 - i, h: 6 - i, l: 4 - i, c: 5 - i, v: 1000 });
    for (let i = 0; i < 5; i++) prices.push({ o: i + 1, h: i + 2, l: i, c: i + 1, v: 1000 });
    for (let i = 0; i < 5; i++) prices.push({ o: 5 - i, h: 6 - i, l: 4 - i, c: 5 - i, v: 1000 });
    const events = computeZigZagAnchorEvents(makeBars(prices), { ...TEST_CONFIG, devThreshold: 10 });
    expect(events.map((e) => [e.pivotBar, e.confirmBar, e.isHigh, e.replaced])).toEqual([
      [4, 6, true, false],
      [9, 11, false, false],
    ]);
  });

  it('a same-side pivot that is not more extreme is rejected and emits nothing', () => {
    // High at bar 4 (145), a fall, then a lower high at bar 9 (139) with no
    // reversal beyond the 50% threshold in between — bar 9 must not anchor.
    const highs = [105, 115, 125, 135, 145, 140, 135, 130, 135, 139, 136, 133];
    const bars = makeBars(highs.map((h) => ({ o: h - 5, h, l: h - 10, c: h - 5, v: 1000 })));
    const events = computeZigZagAnchorEvents(bars, { ...TEST_CONFIG, devThreshold: 50 });
    expect(events.map((e) => [e.pivotBar, e.isHigh, e.replaced])).toEqual([[4, true, false]]);
  });

  it('is exported from the engine barrel alongside computeZigZagPivots', () => {
    expect(engine.computeZigZagAnchorEvents).toBe(computeZigZagAnchorEvents);
  });

  it('emits nothing for moves below devThreshold', () => {
    const flat: P = { o: 100, h: 101, l: 99, c: 100, v: 1000 };
    const bars = makeBars(Array.from({ length: 20 }, () => flat));
    expect(computeZigZagAnchorEvents(bars, { ...TEST_CONFIG, devThreshold: 50 })).toEqual([]);
  });

  it('emits nothing for all-NaN prices', () => {
    const nan: P = { o: NaN, h: NaN, l: NaN, c: NaN, v: 1000 };
    expect(computeZigZagAnchorEvents(makeBars(Array.from({ length: 20 }, () => nan)), TEST_CONFIG)).toEqual([]);
  });

  describe('allowZigZagOnOneBar', () => {
    const flat: P = { o: 100, h: 101, l: 99, c: 100, v: 1000 };
    const spike: P = { o: 100, h: 200, l: 50, c: 100, v: 1000 };
    const bars = makeBars([flat, flat, flat, flat, flat, spike, flat, flat, flat, flat, flat]);

    it('true: a high and a low on one bar are two events sharing a confirmation bar', () => {
      const events = computeZigZagAnchorEvents(bars, { ...TEST_CONFIG, allowZigZagOnOneBar: true });
      const onSpike = events.filter((e) => e.pivotBar === 5);
      expect(onSpike).toHaveLength(2);
      expect(onSpike.every((e) => e.confirmBar === 7)).toBe(true);
      expect(onSpike.some((e) => e.isHigh)).toBe(true);
      expect(onSpike.some((e) => !e.isHigh)).toBe(true);
    });

    it('false: only one event on the spike bar', () => {
      const events = computeZigZagAnchorEvents(bars, { ...TEST_CONFIG, allowZigZagOnOneBar: false });
      expect(events.filter((e) => e.pivotBar === 5)).toHaveLength(1);
    });
  });

  it('projected pivots never produce events — projectionPivots has no effect', () => {
    const bars = makeWalk(3, 400);
    const config = { ...TEST_CONFIG, devThreshold: 2, leftDepth: 2, rightDepth: 4 };
    const off = computeZigZagAnchorEvents(bars, { ...config, projectionPivots: false });
    const on = computeZigZagAnchorEvents(bars, { ...config, projectionPivots: true });
    expect(on).toEqual(off);
  });

  describe('invariants on varied series', () => {
    for (const g of GOLDEN) {
      describe(g.name, () => {
        const bars = makeWalk(g.seed, g.n);
        const rightDepth = Math.max(2, g.config.rightDepth);
        const events = computeZigZagAnchorEvents(bars, g.config);

        it('every event is knowable on a real bar, exactly rightDepth after its pivot', () => {
          expect(events.length).toBeGreaterThan(0);
          for (const e of events) {
            expect(e.confirmBar).toBe(e.pivotBar + rightDepth);
            expect(e.confirmBar).toBeLessThan(bars.length);
          }
        });

        it('events arrive in non-decreasing confirmation order', () => {
          for (let i = 1; i < events.length; i++) {
            expect(events[i].confirmBar).toBeGreaterThanOrEqual(events[i - 1].confirmBar);
          }
        });

        it('replaying the events (a replaced event removes its predecessor) reproduces the surviving pivots', () => {
          const replay: AnchorEvent[] = [];
          for (const e of events) {
            if (e.replaced) replay.pop();
            replay.push(e);
          }
          const survivors = computeZigZagPivots(bars, g.config).pivots;
          expect(replay.map(eventSig).join(' ')).toBe(survivors.map(sig).join(' '));
        });
      });
    }

    it('replacement is exercised: at least one varied series contains a replaced event', () => {
      const replaced = GOLDEN.flatMap((g) => computeZigZagAnchorEvents(makeWalk(g.seed, g.n), g.config)).filter((e) => e.replaced);
      expect(replaced.length).toBeGreaterThan(0);
    });
  });
});

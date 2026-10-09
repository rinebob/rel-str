import { computeAnchoredVwap } from './st-anchored-vwap.engine';
import type { AnchoredVwapConfig, AnchoredVwapSegment } from './st-anchored-vwap.types';
import type { PriceBar } from '../flex-chart.types';

// =============================================================================
// Test helpers
// =============================================================================

type Row = { o: number; h: number; l: number; c: number; v?: number };

/** Local-midnight Date → its ISO 'YYYY-MM-DD' — matches `PriceBar.date`. */
const isoOf = (d: Date): string =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

function makeBars(rows: Row[]): PriceBar[] {
  return rows.map((r, i) => {
    const x = new Date(2026, 0, 1 + i);
    return {
      // The history window compares `date`, not `x` — keep them consistent so
      // fixtures model the production pair (x is a PT-midnight instant there).
      date: isoOf(x),
      x,
      open: r.o,
      high: r.h,
      low: r.l,
      close: r.c,
      volume: r.v,
    };
  });
}

/** Bars whose typical price (H+L+C)/3 equals the close: high = c+1, low = c-1. */
function barsFromCloses(closes: number[], volume: (i: number) => number | undefined = () => 1000): PriceBar[] {
  return makeBars(closes.map((c, i) => ({ o: c, h: c + 1, l: c - 1, c, v: volume(i) })));
}

/**
 * Six straight legs, 31 bars. With depth 2/2 the swing pivots are, by
 * construction: high bar 5 (121), low bar 10 (99), high bar 15 (131),
 * low bar 20 (109), high bar 25 (141). Each is confirmed 2 bars later.
 */
const CLOSES = [
  100, 104, 108, 112, 116, 120,
  116, 112, 108, 104, 100,
  106, 112, 118, 124, 130,
  126, 122, 118, 114, 110,
  116, 122, 128, 134, 140,
  136, 132, 128, 124, 120,
];

const CONFIG: AnchoredVwapConfig = {
  smallRetracementPct: 5,
  largeRetracementPct: 25,
  leftDepth: 2,
  rightDepth: 2,
  maxHistory: 100,
};

const pick = (
  segs: AnchoredVwapSegment[],
  scale: AnchoredVwapSegment['scale'],
  side: AnchoredVwapSegment['side'],
): AnchoredVwapSegment[] => segs.filter((s) => s.scale === scale && s.side === side);

// =============================================================================
// Lines and handoffs
// =============================================================================

describe('computeAnchoredVwap — lines and handoffs', () => {
  const bars = barsFromCloses(CLOSES);
  const segs = computeAnchoredVwap(bars, CONFIG);

  it('returns nothing for empty bars, too few bars to confirm a pivot, or a flat series', () => {
    expect(computeAnchoredVwap([], CONFIG)).toEqual([]);
    expect(computeAnchoredVwap(barsFromCloses(CLOSES.slice(0, 4)), CONFIG)).toEqual([]);
    expect(computeAnchoredVwap(barsFromCloses(Array.from({ length: 30 }, () => 100)), CONFIG)).toEqual([]);
  });

  it('draws each anchor from its confirmation bar, never back to the pivot bar', () => {
    const small = pick(segs, 'small', 'high');
    expect(small.map((s) => [s.pivotBar, s.startBar])).toEqual([[5, 7], [15, 17], [25, 27]]);
    for (const s of segs) expect(s.points[0].index).toBe(s.startBar);
  });

  it('draws one point per bar from start to end, inclusive and contiguous', () => {
    for (const s of segs) {
      expect(s.points.map((p) => p.index)).toEqual(
        Array.from({ length: s.endBar - s.startBar + 1 }, (_, k) => s.startBar + k),
      );
    }
  });

  it('runs a terminated line through the next same-side anchor’s confirmation bar, where the new line starts', () => {
    const high = pick(segs, 'small', 'high');
    expect(high.map((s) => [s.startBar, s.endBar, s.active])).toEqual([
      [7, 17, false],
      [17, 27, false],
      [27, 30, true],
    ]);
    const low = pick(segs, 'small', 'low');
    expect(low.map((s) => [s.pivotBar, s.startBar, s.endBar, s.active])).toEqual([
      [10, 12, 22, false],
      [20, 22, 30, true],
    ]);
  });

  it('first drawn value is the VWAP of the pivot bar through the confirmation bar', () => {
    // Bars 5..7 close 120, 116, 112 (typical = close), equal volume → mean 116.
    expect(pick(segs, 'small', 'high')[0].points[0].y).toBeCloseTo(116, 10);
  });

  it('keeps a replaced same-side anchor as a drawn line ending at its replacement’s confirmation bar', () => {
    // At 25% neither dip qualifies as a reversal, so each higher high REPLACES
    // the previous high anchor — the replaced anchors were still the live line.
    const large = computeAnchoredVwap(bars, CONFIG).filter((s) => s.scale === 'large');
    expect(pick(large, 'large', 'low')).toEqual([]);
    expect(pick(large, 'large', 'high').map((s) => [s.pivotBar, s.startBar, s.endBar, s.active])).toEqual([
      [5, 7, 17, false],
      [15, 17, 27, false],
      [25, 27, 30, true],
    ]);
  });

  it('a pivot that qualifies only at the small scale appears only in the small set', () => {
    expect(pick(segs, 'small', 'low').length).toBeGreaterThan(0);
    expect(pick(segs, 'large', 'low')).toEqual([]);
  });

  it('a pivot confirmed on the final bar draws an active line of exactly one point', () => {
    // Bars 0..27: the third high (pivot bar 25) is knowable on bar 27, the last bar.
    const truncated = computeAnchoredVwap(barsFromCloses(CLOSES.slice(0, 28)), CONFIG);
    const last = pick(truncated, 'small', 'high').at(-1)!;
    expect([last.pivotBar, last.startBar, last.endBar, last.active]).toEqual([25, 27, 27, true]);
    expect(last.points).toHaveLength(1);
  });

  it('gives every segment a unique, stable key', () => {
    const keys = segs.map((s) => s.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(computeAnchoredVwap(bars, CONFIG).map((s) => s.key)).toEqual(keys);
  });
});

// =============================================================================
// Typical price, volume weighting, flat-carry
// =============================================================================

describe('computeAnchoredVwap — typical price and volume', () => {
  const smallHigh = (bars: PriceBar[]) => pick(computeAnchoredVwap(bars, CONFIG), 'small', 'high');

  it('keeps accumulating from the pivot bar across the whole line', () => {
    // Uniform volume, typical = close: at bar 17 the first line has averaged
    // closes of bars 5..17 — 120,116,112,108,104,100,106,112,118,124,130,126,122
    // (sum 1498 over 13 bars).
    const line = smallHigh(barsFromCloses(CLOSES))[0];
    expect(line.points.find((p) => p.index === 17)!.y).toBeCloseTo(1498 / 13, 10);
  });

  it('weights by volume', () => {
    // Bars 5,6,7 close 120,116,112 with volume 1000,1000,3000 → 572000/5000.
    const bars = barsFromCloses(CLOSES, (i) => (i === 7 ? 3000 : 1000));
    expect(smallHigh(bars)[0].points[0].y).toBeCloseTo(114.4, 10);
  });

  /** Typical price (H+L+C)/3 = close + 2/3 here, distinct from close and from (H+L)/2. */
  function typicalBars(volume: (i: number) => number | undefined): PriceBar[] {
    return makeBars(CLOSES.map((c, i) => ({ o: c, h: c + 3, l: c - 1, c, v: volume(i) })));
  }

  it('uses the typical price (H+L+C)/3', () => {
    // Volume only on pivot bar 5 → the line equals that bar's typical price everywhere.
    const line = smallHigh(typicalBars((i) => (i === 5 ? 1000 : 0)))[0];
    for (const p of line.points) expect(p.y).toBeCloseTo(CLOSES[5] + 2 / 3, 10);
  });

  it('seeds a line with no volume since its anchor with the pivot bar’s typical price', () => {
    // Volume only on bar 5, so the second high line (pivot bar 15) never sees volume.
    const second = smallHigh(typicalBars((i) => (i === 5 ? 1000 : 0)))[1];
    expect(second.pivotBar).toBe(15);
    for (const p of second.points) expect(p.y).toBeCloseTo(CLOSES[15] + 2 / 3, 10);
  });

  it.each([
    ['zero', 0],
    ['missing', undefined],
  ])('a %s-volume bar contributes nothing and the line carries flat across it', (_label, volume) => {
    const line = smallHigh(barsFromCloses(CLOSES, (i) => (i === 9 ? volume : 1000)))[0];
    const at = (idx: number) => line.points.find((p) => p.index === idx)!.y;
    expect(at(9)).toBe(at(8));
    expect(at(10)).not.toBe(at(9));
  });

  it('never emits a non-finite value when a bar has a non-finite close', () => {
    const bars = barsFromCloses(CLOSES);
    bars[9] = { ...bars[9], close: NaN };
    for (const s of computeAnchoredVwap(bars, CONFIG)) {
      for (const p of s.points) expect(Number.isFinite(p.y)).toBe(true);
    }
  });
});

// =============================================================================
// History window
// =============================================================================

describe('computeAnchoredVwap — history window', () => {
  const bars = barsFromCloses(CLOSES);
  const dateOf = (bar: number): string => bars[bar].date;
  const run = (over: Partial<AnchoredVwapConfig>) => computeAnchoredVwap(bars, { ...CONFIG, ...over });
  const terminated = (segs: AnchoredVwapSegment[], scale: AnchoredVwapSegment['scale']) =>
    segs.filter((s) => s.scale === scale && !s.active);
  const actives = (segs: AnchoredVwapSegment[]) =>
    segs.filter((s) => s.active).map((s) => `${s.scale}-${s.side}-${s.pivotBar}`).sort();
  /** Pivot bars of the terminated segments, in chronological (start-bar) order. */
  const pivots = (segs: AnchoredVwapSegment[]) =>
    [...segs].sort((a, b) => a.startBar - b.startBar).map((s) => s.pivotBar);

  // Small scale has three terminated segments (high@5, low@10, high@15) and two
  // active (high@25, low@20); large has two terminated (high@5, high@15) and one active (high@25).
  const ALL_ACTIVE = ['large-high-25', 'small-high-25', 'small-low-20'];

  it('unset: keeps the most recent maxHistory terminated segments, pruning the oldest', () => {
    const segs = run({ maxHistory: 2 });
    expect(pivots(terminated(segs, 'small'))).toEqual([10, 15]);
    expect(pivots(terminated(segs, 'large'))).toEqual([5, 15]);
    expect(pivots(terminated(run({ maxHistory: 1 }), 'small'))).toEqual([15]);
  });

  it('set: starts at the date and fills chronologically forward until maxHistory, never pruning the start', () => {
    // From bar 0: the cap of 2 keeps the FIRST two and drops the most recent.
    expect(pivots(terminated(run({ historyStart: dateOf(0), maxHistory: 2 }), 'small'))).toEqual([5, 10]);
    expect(pivots(terminated(run({ historyStart: dateOf(0), maxHistory: 1 }), 'small'))).toEqual([5]);
  });

  it('set: only segments whose pivot is on or after the date are eligible', () => {
    const segs = run({ historyStart: dateOf(10), maxHistory: 100 });
    expect(pivots(terminated(segs, 'small'))).toEqual([10, 15]);
    expect(pivots(terminated(segs, 'large'))).toEqual([15]);
  });

  it('applies the cap per scale across both sides combined, not per side', () => {
    const small = terminated(run({ maxHistory: 2 }), 'small');
    expect(small).toHaveLength(2);
    expect(small.map((s) => s.side).sort()).toEqual(['high', 'low']);
  });

  it('windows each scale independently', () => {
    // Large has only two terminated segments, so a cap of 2 keeps both even
    // though the small scale had to prune.
    const segs = run({ maxHistory: 2 });
    expect(terminated(segs, 'small')).toHaveLength(2);
    expect(terminated(segs, 'large')).toHaveLength(2);
  });

  it('keeps everything when maxHistory exceeds the available history', () => {
    const segs = run({ maxHistory: 1000 });
    expect(terminated(segs, 'small')).toHaveLength(3);
    expect(terminated(segs, 'large')).toHaveLength(2);
  });

  it('never windows or prunes active lines, in either mode', () => {
    expect(actives(run({ maxHistory: 0 }))).toEqual(ALL_ACTIVE);
    expect(terminated(run({ maxHistory: 0 }), 'small')).toEqual([]);
    expect(actives(run({ maxHistory: 1 }))).toEqual(ALL_ACTIVE);
    // A start date after every pivot leaves no history but all three active lines.
    const late = run({ historyStart: '2026-02-01', maxHistory: 100 });
    expect(terminated(late, 'small')).toEqual([]);
    expect(actives(late)).toEqual(ALL_ACTIVE);
  });

  it.each(['not-a-date', '2026-13-40', ''])('treats a non-ISO historyStart as unset — %s', (v) => {
    expect(pivots(terminated(run({ historyStart: v, maxHistory: 2 }), 'small'))).toEqual([10, 15]);
  });

  it('filters on the pivot\'s session date, never the epoch of x', () => {
    // Production `x` is a PT-midnight instant; an epoch threshold parsed in
    // the user's timezone would move the boundary for users west of PT. Only
    // `date` participates — push every epoch into 2030 and nothing changes.
    const shifted = bars.map((b) => ({ ...b, x: new Date(Date.UTC(2030, 5, 15)) }));
    const segs = computeAnchoredVwap(shifted, { ...CONFIG, historyStart: '2026-01-16', maxHistory: 100 });
    expect(pivots(terminated(segs, 'small'))).toEqual([15]);
  });
});

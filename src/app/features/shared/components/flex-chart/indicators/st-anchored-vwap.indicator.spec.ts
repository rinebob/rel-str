import { ST_ANCHORED_VWAP_INDICATOR, computeAnchoredVwapSeries } from './st-anchored-vwap.indicator';
import type { AnchoredVwapLineSeries } from './st-anchored-vwap.indicator';
import { computeAnchoredVwap, computeAnchoredVwapResult } from './st-anchored-vwap.engine';
import type { AnchoredVwapConfig, AnchoredVwapSegment } from './st-anchored-vwap.types';
import { StIndicator } from '../flex-chart.types';
import type { PriceBar } from '../flex-chart.types';

// =============================================================================
// Test helpers
// =============================================================================

/** Local-midnight Date → its ISO 'YYYY-MM-DD' — matches `PriceBar.date`. */
const isoOf = (d: Date): string =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** Bars whose typical price equals the close: high = c+1, low = c-1. */
function barsFromCloses(closes: number[]): PriceBar[] {
  return closes.map((c, i) => {
    const x = new Date(2026, 0, 1 + i);
    return { date: isoOf(x), x, open: c, high: c + 1, low: c - 1, close: c, volume: 1000 };
  });
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
    const x = new Date(2026, 0, 1 + i);
    bars.push({
      date: isoOf(x),
      x,
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
  line1RetracementPct: 5,
  line2RetracementPct: 25,
  line1LeftDepth: 2,
  line1RightDepth: 2,
  line2LeftDepth: 2,
  line2RightDepth: 2,
  maxHistory: 100,
};

const SCALES = ['line1', 'line2'] as const;

const EXPECTED_KEYS = SCALES.flatMap((scale) => [
  ...(['high', 'low'] as const).flatMap((side) =>
    ['history-a', 'history-b', 'active'].map((kind) => `${scale}-${side}-${kind}`),
  ),
  `${scale}-zigzag`,
  `${scale}-developing`,
]);

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
      line1RetracementPct: 2,
      line2RetracementPct: 5,
      line1LeftDepth: 5,
      line1RightDepth: 2,
      line2LeftDepth: 5,
      // rightDepth defaults below leftDepth so a reversal that has met the
      // deviation amount confirms sooner.
      line2RightDepth: 2,
      line1HighColor: '#FF8CFF',
      line1LowColor: '#8CF5FF',
      // Line 2 deliberately sits outside line 1's magenta/cyan family.
      line2HighColor: '#FFA500',
      line2LowColor: '#00C853',
      showLine1: true,
      showLine2: true,
      showZigZag: true,
      maxHistory: 100,
      historyStart: '',
    });
  });

  it('labels the two sets as line 1 and line 2', () => {
    const labels = Object.fromEntries(ST_ANCHORED_VWAP_INDICATOR.params.map((p) => [p.key, p.label]));
    expect(labels['line1RetracementPct']).toContain('Line 1');
    expect(labels['line2RetracementPct']).toContain('Line 2');
    expect(labels['line1HighColor']).toContain('Line 1');
    expect(labels['showZigZag']).toContain('ZigZag');
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
  ])('always returns the same 16 keys in the same order — %s', (_label, bars) => {
    expect(computeAnchoredVwapSeries(bars, PARAMS).map((s) => s.key)).toEqual(EXPECTED_KEYS);
  });

  it('orders each slot history first and active last, legs after the VWAP slots, and line 2 after line 1, so the live and line-2 lines draw on top', () => {
    expect(EXPECTED_KEYS.slice(0, 3)).toEqual(['line1-high-history-a', 'line1-high-history-b', 'line1-high-active']);
    expect(EXPECTED_KEYS.indexOf('line2-high-history-a')).toBeGreaterThan(EXPECTED_KEYS.indexOf('line1-developing'));
  });

  it('draws the live line in the active series and the older segments in history, alternating', () => {
    const series = computeAnchoredVwapSeries(barsFromCloses(CLOSES), PARAMS);
    // line1-high: terminated [7..17], [17..27] then active [27..30]
    expect(byKey(series, 'line1-high-history-a').data.map((p) => p.index)).toEqual(
      Array.from({ length: 11 }, (_, i) => 7 + i),
    );
    expect(byKey(series, 'line1-high-history-b').data.map((p) => p.index)).toEqual(
      Array.from({ length: 11 }, (_, i) => 17 + i),
    );
    expect(byKey(series, 'line1-high-active').data.map((p) => p.index)).toEqual([27, 28, 29, 30]);
  });

  it('leaves the history and active series of a side with no anchors empty', () => {
    const series = computeAnchoredVwapSeries(barsFromCloses(CLOSES), PARAMS);
    for (const kind of ['history-a', 'history-b', 'active']) {
      expect(byKey(series, `line2-low-${kind}`).data).toEqual([]);
    }
  });

  it('carries the engine’s values: every packed chunk equals a segment’s points', () => {
    const bars = barsFromCloses(CLOSES);
    const segments = computeAnchoredVwap(bars, { ...PARAMS, historyStart: undefined });
    const series = computeAnchoredVwapSeries(bars, PARAMS);
    const seg = (scale: string, side: string, pivotBar: number): AnchoredVwapSegment =>
      segments.find((s) => s.set === scale && s.side === side && s.pivotBar === pivotBar)!;
    expect(chunks(byKey(series, 'line1-high-history-a'))[0]).toEqual(seg('line1', 'high', 5).points);
    expect(chunks(byKey(series, 'line1-high-history-b'))[0]).toEqual(seg('line1', 'high', 15).points);
    expect(byKey(series, 'line1-high-active').data).toEqual(seg('line1', 'high', 25).points);
  });
});

// =============================================================================
// ZigZag legs
// =============================================================================

describe('computeAnchoredVwapSeries — zigzag legs', () => {
  const bars = barsFromCloses(CLOSES);
  const series = computeAnchoredVwapSeries(bars, PARAMS);

  it('renders the confirmed chain as a MultiColoredLine over the surviving anchor vertices, in pivot order', () => {
    const chain = byKey(series, 'line1-zigzag');
    expect(chain.type).toBe('MultiColoredLine');
    expect(chain.dashArray).toBe('');
    expect(chain.pointColorMapping).toBe('color');
    // Vertices are the anchor pivots in order: high@5, low@10, high@15, low@20, high@25.
    expect(chain.data.map((p) => [p.index, p.y])).toEqual([[5, 121], [10, 99], [15, 131], [20, 109], [25, 141]]);
    // A segment takes the color of its start vertex = the leg's destination
    // side: legs into lows are the low hue, legs into highs the high hue.
    expect(chain.data.map((p) => p.color)).toEqual(['#8CF5FF', '#FF8CFF', '#8CF5FF', '#FF8CFF', '#FF8CFF']);
  });

  it('drops superseded anchors — the line-2 chain marks only the surviving high', () => {
    // Line 2's three high events (5, 15, 25) are two replacements — only the
    // survivor is a vertex, so no same-side legs are drawn.
    const chain = byKey(series, 'line2-zigzag');
    expect(chain.data).toEqual([{ index: 25, y: 141, color: '#FFA500' }]);
  });

  it('marks a lone anchor on the chain even when no legs connect', () => {
    // One climb then a monotone decline: high@4 is the only anchor — the chain
    // still carries its vertex (painted with its own side's hue).
    const solo = barsFromCloses([100, 105, 110, 115, 120, 115, 110, 105, 100, 95, 90, 85, 80, 75, 70]);
    const chain = byKey(computeAnchoredVwapSeries(solo, PARAMS), 'line1-zigzag');
    expect(chain.data).toEqual([{ index: 4, y: 121, color: '#FF8CFF' }]);
  });

  it('renders the developing leg dashed, from the last anchor to the running extreme', () => {
    const dev = byKey(series, 'line1-developing');
    expect(dev.type).toBe('Line');
    expect(dev.dashArray).toBe('5,3');
    expect(dev.data).toEqual([
      { index: 25, y: 141 },
      { index: 30, y: 119 },
    ]);
    // Destination is a low extreme → the line-1 low hue.
    expect(dev.color).toBe('#8CF5FF');
  });

  it('leaves a set’s developing series empty when no projection pivot exists', () => {
    // Line 2 at 25%: the drop after high@25 (~15.6%) never reaches the threshold.
    expect(byKey(series, 'line2-developing').data).toEqual([]);
  });

  it('every active segment’s anchor is a chain vertex; superseded anchors are not', () => {
    const { segments, legs } = computeAnchoredVwapResult(bars, PARAMS);
    for (const scale of SCALES) {
      const chain = byKey(series, `${scale}-zigzag`);
      const legSet = legs.find((l) => l.set === scale)!;
      // The chain carries exactly the engine's surviving-anchor vertices.
      expect(chain.data.map((p) => [p.index, p.y])).toEqual(legSet.vertices.map((v) => [v.index, v.y]));
      // The active anchor always survives; superseded anchors keep their
      // (terminated) segments but no vertex.
      const vertices = new Set(chain.data.map((p) => p.index));
      for (const s of segments.filter((x) => x.set === scale && x.active)) {
        expect(vertices.has(s.pivotBar)).toBe(true);
      }
    }
  });

  it.each([false, 'false'])('showZigZag: %s empties both leg series but keeps all 16 keys', (v) => {
    const off = computeAnchoredVwapSeries(bars, { ...PARAMS, showZigZag: v });
    expect(off.map((s) => s.key)).toEqual(EXPECTED_KEYS);
    for (const scale of SCALES) {
      expect(byKey(off, `${scale}-zigzag`).data).toEqual([]);
      expect(byKey(off, `${scale}-developing`).data).toEqual([]);
    }
    // The VWAP slots are untouched.
    expect(byKey(off, 'line1-high-active').data).toEqual(byKey(series, 'line1-high-active').data);
  });
});

// =============================================================================
// Per-set visibility (#955)
// =============================================================================

describe('computeAnchoredVwapSeries — set visibility', () => {
  const bars = barsFromCloses(CLOSES);
  const series = computeAnchoredVwapSeries(bars, PARAMS);

  it.each(['line1', 'line2'] as const)('%s hidden empties its 6 VWAP slots but keeps its legs, the other set, and all 16 keys', (hidden) => {
    const off = computeAnchoredVwapSeries(bars, { ...PARAMS, [`show${hidden === 'line1' ? 'Line1' : 'Line2'}`]: false });
    expect(off.map((s) => s.key)).toEqual(EXPECTED_KEYS);
    for (const s of off) {
      const isHiddenVwapSlot = s.key.startsWith(hidden) && !s.key.endsWith('zigzag') && !s.key.endsWith('developing');
      expect(s.data).toEqual(isHiddenVwapSlot ? [] : byKey(series, s.key).data);
    }
  });

  it('legs still render when both sets are hidden — showZigZag governs them alone', () => {
    const off = computeAnchoredVwapSeries(bars, { ...PARAMS, showLine1: false, showLine2: false });
    expect(byKey(off, 'line1-zigzag').data.length).toBeGreaterThan(0);
    expect(off.filter((s) => s.key.includes('-high-') || s.key.includes('-low-')).every((s) => s.data.length === 0)).toBe(true);
  });

  it('shows both sets by default when the params are absent', () => {
    for (const s of series) expect(s.data).not.toBeUndefined();
    expect(byKey(series, 'line1-high-active').data.length).toBeGreaterThan(0);
    expect(byKey(series, 'line2-high-active').data.length).toBeGreaterThan(0);
  });
});

// =============================================================================
// Per-set depths (#955)
// =============================================================================

describe('computeAnchoredVwapSeries — per-set depths', () => {
  const bars = makeWalk(7, 300);

  it('line-2 depth changes leave every line-1 series byte-identical', () => {
    const a = computeAnchoredVwapSeries(bars, { ...PARAMS, line2LeftDepth: 2, line2RightDepth: 2 });
    const b = computeAnchoredVwapSeries(bars, { ...PARAMS, line2LeftDepth: 12, line2RightDepth: 12 });
    for (const s of a.filter((x) => x.key.startsWith('line1'))) {
      expect(s.data).toEqual(byKey(b, s.key).data);
    }
  });

  it('line-1 depth changes leave every line-2 series byte-identical', () => {
    const a = computeAnchoredVwapSeries(bars, { ...PARAMS, line1LeftDepth: 2, line1RightDepth: 2 });
    const b = computeAnchoredVwapSeries(bars, { ...PARAMS, line1LeftDepth: 12, line1RightDepth: 12 });
    for (const s of a.filter((x) => x.key.startsWith('line2'))) {
      expect(s.data).toEqual(byKey(b, s.key).data);
    }
  });
});

// =============================================================================
// historyStart — ISO date string param (#872)
//
// Fixture bars carry `date`/`x` pairs for Jan 1+i 2026, so the pivots of CLOSES
// (high@5, low@10, high@15, low@20, high@25) land on 2026-01-06, 01-11, 01-16,
// 01-21, 01-26. The window compares the pivot bar's session `date` to the ISO
// string — calendars, not epochs — so no timezone conversion happens anywhere
// in the chain (pivot `x` is a PT-midnight instant in real mode).
// =============================================================================

describe('computeAnchoredVwapSeries — historyStart', () => {
  const bars = barsFromCloses(CLOSES);

  it('windows history to anchors on or after the ISO date — the boundary date is inclusive', () => {
    const series = computeAnchoredVwapSeries(bars, { ...PARAMS, historyStart: '2026-01-16' });
    const oracle = computeAnchoredVwap(bars, { ...PARAMS, historyStart: '2026-01-16' });
    // line1-high: pivot@5 dropped, pivot@15 kept (now first → history-a); pivot@25 stays active.
    expect(chunks(byKey(series, 'line1-high-history-a'))[0]).toEqual(
      oracle.find((s) => s.set === 'line1' && s.side === 'high' && s.pivotBar === 15)!.points,
    );
    expect(byKey(series, 'line1-high-history-b').data).toEqual([]);
    // line1-low: its only terminated anchor is pivot@10 (Jan 11) — dropped; pivot@20 stays active.
    expect(byKey(series, 'line1-low-history-a').data).toEqual([]);
    expect(byKey(series, 'line1-low-history-b').data).toEqual([]);
    expect(byKey(series, 'line1-low-active').data.length).toBeGreaterThan(0);
    // The window filters history lines only — the legs are structural and stay.
    expect(byKey(series, 'line1-zigzag').data.length).toBeGreaterThan(0);
  });

  it('a historyStart after the last anchor empties every history series; the active lines and legs remain', () => {
    const series = computeAnchoredVwapSeries(bars, { ...PARAMS, historyStart: '2026-01-27' });
    for (const s of series) {
      if (!s.key.includes('history')) continue;
      expect(s.data).toEqual([]);
    }
    expect(byKey(series, 'line1-high-active').data.length).toBeGreaterThan(0);
    expect(byKey(series, 'line1-low-active').data.length).toBeGreaterThan(0);
    expect(byKey(series, 'line1-zigzag').data.length).toBeGreaterThan(0);
  });

  it('a historyStart before every anchor is equivalent to unset', () => {
    expect(computeAnchoredVwapSeries(bars, { ...PARAMS, historyStart: '2020-01-01' }))
      .toEqual(computeAnchoredVwapSeries(bars, PARAMS));
  });

  it.each(['banana', '2026-13-40', ''])('an empty or unparseable historyStart is ignored — %s', (v) => {
    expect(computeAnchoredVwapSeries(bars, { ...PARAMS, historyStart: v }))
      .toEqual(computeAnchoredVwapSeries(bars, PARAMS));
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
        // The leg series are chains, not packed segments — they carry no nulls.
        for (const s of series.filter((x) => !x.key.endsWith('-zigzag') && !x.key.endsWith('-developing'))) {
          const ys = s.data.map((p) => p.y);
          if (ys.length === 0) continue;
          expect(ys[0]).not.toBeNull();
          expect(ys[ys.length - 1]).not.toBeNull();
          for (let i = 1; i < ys.length; i++) expect(ys[i] === null && ys[i - 1] === null).toBe(false);
        }
      });

      it('packs the terminated segments of each slot alternately into history-a and history-b, and the live one into active', () => {
        for (const scale of SCALES) {
          for (const side of ['high', 'low'] as const) {
            const slot = segments.filter((s) => s.set === scale && s.side === side).sort((a, b) => a.startBar - b.startBar);
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

      it('every vertex is a real anchor and every active anchor is a vertex — superseded anchors are unmarked', () => {
        const { legs } = computeAnchoredVwapResult(bars, config);
        for (const scale of SCALES) {
          const legSet = legs.find((l) => l.set === scale)!;
          const anchorBars = new Set(segments.filter((x) => x.set === scale).map((s) => s.pivotBar));
          for (const v of legSet.vertices) expect(anchorBars.has(v.index)).toBe(true);
          // The active anchor always survives; a terminated anchor may have
          // been superseded — its segment stays, its vertex is dropped.
          for (const s of segments.filter((x) => x.set === scale && x.active)) {
            expect(legSet.vertices.some((v) => v.index === s.pivotBar)).toBe(true);
          }
        }
      });
    });
  }

  it('honours maxHistory per set across both sides', () => {
    const bars = makeWalk(1, 320);
    const series = computeAnchoredVwapSeries(bars, { ...PARAMS, maxHistory: 3 });
    for (const scale of SCALES) {
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

  it('draws line 2 thicker than line 1', () => {
    expect(byKey(series, 'line2-high-active').width).toBeGreaterThan(byKey(series, 'line1-high-active').width);
    expect(byKey(series, 'line2-low-active').width).toBeGreaterThan(byKey(series, 'line1-low-active').width);
  });

  it('keeps the width and colour of history identical to the active line — no fading', () => {
    for (const slot of ['line1-high', 'line1-low', 'line2-high', 'line2-low']) {
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
    expect(byKey(series, 'line1-high-active').color).toBe('#FF8CFF');
    expect(byKey(series, 'line1-low-active').color).toBe('#8CF5FF');
    expect(byKey(series, 'line2-high-active').color).toBe('#FFA500');
    expect(byKey(series, 'line2-low-active').color).toBe('#00C853');
  });

  it('applies colour params', () => {
    const custom = computeAnchoredVwapSeries(barsFromCloses(CLOSES), { ...PARAMS, line1HighColor: '#123456' });
    expect(byKey(custom, 'line1-high-active').color).toBe('#123456');
    expect(byKey(custom, 'line1-low-active').color).toBe('#8CF5FF');
  });

  it('names lines by set, side and retracement percentage', () => {
    expect(byKey(series, 'line1-high-active').name).toBe('AVWAP-1H 5%');
    expect(byKey(series, 'line1-low-active').name).toBe('AVWAP-1L 5%');
    expect(byKey(series, 'line2-high-active').name).toBe('AVWAP-2H 25%');
    expect(byKey(series, 'line2-low-active').name).toBe('AVWAP-2L 25%');
    expect(byKey(series, 'line1-zigzag').name).toBe('ZZ 5%');
    expect(byKey(series, 'line2-zigzag').name).toBe('ZZ 25%');
  });
});

describe('computeAnchoredVwapSeries — params', () => {
  it('uses the declared defaults when no params are supplied', () => {
    const series = computeAnchoredVwapSeries(makeWalk(2, 300), {});
    expect(series.map((s) => s.key)).toEqual(EXPECTED_KEYS);
    expect(byKey(series, 'line1-high-active').name).toBe('AVWAP-1H 2%');
    expect(byKey(series, 'line2-high-active').name).toBe('AVWAP-2H 5%');
  });

  it('falls back to defaults for non-numeric params and clamps out-of-range ones', () => {
    const series = computeAnchoredVwapSeries(makeWalk(2, 300), {
      line1RetracementPct: 'abc',
      line2RetracementPct: Number.NaN,
      line1LeftDepth: 0,
      line2RightDepth: -3,
      maxHistory: -5,
    });
    expect(series.map((s) => s.key)).toEqual(EXPECTED_KEYS);
    expect(byKey(series, 'line1-high-active').name).toBe('AVWAP-1H 2%');
    // maxHistory clamps to 0: no history anywhere, active lines still draw.
    expect(series.filter((s) => s.key.includes('history')).every((s) => s.data.length === 0)).toBe(true);
    expect(series.some((s) => s.key.endsWith('active') && s.data.length > 0)).toBe(true);
  });

  it('ignores non-string colour params', () => {
    const series = computeAnchoredVwapSeries(barsFromCloses(CLOSES), { ...PARAMS, line1HighColor: 7 });
    expect(byKey(series, 'line1-high-active').color).toBe('#FF8CFF');
  });

  it('shows the legs by default when the param is absent', () => {
    const series = computeAnchoredVwapSeries(barsFromCloses(CLOSES), { ...PARAMS });
    expect(byKey(series, 'line1-zigzag').data.length).toBeGreaterThan(0);
  });
});

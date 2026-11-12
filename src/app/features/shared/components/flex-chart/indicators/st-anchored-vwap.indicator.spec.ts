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

/** Line 1 (5%): legs from H5 L10 H15 L20, live line low@20. Line 2 (17%): H25 replaces H15, so lines from H5 and L10 only — live line low@10. */
const PARAMS = {
  line1RetracementPct: 5,
  line2RetracementPct: 17,
  line1LeftDepth: 2,
  line1RightDepth: 2,
  line2LeftDepth: 2,
  line2RightDepth: 2,
  maxHistory: 100,
};

const SCALES = ['line1', 'line2'] as const;

const HIST_KINDS = ['history-a', 'history-b', 'history-c', 'history-d'] as const;

const EXPECTED_KEYS = SCALES.flatMap((scale) => [
  ...(['high', 'low'] as const).flatMap((side) =>
    [...HIST_KINDS, 'active'].map((kind) => `${scale}-${side}-${kind}`),
  ),
  `${scale}-zigzag`,
  `${scale}-developing`,
  `${scale}-confirmations`,
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
      line1LowColor: '#FFFF00',
      // Line 2 deliberately sits outside line 1's magenta/yellow family.
      line2HighColor: '#00C853',
      line2LowColor: '#FF0000',
      line1Weight: 3,
      line2Weight: 1,
      line1ZigZagColor: '#2DD4BF',
      line2ZigZagColor: '#2DD4BF',
      showLine1High: true,
      showLine1Low: true,
      showLine2High: true,
      showLine2Low: true,
      showLine1ZigZag: true,
      showLine2ZigZag: true,
      showLine1Confirms: false,
      showLine2Confirms: false,
      line1Persist: false,
      line2Persist: false,
      maxHistory: 100,
      historyStart: '',
    });
  });

  it('labels the two sets as line 1 and line 2', () => {
    const labels = Object.fromEntries(ST_ANCHORED_VWAP_INDICATOR.params.map((p) => [p.key, p.label]));
    expect(labels['line1RetracementPct']).toContain('Line 1');
    expect(labels['line2RetracementPct']).toContain('Line 2');
    expect(labels['line1HighColor']).toContain('Line 1');
    expect(labels['showLine1ZigZag']).toContain('ZigZag');
    expect(labels['showLine2ZigZag']).toContain('ZigZag');
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
  ])('always returns the same 26 keys in the same order — %s', (_label, bars) => {
    expect(computeAnchoredVwapSeries(bars, PARAMS).map((s) => s.key)).toEqual(EXPECTED_KEYS);
  });

  it('orders each slot history first and active last, legs after the VWAP slots, and line 2 after line 1, so the live and line-2 lines draw on top', () => {
    expect(EXPECTED_KEYS.slice(0, 5)).toEqual([
      'line1-high-history-a', 'line1-high-history-b', 'line1-high-history-c', 'line1-high-history-d', 'line1-high-active',
    ]);
    expect(EXPECTED_KEYS.indexOf('line2-high-history-a')).toBeGreaterThan(EXPECTED_KEYS.indexOf('line1-developing'));
  });

  it('draws the live line in the active series and packs the older disjoint segments into history', () => {
    const series = computeAnchoredVwapSeries(barsFromCloses(CLOSES), PARAMS);
    // line1-high: terminated [7..11] and [17..21] are x-disjoint, so
    // first-fit packs both into history-a with a null break at index 12.
    expect(byKey(series, 'line1-high-history-a').data.map((p) => p.index)).toEqual(
      [...Array.from({ length: 5 }, (_, i) => 7 + i), 12, ...Array.from({ length: 5 }, (_, i) => 17 + i)],
    );
    expect(byKey(series, 'line1-high-history-b').data).toEqual([]);
    expect(byKey(series, 'line1-high-active').data.map((p) => p.index)).toEqual([27, 28, 29, 30]);
  });

  it('leaves the history and active series of a set with no triggered reversals empty', () => {
    // At 50% only the first pivot registers — and its reversal never
    // triggers — so line 2 draws no lines at all.
    const series = computeAnchoredVwapSeries(barsFromCloses(CLOSES), { ...PARAMS, line2RetracementPct: 50 });
    for (const side of ['high', 'low']) {
      for (const kind of [...HIST_KINDS, 'active']) {
        expect(byKey(series, `line2-${side}-${kind}`).data).toEqual([]);
      }
    }
  });

  it('carries the engine’s values: every packed chunk equals a segment’s points', () => {
    const bars = barsFromCloses(CLOSES);
    const segments = computeAnchoredVwap(bars, { ...PARAMS, historyStart: undefined });
    const series = computeAnchoredVwapSeries(bars, PARAMS);
    const seg = (scale: string, side: string, pivotBar: number): AnchoredVwapSegment =>
      segments.find((s) => s.set === scale && s.side === side && s.pivotBar === pivotBar)!;
    expect(chunks(byKey(series, 'line1-high-history-a'))).toEqual([seg('line1', 'high', 5).points, seg('line1', 'high', 15).points]);
    expect(byKey(series, 'line1-high-history-b').data).toEqual([]);
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
    // The whole chain draws in the set's uniform leg color (#1459) — teal
    // by default; per-vertex colors exist only for the MultiColoredLine
    // contract.
    expect(chain.data.map((p) => p.color)).toEqual(['#2DD4BF', '#2DD4BF', '#2DD4BF', '#2DD4BF', '#2DD4BF']);
    expect(chain.color).toBe('#2DD4BF');
    expect(chain.width).toBe(3); // legs share the set's weight
  });

  it('drops superseded anchors — the line-2 chain skips high@15, replaced by high@25', () => {
    const chain = byKey(series, 'line2-zigzag');
    expect(chain.data.map((p) => [p.index, p.y])).toEqual([[5, 121], [10, 99], [25, 141]]);
    expect(chain.width).toBe(1); // line 2's legs share its weight
  });

  it('marks a lone anchor on the chain even when no legs connect', () => {
    // One climb then a monotone decline: high@4 is the only anchor — the chain
    // still carries its vertex (painted with the set's leg color).
    const solo = barsFromCloses([100, 105, 110, 115, 120, 115, 110, 105, 100, 95, 90, 85, 80, 75, 70]);
    const chain = byKey(computeAnchoredVwapSeries(solo, PARAMS), 'line1-zigzag');
    expect(chain.data).toEqual([{ index: 4, y: 121, color: '#2DD4BF' }]);
  });

  it('renders the developing leg dashed, from the last anchor to the running extreme', () => {
    const dev = byKey(series, 'line1-developing');
    expect(dev.type).toBe('Line');
    expect(dev.dashArray).toBe('5,3');
    expect(dev.data).toEqual([
      { index: 25, y: 141 },
      { index: 30, y: 119 },
    ]);
    // The developing leg draws in the set's uniform leg color.
    expect(dev.color).toBe('#2DD4BF');
  });

  it('leaves a set’s developing series empty when no projection pivot exists', () => {
    // Line 2 at 17%: the drop after high@25 (~15.6%) never reaches the threshold.
    expect(byKey(series, 'line2-developing').data).toEqual([]);
  });

  it('every active segment’s anchor is a chain vertex; superseded anchors are not', () => {
    const { segments, legs } = computeAnchoredVwapResult(bars, PARAMS);
    for (const scale of SCALES) {
      const chain = byKey(series, `${scale}-zigzag`);
      const legSet = legs.find((l) => l.set === scale)!;
      // The chain carries exactly the engine's surviving-anchor vertices.
      expect(chain.data.map((p) => [p.index, p.y])).toEqual(legSet.vertices.map((v) => [v.index, v.y]));
      // The live line starts on the most recent vertex's trigger bar.
      const lastTrigger = legSet.confirmations.at(-1);
      for (const s of segments.filter((x) => x.set === scale && x.active)) {
        expect(s.startBar).toBe(lastTrigger?.index);
      }
    }
  });

  it.each(['line1', 'line2'] as const)('%s leg toggle empties only that set\'s chain + developing — the other set\'s legs and all 26 keys stay', (set) => {
    const off = computeAnchoredVwapSeries(bars, { ...PARAMS, [`show${set === 'line1' ? 'Line1' : 'Line2'}ZigZag`]: false });
    expect(off.map((s) => s.key)).toEqual(EXPECTED_KEYS);
    for (const s of off) {
      const isLegSlot = s.key.endsWith('zigzag') || s.key.endsWith('developing');
      expect(s.data).toEqual(isLegSlot && s.key.startsWith(set) ? [] : byKey(series, s.key).data);
    }
  });

});

// =============================================================================
// Confirmation-point markers
// =============================================================================

describe('computeAnchoredVwapSeries — confirmation markers', () => {
  const bars = barsFromCloses(CLOSES);
  const marked = computeAnchoredVwapSeries(bars, { ...PARAMS, showLine1Confirms: true, showLine2Confirms: true });

  it('is empty by default — the debug overlay is opt-in per set', () => {
    const plain = computeAnchoredVwapSeries(bars, PARAMS);
    expect(byKey(plain, 'line1-confirmations').data).toEqual([]);
    expect(byKey(plain, 'line2-confirmations').data).toEqual([]);
  });

  it('draws the zigzag’s trigger dots — the threshold level on the bar that crossed it, in the pivot’s side color', () => {
    // Line 1: every vertex triggered — H5 on bar 7 (level 121×0.95), L10 on
    // 11 (99×1.05), H15 on 17, L20 on 21, H25 on 27.
    const dots = byKey(marked, 'line1-confirmations');
    expect(dots.type).toBe('Scatter');
    expect(dots.pointColorMapping).toBe('color');
    expect(dots.marker?.visible).toBe(true);
    // All five triggers gapped through their levels (e.g. 114.95 sits above
    // bar 7's high), so each dot lands on the trigger bar's open.
    expect(dots.data).toEqual([
      { index: 7, y: 112, color: '#FF8CFF' },
      { index: 11, y: 106, color: '#FFFF00' },
      { index: 17, y: 122, color: '#FF8CFF' },
      { index: 21, y: 116, color: '#FFFF00' },
      { index: 27, y: 132, color: '#FF8CFF' },
    ]);
    // Causal contract: the high line starts on the blue dot's bar.
    expect(byKey(marked, 'line1-high-history-a').data[0].index).toBe(7);
    expect(byKey(marked, 'line1-high-active').data[0].index).toBe(27);
  });

  it('emits no dot for a vertex whose reversal hasn’t triggered — and no line either', () => {
    // Line 2 (17%): only H5 (bar 10, level 121×0.83) and L10 (bar 13,
    // 99×1.17) triggered; the drop after H25 never reached 17% — no dot,
    // and the low-anchored line stays live.
    expect(byKey(marked, 'line2-confirmations').data).toEqual([
      { index: 10, y: 121 * 0.83, color: '#00C853' },
      { index: 13, y: 118, color: '#FF0000' },
    ]);
    expect(byKey(marked, 'line2-low-active').data[0].index).toBe(13);
    expect(byKey(marked, 'line2-high-active').data).toEqual([]);
  });

  it.each(['line1', 'line2'] as const)('%s confirms toggle empties only its own marker series', (set) => {
    const off = computeAnchoredVwapSeries(bars, { ...PARAMS, showLine1Confirms: true, showLine2Confirms: true, [`show${set === 'line1' ? 'Line1' : 'Line2'}Confirms`]: false });
    for (const s of off) {
      expect(s.data).toEqual(s.key === `${set}-confirmations` ? [] : byKey(marked, s.key).data);
    }
  });
});

// =============================================================================
// Per-set visibility (#955)
// =============================================================================

describe('computeAnchoredVwapSeries — set visibility', () => {
  const bars = barsFromCloses(CLOSES);
  const series = computeAnchoredVwapSeries(bars, PARAMS);

  it.each([
    ['line1', 'high'], ['line1', 'low'],
    ['line2', 'high'], ['line2', 'low'],
  ] as const)('%s %s hidden empties only that side\'s 3 VWAP slots — the other side, the legs, and all 26 keys stay', (set, side) => {
    const key = `show${set === 'line1' ? 'Line1' : 'Line2'}${side === 'high' ? 'High' : 'Low'}`;
    const off = computeAnchoredVwapSeries(bars, { ...PARAMS, [key]: false });
    expect(off.map((s) => s.key)).toEqual(EXPECTED_KEYS);
    for (const s of off) {
      const isHiddenSlot = s.key.startsWith(`${set}-${side}-`);
      expect(s.data).toEqual(isHiddenSlot ? [] : byKey(series, s.key).data);
    }
  });

  it('legs still render when every VWAP side is hidden — leg toggles govern them alone', () => {
    const off = computeAnchoredVwapSeries(bars, {
      ...PARAMS,
      showLine1High: false, showLine1Low: false,
      showLine2High: false, showLine2Low: false,
    });
    expect(byKey(off, 'line1-zigzag').data.length).toBeGreaterThan(0);
    expect(off.filter((s) => s.key.includes('-high-') || s.key.includes('-low-')).every((s) => s.data.length === 0)).toBe(true);
  });

  it('shows both sets by default when the params are absent', () => {
    for (const s of series) expect(s.data).not.toBeUndefined();
    // Both sets' live lines on this fixture: high@25 for line 1, low@10 for
    // line 2 (H25's reversal never triggered at 17%).
    expect(byKey(series, 'line1-high-active').data.length).toBeGreaterThan(0);
    expect(byKey(series, 'line2-low-active').data.length).toBeGreaterThan(0);
  });
});

// =============================================================================
// Persist mode — a fan of lines, one per triggered vertex
// =============================================================================

describe('computeAnchoredVwapSeries — persist mode', () => {
  const bars = barsFromCloses(CLOSES);
  const series = computeAnchoredVwapSeries(bars, { ...PARAMS, line1Persist: true });
  const spans = (key: string) => chunks(byKey(series, key)).map((c) => [c[0].index, c.at(-1)!.index]);

  it('keeps every triggered vertex’s line to the last bar — newest in the active slot, older ones each taking a history slot', () => {
    // Line 1 (5%): five triggered vertices. Highs take history-a/b (one
    // overlapping line per series), the newest goes active; every line
    // reaches bar 30.
    expect(spans('line1-high-history-a')).toEqual([[7, 30]]);
    expect(spans('line1-high-history-b')).toEqual([[17, 30]]);
    expect(spans('line1-high-active')).toEqual([[27, 30]]);
    expect(spans('line1-low-history-a')).toEqual([[11, 30]]);
    expect(spans('line1-low-history-b')).toEqual([[21, 30]]);
    expect(byKey(series, 'line1-low-active').data).toEqual([]);
    // The 26-key structure is unchanged.
    expect(series.map((s) => s.key)).toEqual(EXPECTED_KEYS);
  });

  it('the flag is per set — line 2 still alternates', () => {
    expect(spans('line2-high-history-a')).toEqual([[10, 13]]);
    expect(spans('line2-low-active')).toEqual([[13, 30]]);
  });

  it('never drops a persist segment — overflow packs overlapping runs into shared slots, null-separated', () => {
    // A long walk at a tight retracement generates far more same-side
    // persist segments than the four history slots — every one must still
    // draw (the fan is unbounded), packed with null break points.
    const dense = computeAnchoredVwapSeries(makeWalk(7, 300), { ...PARAMS, line1RetracementPct: 1, line1Persist: true });
    const terminatedCount = computeAnchoredVwap(makeWalk(7, 300), { ...PARAMS, line1RetracementPct: 1, line1Persist: true })
      .filter((s) => s.set === 'line1' && s.side === 'high' && !s.active).length;
    expect(terminatedCount).toBeGreaterThan(HIST_KINDS.length);
    const packed = HIST_KINDS.reduce((n, key) => n + chunks(byKey(dense, `line1-high-${key}`)).length, 0);
    expect(packed).toBe(terminatedCount);
  });

  it('non-persist packing still keeps one real point per index per series', () => {
    const dense = computeAnchoredVwapSeries(makeWalk(7, 300), { ...PARAMS, line1RetracementPct: 1 });
    for (const key of HIST_KINDS) {
      const idx = byKey(dense, `line1-high-${key}`).data.filter((p) => p.y !== null).map((p) => p.index);
      expect(new Set(idx).size).toBe(idx.length);
    }
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
    // line1-high: pivot@5 dropped, pivot@15 kept (now first → history-a).
    expect(chunks(byKey(series, 'line1-high-history-a'))[0]).toEqual(
      oracle.find((s) => s.set === 'line1' && s.side === 'high' && s.pivotBar === 15)!.points,
    );
    expect(byKey(series, 'line1-high-history-b').data).toEqual([]);
    // line1-low: pivot@10 (Jan 11) is dropped; pivot@20 (Jan 21) is kept —
    // its line is terminated (the live line is the newest anchor, high@25).
    expect(chunks(byKey(series, 'line1-low-history-a'))[0]).toEqual(
      oracle.find((s) => s.set === 'line1' && s.side === 'low' && s.pivotBar === 20)!.points,
    );
    expect(byKey(series, 'line1-low-history-b').data).toEqual([]);
    expect(byKey(series, 'line1-low-active').data).toEqual([]);
    // The window filters history lines only — the legs are structural and stay.
    expect(byKey(series, 'line1-zigzag').data.length).toBeGreaterThan(0);
  });

  it('a historyStart after the last anchor empties every history series; the active lines and legs remain', () => {
    const series = computeAnchoredVwapSeries(bars, { ...PARAMS, historyStart: '2026-01-27' });
    for (const s of series) {
      if (!s.key.includes('history')) continue;
      expect(s.data).toEqual([]);
    }
    // Exactly one live line per set: the newest anchor is high@25.
    expect(byKey(series, 'line1-high-active').data.length).toBeGreaterThan(0);
    expect(byKey(series, 'line1-low-active').data).toEqual([]);
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

      it('never puts two real points at one index, and indices never decrease within a series', () => {
        for (const s of series) {
          const idx = s.data.map((p) => p.index);
          expect(idx).toEqual([...idx].sort((a, b) => a - b));
          // A `y: null` break may share an index with the next segment's
          // start bar — the real (drawn) points are what must stay unique.
          const real = s.data.filter((p) => p.y !== null).map((p) => p.index);
          expect(new Set(real).size).toBe(real.length);
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

      it('first-fits the terminated segments into the history slots and puts the live one into active', () => {
        for (const scale of SCALES) {
          for (const side of ['high', 'low'] as const) {
            const slot = segments.filter((s) => s.set === scale && s.side === side).sort((a, b) => a.startBar - b.startBar);
            const terminated = slot.filter((s) => !s.active);
            // Every terminated segment's points survive, in some slot.
            const packed = HIST_KINDS.flatMap((kind) => chunks(byKey(series, `${scale}-${side}-${kind}`)));
            expect([...packed].sort((x, y) => x[0].index - y[0].index)).toEqual(terminated.map((s) => s.points));
            const live = slot.find((s) => s.active);
            expect(byKey(series, `${scale}-${side}-active`).data).toEqual(live ? live.points : []);
          }
        }
      });

      it('every line anchors at a drawn vertex and starts on that vertex’s trigger dot', () => {
        const { legs } = computeAnchoredVwapResult(bars, config);
        for (const scale of SCALES) {
          const legSet = legs.find((l) => l.set === scale)!;
          const vertexKeys = new Set(legSet.vertices.map((v) => `${v.index}@${v.isHigh}`));
          const triggerBars = new Set(legSet.confirmations.map((c) => c.index));
          for (const s of segments.filter((x) => x.set === scale)) {
            expect(vertexKeys.has(`${s.pivotBar}@${s.side === 'high'}`)).toBe(true);
            expect(triggerBars.has(s.startBar)).toBe(true);
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

  it('defaults line 1 heaviest (weight 3) and line 2 thin (weight 1)', () => {
    expect(byKey(series, 'line1-high-active').width).toBe(3);
    expect(byKey(series, 'line1-low-active').width).toBe(3);
    expect(byKey(series, 'line2-high-active').width).toBe(1);
    expect(byKey(series, 'line2-low-active').width).toBe(1);
  });

  it.each([
    ['line1', 'line1Weight'], ['line2', 'line2Weight'],
  ] as const)('%sWeight sets the stroke width on all 6 VWAP slots, integer-clamped to 1–3', (set, key) => {
    const heavy = computeAnchoredVwapSeries(barsFromCloses(CLOSES), { ...PARAMS, [key]: 2 });
    for (const side of ['high', 'low']) {
      for (const kind of [...HIST_KINDS, 'active']) {
        expect(byKey(heavy, `${set}-${side}-${kind}`).width).toBe(2);
      }
    }
    // The legs share the set's weight too.
    expect(byKey(heavy, `${set}-zigzag`).width).toBe(2);
    expect(byKey(heavy, `${set}-developing`).width).toBe(2);
    const clamped = computeAnchoredVwapSeries(barsFromCloses(CLOSES), { ...PARAMS, [key]: 9.7 });
    expect(byKey(clamped, `${set}-high-active`).width).toBe(3);
  });

  it('keeps the width and colour of history identical to the active line — no fading', () => {
    for (const slot of ['line1-high', 'line1-low', 'line2-high', 'line2-low']) {
      const active = byKey(series, `${slot}-active`);
      for (const kind of HIST_KINDS) {
        const h = byKey(series, `${slot}-${kind}`);
        expect(h.color).toBe(active.color);
        expect(h.width).toBe(active.width);
        expect(h.name).toBe(active.name);
      }
    }
  });

  it('uses the default colours, hue encoding the side', () => {
    expect(byKey(series, 'line1-high-active').color).toBe('#FF8CFF');
    expect(byKey(series, 'line1-low-active').color).toBe('#FFFF00');
    expect(byKey(series, 'line2-high-active').color).toBe('#00C853');
    expect(byKey(series, 'line2-low-active').color).toBe('#FF0000');
  });

  it('applies colour params', () => {
    const custom = computeAnchoredVwapSeries(barsFromCloses(CLOSES), { ...PARAMS, line1HighColor: '#123456' });
    expect(byKey(custom, 'line1-high-active').color).toBe('#123456');
    expect(byKey(custom, 'line1-low-active').color).toBe('#FFFF00');
  });

  it('names lines by set, side and retracement percentage', () => {
    expect(byKey(series, 'line1-high-active').name).toBe('AVWAP-1H 5%');
    expect(byKey(series, 'line1-low-active').name).toBe('AVWAP-1L 5%');
    expect(byKey(series, 'line2-high-active').name).toBe('AVWAP-2H 17%');
    expect(byKey(series, 'line2-low-active').name).toBe('AVWAP-2L 17%');
    expect(byKey(series, 'line1-zigzag').name).toBe('ZZ 5%');
    expect(byKey(series, 'line2-zigzag').name).toBe('ZZ 17%');
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

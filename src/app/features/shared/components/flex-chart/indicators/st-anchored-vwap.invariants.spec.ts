import { computeAnchoredVwap, computeAnchoredVwapResult } from './st-anchored-vwap.engine';
import { computeZigZagAnchorEvents, DEFAULT_CONFIG, type AnchorEvent } from './st-zigzag.engine';
import type { AnchoredVwapConfig, AnchoredVwapSegment } from './st-anchored-vwap.types';
import type { PriceBar } from '../flex-chart.types';

// =============================================================================
// Varied synthetic series
// =============================================================================

/** Deterministic pseudo-random walk (LCG) with random volume, including zero-volume bars. */
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
    const volume = rnd() < 0.1 ? 0 : Math.floor(rnd() * 5000);
    const x = new Date(2026, 0, 1 + i);
    // `date` must be x's ISO calendar — the history window compares `date`,
    // not `x`, so a synthetic label would silently disable era mode here.
    const date = `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
    bars.push({ date, x, open, high, low, close, volume });
  }
  return bars;
}

/** Window disabled so the full output is directly comparable to a truncated one. */
const SCENARIOS: { name: string; seed: number; n: number; config: AnchoredVwapConfig }[] = [
  { name: 'depth 3/3, 3% and 8%', seed: 1, n: 320, config: { line1RetracementPct: 3, line2RetracementPct: 8, line1LeftDepth: 3, line1RightDepth: 3, line2LeftDepth: 3, line2RightDepth: 3, maxHistory: 100_000 } },
  { name: 'depth 2/4, 2% and 6%', seed: 3, n: 320, config: { line1RetracementPct: 2, line2RetracementPct: 6, line1LeftDepth: 2, line1RightDepth: 4, line2LeftDepth: 2, line2RightDepth: 4, maxHistory: 100_000 } },
  { name: 'depth 4/2, 5% and 12%', seed: 4, n: 280, config: { line1RetracementPct: 5, line2RetracementPct: 12, line1LeftDepth: 4, line1RightDepth: 2, line2LeftDepth: 4, line2RightDepth: 2, maxHistory: 100_000 } },
];

const events = (bars: PriceBar[], config: AnchoredVwapConfig, scale: 'line1' | 'line2'): AnchorEvent[] =>
  computeZigZagAnchorEvents(bars, {
    ...DEFAULT_CONFIG,
    devThreshold: scale === 'line1' ? config.line1RetracementPct : config.line2RetracementPct,
    leftDepth: scale === 'line1' ? config.line1LeftDepth : config.line2LeftDepth,
    rightDepth: scale === 'line1' ? config.line1RightDepth : config.line2RightDepth,
    allowZigZagOnOneBar: true,
    projectionPivots: false,
  });

/** Direct-summation anchored VWAP at `index` — a different algorithm from the engine's prefix sums. */
function referenceVwap(bars: PriceBar[], pivotBar: number, index: number): number | undefined {
  let pv = 0;
  let v = 0;
  for (let i = pivotBar; i <= index; i++) {
    const tp = (bars[i].high + bars[i].low + bars[i].close) / 3;
    const vol = bars[i].volume ?? 0;
    if (vol > 0 && Number.isFinite(tp)) {
      pv += tp * vol;
      v += vol;
    }
  }
  return v > 0 ? pv / v : undefined;
}

// =============================================================================
// Invariants
// =============================================================================

describe('computeAnchoredVwap — invariants on varied series', () => {
  for (const sc of SCENARIOS) {
    describe(sc.name, () => {
      const bars = makeWalk(sc.seed, sc.n);
      const segs = computeAnchoredVwap(bars, sc.config);

      it('produces lines for both sets and both sides', () => {
        for (const scale of ['line1', 'line2'] as const) {
          for (const side of ['high', 'low'] as const) {
            expect(segs.some((s) => s.set === scale && s.side === side)).toBe(true);
          }
        }
      });

      it('starts every line on its anchor’s confirmation bar and nowhere earlier', () => {
        for (const scale of ['line1', 'line2'] as const) {
          const ev = events(bars, sc.config, scale);
          for (const s of segs.filter((x) => x.set === scale)) {
            const anchor = ev.find((e) => e.pivotBar === s.pivotBar && e.isHigh === (s.side === 'high'))!;
            expect(anchor).toBeDefined();
            expect(s.startBar).toBe(anchor.confirmBar);
            expect(s.points[0].index).toBe(anchor.confirmBar);
            expect(s.points.every((p) => p.index >= anchor.confirmBar)).toBe(true);
          }
        }
      });

      it('hands each line to the next same-side anchor on its confirmation bar, with the last line active to the final bar', () => {
        for (const scale of ['line1', 'line2'] as const) {
          for (const side of ['high', 'low'] as const) {
            const line = segs.filter((s) => s.set === scale && s.side === side).sort((a, b) => a.startBar - b.startBar);
            const anchors = events(bars, sc.config, scale).filter((e) => e.isHigh === (side === 'high'));
            expect(line.map((s) => s.pivotBar)).toEqual(anchors.map((a) => a.pivotBar));
            line.forEach((s, k) => {
              const last = k === line.length - 1;
              expect(s.active).toBe(last);
              expect(s.endBar).toBe(last ? bars.length - 1 : line[k + 1].startBar);
              expect(s.points.map((p) => p.index)).toEqual(
                Array.from({ length: s.endBar - s.startBar + 1 }, (_, i) => s.startBar + i),
              );
            });
          }
        }
      });

      it('matches a direct-summation VWAP from the pivot bar, carrying flat where no volume has accumulated', () => {
        for (const s of segs) {
          let carried = Number.NaN;
          for (const p of s.points) {
            const expected = referenceVwap(bars, s.pivotBar, p.index);
            if (expected !== undefined) carried = expected;
            if (Number.isNaN(carried)) {
              // No volume yet: seeded with the pivot bar's typical price.
              const b = bars[s.pivotBar];
              expect(p.y).toBeCloseTo((b.high + b.low + b.close) / 3, 6);
            } else {
              expect(p.y).toBeCloseTo(carried, 6);
            }
          }
        }
      });

      it('treats the history window as a pure filter: a windowed segment is identical to its unwindowed twin and active lines always remain', () => {
        const byKey = new Map<string, AnchoredVwapSegment>(segs.map((s) => [s.key, s]));
        const modes: Partial<AnchoredVwapConfig>[] = [
          { maxHistory: 3 },
          { maxHistory: 3, historyStart: bars[Math.floor(bars.length / 2)].date },
          { maxHistory: 0 },
        ];
        for (const mode of modes) {
          const windowed = computeAnchoredVwap(bars, { ...sc.config, ...mode });
          for (const s of windowed) expect(s).toEqual(byKey.get(s.key));
          const activeKeys = (list: AnchoredVwapSegment[]) => list.filter((s) => s.active).map((s) => s.key).sort();
          expect(activeKeys(windowed)).toEqual(activeKeys(segs));
        }
      });

      it('never looks ahead: output at bar t from bars[0..t] equals the full output restricted to bars ≤ t', () => {
        const byKey = new Map<string, AnchoredVwapSegment>(segs.map((s) => [s.key, s]));
        for (let t = 40; t < bars.length; t += 11) {
          const truncated = computeAnchoredVwap(bars.slice(0, t + 1), sc.config);
          const fullUpToT = segs.filter((s) => s.startBar <= t);
          expect(truncated.map((s) => s.key).sort()).toEqual(fullUpToT.map((s) => s.key).sort());
          for (const s of truncated) {
            const full = byKey.get(s.key)!;
            expect(s.points).toEqual(full.points.filter((p) => p.index <= t));
          }
        }
      });

      it('chains legs over surviving anchors only — superseded anchors anchor segments but not vertices', () => {
        const { legs } = computeAnchoredVwapResult(bars, sc.config);
        for (const scale of ['line1', 'line2'] as const) {
          const legSet = legs.find((l) => l.set === scale)!;
          const anchors = events(bars, sc.config, scale);
          // A `replaced` event supersedes the anchor immediately before it;
          // the chain walks survivors only, so legs alternate like ST ZigZag.
          const surviving = anchors.filter((a, i) => !anchors[i + 1]?.replaced);
          // Same-bar high+low survivors still collapse to the later one (a
          // line series can't draw two vertices at one index).
          const expected = surviving
            .filter((a, i, all) => i === all.length - 1 || all[i + 1].pivotBar !== a.pivotBar);
          expect(legSet.vertices.map((v) => v.index)).toEqual(expected.map((a) => a.pivotBar));
          expect(legSet.vertices.map((v) => v.y)).toEqual(expected.map((a) => a.price));
          // Legs connect consecutive vertices, each painted its destination's side.
          expect(legSet.confirmed.map((l) => [l.from, l.to])).toEqual(
            legSet.vertices.slice(1).map((to, i) => [legSet.vertices[i], to]),
          );
          expect(legSet.confirmed.map((l) => l.isHigh)).toEqual(legSet.vertices.slice(1).map((v) => v.isHigh));
          // A surviving anchor's segment has a coincident vertex; a superseded
          // anchor keeps its segment but loses the mark — unless a surviving
          // opposite-side event coincidentally shares its bar.
          for (const s of segs.filter((x) => x.set === scale)) {
            const anchor = anchors.find((a) => a.pivotBar === s.pivotBar && a.isHigh === (s.side === 'high'))!;
            const vertex = legSet.vertices.find((v) => v.index === s.pivotBar && v.isHigh === anchor.isHigh);
            if (!surviving.includes(anchor)) {
              expect(vertex).toBeUndefined();
            } else if (expected.includes(anchor)) {
              expect(vertex?.y).toBe(anchor.price);
            } else {
              // Survived but lost a same-bar collapse — the kept opposite-side
              // event still marks the bar.
              expect(legSet.vertices.some((v) => v.index === s.pivotBar)).toBe(true);
            }
          }
        }
      });

      it('legs only rewrite forward: a truncated chain’s vertices are all real anchors of the full stream — superseded at most', () => {
        const full = computeAnchoredVwapResult(bars, sc.config).legs;
        const verticesOf = (legs: typeof full, scale: string) =>
          legs.find((l) => l.set === scale)!.vertices.map((v) => `${v.index}@${v.y}`);
        for (let t = 40; t < bars.length; t += 11) {
          const truncated = computeAnchoredVwapResult(bars.slice(0, t + 1), sc.config);
          for (const legSet of truncated.legs) {
            // Survival isn't causal — an anchor superseded later disappears
            // from the full chain — so the truncated chain isn't a prefix of
            // it. But it can't invent anchors: every vertex is a real anchor
            // event of the full stream, surviving or later superseded.
            const fullEvents = events(bars, sc.config, legSet.set);
            const allowed = new Set([
              ...verticesOf(full, legSet.set),
              ...fullEvents.filter((a, i) => fullEvents[i + 1]?.replaced).map((a) => `${a.pivotBar}@${a.price}`),
            ]);
            for (const v of verticesOf(truncated.legs, legSet.set)) {
              expect(allowed.has(v)).toBe(true);
            }
          }
        }
      });

      it('develops the leg only beyond the last anchor — it never anchors a line', () => {
        const { legs } = computeAnchoredVwapResult(bars, sc.config);
        for (const legSet of legs) {
          // No anchors → nothing to chain a developing leg off.
          if (legSet.vertices.length === 0) {
            expect(legSet.developing).toBeNull();
            continue;
          }
          // Anchors but no qualifying post-pivot move → no developing leg.
          if (!legSet.developing) continue;
          const lastVertex = legSet.vertices[legSet.vertices.length - 1];
          expect(legSet.developing.from).toEqual(lastVertex);
          // The projection pivot is scanned strictly after the last anchor.
          expect(legSet.developing.to.index).toBeGreaterThan(legSet.developing.from.index);
          // The developing tip is never a segment anchor.
          expect(segs.filter((s) => s.set === legSet.set).every((s) => s.pivotBar !== legSet.developing!.to.index)).toBe(true);
        }
      });

      it('the developing tip is causal: on bars[0..t] it chains off that prefix’s last vertex', () => {
        for (let t = 40; t < bars.length; t += 11) {
          const truncated = computeAnchoredVwapResult(bars.slice(0, t + 1), sc.config);
          for (const legSet of truncated.legs) {
            if (!legSet.developing) continue; // no qualifying move on the prefix
            const lastVertex = legSet.vertices[legSet.vertices.length - 1];
            expect(legSet.developing.from).toEqual(lastVertex);
            // Tip strictly after the last vertex and within the prefix.
            expect(legSet.developing.to.index).toBeGreaterThan(lastVertex.index);
            expect(legSet.developing.to.index).toBeLessThanOrEqual(t);
          }
        }
      });
    });
  }
});

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

      it('starts every line on its anchor’s trigger bar — the first bar crossing the deviation threshold', () => {
        for (const scale of ['line1', 'line2'] as const) {
          const dev = scale === 'line1' ? sc.config.line1RetracementPct : sc.config.line2RetracementPct;
          const ev = events(bars, sc.config, scale);
          for (const s of segs.filter((x) => x.set === scale)) {
            const anchor = ev.find((e) => e.pivotBar === s.pivotBar && e.isHigh === (s.side === 'high'))!;
            expect(anchor).toBeDefined();
            // Independent trigger: first bar whose far side crossed the level.
            const level = s.side === 'high' ? anchor.price * (1 - dev / 100) : anchor.price * (1 + dev / 100);
            let trigger = s.pivotBar;
            while (trigger < bars.length && !(s.side === 'high' ? bars[trigger].low <= level : bars[trigger].high >= level)) {
              trigger++;
            }
            expect(s.startBar).toBe(trigger);
            expect(s.points[0].index).toBe(trigger);
            expect(s.points.every((p) => p.index >= s.pivotBar)).toBe(true);
          }
        }
      });

      it('draws one line per vertex whose reversal has triggered — every vertex but possibly the last', () => {
        // The scenario must exercise new extremes, or "supersession adds no line" is vacuous.
        expect((['line1', 'line2'] as const).some((scale) => events(bars, sc.config, scale).some((a) => a.replaced))).toBe(true);
        const { legs } = computeAnchoredVwapResult(bars, sc.config);
        for (const scale of ['line1', 'line2'] as const) {
          // Two reversals can fire on one bar (allowZigZagOnOneBar) — the
          // earlier line is then a single point; break the tie by pivot.
          const line = segs.filter((s) => s.set === scale).sort((a, b) => a.startBar - b.startBar || a.pivotBar - b.pivotBar);
          const vertices = legs.find((l) => l.set === scale)!.vertices;
          // Lines anchor at surviving vertices, and a mid-chain vertex's
          // trigger is guaranteed (the next vertex deviates ≥ the threshold)
          // — only the last vertex can be untriggered, so lines are a prefix.
          expect([vertices.length, vertices.length - 1]).toContain(line.length);
          expect(line.map((s) => `${s.side}@${s.pivotBar}`)).toEqual(
            vertices.slice(0, line.length).map((v) => `${v.isHigh ? 'high' : 'low'}@${v.index}`),
          );
          // allowZigZagOnOneBar can leave consecutive same-side vertices in
          // the chain (a same-bar high+low pair collapses to the later one),
          // so sides need not strictly alternate.
          line.forEach((s, k) => {
            const last = k === line.length - 1;
            expect(s.active).toBe(last);
            expect(s.endBar).toBe(last ? bars.length - 1 : line[k + 1].startBar);
            expect(s.points.map((p) => p.index)).toEqual(
              Array.from({ length: s.endBar - s.startBar + 1 }, (_, i) => s.startBar + i),
            );
          });
          // Consecutive segments tile without gaps: each ends where the next begins.
          for (let k = 1; k < line.length; k++) {
            expect(line[k].startBar).toBe(line[k - 1].endBar);
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

      it('never looks ahead: every truncated line’s anchor is a real event knowable by t, and values agree where both runs draw the line', () => {
        const byKey = new Map<string, AnchoredVwapSegment>(segs.map((s) => [s.key, s]));
        for (let t = 40; t < bars.length; t += 11) {
          const truncated = computeAnchoredVwap(bars.slice(0, t + 1), sc.config);
          const truncatedKeys = new Set(truncated.map((s) => s.key));
          // The other direction: a full line whose vertex registered and
          // whose trigger fired by t must be drawn in the truncated run.
          for (const full of segs) {
            const anchor = events(bars, sc.config, full.set).find(
              (e) => e.pivotBar === full.pivotBar && e.isHigh === (full.side === 'high'),
            )!;
            if (full.startBar <= t && anchor.confirmBar <= t) {
              expect(truncatedKeys.has(full.key)).toBe(true);
            }
          }
          for (const s of truncated) {
            const anchor = events(bars, sc.config, s.set).find(
              (e) => e.pivotBar === s.pivotBar && e.isHigh === (s.side === 'high'),
            );
            // The anchor must be a real pivot of the full stream — and the
            // vertex can only be in the truncated chain if it registered by t.
            expect(anchor).toBeDefined();
            expect(anchor!.confirmBar).toBeLessThanOrEqual(t);
            const full = byKey.get(s.key);
            if (full) {
              // Values agree over the shared drawn range. Either run can
              // legitimately end earlier: the truncated line may continue
              // past the full endBar (the ending reversal isn't knowable at
              // t) or stop short (an extra vertex superseded only later in
              // the full stream ended it here).
              const truncatedY = new Map(s.points.map((p) => [p.index, p.y]));
              for (const p of full.points) {
                if (p.index <= s.endBar) expect(truncatedY.get(p.index)).toBe(p.y);
              }
              const fullY = new Map(full.points.map((p) => [p.index, p.y]));
              for (const p of s.points) {
                if (p.index <= full.endBar) expect(fullY.get(p.index)).toBe(p.y);
              }
            }
            // else the vertex was superseded in the full stream — the line is
            // legitimately absent there.
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
          expect(legSet.vertices.map((v) => v.isHigh)).toEqual(expected.map((a) => a.isHigh));
          // Every segment anchors at a drawn vertex — superseded anchors
          // never carry a line under vertex-anchored legs.
          const vertexKeys = new Set(legSet.vertices.map((v) => `${v.index}@${v.isHigh}`));
          for (const s of segs.filter((x) => x.set === scale)) {
            expect(vertexKeys.has(`${s.pivotBar}@${s.side === 'high'}`)).toBe(true);
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

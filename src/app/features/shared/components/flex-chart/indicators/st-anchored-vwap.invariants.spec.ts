import { computeAnchoredVwap } from './st-anchored-vwap.engine';
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
    bars.push({ date: `d${i}`, x: new Date(2026, 0, 1 + i), open, high, low, close, volume });
  }
  return bars;
}

/** Window disabled so the full output is directly comparable to a truncated one. */
const SCENARIOS: { name: string; seed: number; n: number; config: AnchoredVwapConfig }[] = [
  { name: 'depth 3/3, 3% and 8%', seed: 1, n: 320, config: { smallRetracementPct: 3, largeRetracementPct: 8, leftDepth: 3, rightDepth: 3, maxHistory: 100_000 } },
  { name: 'depth 2/4, 2% and 6%', seed: 3, n: 320, config: { smallRetracementPct: 2, largeRetracementPct: 6, leftDepth: 2, rightDepth: 4, maxHistory: 100_000 } },
  { name: 'depth 4/2, 5% and 12%', seed: 4, n: 280, config: { smallRetracementPct: 5, largeRetracementPct: 12, leftDepth: 4, rightDepth: 2, maxHistory: 100_000 } },
];

const events = (bars: PriceBar[], config: AnchoredVwapConfig, scale: 'small' | 'large'): AnchorEvent[] =>
  computeZigZagAnchorEvents(bars, {
    ...DEFAULT_CONFIG,
    devThreshold: scale === 'small' ? config.smallRetracementPct : config.largeRetracementPct,
    leftDepth: config.leftDepth,
    rightDepth: config.rightDepth,
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

      it('produces lines for both scales and both sides', () => {
        for (const scale of ['small', 'large'] as const) {
          for (const side of ['high', 'low'] as const) {
            expect(segs.some((s) => s.scale === scale && s.side === side)).toBe(true);
          }
        }
      });

      it('starts every line on its anchor’s confirmation bar and nowhere earlier', () => {
        for (const scale of ['small', 'large'] as const) {
          const ev = events(bars, sc.config, scale);
          for (const s of segs.filter((x) => x.scale === scale)) {
            const anchor = ev.find((e) => e.pivotBar === s.pivotBar && e.isHigh === (s.side === 'high'))!;
            expect(anchor).toBeDefined();
            expect(s.startBar).toBe(anchor.confirmBar);
            expect(s.points[0].index).toBe(anchor.confirmBar);
            expect(s.points.every((p) => p.index >= anchor.confirmBar)).toBe(true);
          }
        }
      });

      it('hands each line to the next same-side anchor on its confirmation bar, with the last line active to the final bar', () => {
        for (const scale of ['small', 'large'] as const) {
          for (const side of ['high', 'low'] as const) {
            const line = segs.filter((s) => s.scale === scale && s.side === side).sort((a, b) => a.startBar - b.startBar);
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
          { maxHistory: 3, historyStart: bars[Math.floor(bars.length / 2)].x.getTime() },
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
    });
  }
});

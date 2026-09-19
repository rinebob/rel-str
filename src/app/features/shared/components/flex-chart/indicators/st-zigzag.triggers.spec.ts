import { computeTriggerPoints } from './st-zigzag.triggers';
import type { Pivot } from './st-zigzag.types';
import type { PriceBar } from '../flex-chart.types';

// =============================================================================
// Test helpers
// =============================================================================

function makeBars(prices: { o: number; h: number; l: number; c: number; v?: number }[]): PriceBar[] {
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

function highPivot(barIndex: number, price: number): Pivot {
  return { barIndex, time: 0, price, isHigh: true, confirmed: true };
}

function lowPivot(barIndex: number, price: number): Pivot {
  return { barIndex, time: 0, price, isHigh: false, confirmed: true };
}

const DEV = 5; // percent

// =============================================================================
// computeTriggerPoints
// =============================================================================

describe('computeTriggerPoints', () => {
  it('returns empty for no pivots', () => {
    expect(computeTriggerPoints(makeBars([{ o: 10, h: 11, l: 9, c: 10 }]), [], DEV)).toEqual([]);
  });

  it('marks the first bar whose low crosses below a high pivot by devThreshold', () => {
    // High pivot at 100 on bar 0; threshold level = 95.
    const bars = makeBars([
      { o: 99, h: 100, l: 97, c: 98 },  // bar 0: low 97 > 95 — no cross
      { o: 98, h: 99, l: 96, c: 97 },   // bar 1: low 96 > 95 — no cross
      { o: 97, h: 98, l: 94, c: 95 },   // bar 2: low 94 <= 95 — TRIGGER
      { o: 95, h: 96, l: 92, c: 93 },   // bar 3: deeper cross — not the trigger
    ]);
    const triggers = computeTriggerPoints(bars, [highPivot(0, 100)], DEV);
    expect(triggers.length).toBe(1);
    expect(triggers[0].barIndex).toBe(2);
    expect(triggers[0].price).toBeCloseTo(95);
    expect(triggers[0].isHigh).toBe(true);
  });

  it('marks the first bar whose high crosses above a low pivot by devThreshold', () => {
    // Low pivot at 100 on bar 0; threshold level = 105.
    const bars = makeBars([
      { o: 101, h: 103, l: 100, c: 102 }, // bar 0: high 103 < 105 — no cross
      { o: 102, h: 106, l: 101, c: 105 }, // bar 1: high 106 >= 105 — TRIGGER
      { o: 105, h: 110, l: 104, c: 109 }, // bar 2: higher — not the trigger
    ]);
    const triggers = computeTriggerPoints(bars, [lowPivot(0, 100)], DEV);
    expect(triggers.length).toBe(1);
    expect(triggers[0].barIndex).toBe(1);
    expect(triggers[0].price).toBeCloseTo(105);
    expect(triggers[0].isHigh).toBe(false);
  });

  it('emits no point when the threshold never crosses (last pivot)', () => {
    const bars = makeBars([
      { o: 99, h: 100, l: 98, c: 99 },
      { o: 99, h: 100, l: 97, c: 98 }, // low 97 > 95 — no cross
      { o: 98, h: 99, l: 96.5, c: 97 },
    ]);
    expect(computeTriggerPoints(bars, [highPivot(0, 100)], DEV)).toEqual([]);
  });

  it('emits one trigger per pivot across a pivot sequence', () => {
    // High at bar 0 (100) → low at bar 4 (90) → high at bar 8 (99).
    // Trigger for pivot 0: first low <= 95 → bar 2.
    // Trigger for pivot 1: first high >= 94.5 → bar 6.
    const bars = makeBars([
      { o: 99, h: 100, l: 98, c: 99 },   // 0: high pivot 100
      { o: 98, h: 99, l: 96, c: 97 },    // 1: low 96 > 95
      { o: 96, h: 97, l: 94, c: 95 },    // 2: low 94 <= 95 — trigger for pivot 0
      { o: 94, h: 95, l: 91, c: 92 },    // 3
      { o: 91, h: 92, l: 90, c: 91 },    // 4: low pivot 90
      { o: 92, h: 93, l: 91, c: 92 },    // 5: high 93 < 94.5
      { o: 93, h: 95, l: 92, c: 94 },    // 6: high 95 >= 94.5 — trigger for pivot 1
      { o: 95, h: 98, l: 94, c: 97 },    // 7
      { o: 98, h: 99, l: 96, c: 98 },    // 8: high pivot 99 (no bars after — no trigger)
    ]);
    const pivots = [highPivot(0, 100), lowPivot(4, 90), highPivot(8, 99)];
    const triggers = computeTriggerPoints(bars, pivots, DEV);
    expect(triggers.length).toBe(2);
    expect(triggers[0].barIndex).toBe(2);
    expect(triggers[0].price).toBeCloseTo(95);
    expect(triggers[1].barIndex).toBe(6);
    expect(triggers[1].price).toBeCloseTo(94.5);
  });

  it('bounds the scan to the next pivot — crossing after it is not claimed', () => {
    // Pivot at bar 0 (100), next pivot at bar 2. The threshold (95) is
    // crossed only at bar 3 — after the next pivot — so pivot 0's trigger
    // must not look beyond bar 2... but bar 2's own low satisfies dev, so
    // this case cannot happen in a real pivot stream; the bound guarantees
    // we never attribute a later crossing to an earlier pivot.
    const bars = makeBars([
      { o: 99, h: 100, l: 98, c: 99 },  // 0: high pivot 100
      { o: 98, h: 99, l: 96, c: 97 },   // 1: no cross (96 > 95)
      { o: 96, h: 97, l: 95, c: 96 },   // 2: next pivot — low 95 <= 95 crosses at bound
      { o: 95, h: 96, l: 90, c: 91 },   // 3
    ]);
    const triggers = computeTriggerPoints(bars, [highPivot(0, 100), lowPivot(2, 95)], DEV);
    expect(triggers[0].barIndex).toBe(2); // bound inclusive
  });

  it('can trigger on the pivot bar itself for a one-bar reversal', () => {
    // High pivot at 100; the same bar's low 94 <= 95 — one-bar zigzag.
    const bars = makeBars([
      { o: 97, h: 100, l: 94, c: 95 },
      { o: 95, h: 96, l: 93, c: 94 },
    ]);
    const triggers = computeTriggerPoints(bars, [highPivot(0, 100), lowPivot(0, 94)], DEV);
    // Both pivots trigger on bar 0: the high pivot's low (94 <= 95)
    // crosses down, and the low pivot's high (100 >= 98.7) crosses up —
    // a true one-bar reversal flips both ways on the same bar.
    expect(triggers.length).toBe(2);
    expect(triggers[0].barIndex).toBe(0);
    expect(triggers[1].barIndex).toBe(0);
  });

  it('skips bars with non-finite extremes', () => {
    const bars = makeBars([
      { o: 99, h: 100, l: 98, c: 99 },
      { o: 98, h: 99, l: NaN, c: 97 },  // non-finite low — skipped
      { o: 97, h: 98, l: 94, c: 95 },   // bar 2 crosses
    ]);
    const triggers = computeTriggerPoints(bars, [highPivot(0, 100)], DEV);
    expect(triggers.length).toBe(1);
    expect(triggers[0].barIndex).toBe(2);
  });
});

import { computeZigZagPivots, deriveSwings, computeSwingStats } from './st-zigzag.engine';
import type { ZigZagConfig } from './st-zigzag.engine';
import type { PriceBar } from '../flex-chart.types';

// =============================================================================
// End-to-end engine test: computeZigZagPivots → deriveSwings → computeSwingStats
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

describe('ZigZag engine end-to-end', () => {
  it('runs the full pipeline: pivots → swings → stats', () => {
    // Create a zigzag pattern with multiple swings
    const prices: { o: number; h: number; l: number; c: number; v?: number }[] = [];
    // Rise: bars 0-4, highs 10..50
    for (let i = 0; i < 5; i++) prices.push({ o: 10 + i * 10, h: 15 + i * 10, l: 5 + i * 10, c: 10 + i * 10, v: 1000 });
    // Fall: bars 5-9, lows 45..5
    for (let i = 0; i < 5; i++) prices.push({ o: 45 - i * 10, h: 50 - i * 10, l: 40 - i * 10, c: 45 - i * 10, v: 1000 });
    // Rise: bars 10-14, highs 10..50
    for (let i = 0; i < 5; i++) prices.push({ o: 10 + i * 10, h: 15 + i * 10, l: 5 + i * 10, c: 10 + i * 10, v: 1000 });
    // Fall: bars 15-19, lows 45..5
    for (let i = 0; i < 5; i++) prices.push({ o: 45 - i * 10, h: 50 - i * 10, l: 40 - i * 10, c: 45 - i * 10, v: 1000 });

    const bars = makeBars(prices);
    const config: ZigZagConfig = {
      devThreshold: 20.0,
      leftDepth: 2,
      rightDepth: 2,
      allowZigZagOnOneBar: true,
      projectionPivots: false,
      lineColor: '#1976d2',
    };

    // Step 1: Compute pivots
    const { pivots, projection } = computeZigZagPivots(bars, config);
    expect(pivots.length).toBeGreaterThanOrEqual(2);
    for (let i = 1; i < pivots.length; i++) {
      expect(pivots[i].isHigh).not.toBe(pivots[i - 1].isHigh);
    }

    // Step 2: Derive swings
    const swings = deriveSwings(pivots, bars, projection);
    expect(swings.length).toBe(pivots.length - 1 + (projection ? 1 : 0));
    for (const swing of swings) {
      expect(swing.magnitudeAbsolute).toBeGreaterThanOrEqual(0);
      expect(swing.duration).toBeGreaterThan(0);
    }

    // Step 3: Compute stats (only confirmed swings)
    const stats = computeSwingStats(swings);
    const confirmedSwings = swings.filter(s => s.confirmed);
    const upCount = confirmedSwings.filter(s => s.direction === 'up').length;
    const downCount = confirmedSwings.filter(s => s.direction === 'down').length;
    expect(stats.up.count).toBe(upCount);
    expect(stats.down.count).toBe(downCount);
  });

  it('handles the single-pivot + projection case end-to-end', () => {
    // Rise to a peak, then a moderate drop (not enough to confirm a low pivot)
    const prices: { o: number; h: number; l: number; c: number; v?: number }[] = [];
    for (let i = 0; i < 8; i++) prices.push({ o: 100 + i * 5, h: 105 + i * 5, l: 95 + i * 5, c: 100 + i * 5, v: 1000 });
    for (let i = 0; i < 3; i++) prices.push({ o: 135 - i * 5, h: 140 - i * 5, l: 130 - i * 5, c: 135 - i * 5, v: 1000 });
    const bars = makeBars(prices);
    const config: ZigZagConfig = {
      devThreshold: 5.0, leftDepth: 2, rightDepth: 2,
      allowZigZagOnOneBar: true, projectionPivots: true,
      lineColor: '#1976d2',
    };

    const { pivots, projection } = computeZigZagPivots(bars, config);
    expect(pivots).toHaveLength(1);
    expect(projection).toBeDefined();

    const swings = deriveSwings(pivots, bars, projection);
    expect(swings).toHaveLength(1);
    expect(swings[0].confirmed).toBe(false);
    expect(swings[0].volume).toBeGreaterThan(0);

    const stats = computeSwingStats(swings);
    // Projected swing excluded from stats
    expect(stats.up.count + stats.down.count).toBe(0);
  });
});

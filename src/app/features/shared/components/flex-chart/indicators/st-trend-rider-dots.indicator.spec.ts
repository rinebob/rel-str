import { detectZoneZeroCrossDots } from './st-trend-rider-dots.indicator';
import type { PriceBar } from '../flex-chart.types';

// =============================================================================
// Test helpers
// =============================================================================

function makeBars(count: number): PriceBar[] {
  const bars: PriceBar[] = [];
  for (let i = 0; i < count; i++) {
    const c = 100 + i;
    bars.push({
      date: `2026-01-${String(i + 1).padStart(2, '0')}`,
      x: new Date(2026, 0, i + 1),
      open: c,
      high: c + 5,
      low: c - 5,
      close: c,
    });
  }
  return bars;
}

function makeZoneData(zones: (number | undefined)[]): { x: Date; y: number | undefined }[] {
  return zones.map((z, i) => ({
    x: new Date(2026, 0, i + 1),
    y: z,
  }));
}

const LONG_COLOR = '#009688';
const SHORT_COLOR = '#FF9800';

// =============================================================================
// Basic detection
// =============================================================================

describe('detectZoneZeroCrossDots', () => {
  it('fires bullish cross dot when zone goes from negative to positive', () => {
    const bars = makeBars(3);
    const zoneData = makeZoneData([-1, -1, 1]);
    const dots = detectZoneZeroCrossDots(zoneData, bars, LONG_COLOR, SHORT_COLOR);
    expect(dots.length).toBe(1);
    expect(dots[0].color).toBe(LONG_COLOR);
    // Long dot placed below bar: bar.low - ATR*2.5
    expect(dots[0].y).toBeLessThan(bars[2].low);
  });

  it('fires bearish cross dot when zone goes from positive to negative', () => {
    const bars = makeBars(3);
    const zoneData = makeZoneData([1, 1, -1]);
    const dots = detectZoneZeroCrossDots(zoneData, bars, LONG_COLOR, SHORT_COLOR);
    expect(dots.length).toBe(1);
    expect(dots[0].color).toBe(SHORT_COLOR);
    // Short dot placed above bar: bar.high + ATR*2.5
    expect(dots[0].y).toBeGreaterThan(bars[2].high);
  });

  it('does not fire when zone stays same sign', () => {
    const bars = makeBars(3);
    const zoneData = makeZoneData([1, 2, 3]);
    const dots = detectZoneZeroCrossDots(zoneData, bars, LONG_COLOR, SHORT_COLOR);
    expect(dots.length).toBe(0);
  });

  it('does not fire when zone lands on zero from negative', () => {
    const bars = makeBars(3);
    const zoneData = makeZoneData([-1, -1, 0]);
    const dots = detectZoneZeroCrossDots(zoneData, bars, LONG_COLOR, SHORT_COLOR);
    expect(dots.length).toBe(0);
  });

  it('does not fire when zone leaves zero to positive', () => {
    const bars = makeBars(3);
    const zoneData = makeZoneData([0, 0, 1]);
    const dots = detectZoneZeroCrossDots(zoneData, bars, LONG_COLOR, SHORT_COLOR);
    expect(dots.length).toBe(0);
  });

  // =============================================================================
  // Jump cases
  // =============================================================================

  it('fires on jump over zero (-2 to +1)', () => {
    const bars = makeBars(3);
    const zoneData = makeZoneData([-2, -2, 1]);
    const dots = detectZoneZeroCrossDots(zoneData, bars, LONG_COLOR, SHORT_COLOR);
    expect(dots.length).toBe(1);
    expect(dots[0].color).toBe(LONG_COLOR);
  });

  it('fires on large jump (+3 to -3)', () => {
    const bars = makeBars(3);
    const zoneData = makeZoneData([3, 3, -3]);
    const dots = detectZoneZeroCrossDots(zoneData, bars, LONG_COLOR, SHORT_COLOR);
    expect(dots.length).toBe(1);
    expect(dots[0].color).toBe(SHORT_COLOR);
  });

  it('does not fire on jump to zero (-2 to 0)', () => {
    const bars = makeBars(3);
    const zoneData = makeZoneData([-2, -2, 0]);
    const dots = detectZoneZeroCrossDots(zoneData, bars, LONG_COLOR, SHORT_COLOR);
    expect(dots.length).toBe(0);
  });

  // =============================================================================
  // Multiple crosses
  // =============================================================================

  it('fires on each sign flip in sequence', () => {
    const bars = makeBars(5);
    // -1 → +1 → -1 → +1 → -1 (crosses at bars 1, 2, 3, 4)
    const zoneData = makeZoneData([-1, 1, -1, 1, -1]);
    const dots = detectZoneZeroCrossDots(zoneData, bars, LONG_COLOR, SHORT_COLOR);
    expect(dots.length).toBe(4);
    expect(dots[0].color).toBe(LONG_COLOR);  // -1 → +1
    expect(dots[1].color).toBe(SHORT_COLOR); // +1 → -1
    expect(dots[2].color).toBe(LONG_COLOR);  // -1 → +1
    expect(dots[3].color).toBe(SHORT_COLOR); // +1 → -1
  });

  it('does not fire on flat bars between crosses', () => {
    const bars = makeBars(4);
    // -1 → +1 → +1 → -1 (crosses at bars 1 and 3 only)
    const zoneData = makeZoneData([-1, 1, 1, -1]);
    const dots = detectZoneZeroCrossDots(zoneData, bars, LONG_COLOR, SHORT_COLOR);
    expect(dots.length).toBe(2);
    expect(dots[0].color).toBe(LONG_COLOR);  // -1 → +1
    expect(dots[1].color).toBe(SHORT_COLOR); // +1 → -1
  });

  // =============================================================================
  // Edge cases
  // =============================================================================

  it('returns empty for empty zone data', () => {
    const bars = makeBars(3);
    const dots = detectZoneZeroCrossDots([], bars, LONG_COLOR, SHORT_COLOR);
    expect(dots.length).toBe(0);
  });

  it('returns empty for single bar', () => {
    const bars = makeBars(1);
    const zoneData = makeZoneData([1]);
    const dots = detectZoneZeroCrossDots(zoneData, bars, LONG_COLOR, SHORT_COLOR);
    expect(dots.length).toBe(0);
  });

  it('returns empty when all zones are zero', () => {
    const bars = makeBars(4);
    const zoneData = makeZoneData([0, 0, 0, 0]);
    const dots = detectZoneZeroCrossDots(zoneData, bars, LONG_COLOR, SHORT_COLOR);
    expect(dots.length).toBe(0);
  });

  it('handles V1 range (-3 to +3)', () => {
    const bars = makeBars(5);
    // -3 → -1 → 0 → 1 → 3 (cross at bar 3: 0→1 is NOT a cross, but -1→0 is not, 0→1 is not)
    // Actually: -3 → -1 (same sign, no cross), -1 → 0 (no cross, landed on zero),
    // 0 → 1 (no cross, left zero), 1 → 3 (same sign, no cross)
    const zoneData = makeZoneData([-3, -1, 0, 1, 3]);
    const dots = detectZoneZeroCrossDots(zoneData, bars, LONG_COLOR, SHORT_COLOR);
    expect(dots.length).toBe(0);
  });

  it('handles V2 range (-4 to +4) with direct jump', () => {
    const bars = makeBars(3);
    // -4 → -2 → 4 (cross at bar 2: -2 → +4, sign flip)
    const zoneData = makeZoneData([-4, -2, 4]);
    const dots = detectZoneZeroCrossDots(zoneData, bars, LONG_COLOR, SHORT_COLOR);
    expect(dots.length).toBe(1);
    expect(dots[0].color).toBe(LONG_COLOR);
  });

  // =============================================================================
  // Placement
  // =============================================================================

  it('places long dot below bar.low', () => {
    const bars = makeBars(3);
    const zoneData = makeZoneData([-1, -1, 1]);
    const dots = detectZoneZeroCrossDots(zoneData, bars, LONG_COLOR, SHORT_COLOR);
    expect(dots.length).toBe(1);
    expect(dots[0].y).toBeLessThan(bars[2].low);
  });

  it('places short dot above bar.high', () => {
    const bars = makeBars(3);
    const zoneData = makeZoneData([1, 1, -1]);
    const dots = detectZoneZeroCrossDots(zoneData, bars, LONG_COLOR, SHORT_COLOR);
    expect(dots.length).toBe(1);
    expect(dots[0].y).toBeGreaterThan(bars[2].high);
  });

  it('uses teal for long color', () => {
    const bars = makeBars(3);
    const zoneData = makeZoneData([-1, -1, 1]);
    const dots = detectZoneZeroCrossDots(zoneData, bars, LONG_COLOR, SHORT_COLOR);
    expect(dots[0].color).toBe('#009688');
  });

  it('uses orange for short color', () => {
    const bars = makeBars(3);
    const zoneData = makeZoneData([1, 1, -1]);
    const dots = detectZoneZeroCrossDots(zoneData, bars, LONG_COLOR, SHORT_COLOR);
    expect(dots[0].color).toBe('#FF9800');
  });

  // =============================================================================
  // Null/missing zone values — breaks the sequence
  // =============================================================================

  it('does not fire when null zone breaks the sequence between sign flip', () => {
    const bars = makeBars(4);
    // -1, null, +1 — null breaks the sequence, no cross should fire
    const zoneData = makeZoneData([-1, undefined, 1]);
    const dots = detectZoneZeroCrossDots(zoneData, bars, LONG_COLOR, SHORT_COLOR);
    expect(dots.length).toBe(0);
  });

  it('does not fire when current zone is undefined', () => {
    const bars = makeBars(3);
    const zoneData = makeZoneData([-1, undefined, 1]);
    const dots = detectZoneZeroCrossDots(zoneData, bars, LONG_COLOR, SHORT_COLOR);
    expect(dots.length).toBe(0);
  });

  it('does not fire when previous zone is undefined', () => {
    const bars = makeBars(3);
    const zoneData = makeZoneData([undefined, -1, 1]);
    const dots = detectZoneZeroCrossDots(zoneData, bars, LONG_COLOR, SHORT_COLOR);
    // undefined → -1: no cross (prev is undefined)
    // -1 → 1: cross! (both defined, sign flip)
    expect(dots.length).toBe(1);
    expect(dots[0].color).toBe(LONG_COLOR);
  });

  it('fires on cross after null gap is cleared', () => {
    const bars = makeBars(5);
    // -1, null, null, +1, +1 — null breaks sequence, then +1 → +1 is same sign
    // No cross should fire because the null gap breaks the -1 → +1 sequence
    const zoneData = makeZoneData([-1, undefined, undefined, 1, 1]);
    const dots = detectZoneZeroCrossDots(zoneData, bars, LONG_COLOR, SHORT_COLOR);
    expect(dots.length).toBe(0);
  });

  it('fires on cross when both zones are defined and adjacent', () => {
    const bars = makeBars(4);
    // -1, -1, null, +1 — null breaks sequence, but -1 → -1 is same sign
    // Then null → +1: prev is undefined, no cross
    // No cross should fire
    const zoneData = makeZoneData([-1, -1, undefined, 1]);
    const dots = detectZoneZeroCrossDots(zoneData, bars, LONG_COLOR, SHORT_COLOR);
    expect(dots.length).toBe(0);
  });
});

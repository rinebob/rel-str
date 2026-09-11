import { calculateStdDevLines, computeStdDevLinesSeries, STD_DEV_LINES_INDICATOR } from './std-dev-lines.indicator';
import type { PriceBar } from '../flex-chart.types';
import { StIndicator } from '../flex-chart.types';

// =============================================================================
// Test helpers
// =============================================================================

function makeBars(closes: number[]): PriceBar[] {
  return closes.map((c, i) => ({
    date: `2026-01-${String(i + 1).padStart(2, '0')}`,
    x: new Date(2026, 0, i + 1),
    open: c,
    high: c + 1,
    low: c - 1,
    close: c,
  }));
}

// Hand-computed fixture: closes = [100, 101, 102, 103, 104]
// SMA(3): [NaN, NaN, 101, 102, 103]
//   i=2: (100+101+102)/3 = 101
//   i=3: (101+102+103)/3 = 102
//   i=4: (102+103+104)/3 = 103
// Rolling std dev at i=2: deviations from 101 are [-1, 0, 1], var = 2/3, std = sqrt(2/3)
// At i=3: deviations from 102 are [-1, 0, 1], var = 2/3, std = sqrt(2/3)
// At i=4: deviations from 103 are [-1, 0, 1], var = 2/3, std = sqrt(2/3)
const SQRT_2_3 = Math.sqrt(2 / 3);

// EMA(3) with k=0.5:
//   seed = SMA(3) = 101 at i=2
//   i=3: 103*0.5 + 101*0.5 = 102
//   i=4: 104*0.5 + 102*0.5 = 103
// (For linear data, EMA = SMA)

// =============================================================================
// Tests
// =============================================================================

describe('STD_DEV_LINES_INDICATOR', () => {
  it('has correct id, type, and pane', () => {
    expect(STD_DEV_LINES_INDICATOR.id).toBe('std-dev-lines');
    expect(STD_DEV_LINES_INDICATOR.type).toBe(StIndicator.STD_DEV_LINES);
    expect(STD_DEV_LINES_INDICATOR.defaultPane).toBe('overlay');
    expect(STD_DEV_LINES_INDICATOR.axisScale).toBe('price');
  });

  it('has period, maType, and displayMode params', () => {
    const keys = STD_DEV_LINES_INDICATOR.params.map(p => p.key);
    expect(keys).toContain('period');
    expect(keys).toContain('maType');
    expect(keys).toContain('displayMode');
  });

  it('defaults to period 50, sma, combined', () => {
    const period = STD_DEV_LINES_INDICATOR.params.find(p => p.key === 'period')!;
    expect(period.default).toBe(50);
    const maType = STD_DEV_LINES_INDICATOR.params.find(p => p.key === 'maType')!;
    expect(maType.default).toBe('sma');
    const displayMode = STD_DEV_LINES_INDICATOR.params.find(p => p.key === 'displayMode')!;
    expect(displayMode.default).toBe('combined');
  });
});

describe('calculateStdDevLines (IndicatorCalculator)', () => {
  it('returns center line as y values', () => {
    const bars = makeBars([100, 101, 102, 103, 104]);
    const result = calculateStdDevLines(bars, { period: 3, maType: 'sma', displayMode: 'combined' });
    // SMA(3): [NaN, NaN, 101, 102, 103] → 3 valid points
    expect(result.length).toBe(3);
    expect(result[0].y).toBe(101);
    expect(result[1].y).toBe(102);
    expect(result[2].y).toBe(103);
  });

  it('returns empty for insufficient bars', () => {
    const bars = makeBars([100, 101]);
    const result = calculateStdDevLines(bars, { period: 5, maType: 'sma', displayMode: 'combined' });
    expect(result.length).toBe(0);
  });

  it('returns empty for empty input', () => {
    const result = calculateStdDevLines([], { period: 3, maType: 'sma', displayMode: 'combined' });
    expect(result.length).toBe(0);
  });

  it('supports EMA center line', () => {
    const bars = makeBars([100, 101, 102, 103, 104]);
    const result = calculateStdDevLines(bars, { period: 3, maType: 'ema', displayMode: 'combined' });
    // EMA(3) seed = SMA(3) = 101 at i=2
    expect(result[0].y).toBe(101);
    // EMA at i=3: k=0.5, val = 103*0.5 + 101*0.5 = 102
    expect(result[1].y).toBeCloseTo(102, 10);
    // EMA at i=4: val = 104*0.5 + 102*0.5 = 103
    expect(result[2].y).toBeCloseTo(103, 10);
  });
});

describe('computeStdDevLinesSeries', () => {
  it('returns center line + regular + fib bands in combined mode', () => {
    const bars = makeBars([100, 101, 102, 103, 104]);
    const result = computeStdDevLinesSeries(bars, { period: 3, maType: 'sma', displayMode: 'combined' });
    // center + 5 regular pairs (10 lines) + 3 fib pairs (6 lines) = 17 lines
    expect(result.lines.length).toBe(17);
    expect(result.fills.length).toBeGreaterThan(0);
  });

  it('returns center + regular only in regular-only mode', () => {
    const bars = makeBars([100, 101, 102, 103, 104]);
    const result = computeStdDevLinesSeries(bars, { period: 3, maType: 'sma', displayMode: 'regular-only' });
    // center + 5 pairs = 11 lines, no fills
    expect(result.lines.length).toBe(11);
    expect(result.fills.length).toBe(0);
  });

  it('returns center + fib only in fib-only mode', () => {
    const bars = makeBars([100, 101, 102, 103, 104]);
    const result = computeStdDevLinesSeries(bars, { period: 3, maType: 'sma', displayMode: 'fib-only' });
    // center + 3 pairs = 7 lines, no fills
    expect(result.lines.length).toBe(7);
    expect(result.fills.length).toBe(0);
  });

  it('center line has correct values for SMA', () => {
    const bars = makeBars([100, 101, 102, 103, 104]);
    const result = computeStdDevLinesSeries(bars, { period: 3, maType: 'sma', displayMode: 'combined' });
    const center = result.lines.find(l => l.key === 'center')!;
    expect(center.data.length).toBe(3);
    expect(center.data[0].y).toBe(101);
    expect(center.data[1].y).toBe(102);
    expect(center.data[2].y).toBe(103);
  });

  it('regular bands are centered on the center line', () => {
    const bars = makeBars([100, 101, 102, 103, 104]);
    const result = computeStdDevLinesSeries(bars, { period: 3, maType: 'sma', displayMode: 'regular-only' });
    const center = result.lines.find(l => l.key === 'center')!;
    const upper1 = result.lines.find(l => l.key === 'regular-upper-1')!;
    const lower1 = result.lines.find(l => l.key === 'regular-lower-1')!;

    // At each data point: upper = center + 1*std, lower = center - 1*std
    for (let i = 0; i < center.data.length; i++) {
      const c = center.data[i].y;
      const std = SQRT_2_3;
      expect(upper1.data[i].y).toBeCloseTo(c + std, 10);
      expect(lower1.data[i].y).toBeCloseTo(c - std, 10);
    }
  });

  it('fib bands use Fibonacci deviation levels', () => {
    const bars = makeBars([100, 101, 102, 103, 104]);
    const result = computeStdDevLinesSeries(bars, { period: 3, maType: 'sma', displayMode: 'fib-only' });
    const fibKeys = result.lines.filter(l => l.key !== 'center').map(l => l.key);
    // Should have 0.618, 1.618, 2.618 levels
    expect(fibKeys.some(k => k.includes('0.618'))).toBe(true);
    expect(fibKeys.some(k => k.includes('1.618'))).toBe(true);
    expect(fibKeys.some(k => k.includes('2.618'))).toBe(true);
  });

  it('bands are symmetric around center line', () => {
    const bars = makeBars([100, 101, 102, 103, 104]);
    const result = computeStdDevLinesSeries(bars, { period: 3, maType: 'sma', displayMode: 'combined' });
    const center = result.lines.find(l => l.key === 'center')!;

    // Check symmetry for regular 2.0 band
    const upper2 = result.lines.find(l => l.key === 'regular-upper-2')!;
    const lower2 = result.lines.find(l => l.key === 'regular-lower-2')!;

    for (let i = 0; i < center.data.length; i++) {
      const c = center.data[i].y;
      const upperDist = upper2.data[i].y - c;
      const lowerDist = c - lower2.data[i].y;
      expect(upperDist).toBeCloseTo(lowerDist, 10);
    }
  });

  it('constant price produces zero std dev', () => {
    const bars = makeBars([100, 100, 100, 100, 100]);
    const result = computeStdDevLinesSeries(bars, { period: 3, maType: 'sma', displayMode: 'regular-only' });
    const center = result.lines.find(l => l.key === 'center')!;
    const upper1 = result.lines.find(l => l.key === 'regular-upper-1')!;

    // All bands should equal the center line (std dev = 0)
    for (let i = 0; i < center.data.length; i++) {
      expect(upper1.data[i].y).toBe(center.data[i].y);
    }
  });

  it('returns empty for insufficient bars', () => {
    const bars = makeBars([100, 101]);
    const result = computeStdDevLinesSeries(bars, { period: 5, maType: 'sma', displayMode: 'combined' });
    expect(result.lines.length).toBe(0);
    expect(result.fills.length).toBe(0);
  });

  it('returns empty for empty input', () => {
    const result = computeStdDevLinesSeries([], { period: 3, maType: 'sma', displayMode: 'combined' });
    expect(result.lines.length).toBe(0);
    expect(result.fills.length).toBe(0);
  });

  it('returns empty for invalid period', () => {
    const bars = makeBars([100, 101, 102]);
    const result = computeStdDevLinesSeries(bars, { period: 0, maType: 'sma', displayMode: 'combined' });
    expect(result.lines.length).toBe(0);
  });

  it('handles period=1 (every bar is its own MA)', () => {
    const bars = makeBars([100, 101, 102, 103, 104]);
    const result = computeStdDevLinesSeries(bars, { period: 1, maType: 'sma', displayMode: 'regular-only' });
    const center = result.lines.find(l => l.key === 'center')!;
    // SMA(1) = close itself, so all 5 bars are valid
    expect(center.data.length).toBe(5);
    expect(center.data[0].y).toBe(100);
    expect(center.data[4].y).toBe(104);
    // Std dev with period=1 is 0 (no deviation from self)
    const upper1 = result.lines.find(l => l.key === 'regular-upper-1')!;
    expect(upper1.data[0].y).toBe(100); // 100 + 1*0 = 100
  });

  it('supports EMA center line', () => {
    const bars = makeBars([100, 101, 102, 103, 104]);
    const result = computeStdDevLinesSeries(bars, { period: 3, maType: 'ema', displayMode: 'regular-only' });
    const center = result.lines.find(l => l.key === 'center')!;
    // EMA(3) seed = 101 at i=2
    expect(center.data[0].y).toBe(101);
    expect(center.data[1].y).toBeCloseTo(102, 10);
    expect(center.data[2].y).toBeCloseTo(103, 10);
  });

  it('EMA bands differ from SMA bands on non-linear data', () => {
    // Non-linear data so EMA ≠ SMA
    const bars = makeBars([100, 110, 95, 115, 90, 120, 85, 125, 80, 130]);
    const smaResult = computeStdDevLinesSeries(bars, { period: 3, maType: 'sma', displayMode: 'regular-only' });
    const emaResult = computeStdDevLinesSeries(bars, { period: 3, maType: 'ema', displayMode: 'regular-only' });
    const smaCenter = smaResult.lines.find(l => l.key === 'center')!;
    const emaCenter = emaResult.lines.find(l => l.key === 'center')!;
    // Centers should differ after the seed (non-linear data)
    expect(emaCenter.data[3].y).not.toBeCloseTo(smaCenter.data[3].y, 5);
  });

  it('combined mode creates fill zones', () => {
    const bars = makeBars([100, 101, 102, 103, 104]);
    const result = computeStdDevLinesSeries(bars, { period: 3, maType: 'sma', displayMode: 'combined' });
    expect(result.fills.length).toBeGreaterThan(0);
    // Each fill should have name, color, opacity, and data with high/low
    for (const fill of result.fills) {
      expect(fill.name).toBeTruthy();
      expect(fill.color).toBeTruthy();
      expect(fill.opacity).toBeGreaterThan(0);
      expect(fill.opacity).toBeLessThanOrEqual(1);
      expect(fill.data.length).toBeGreaterThan(0);
      // Each data point should have high >= low
      for (const point of fill.data) {
        expect(point.high).toBeGreaterThanOrEqual(point.low);
      }
    }
  });

  it('fill zone data has correct high/low ordering', () => {
    const bars = makeBars([100, 101, 102, 103, 104]);
    const result = computeStdDevLinesSeries(bars, { period: 3, maType: 'sma', displayMode: 'combined' });
    // For the first fill (between regular 0.5 upper and fib 0.618 upper):
    // regular 0.5 upper = center + 0.5*std, fib 0.618 upper = center + 0.618*std
    // So high should be fib (0.618 > 0.5), low should be regular
    const firstFill = result.fills[0];
    expect(firstFill.data.length).toBe(3);
    // high = max(regular_upper, fib_upper) = fib_upper (since 0.618 > 0.5)
    // low = min(regular_upper, fib_upper) = regular_upper
    for (const point of firstFill.data) {
      expect(point.high).toBeGreaterThanOrEqual(point.low);
    }
  });

  it('handles NaN closes in EMA (carries forward)', () => {
    // Bar with NaN close at index 3 — EMA should carry forward
    const bars: PriceBar[] = [100, 101, 102, 103, 104].map((c, i) => ({
      date: `2026-01-${String(i + 1).padStart(2, '0')}`,
      x: new Date(2026, 0, i + 1),
      open: c, high: c + 1, low: c - 1,
      close: i === 3 ? NaN : c,
    }));
    const result = computeStdDevLinesSeries(bars, { period: 3, maType: 'ema', displayMode: 'regular-only' });
    const center = result.lines.find(l => l.key === 'center')!;
    // EMA should still produce values at index 3 (carried forward)
    expect(center.data.length).toBe(3);
  });

  it('line data has index-based x values', () => {
    const bars = makeBars([100, 101, 102, 103, 104]);
    const result = computeStdDevLinesSeries(bars, { period: 3, maType: 'sma', displayMode: 'combined' });
    const center = result.lines.find(l => l.key === 'center')!;
    // First valid bar is at index 2 (period-1)
    expect(center.data[0].index).toBe(2);
    expect(center.data[1].index).toBe(3);
    expect(center.data[2].index).toBe(4);
  });

  it('NaN warm-up values are filtered from line data', () => {
    const bars = makeBars([100, 101, 102, 103, 104]);
    const result = computeStdDevLinesSeries(bars, { period: 3, maType: 'sma', displayMode: 'combined' });
    const center = result.lines.find(l => l.key === 'center')!;
    // Only 3 valid points (indices 2, 3, 4), not 5
    expect(center.data.length).toBe(3);
  });
});

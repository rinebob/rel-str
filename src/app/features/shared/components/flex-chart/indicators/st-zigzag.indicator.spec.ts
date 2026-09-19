import { ST_ZIGZAG_INDICATOR, calculateZigZag, computeZigZagSeries } from './st-zigzag.indicator';
import { StIndicator } from '../flex-chart.types';
import type { PriceBar, IndicatorParamDef } from '../flex-chart.types';
import { DEFAULT_CONFIG } from './st-zigzag.types';

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

function makeSinglePeakBars(): PriceBar[] {
  const highs = [11, 12, 13, 14, 15, 16, 17, 18, 17, 16, 15, 14, 13, 12, 11];
  const lows  = [ 9, 10, 11, 12, 13, 14, 15, 16, 15, 14, 13, 12, 11, 10,  9];
  return makeBars(highs.map((h, i) => ({ o: h - 1, h, l: lows[i], c: h - 1, v: 1000 })));
}

// =============================================================================
// ST_ZIGZAG_INDICATOR metadata
// =============================================================================

describe('ST_ZIGZAG_INDICATOR', () => {
  it('has correct id and type', () => {
    expect(ST_ZIGZAG_INDICATOR.id).toBe('st-zigzag');
    expect(ST_ZIGZAG_INDICATOR.type).toBe(StIndicator.ST_ZIGZAG);
  });

  it('has correct label', () => {
    expect(ST_ZIGZAG_INDICATOR.label).toBe('ST ZigZag');
  });

  it('renders on the overlay pane', () => {
    expect(ST_ZIGZAG_INDICATOR.defaultPane).toBe('overlay');
  });

  it('uses price axis scale', () => {
    expect(ST_ZIGZAG_INDICATOR.axisScale).toBe('price');
  });

  it('has 7 params with correct keys and defaults matching DEFAULT_CONFIG', () => {
    const keys = ST_ZIGZAG_INDICATOR.params.map(p => p.key);
    expect(keys).toEqual([
      'devThreshold', 'leftDepth', 'rightDepth', 'allowZigZagOnOneBar', 'projectionPivots', 'lineColor',
      'showTriggerDots',
    ]);

    const byKey = Object.fromEntries(ST_ZIGZAG_INDICATOR.params.map(p => [p.key, p.default]));
    expect(byKey['devThreshold']).toBe(DEFAULT_CONFIG.devThreshold);
    expect(byKey['leftDepth']).toBe(DEFAULT_CONFIG.leftDepth);
    expect(byKey['rightDepth']).toBe(DEFAULT_CONFIG.rightDepth);
    expect(byKey['allowZigZagOnOneBar']).toBe(DEFAULT_CONFIG.allowZigZagOnOneBar);
    expect(byKey['projectionPivots']).toBe(DEFAULT_CONFIG.projectionPivots);
    expect(byKey['lineColor']).toBe(DEFAULT_CONFIG.lineColor);
    expect(byKey['showTriggerDots']).toBe(true);
  });

  it('lineColor param is a string with default #1976d2', () => {
    const lineColorParam = ST_ZIGZAG_INDICATOR.params.find(p => p.key === 'lineColor')!;
    expect(typeof lineColorParam.default).toBe('string');
    expect(lineColorParam.default).toBe('#1976d2');
  });

  it('has min/max constraints on numeric params', () => {
    const devThreshold = ST_ZIGZAG_INDICATOR.params.find((p: IndicatorParamDef) => p.key === 'devThreshold')!;
    expect(devThreshold.min).toBeDefined();
    expect(devThreshold.max).toBeDefined();
    expect(devThreshold.max!).toBeGreaterThan(devThreshold.min!);

    const leftDepth = ST_ZIGZAG_INDICATOR.params.find((p: IndicatorParamDef) => p.key === 'leftDepth')!;
    expect(leftDepth.min).toBe(2);
    expect(leftDepth.max).toBeDefined();
    expect(leftDepth.max!).toBeGreaterThan(leftDepth.min!);

    const rightDepth = ST_ZIGZAG_INDICATOR.params.find((p: IndicatorParamDef) => p.key === 'rightDepth')!;
    expect(rightDepth.min).toBe(2);
    expect(rightDepth.max).toBeDefined();
    expect(rightDepth.max!).toBeGreaterThan(rightDepth.min!);
  });

  it('allowZigZagOnOneBar and projectionPivots are boolean params', () => {
    const allowOneBar = ST_ZIGZAG_INDICATOR.params.find((p: IndicatorParamDef) => p.key === 'allowZigZagOnOneBar')!;
    expect(typeof allowOneBar.default).toBe('boolean');

    const projPivots = ST_ZIGZAG_INDICATOR.params.find((p: IndicatorParamDef) => p.key === 'projectionPivots')!;
    expect(typeof projPivots.default).toBe('boolean');
  });
});

// =============================================================================
// DEFAULT_CONFIG
// =============================================================================

describe('DEFAULT_CONFIG', () => {
  it('includes lineColor with default #1976d2', () => {
    expect(DEFAULT_CONFIG.lineColor).toBe('#1976d2');
  });
});

// =============================================================================
// calculateZigZag (IndicatorCalculator signature — confirmed pivots only)
// =============================================================================

describe('calculateZigZag', () => {
  it('returns empty for empty bars', () => {
    const result = calculateZigZag([], {});
    expect(result).toEqual([]);
  });

  it('returns empty for insufficient bars', () => {
    const bars = makeSinglePeakBars().slice(0, 3);
    const result = calculateZigZag(bars, { devThreshold: 5, leftDepth: 2, rightDepth: 2, allowZigZagOnOneBar: true, projectionPivots: false });
    expect(result).toEqual([]);
  });

  it('returns points for confirmed pivots only (no projection)', () => {
    const bars = makeSinglePeakBars();
    const params = { devThreshold: 5, leftDepth: 2, rightDepth: 2, allowZigZagOnOneBar: true, projectionPivots: false };
    const result = calculateZigZag(bars, params);
    // Single peak at bar 7 (price 18) — one pivot → 1 point
    expect(result).toHaveLength(1);
    expect(result[0].y).toBe(18);
  });

  it('returns points including projection when projectionPivots is true', () => {
    // Rise to peak at bar 7, then fall for 3 bars (enough to confirm high pivot + project low)
    const prices: { o: number; h: number; l: number; c: number; v?: number }[] = [];
    for (let i = 0; i < 8; i++) prices.push({ o: 100 + i * 5, h: 105 + i * 5, l: 95 + i * 5, c: 100 + i * 5, v: 1000 });
    for (let i = 0; i < 3; i++) prices.push({ o: 135 - i * 5, h: 140 - i * 5, l: 130 - i * 5, c: 135 - i * 5, v: 1000 });
    const bars = makeBars(prices);
    const params = { devThreshold: 5, leftDepth: 2, rightDepth: 2, allowZigZagOnOneBar: true, projectionPivots: true };
    const result = calculateZigZag(bars, params);
    // Confirmed high at bar 7 + projected low → at least 2 points
    expect(result.length).toBeGreaterThanOrEqual(2);
    // First point is the confirmed high at price 140
    expect(result[0].y).toBe(140);
  });

  it('uses default params when params is empty', () => {
    const bars = makeSinglePeakBars();
    const result = calculateZigZag(bars, {});
    // With DEFAULT_CONFIG (devThreshold=5, leftDepth=5, rightDepth=5), bar 7 is confirmed
    // because bars 2-6 are below 18 (left) and bars 8-12 are below 18 (right).
    expect(result.length).toBeGreaterThanOrEqual(1);
  });

  it('handles string boolean params correctly (Boolean("false") is not true)', () => {
    const bars = makeSinglePeakBars();
    // Simulate params serialized as strings — 'false' should mean false, not true
    const params = {
      devThreshold: 5,
      leftDepth: 2,
      rightDepth: 2,
      allowZigZagOnOneBar: 'false' as unknown as boolean,
      projectionPivots: 'false' as unknown as boolean,
    };
    const result = calculateZigZag(bars, params);
    // Should still produce confirmed pivots (allowZigZagOnOneBar=false affects
    // same-bar pivots, projectionPivots=false excludes projection)
    expect(result.length).toBeGreaterThanOrEqual(1);
  });
});

// =============================================================================
// computeZigZagSeries (full multi-line series for chart rendering)
// =============================================================================

describe('computeZigZagSeries', () => {
  it('returns empty lines and no projected line for empty bars', () => {
    const result = computeZigZagSeries([], {});
    expect(result.lines).toEqual([]);
    expect(result.projectedLine).toBeUndefined();
  });

  it('returns solid line segments connecting confirmed pivots', () => {
    // Create a zigzag: rise 5 bars, fall 5 bars, rise 5 bars, fall 5 bars
    const prices: { o: number; h: number; l: number; c: number; v?: number }[] = [];
    for (let i = 0; i < 5; i++) prices.push({ o: 10 + i * 10, h: 15 + i * 10, l: 5 + i * 10, c: 10 + i * 10, v: 1000 });
    for (let i = 0; i < 5; i++) prices.push({ o: 45 - i * 10, h: 50 - i * 10, l: 40 - i * 10, c: 45 - i * 10, v: 1000 });
    for (let i = 0; i < 5; i++) prices.push({ o: 10 + i * 10, h: 15 + i * 10, l: 5 + i * 10, c: 10 + i * 10, v: 1000 });
    for (let i = 0; i < 5; i++) prices.push({ o: 45 - i * 10, h: 50 - i * 10, l: 40 - i * 10, c: 45 - i * 10, v: 1000 });
    const bars = makeBars(prices);
    const params = { devThreshold: 20, leftDepth: 2, rightDepth: 2, allowZigZagOnOneBar: true, projectionPivots: false };
    const result = computeZigZagSeries(bars, params);

    // Should have at least 2 confirmed pivots → at least 1 line segment
    expect(result.lines.length).toBeGreaterThanOrEqual(1);

    // Each line segment should have data points with index and y
    for (const line of result.lines) {
      expect(line.data.length).toBeGreaterThanOrEqual(2);
      for (const point of line.data) {
        expect(typeof point.index).toBe('number');
        expect(typeof point.y).toBe('number');
      }
    }

    // No projection when projectionPivots is false
    expect(result.projectedLine).toBeUndefined();
  });

  it('returns a dashed projected line when projectionPivots is true', () => {
    // Rise to peak at bar 7, then fall for 3 bars
    const prices: { o: number; h: number; l: number; c: number; v?: number }[] = [];
    for (let i = 0; i < 8; i++) prices.push({ o: 100 + i * 5, h: 105 + i * 5, l: 95 + i * 5, c: 100 + i * 5, v: 1000 });
    for (let i = 0; i < 3; i++) prices.push({ o: 135 - i * 5, h: 140 - i * 5, l: 130 - i * 5, c: 135 - i * 5, v: 1000 });
    const bars = makeBars(prices);
    const params = { devThreshold: 5, leftDepth: 2, rightDepth: 2, allowZigZagOnOneBar: true, projectionPivots: true };
    const result = computeZigZagSeries(bars, params);

    // Should have a projected line
    expect(result.projectedLine).toBeDefined();
    expect(result.projectedLine!.dashArray).not.toBe('');
    expect(result.projectedLine!.data.length).toBeGreaterThanOrEqual(2);
  });

  it('projected line starts at the last confirmed pivot and ends at the projected pivot', () => {
    // Rise to peak at bar 7 (high=140), then fall for 3 bars (low goes to 125)
    const prices: { o: number; h: number; l: number; c: number; v?: number }[] = [];
    for (let i = 0; i < 8; i++) prices.push({ o: 100 + i * 5, h: 105 + i * 5, l: 95 + i * 5, c: 100 + i * 5, v: 1000 });
    for (let i = 0; i < 3; i++) prices.push({ o: 135 - i * 5, h: 140 - i * 5, l: 130 - i * 5, c: 135 - i * 5, v: 1000 });
    const bars = makeBars(prices);
    const params = { devThreshold: 5, leftDepth: 2, rightDepth: 2, allowZigZagOnOneBar: true, projectionPivots: true };
    const result = computeZigZagSeries(bars, params);

    expect(result.projectedLine).toBeDefined();
    const data = result.projectedLine!.data;
    expect(data.length).toBeGreaterThanOrEqual(2);
    // First point should be the last confirmed pivot (bar 7, price 140)
    expect(data[0].index).toBe(7);
    expect(data[0].y).toBe(140);
  });

  it('confirmed line segments use empty dashArray (solid)', () => {
    const prices: { o: number; h: number; l: number; c: number; v?: number }[] = [];
    for (let i = 0; i < 5; i++) prices.push({ o: 10 + i * 10, h: 15 + i * 10, l: 5 + i * 10, c: 10 + i * 10, v: 1000 });
    for (let i = 0; i < 5; i++) prices.push({ o: 45 - i * 10, h: 50 - i * 10, l: 40 - i * 10, c: 45 - i * 10, v: 1000 });
    for (let i = 0; i < 5; i++) prices.push({ o: 10 + i * 10, h: 15 + i * 10, l: 5 + i * 10, c: 10 + i * 10, v: 1000 });
    for (let i = 0; i < 5; i++) prices.push({ o: 45 - i * 10, h: 50 - i * 10, l: 40 - i * 10, c: 45 - i * 10, v: 1000 });
    const bars = makeBars(prices);
    const params = { devThreshold: 20, leftDepth: 2, rightDepth: 2, allowZigZagOnOneBar: true, projectionPivots: false };
    const result = computeZigZagSeries(bars, params);

    for (const line of result.lines) {
      expect(line.dashArray).toBe('');
    }
  });

  it('uses default params when params is empty', () => {
    const bars = makeSinglePeakBars();
    const result = computeZigZagSeries(bars, {});
    // With DEFAULT_CONFIG, should find the peak at bar 7
    expect(result.lines.length + (result.projectedLine ? 1 : 0)).toBeGreaterThanOrEqual(1);
  });

  it('emits a triggers scatter series by default', () => {
    const prices: { o: number; h: number; l: number; c: number; v?: number }[] = [];
    for (let i = 0; i < 5; i++) prices.push({ o: 10 + i * 10, h: 15 + i * 10, l: 5 + i * 10, c: 10 + i * 10, v: 1000 });
    for (let i = 0; i < 5; i++) prices.push({ o: 45 - i * 10, h: 50 - i * 10, l: 40 - i * 10, c: 45 - i * 10, v: 1000 });
    for (let i = 0; i < 5; i++) prices.push({ o: 10 + i * 10, h: 15 + i * 10, l: 5 + i * 10, c: 10 + i * 10, v: 1000 });
    const bars = makeBars(prices);
    const params = { devThreshold: 20, leftDepth: 2, rightDepth: 2, allowZigZagOnOneBar: true, projectionPivots: false, lineColor: '#abc' };
    const result = computeZigZagSeries(bars, params);

    expect(result.triggers).toBeDefined();
    expect(result.triggers!.data.length).toBeGreaterThan(0);
    for (const pt of result.triggers!.data) {
      expect(typeof pt.index).toBe('number');
      expect(typeof pt.y).toBe('number');
      expect(pt.color).toBe('#abc');
    }
  });

  it('omits the triggers series when showTriggerDots is false', () => {
    const prices: { o: number; h: number; l: number; c: number; v?: number }[] = [];
    for (let i = 0; i < 5; i++) prices.push({ o: 10 + i * 10, h: 15 + i * 10, l: 5 + i * 10, c: 10 + i * 10, v: 1000 });
    for (let i = 0; i < 5; i++) prices.push({ o: 45 - i * 10, h: 50 - i * 10, l: 40 - i * 10, c: 45 - i * 10, v: 1000 });
    for (let i = 0; i < 5; i++) prices.push({ o: 10 + i * 10, h: 15 + i * 10, l: 5 + i * 10, c: 10 + i * 10, v: 1000 });
    const bars = makeBars(prices);
    const params = { devThreshold: 20, leftDepth: 2, rightDepth: 2, allowZigZagOnOneBar: true, projectionPivots: false, showTriggerDots: false };
    const result = computeZigZagSeries(bars, params);

    expect(result.lines.length).toBeGreaterThanOrEqual(1); // lines still emitted
    expect(result.triggers).toBeUndefined();
  });
});

// =============================================================================
// computeZigZagSeries — instanceId and lineColor (multi-instance support)
// =============================================================================

describe('computeZigZagSeries — multi-instance', () => {
  function makeMultiPeakBars(): PriceBar[] {
    const prices: { o: number; h: number; l: number; c: number; v?: number }[] = [];
    for (let i = 0; i < 5; i++) prices.push({ o: 10 + i * 10, h: 15 + i * 10, l: 5 + i * 10, c: 10 + i * 10, v: 1000 });
    for (let i = 0; i < 5; i++) prices.push({ o: 45 - i * 10, h: 50 - i * 10, l: 40 - i * 10, c: 45 - i * 10, v: 1000 });
    for (let i = 0; i < 5; i++) prices.push({ o: 10 + i * 10, h: 15 + i * 10, l: 5 + i * 10, c: 10 + i * 10, v: 1000 });
    for (let i = 0; i < 5; i++) prices.push({ o: 45 - i * 10, h: 50 - i * 10, l: 40 - i * 10, c: 45 - i * 10, v: 1000 });
    return makeBars(prices);
  }

  it('prefixes line keys with instanceId when provided', () => {
    const bars = makeMultiPeakBars();
    const params = { devThreshold: 20, leftDepth: 2, rightDepth: 2, allowZigZagOnOneBar: true, projectionPivots: false, lineColor: '#1976d2' };
    const result = computeZigZagSeries(bars, params, { instanceId: 'zz1' });

    expect(result.lines.length).toBeGreaterThanOrEqual(1);
    for (const line of result.lines) {
      expect(line.key.startsWith('zz1-')).toBe(true);
    }
  });

  it('uses un-prefixed keys when instanceId is not provided (backward compat)', () => {
    const bars = makeMultiPeakBars();
    const params = { devThreshold: 20, leftDepth: 2, rightDepth: 2, allowZigZagOnOneBar: true, projectionPivots: false, lineColor: '#1976d2' };
    const result = computeZigZagSeries(bars, params);

    expect(result.lines.length).toBeGreaterThanOrEqual(1);
    for (const line of result.lines) {
      expect(line.key.startsWith('zz1-')).toBe(false);
    }
  });

  it('uses the provided lineColor for all line segments', () => {
    const bars = makeMultiPeakBars();
    const params = { devThreshold: 20, leftDepth: 2, rightDepth: 2, allowZigZagOnOneBar: true, projectionPivots: false, lineColor: '#1976d2' };
    const result = computeZigZagSeries(bars, params, { instanceId: 'zz1', lineColor: '#ff0000' });

    for (const line of result.lines) {
      expect(line.color).toBe('#ff0000');
    }
  });

  it('falls back to config.params.lineColor when options.lineColor is not provided', () => {
    const bars = makeMultiPeakBars();
    const params = { devThreshold: 20, leftDepth: 2, rightDepth: 2, allowZigZagOnOneBar: true, projectionPivots: false, lineColor: '#00ff00' };
    const result = computeZigZagSeries(bars, params, { instanceId: 'zz1' });

    for (const line of result.lines) {
      expect(line.color).toBe('#00ff00');
    }
  });

  it('falls back to DEFAULT_CONFIG.lineColor when neither options.lineColor nor params.lineColor is provided', () => {
    const bars = makeMultiPeakBars();
    const params = { devThreshold: 20, leftDepth: 2, rightDepth: 2, allowZigZagOnOneBar: true, projectionPivots: false };
    const result = computeZigZagSeries(bars, params, { instanceId: 'zz1' });

    for (const line of result.lines) {
      expect(line.color).toBe('#1976d2');
    }
  });

  it('prefixes projected line key with instanceId', () => {
    const prices: { o: number; h: number; l: number; c: number; v?: number }[] = [];
    for (let i = 0; i < 8; i++) prices.push({ o: 100 + i * 5, h: 105 + i * 5, l: 95 + i * 5, c: 100 + i * 5, v: 1000 });
    for (let i = 0; i < 3; i++) prices.push({ o: 135 - i * 5, h: 140 - i * 5, l: 130 - i * 5, c: 135 - i * 5, v: 1000 });
    const bars = makeBars(prices);
    const params = { devThreshold: 5, leftDepth: 2, rightDepth: 2, allowZigZagOnOneBar: true, projectionPivots: true, lineColor: '#1976d2' };
    const result = computeZigZagSeries(bars, params, { instanceId: 'zz2', lineColor: '#ff0000' });

    expect(result.projectedLine).toBeDefined();
    expect(result.projectedLine!.key.startsWith('zz2-')).toBe(true);
    expect(result.projectedLine!.color).toBe('#ff0000');
  });

  it('produces distinct keys for two different instanceIds', () => {
    const bars = makeMultiPeakBars();
    const params = { devThreshold: 20, leftDepth: 2, rightDepth: 2, allowZigZagOnOneBar: true, projectionPivots: false, lineColor: '#1976d2' };
    const result1 = computeZigZagSeries(bars, params, { instanceId: 'zz1' });
    const result2 = computeZigZagSeries(bars, params, { instanceId: 'zz2' });

    const keys1 = new Set(result1.lines.map(l => l.key));
    const keys2 = new Set(result2.lines.map(l => l.key));
    for (const k of keys1) {
      expect(keys2.has(k)).toBe(false);
    }
  });
});

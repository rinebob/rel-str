import { toOHLCDatum } from '../utils/ohlc-datum.utils';
import type { OhlcBar } from '../../../core/models/market-data.types';

describe('toOHLCDatum', () => {
  function bar(date: string, overrides: Partial<OhlcBar> = {}): OhlcBar {
    return { d: date, o: 100, h: 110, l: 90, c: 105, v: 1000, ...overrides };
  }

  it('maps valid bars to OHLCDatum', () => {
    const result = toOHLCDatum([bar('2026-01-01'), bar('2026-01-02')]);
    expect(result).toHaveLength(2);
    expect(result[0].date).toBe('2026-01-01');
    expect(result[0].open).toBe(100);
    expect(result[0].high).toBe(110);
    expect(result[0].low).toBe(90);
    expect(result[0].close).toBe(105);
    expect(result[0].volume).toBe(1000);
    expect(result[0].x).toEqual(new Date('2026-01-01T00:00:00.000Z'));
  });

  it('filters out bars with close = 0', () => {
    const result = toOHLCDatum([bar('2026-01-01', { c: 0 }), bar('2026-01-02', { c: 100 })]);
    expect(result).toHaveLength(1);
    expect(result[0].date).toBe('2026-01-02');
  });

  it('filters out bars with NaN close', () => {
    const result = toOHLCDatum([bar('2026-01-01', { c: NaN }), bar('2026-01-02', { c: 100 })]);
    expect(result).toHaveLength(1);
    expect(result[0].date).toBe('2026-01-02');
  });

  it('filters out bars with Infinity close', () => {
    const result = toOHLCDatum([bar('2026-01-01', { c: Infinity }), bar('2026-01-02', { c: 100 })]);
    expect(result).toHaveLength(1);
    expect(result[0].date).toBe('2026-01-02');
  });

  it('filters out bars with negative close', () => {
    const result = toOHLCDatum([bar('2026-01-01', { c: -5 }), bar('2026-01-02', { c: 100 })]);
    expect(result).toHaveLength(1);
    expect(result[0].date).toBe('2026-01-02');
  });

  it('falls back to close for missing open', () => {
    const result = toOHLCDatum([bar('2026-01-01', { o: NaN })]);
    expect(result).toHaveLength(1);
    expect(result[0].open).toBe(105);
  });

  it('falls back to close for missing high', () => {
    const result = toOHLCDatum([bar('2026-01-01', { h: undefined as unknown as number })]);
    expect(result).toHaveLength(1);
    expect(result[0].high).toBe(105);
  });

  it('falls back to close for missing low', () => {
    const result = toOHLCDatum([bar('2026-01-01', { l: NaN })]);
    expect(result).toHaveLength(1);
    expect(result[0].low).toBe(105);
  });

  it('passes through undefined volume', () => {
    const result = toOHLCDatum([bar('2026-01-01', { v: undefined })]);
    expect(result).toHaveLength(1);
    expect(result[0].volume).toBeUndefined();
  });

  it('returns empty array for empty input', () => {
    expect(toOHLCDatum([])).toEqual([]);
  });
});

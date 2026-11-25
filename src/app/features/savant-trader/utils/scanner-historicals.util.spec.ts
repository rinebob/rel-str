/**
 * scanner-historicals.util spec (#1098/#1308) — wire → PriceBar mapping +
 * SMA overlay math for the untracked chart popup. historicalsToBars
 * coerces the string-priced wire bars and drops malformed rows;
 * smaOverlays aligns per-bar series with a null warmup head.
 */
import {
  historicalsToBars,
  smaOverlays,
  volumeColumns,
} from './scanner-historicals.util';
import { toDatePt } from './utils';
import type { EquityHistoricalBar } from '@robinhood-mcp/contracts';
import type { PriceBar } from '../../shared/components/flex-chart/flex-chart.types';

const wire = (
  over: Partial<EquityHistoricalBar> = {},
): EquityHistoricalBar => ({
  begins_at: '2026-01-05T00:00:00Z',
  open_price: '100.00',
  close_price: '101.50',
  high_price: '102.00',
  low_price: '99.50',
  volume: 1234567,
  session: 'reg',
  ...over,
});

const bar = (date: string, close: number): PriceBar => ({
  date,
  x: new Date(`${date}T00:00:00Z`),
  open: close,
  high: close,
  low: close,
  close,
});

describe('historicalsToBars', () => {
  it('parses begins_at + string *_price fields into PriceBar', () => {
    const out = historicalsToBars([wire()]);
    expect(out).toHaveLength(1);
    // x carries the canonical chart convention — PT-midnight via
    // ohlcToPriceBar → toDatePt, not the UTC begins_at timestamp.
    expect(out[0].x).toEqual(toDatePt('2026-01-05'));
    expect(out[0].date).toBe('2026-01-05');
    expect(out[0].open).toBe(100);
    expect(out[0].close).toBe(101.5);
    expect(out[0].high).toBe(102);
    expect(out[0].low).toBe(99.5);
    expect(out[0].volume).toBe(1234567);
  });

  it('drops malformed rows — non-finite prices, unparseable dates — keeps the rest', () => {
    const out = historicalsToBars([
      wire({ begins_at: '2026-01-05T00:00:00Z' }),
      wire({ begins_at: '2026-01-06T00:00:00Z', open_price: 'abc' }),
      wire({ begins_at: 'not-a-date' }),
      wire({ begins_at: '2026-01-07T00:00:00Z', close_price: 'NaN' }),
      wire({ begins_at: '2026-01-08T00:00:00Z', low_price: '' }),
    ]);
    expect(out.map((b) => b.date)).toEqual(['2026-01-05']);
  });

  it('empty / absent input → []', () => {
    expect(historicalsToBars([])).toEqual([]);
    expect(historicalsToBars(undefined)).toEqual([]);
    expect(historicalsToBars(null)).toEqual([]);
  });
});

describe('smaOverlays', () => {
  it('computes SMA values at hand-checkable points', () => {
    // closes 1..10 → SMA(3) at bar idx 5 (closes 4,5,6) = 5.
    const bars = Array.from({ length: 10 }, (_, i) =>
      bar(`2026-01-${String(i + 1).padStart(2, '0')}`, i + 1),
    );
    const [sma3] = smaOverlays(bars, [3]);
    expect(sma3.period).toBe(3);
    expect(sma3.points[5].y).toBe(5);
    expect(sma3.points[9].y).toBe(9); // (8+9+10)/3
  });

  it('first period-1 points carry null (warmup) — the line starts at the first full window', () => {
    const bars = Array.from({ length: 12 }, (_, i) =>
      bar(`2026-01-${String(i + 1).padStart(2, '0')}`, i + 1),
    );
    const [sma5] = smaOverlays(bars, [5]);
    expect(sma5.points.slice(0, 4).every((p) => p.y === null)).toBe(true);
    expect(sma5.points[4].y).toBe(3); // (1+2+3+4+5)/5
    expect(sma5.points).toHaveLength(bars.length);
    expect(sma5.points.map((p) => p.x)).toEqual(bars.map((b) => b.x));
  });

  it('returns one series per period — [10,20,50] as ordered', () => {
    const bars = Array.from({ length: 60 }, (_, i) =>
      bar(`2026-01-${String((i % 28) + 1).padStart(2, '0')}`, 50 + i),
    );
    const out = smaOverlays(bars, [10, 20, 50]);
    expect(out.map((o) => o.period)).toEqual([10, 20, 50]);
    expect(out[2].points[49].y).not.toBeNull();
    expect(out[2].points[48].y).toBeNull();
  });
});

describe('volumeColumns', () => {
  it('emits one column per bar — y in millions, x aligned to the bar', () => {
    const bars = [
      { ...bar('2026-01-05', 101), volume: 2_500_000 },
      { ...bar('2026-01-06', 102), volume: 4_000_000 },
    ];
    const out = volumeColumns(bars);
    expect(out.map((p) => p.y)).toEqual([2.5, 4]);
    expect(out.map((p) => p.x)).toEqual(bars.map((b) => b.x));
  });

  it('colors up when close ≥ open, down when close < open — light-vocab candle literals', () => {
    const up = { ...bar('2026-01-05', 100), volume: 1 }; // open = close → up
    const down = {
      ...bar('2026-01-06', 90),
      open: 100,
      volume: 1,
    };
    const [u, d] = volumeColumns([up, down]);
    expect(u.color).toBe('#26a69a');
    expect(d.color).toBe('#ef5350');
  });

  it('skips absent, non-finite, and negative volumes', () => {
    const good = { ...bar('2026-01-05', 100), volume: 1000 };
    const out = volumeColumns([
      good,
      { ...bar('2026-01-06', 100) }, // undefined
      { ...bar('2026-01-07', 100), volume: NaN },
      { ...bar('2026-01-08', 100), volume: -5 },
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].x).toEqual(good.x);
  });

  it('empty input → []', () => {
    expect(volumeColumns([])).toEqual([]);
  });
});

import { aggregateDailyToTwoDay } from './two-day-bars';
import type { PriceBar } from '../../../shared/components/flex-chart/flex-chart.types';

function bar(date: string, o = 0, h = 0, l = 0, c = 0, volume?: number): PriceBar {
  return { date, x: new Date(`${date}T00:00:00Z`), open: o, high: h, low: l, close: c, volume };
}

/** A normal two-week run: Mon 10/05 → Fri 10/16 (10 trading days). */
const TWO_WEEKS = [
  '2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08', '2026-10-09',
  '2026-10-12', '2026-10-13', '2026-10-14', '2026-10-15', '2026-10-16',
];

describe('aggregateDailyToTwoDay', () => {
  it('returns empty for empty input', () => {
    expect(aggregateDailyToTwoDay([])).toEqual([]);
  });

  it('pairs consecutive trading days — 10 days → 5 bars, no lone Friday', () => {
    const bars = aggregateDailyToTwoDay(TWO_WEEKS.map((d) => bar(d)));
    expect(bars.map((b) => b.date)).toEqual([
      '2026-10-06', // Mon–Tue
      '2026-10-08', // Wed–Thu
      '2026-10-12', // Fri–Mon
      '2026-10-14', // Tue–Wed
      '2026-10-16', // Thu–Fri
    ]);
  });

  it('extends the Friday bar to Tuesday when Monday is a holiday', () => {
    // Mon 10/12 removed → holiday week has Tue–Fri.
    const days = [...TWO_WEEKS.slice(0, 5), ...TWO_WEEKS.slice(6)];
    const bars = aggregateDailyToTwoDay(days.map((d) => bar(d)));
    expect(bars.map((b) => b.date)).toEqual([
      '2026-10-06', '2026-10-08',
      '2026-10-13', // Fri 10/09 + Tue 10/13
      '2026-10-15', // Wed–Thu
      '2026-10-16', // trailing odd bar
    ]);
  });

  it('folds OHLCV: first open, max high, min low, last close, summed volume', () => {
    const bars = aggregateDailyToTwoDay([
      bar('2026-10-05', 100, 110, 95, 105, 1000),
      bar('2026-10-06', 106, 115, 104, 112, 2000),
    ]);
    expect(bars).toHaveLength(1);
    expect(bars[0]).toEqual({
      date: '2026-10-06',
      x: new Date('2026-10-06T00:00:00Z'),
      open: 100,
      high: 115,
      low: 95,
      close: 112,
      volume: 3000,
    });
  });

  it('keeps a trailing odd bar as-is (in-progress pair)', () => {
    const last = bar('2026-10-07', 1, 2, 0.5, 1.5, 500);
    const bars = aggregateDailyToTwoDay([
      bar('2026-10-05'), bar('2026-10-06'), last,
    ]);
    expect(bars).toHaveLength(2);
    expect(bars[1]).toBe(last);
  });

  it('omits volume when neither bar carries it', () => {
    const bars = aggregateDailyToTwoDay([bar('2026-10-05'), bar('2026-10-06')]);
    expect(bars[0].volume).toBeUndefined();
  });
});

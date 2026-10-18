/**
 * 2-day bar aggregation — sandbox evaluation interval.
 *
 * Sequential pairs of consecutive trading days: each bar spans exactly two
 * trading days, so a Friday bar rolls into the next trading day (Monday —
 * or Tuesday when Monday is a holiday). Because a full week is 5 trading
 * days (odd), bar-start days rotate Mon/Wed/Fri then Tue/Thu and back —
 * a lone Friday bar is never left behind.
 *
 * Phase is anchored at the first bar of the input series; with the chart
 * store's full-history daily bars that anchor is the symbol's first bar.
 */
import type { PriceBar } from '../../../shared/components/flex-chart/flex-chart.types';

/**
 * Aggregate daily bars into 2-trading-day bars. A trailing odd bar stays a
 * 1-day bar — it is the in-progress pair.
 */
export function aggregateDailyToTwoDay(dailyBars: PriceBar[]): PriceBar[] {
  if (!dailyBars || dailyBars.length === 0) return [];

  const out: PriceBar[] = [];
  for (let i = 0; i < dailyBars.length; i += 2) {
    out.push(foldBars(dailyBars[i], dailyBars[i + 1]));
  }
  return out;
}

/**
 * Fold two consecutive bars into one (the second may be absent for a
 * trailing odd bar). Open = first open, high = max, low = min,
 * close = last close, volume = sum, date/x = last bar's.
 */
function foldBars(a: PriceBar, b?: PriceBar): PriceBar {
  if (!b) return a;
  const volume = (a.volume ?? 0) + (b.volume ?? 0);
  return {
    date: b.date,
    x: b.x,
    open: a.open,
    high: Math.max(a.high, b.high),
    low: Math.min(a.low, b.low),
    close: b.close,
    volume: volume > 0 ? volume : undefined,
  };
}

import type { PriceBar } from './heatmap-chart.types';

/**
 * Aggregate daily bars into weekly bars.
 * Weekly bars end on Friday (or last trading day of the week).
 */
export function aggregateDailyToWeekly(dailyBars: PriceBar[]): PriceBar[] {
  if (!dailyBars || dailyBars.length === 0) return [];

  const weeklyBars: PriceBar[] = [];
  let currentWeek: PriceBar[] = [];
  let lastWeekEnd: Date | null = null;

  for (const bar of dailyBars) {
    const barDate = new Date(bar.x);
    const dayOfWeek = barDate.getUTCDay(); // 0 = Sunday, 5 = Friday

    currentWeek.push(bar);

    // End of week: Friday (5) or if next bar would be in a new week
    const isEndOfWeek = dayOfWeek === 5; // Friday
    const isLastBar = bar === dailyBars[dailyBars.length - 1];

    if (isEndOfWeek || isLastBar) {
      if (currentWeek.length > 0) {
        weeklyBars.push(aggregateBars(currentWeek));
        currentWeek = [];
      }
    }
  }

  return weeklyBars;
}

/**
 * Aggregate daily bars into monthly bars.
 * Monthly bars end on the last trading day of the month.
 */
export function aggregateDailyToMonthly(dailyBars: PriceBar[]): PriceBar[] {
  if (!dailyBars || dailyBars.length === 0) return [];

  const monthlyBars: PriceBar[] = [];
  let currentMonth: PriceBar[] = [];
  let lastMonth: string | null = null;

  for (const bar of dailyBars) {
    const barDate = new Date(bar.x);
    const monthKey = `${barDate.getUTCFullYear()}-${String(barDate.getUTCMonth() + 1).padStart(2, '0')}`;

    if (lastMonth && monthKey !== lastMonth) {
      // New month started, aggregate previous month
      if (currentMonth.length > 0) {
        monthlyBars.push(aggregateBars(currentMonth));
        currentMonth = [];
      }
    }

    currentMonth.push(bar);
    lastMonth = monthKey;
  }

  // Aggregate final month
  if (currentMonth.length > 0) {
    monthlyBars.push(aggregateBars(currentMonth));
  }

  return monthlyBars;
}

/**
 * Aggregate multiple bars into a single bar.
 * Open = first bar's open
 * High = max of all highs
 * Low = min of all lows
 * Close = last bar's close
 * Volume = sum of all volumes
 * Date = last bar's date
 */
function aggregateBars(bars: PriceBar[]): PriceBar {
  if (bars.length === 0) {
    throw new Error('Cannot aggregate empty bars array');
  }

  if (bars.length === 1) {
    return bars[0];
  }

  const firstBar = bars[0];
  const lastBar = bars[bars.length - 1];

  const high = Math.max(...bars.map(b => b.high));
  const low = Math.min(...bars.map(b => b.low));
  const volume = bars.reduce((sum, b) => sum + (b.volume || 0), 0);

  return {
    date: lastBar.date,
    x: lastBar.x,
    open: firstBar.open,
    high,
    low,
    close: lastBar.close,
    volume: volume > 0 ? volume : undefined,
  };
}

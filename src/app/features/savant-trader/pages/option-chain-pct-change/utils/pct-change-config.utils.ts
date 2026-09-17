/**
 * Pure utility functions for pct-change config target date resolution and ID generation.
 *
 * No Angular dependencies, no side effects.
 */
import type { TargetType } from '@shared/pct-change-config-contracts';
import type { OhlcBar } from '../../../../../core/models/market-data.types';

export type { TargetType } from '@shared/pct-change-config-contracts';

/** A daily bar with date and close price (subset of OhlcBar). */
type DailyBar = Pick<OhlcBar, 'd' | 'c'>;

/**
 * Resolve target dates from daily bars by scanning forward from the start date
 * for the first close that reaches or exceeds each percentage from the start price.
 *
 * - Positive percentages look for price increases (close >= startPrice * (1 + pct/100)).
 * - Negative percentages look for price decreases (close <= startPrice * (1 + pct/100)).
 * - Percentages that are never reached are skipped.
 * - The start date itself is included in the scan (0% is always reached on the start date).
 *
 * @param bars Daily bars sorted or unsorted by date.
 * @param startDate The start date (YYYY-MM-DD).
 * @param startPrice The underlying closing price on the start date.
 * @param percentages Array of target percentages (e.g., [-3, 5, 10]).
 * @returns Array of resolved dates (YYYY-MM-DD) in the same order as percentages, skipping unreachable.
 */
export function resolvePctChangeTargets(
  bars: DailyBar[],
  startDate: string,
  startPrice: number,
  percentages: number[],
): string[] {
  if (bars.length === 0 || percentages.length === 0) return [];

  // Sort bars by date ascending.
  const sorted = [...bars].sort((a, b) => a.d.localeCompare(b.d));

  // Only scan bars on or after the start date.
  const forward = sorted.filter((b) => b.d >= startDate);
  if (forward.length === 0) return [];

  const results: string[] = [];

  for (const pct of percentages) {
    const target = startPrice * (1 + pct / 100);
    const isUp = pct >= 0;
    // Relative tolerance scaled to the target magnitude to handle both
    // low- and high-priced underlyings without floating-point drift.
    const epsilon = Math.max(1, Math.abs(target)) * 1e-9;

    const found = forward.find((b) => {
      return isUp ? b.c >= target - epsilon : b.c <= target + epsilon;
    });

    if (found) {
      results.push(found.d);
    }
  }

  return results;
}

/**
 * Generate N dates at a fixed interval from the start date.
 *
 * Does not skip weekends — uses calendar days.
 *
 * @param startDate The start date (YYYY-MM-DD).
 * @param count Number of dates to generate.
 * @param intervalDays Interval in days between each date.
 * @returns Array of dates (YYYY-MM-DD).
 */
export function generateIntervalDates(
  startDate: string,
  count: number,
  intervalDays: number,
): string[] {
  if (count <= 0) return [];

  const [y, m, d] = startDate.split('-').map(Number);
  const start = new Date(y, m - 1, d);
  const dates: string[] = [];

  for (let i = 0; i < count; i++) {
    const dt = new Date(start);
    dt.setDate(dt.getDate() + i * intervalDays);
    dates.push(formatDate(dt));
  }

  return dates;
}

/**
 * Build a human-readable config doc ID.
 *
 * Format: {symbol}-{startDate}-{numberOfTargets}-{targetType}-{uid}
 *
 * @param symbol Underlying symbol (will be uppercased).
 * @param startDate Start date (YYYY-MM-DD).
 * @param numberOfTargets Number of target dates.
 * @param targetType Target type ('pct-change', 'swing-extremes', 'user-dates').
 * @param uid Unique suffix for collision avoidance.
 * @returns The config doc ID.
 */
export function buildConfigId(
  symbol: string,
  startDate: string,
  numberOfTargets: number,
  targetType: TargetType,
  uid: string,
): string {
  return `${symbol.toUpperCase()}-${startDate}-${numberOfTargets}-${targetType}-${uid}`;
}

/** Format a Date as YYYY-MM-DD using local time. */
function formatDate(d: Date): string {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

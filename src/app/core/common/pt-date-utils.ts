/**
 * Pacific Time date utilities (frontend mirror of functions/src/common/pt-date-utils.ts).
 *
 * The backend SDS pipeline writes bar dates and organizes year shards in PT
 * (America/Los_Angeles). All calendar date math in the frontend must use PT
 * to match — using UTC would cause off-by-one errors around midnight UTC and
 * wrong year shard reads at year boundaries.
 */

const PT_TIMEZONE = 'America/Los_Angeles';

/** Format a JS Date as a YYYY-MM-DD calendar string in PT. */
function formatPtCalendarString(date: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: PT_TIMEZONE }).format(date);
}

/** Get the current PT trading date (YYYY-MM-DD). */
export function getMarketDatePT(now = new Date()): string {
  return formatPtCalendarString(now);
}

/** Get the current PT year as a number. */
export function getPtYear(now = new Date()): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: PT_TIMEZONE,
    year: 'numeric',
  }).formatToParts(now);
  return Number(parts.find(p => p.type === 'year')?.value ?? 0);
}

/**
 * Get the PT calendar date N days ago (YYYY-MM-DD).
 * Uses noon UTC to avoid DST boundary edge cases.
 */
export function daysAgoPT(days: number, now = new Date()): string {
  const today = getMarketDatePT(now);
  const [year, month, day] = today.split('-').map(Number);
  const d = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
  d.setUTCDate(d.getUTCDate() - days);
  return formatPtCalendarString(d);
}

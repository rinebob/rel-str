/**
 * Session resolution for the option-chain page.
 *
 * "Today" means the most recent completed trading session in Pacific Time
 * (the app standardizes on PT). Before 1:00 PM PT the current session's EOD
 * snapshot is not expected to exist, so resolution starts from the prior
 * trading day; at/after 1 PM PT it starts from today and walks back when
 * the snapshot hasn't landed yet. The walk skips weekends and caps at
 * MAX_WALK_BACK_DAYS calendar days — holidays are handled implicitly by the
 * fetch loop (an empty snapshot just keeps the walk going).
 */
import { Observable, concatMap, defaultIfEmpty, defer, filter, from, map, take } from 'rxjs';

import { getPtDayOfWeek, ptDateString } from '../../../utils/utils';

const PT_TZ = 'America/Los_Angeles';

/** Hour-of-day PT at which the current session's snapshot is expected. */
export const SESSION_BOUNDARY_HOUR_PT = 13;

/** Max calendar days the walk-back covers (skips weekends along the way). */
export const MAX_WALK_BACK_DAYS = 7;

const ptHourFmt = new Intl.DateTimeFormat('en-US', {
  timeZone: PT_TZ,
  hour: 'numeric',
  hour12: false,
});

function ptHour(d: Date): number {
  const parts = ptHourFmt.formatToParts(d);
  const hour = parseInt(parts.find((p) => p.type === 'hour')?.value ?? '0', 10);
  // 'en-US' + hour12:false reports midnight as 24 on some platforms.
  return hour === 24 ? 0 : hour;
}

function toIso(dt: Date): string {
  return dt.toISOString().slice(0, 10);
}

function isWeekday(dateStr: string): boolean {
  const dow = getPtDayOfWeek(dateStr);
  return dow !== 0 && dow !== 6;
}

/** The weekday strictly before a YYYY-MM-DD date, skipping weekends. */
export function previousWeekday(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d, 12));
  do {
    dt.setUTCDate(dt.getUTCDate() - 1);
  } while (dt.getUTCDay() === 0 || dt.getUTCDay() === 6);
  return toIso(dt);
}

/**
 * Weekday candidates to try for a session snapshot, starting at startDate
 * (adjusted back to a weekday when it lands on a weekend) and walking back
 * no more than maxDaysBack calendar days.
 */
export function walkBackDates(startDate: string, maxDaysBack = MAX_WALK_BACK_DAYS): string[] {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate) || isNaN(Date.parse(startDate))) {
    throw new Error(`walkBackDates: invalid YYYY-MM-DD start date '${startDate}'`);
  }
  const dates: string[] = [];
  const limit = Date.parse(startDate) - maxDaysBack * 86_400_000;
  let cur = isWeekday(startDate) ? startDate : previousWeekday(startDate);
  while (Date.parse(cur) >= limit) {
    dates.push(cur);
    cur = previousWeekday(cur);
  }
  return dates;
}

/**
 * Session date to load for "latest completed session" semantics. Before
 * SESSION_BOUNDARY_HOUR_PT resolves to the prior trading day; at/after it
 * resolves to today. The returned date may be a weekend/holiday — fetch
 * walk-back handles that.
 */
export function resolveSessionDate(now: Date): string {
  const today = ptDateString(now);
  return ptHour(now) >= SESSION_BOUNDARY_HOUR_PT ? today : previousWeekday(today);
}

export interface ResolvedSession<T> {
  date: string;
  data: T;
}

/**
 * Walk back from startDate calling fetch$ per candidate until a result
 * satisfies hasData; emits the winning {date, data} or null when the walk
 * exhausts its cap. Fetches run sequentially and stop at the first hit;
 * fetch errors propagate rather than being walked past.
 */
export function resolveSession$<T>(
  startDate: string,
  fetch$: (date: string) => Observable<T>,
  hasData: (data: T) => boolean,
): Observable<ResolvedSession<T> | null> {
  return defer(() => from(walkBackDates(startDate))).pipe(
    concatMap((date) => fetch$(date).pipe(map((data) => ({ date, data })))),
    filter(({ data }) => hasData(data)),
    take(1),
    defaultIfEmpty(null as ResolvedSession<T> | null),
  );
}

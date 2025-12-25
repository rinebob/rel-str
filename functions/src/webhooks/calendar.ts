import { logger } from 'firebase-functions/v2';
import { db } from '../firebase-admin-init';
import { APP_COLLECTION } from './webhooks-config';
import { MarketHolidayItem, MarketHolidayStatus } from '../types/partner';

export type Ymd = string; // YYYY-MM-DD

export type HolidaySet = Set<Ymd>;

export interface DiagnosticsRunWindowLike {
  fromDay: Ymd;
  toDay: Ymd;
}

interface MarketHolidayDoc {
  year: number;
  region: string;
  holidays: MarketHolidayItem[];
  source?: string;
  weeklyLastTradingDays?: Record<string, string>;
  monthlyLastTradingDays?: Record<string, string>;
}

export interface CanonicalCalendarYear {
  weeklyLastTradingDays: Record<string, string>;  // weekKey -> YYYY-MM-DD
  monthlyLastTradingDays: Record<string, string>; // YYYY-MM -> YYYY-MM-DD
}

/**
 * Load US market holidays for all years intersecting the given window and
 * return a fast lookup set of YYYY-MM-DD strings for days when the market is
 * fully closed.
 */
export async function loadUsHolidaySetForWindow(window: DiagnosticsRunWindowLike): Promise<HolidaySet> {
  const fromYear = Number(window.fromDay.slice(0, 4));
  const toYear = Number(window.toDay.slice(0, 4));

  const startYear = Number.isFinite(fromYear) ? fromYear : toYear;
  const endYear = Number.isFinite(toYear) ? toYear : startYear;

  const holidaySet: HolidaySet = new Set();

  for (let y = startYear; y <= endYear; y++) {
    const docId = `market-holidays-US-${y}`;
    const docRef = db.collection(APP_COLLECTION).doc(docId);
    try {
      const snap = await docRef.get();
      if (!snap.exists) {
        continue;
      }
      const data = (snap.data() as MarketHolidayDoc) || ({} as MarketHolidayDoc);
      const items = Array.isArray(data.holidays) ? data.holidays : [];
      for (const item of items) {
        if (!item || typeof item.date !== 'string') continue;
        const day = item.date.length >= 10 ? item.date.slice(0, 10) : undefined;
        if (!day) continue;
        // Only treat fully closed days as non-trading. Early close is still a
        // trading day for our purposes.
        if (item.status === MarketHolidayStatus.CLOSED) {
          holidaySet.add(day);
        }
      }
    } catch (e: any) {
      try {
        logger.warn('loadUsHolidaySetForWindow_failed_year', { year: y, message: e?.message });
      } catch {
        // ignore logging failures
      }
    }
  }

  return holidaySet;
}

export function addDays(ymd: Ymd, delta: number): Ymd {
  const dt = new Date(`${ymd}T00:00:00.000Z`);
  dt.setUTCDate(dt.getUTCDate() + delta);
  const y = dt.getUTCFullYear();
  const m = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const d = String(dt.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function isWeekend(ymd: Ymd): boolean {
  const dt = new Date(`${ymd}T00:00:00.000Z`);
  const dow = dt.getUTCDay(); // 0=Sun..6=Sat
  return dow === 0 || dow === 6;
}

export function isHoliday(ymd: Ymd, holidays: HolidaySet): boolean {
  return holidays.has(ymd);
}

export function isTradingDay(ymd: Ymd, holidays: HolidaySet): boolean {
  return !isWeekend(ymd) && !isHoliday(ymd, holidays);
}

export function weekKeyFromYmd(ymd: Ymd): Ymd {
  const dt = new Date(`${ymd}T00:00:00.000Z`);
  const dow = dt.getUTCDay(); // 0=Sun..6=Sat
  const offsetFromMonday = (dow + 6) % 7; // Mon=0
  dt.setUTCDate(dt.getUTCDate() - offsetFromMonday);
  const y = dt.getUTCFullYear();
  const m = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const d = String(dt.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function weekKeyFromDate(d: Date): Ymd {
  const copy = new Date(d.getTime());
  const dow = copy.getUTCDay(); // 0=Sun..6=Sat
  const offsetFromMonday = (dow + 6) % 7; // Mon=0
  copy.setUTCDate(copy.getUTCDate() - offsetFromMonday);
  const y = copy.getUTCFullYear();
  const m = String(copy.getUTCMonth() + 1).padStart(2, '0');
  const day = String(copy.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * Determine whether the given trading day is the last trading day of its ISO
 * week, given a holiday set. A day is considered an end-of-week trading day if
 * it is a trading day and the next calendar day is either in a different week
 * or is not a trading day within the same week (weekend/holiday).
 */
export function isEndOfWeekTradingDay(ymd: Ymd, holidays: HolidaySet): boolean {
  if (!isTradingDay(ymd, holidays)) return false;

  const dt = new Date(`${ymd}T00:00:00.000Z`);
  const thisWeekKey = weekKeyFromDate(dt);

  const tomorrowYmd = addDays(ymd, 1);
  const tomorrowDt = new Date(`${tomorrowYmd}T00:00:00.000Z`);
  const tomorrowWeekKey = weekKeyFromDate(tomorrowDt);

  const tomorrowTrading = isTradingDay(tomorrowYmd, holidays);

  // Case 1: calendar week boundary
  if (tomorrowWeekKey !== thisWeekKey) {
    return true;
  }

  // Case 2: still same week, but tomorrow is not a trading day (weekend/holiday).
  return !tomorrowTrading;
}

/**
 * Determine whether the given trading day is the last trading day of its
 * calendar month, given a holiday set. A day is considered an end-of-month
 * trading day if it is a trading day and the next calendar day is either in a
 * different calendar month or is not a trading day within the same month
 * (weekend/holiday).
 */
export function isEndOfMonthTradingDay(ymd: Ymd, holidays: HolidaySet): boolean {
  if (!isTradingDay(ymd, holidays)) return false;

  const thisMonth = ymd.slice(0, 7); // YYYY-MM
  const tomorrowYmd = addDays(ymd, 1);
  const tomorrowMonth = tomorrowYmd.slice(0, 7);
  const tomorrowTrading = isTradingDay(tomorrowYmd, holidays);

  // Case 1: calendar month boundary
  if (tomorrowMonth !== thisMonth) {
    return true;
  }

  // Case 2: still same month, but tomorrow is not a trading day (weekend/holiday).
  return !tomorrowTrading;
}

/**
 * Build canonical weekly/monthly last-trading-day maps for a given year using
 * SA holidays and weekend rules. This is pure calendar math and does not
 * depend on any archive data.
 */
export function buildCanonicalCalendarForYear(year: number, holidays: MarketHolidayItem[]): CanonicalCalendarYear {
  const holidaySet: HolidaySet = new Set();
  for (const h of holidays) {
    if (!h || typeof h.date !== 'string') continue;
    const day = h.date.length >= 10 ? h.date.slice(0, 10) : undefined;
    if (!day) continue;
    if (h.status === MarketHolidayStatus.CLOSED) {
      holidaySet.add(day);
    }
  }

  const weeklyLastTradingDays: Record<string, string> = {};
  const monthlyLastTradingDays: Record<string, string> = {};

  const start = new Date(Date.UTC(year, 0, 1));
  const end = new Date(Date.UTC(year, 11, 31));

  for (let dt = new Date(start.getTime()); dt <= end; dt.setUTCDate(dt.getUTCDate() + 1)) {
    const y = dt.getUTCFullYear();
    const m = String(dt.getUTCMonth() + 1).padStart(2, '0');
    const d = String(dt.getUTCDate()).padStart(2, '0');
    const ymd: Ymd = `${y}-${m}-${d}`;

    if (!isTradingDay(ymd, holidaySet)) {
      continue;
    }

    const monthKey = `${y}-${m}`;
    const existingMonth = monthlyLastTradingDays[monthKey];
    if (!existingMonth || ymd > existingMonth) {
      monthlyLastTradingDays[monthKey] = ymd;
    }

    const weekKey = weekKeyFromYmd(ymd);
    const existingWeek = weeklyLastTradingDays[weekKey];
    if (!existingWeek || ymd > existingWeek) {
      weeklyLastTradingDays[weekKey] = ymd;
    }
  }

  return { weeklyLastTradingDays, monthlyLastTradingDays };
}

/**
 * Load canonical weekly/monthly last-trading-day maps for a specific year
 * from the stored market-holidays-US-<year> document. Returns undefined if
 * the document or maps are missing.
 */
export async function loadCanonicalCalendarYear(year: number): Promise<CanonicalCalendarYear | undefined> {
  const docId = `market-holidays-US-${year}`;
  const docRef = db.collection(APP_COLLECTION).doc(docId);
  try {
    const snap = await docRef.get();
    if (!snap.exists) {
      return undefined;
    }
    const data = (snap.data() as MarketHolidayDoc) || ({} as MarketHolidayDoc);
    const weekly = data.weeklyLastTradingDays || {};
    const monthly = data.monthlyLastTradingDays || {};
    return { weeklyLastTradingDays: weekly, monthlyLastTradingDays: monthly };
  } catch (e: any) {
    try {
      logger.warn('loadCanonicalCalendarYear_failed', { year, message: e?.message });
    } catch {
      // ignore logging failures
    }
    return undefined;
  }
}

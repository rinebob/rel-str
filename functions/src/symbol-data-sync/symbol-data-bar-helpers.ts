/**
 * Shared bar helpers for symbol-data reads and writes.
 *
 * Extracted so the nightly symbol-data-sync and the intraday RH Agent worker can
 * share the same normalization, merging, and period-deduplication logic without
 * creating a circular dependency between the two modules.
 */
import type { OhlcBar } from '../common/market-data-types';

/**
 * Convert a raw SA partner bar to our compact OhlcBar.
 * SA returns: { t: epochMs, o, h, l, c, v, d?: string, barStatus?: string }
 * We store: { d: YYYY-MM-DD, o, h, l, c, v, barStatus? }
 */
export function normalizeBar(raw: any): OhlcBar | null {
  // Prefer explicit date string; fall back to epoch timestamp
  let d: string = '';
  if (raw?.d && typeof raw.d === 'string') {
    d = raw.d.slice(0, 10);
  } else if (raw?.t && Number.isFinite(Number(raw.t))) {
    d = new Date(Number(raw.t)).toISOString().slice(0, 10);
  }

  const o = Number(raw?.o);
  const h = Number(raw?.h);
  const l = Number(raw?.l);
  const c = Number(raw?.c ?? raw?.ac); // adjusted close preferred
  const v = Number(raw?.v);

  if (!d || !Number.isFinite(c) || c <= 0) return null;

  const bar: OhlcBar = { d, o: Number.isFinite(o) ? o : c, h: Number.isFinite(h) ? h : c, l: Number.isFinite(l) ? l : c, c };
  if (Number.isFinite(v) && v > 0) bar.v = v;
  if (raw?.barStatus != null && ['-1', '0', '1'].includes(String(raw.barStatus))) {
    bar.barStatus = Number(raw.barStatus) as -1 | 0 | 1;
  }
  return bar;
}

/**
 * Merge new bars into existing bars array, keyed by date.
 * New bars overwrite existing bars with the same date (handles corrections).
 * Result is sorted chronologically.
 */
export function mergeBars(existing: OhlcBar[], incoming: OhlcBar[]): OhlcBar[] {
  const map = new Map<string, OhlcBar>();
  for (const b of existing) map.set(b.d, b);
  for (const b of incoming) map.set(b.d, b);
  return Array.from(map.values()).sort((a, b) => a.d.localeCompare(b.d));
}

/**
 * Deduplicate bars by period (ISO week or month), keeping the bar with the
 * latest calendar date for each period. SA re-dates the same incomplete
 * weekly/monthly bar on every trading day, so a plain date-keyed merge would
 * accumulate duplicate period bars.
 */
export function dedupByPeriod(bars: OhlcBar[], periodKey: (d: string) => string): OhlcBar[] {
  const map = new Map<string, OhlcBar>();
  for (const b of bars) {
    const key = periodKey(b.d);
    const existing = map.get(key);
    if (!existing || b.d > existing.d) {
      map.set(key, b);
    }
  }
  return Array.from(map.values()).sort((a, b) => a.d.localeCompare(b.d));
}

/** ISO-week key (Mon-Sun) for a YYYY-MM-DD string. Uses PT noon to avoid UTC boundary drift. */
export function isoWeekKey(d: string): string {
  const [year, month, day] = d.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
  const dayOfWeek = (date.getUTCDay() + 6) % 7; // Mon=0 … Sun=6
  const monday = new Date(date);
  monday.setUTCDate(date.getUTCDate() - dayOfWeek);
  return monday.toISOString().slice(0, 10);
}

/** YYYY-MM month key for a YYYY-MM-DD string. */
export function monthKey(d: string): string {
  return d.slice(0, 7);
}

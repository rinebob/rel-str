// Date-related utilities. Keep lightweight and typed.

/**
 * Date formatting constants
 */
export const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/**
 * Converts Date | number to a numeric timestamp (ms since epoch).
 * Returns NaN for unsupported types.
 */
export function toTimestamp(val: unknown): number {
  if (val instanceof Date) return val.getTime();
  if (typeof val === 'number') return val;
  return NaN;
}

/**
 * Converts a string | number | Date to a Date object.
 * - number is treated as a JS timestamp (ms since epoch)
 * - string is passed to Date constructor
 * - invalid inputs return null
 */
export function toDate(value: string | number | Date | null | undefined): Date | null {
  if (value == null) return null;
  if (value instanceof Date) return isNaN(value.getTime()) ? null : value;
  const d = new Date(value);
  return isNaN(d.getTime()) ? null : d;
}

/**
 * Whether two dates (or timestamps) fall on the same calendar day in local time.
 */
export function isSameDay(a: Date | number, b: Date | number): boolean {
  const da = a instanceof Date ? a : new Date(a);
  const db = b instanceof Date ? b : new Date(b);
  return (
    da.getFullYear() === db.getFullYear() &&
    da.getMonth() === db.getMonth() &&
    da.getDate() === db.getDate()
  );
}

/**
 * Returns a new Date offset by the given number of days.
 */
export function addDays(date: Date | number, days: number): Date {
  const d = date instanceof Date ? new Date(date.getTime()) : new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

const ISO_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * Parse a strict ISO 'YYYY-MM-DD' to a local-midnight Date, or null.
 * `new Date(y, m, d)` rolls impossible dates forward ('2026-02-31' → Mar 3),
 * so the parsed parts must round-trip. Returns a LOCAL Date — not
 * `Date.parse`, whose UTC midnight shifts the calendar day for users west
 * of Greenwich (the option-chain off-by-one).
 */
export function parseIsoDateLocal(v: string): Date | null {
  const m = ISO_DATE_RE.exec(v.trim());
  if (!m) return null;
  const [y, mo, d] = [+m[1], +m[2], +m[3]];
  const dt = new Date(y, mo - 1, d);
  return dt.getFullYear() === y && dt.getMonth() === mo - 1 && dt.getDate() === d ? dt : null;
}

/**
 * Whole days between two YYYY-MM-DD dates (UTC).
 */
export function daysBetween(start: string, end: string): number {
  const s = new Date(start + 'T00:00:00Z');
  const e = new Date(end + 'T00:00:00Z');
  return Math.round((e.getTime() - s.getTime()) / 86_400_000);
}

/**
 * Clamps a date between optional min and max bounds (inclusive).
 */
export function clampDate(date: Date | number, min?: Date | number, max?: Date | number): Date {
  const d = date instanceof Date ? date.getTime() : date;
  const lo = typeof min === 'undefined' ? -Infinity : (min instanceof Date ? min.getTime() : min);
  const hi = typeof max === 'undefined' ? Infinity : (max instanceof Date ? max.getTime() : max);
  const clamped = Math.min(Math.max(d, lo), hi);
  return new Date(clamped);
}
// Date-related utilities. Keep lightweight and typed.

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
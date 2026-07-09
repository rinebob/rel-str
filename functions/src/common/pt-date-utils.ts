/**
 * PT date utilities
 *
 * All user-facing dates and identifiers are generated or formatted in PT
 * (America/Los_Angeles). Internal timestamps stay UTC; calendar strings are
 * normalized and rendered in PT.
 *
 * These utilities are shared across multiple domains (RH Agent, symbol-data-sync,
 * etc.) and intentionally live in common/ to avoid circular dependencies between
 * feature modules.
 */
import { RhAgentTriggeredBy } from './rh-agent-runs';

const PT_TIMEZONE = 'America/Los_Angeles';

/** Minimal structural type for Firestore Timestamp without importing firebase-admin. */
type TimestampLike = { toDate(): Date };

/**
 * Format a JS Date as a YYYY-MM-DD calendar string in PT.
 */
function formatDateToPtCalendarString(date: Date): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: PT_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const year = parts.find(p => p.type === 'year')!.value;
  const month = parts.find(p => p.type === 'month')!.value;
  const day = parts.find(p => p.type === 'day')!.value;
  return `${year}-${month}-${day}`;
}

/**
 * Get the current PT trading date (YYYY-MM-DD).
 */
export function getMarketDatePT(now = new Date()): string {
  return formatDateToPtCalendarString(now);
}

/**
 * Get the current PT run date (YYYY-MM-DD).
 * Today this is the same as getMarketDatePT(), but exposed separately so the
 * distinction is explicit in callers.
 */
export function getRunDatePT(now = new Date()): string {
  return formatDateToPtCalendarString(now);
}

/**
 * Get the three-letter lowercase day of week for a YYYY-MM-DD string.
 * Uses the date components directly (interpreted as local midnight) so it does
 * not shift because of timezone.
 */
function getDayOfWeekPt(dateStr: string): string {
  const [year, month, day] = dateStr.split('-').map(Number);
  return new Date(year, month - 1, day)
    .toLocaleDateString('en-US', { weekday: 'short' })
    .toLowerCase();
}

/**
 * Generate a PT run ID in the format YYYY-MM-DD_dow_HHMMSS_trigger.
 * The date portion comes from runDate; the time portion is the current PT time.
 */
export function getRunIdPT(
  runDate: string,
  trigger: RhAgentTriggeredBy,
  now = new Date()
): string {
  const dow = getDayOfWeekPt(runDate);
  const timeParts = new Intl.DateTimeFormat('en-US', {
    timeZone: PT_TIMEZONE,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(now);
  const hours = timeParts.find(p => p.type === 'hour')!.value.padStart(2, '0');
  const minutes = timeParts.find(p => p.type === 'minute')!.value.padStart(2, '0');
  const seconds = timeParts.find(p => p.type === 'second')!.value.padStart(2, '0');
  return `${runDate}_${dow}_${hours}${minutes}${seconds}_${trigger}`;
}

/**
 * Format a UTC timestamp as a PT display string.
 * Accepts Date, Firestore Timestamp, or ISO string.
 */
export function formatTimestampPT(ts: Date | TimestampLike | string): string {
  let date: Date;
  if (ts instanceof Date) {
    date = ts;
  } else if (typeof ts === 'string') {
    date = new Date(ts);
  } else if (ts && typeof ts === 'object' && 'toDate' in ts && typeof ts.toDate === 'function') {
    date = ts.toDate();
  } else {
    throw new Error('formatTimestampPT: unsupported timestamp type');
  }
  return new Intl.DateTimeFormat('en-US', {
    timeZone: PT_TIMEZONE,
    dateStyle: 'medium',
    timeStyle: 'medium',
  }).format(date);
}

/**
 * Validate a YYYY-MM-DD calendar string.
 */
export function isValidMarketDate(dateStr: string): boolean {
  const match = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return false;
  const [_, yearStr, monthStr, dayStr] = match;
  const year = Number(yearStr);
  const month = Number(monthStr);
  const day = Number(dayStr);
  const d = new Date(year, month - 1, day);
  return (
    d.getFullYear() === year &&
    d.getMonth() === month - 1 &&
    d.getDate() === day
  );
}

/**
 * Normalize a partner-provided date string to a PT calendar string.
 * - If already a valid YYYY-MM-DD, return it as-is.
 * - If an ISO/UTC string, convert to PT calendar date.
 * - If invalid or ambiguous, return the fallback (defaults to PT today).
 */
export function normalizeMarketDate(
  dateStr: string,
  fallback = getMarketDatePT()
): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    return isValidMarketDate(dateStr) ? dateStr : fallback;
  }

  const parsed = new Date(dateStr);
  if (Number.isNaN(parsed.getTime())) {
    return fallback;
  }

  return formatDateToPtCalendarString(parsed);
}

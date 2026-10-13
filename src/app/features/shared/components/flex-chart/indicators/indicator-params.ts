/**
 * Shared param parsing for indicator definitions.
 *
 * Indicator params arrive as `Record<string, number | string | boolean>`
 * (sandbox overrides can persist strings for any control), so every value
 * is parsed defensively with a fallback.
 */

/** Parse a numeric param; falls back when missing or not a finite number. */
export function numParam(v: number | string | boolean | undefined, fallback: number): number {
  const n = Number(v ?? fallback);
  return Number.isFinite(n) ? n : fallback;
}

/** Parse a color param; falls back when missing or empty. */
export function colorParam(v: number | string | boolean | undefined, fallback: string): string {
  return typeof v === 'string' && v !== '' ? v : fallback;
}

/** Parse a boolean param that may be a string ('true'/'false'), boolean, or undefined. */
export function boolParam(v: number | string | boolean | undefined, fallback: boolean): boolean {
  if (v === true || v === 'true') return true;
  if (v === false || v === 'false') return false;
  return fallback;
}

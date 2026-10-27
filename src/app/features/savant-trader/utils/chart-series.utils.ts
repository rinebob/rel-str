/**
 * Helpers for Syncfusion category-axis charts: padding date-keyed points
 * onto a shared label axis, unioning label sets, and computing min/max
 * over a visible index window. Shared so every category-axis chart solves
 * alignment and range math the same way.
 */

/** Multi-series line palette — the canonical color cycle for charts that
 *  plot N series, so per-index colors stay consistent across components. */
export const MULTI_SERIES_PALETTE = [
  '#4285F4', '#EA4335', '#34A853', '#FBBC05', '#FF6D01',
  '#46BDC6', '#9C27B0', '#F06292', '#3F51B5', '#00BCD4',
];

/** Pad a date-keyed series onto the shared category axis — one slot per
 *  label, null where the series lacks that date (renders as a gap, never
 *  interpolated). */
export function alignSeriesToLabels<T extends { date: string }>(
  points: readonly T[],
  labels: readonly string[],
  value: (point: T) => number | null,
): { date: string; value: number | null }[] {
  const byDate = new Map<string, T>();
  for (const p of points) byDate.set(p.date, p);
  return labels.map((date) => {
    const p = byDate.get(date);
    return { date, value: p ? value(p) : null };
  });
}

/** Sorted union of label sets — a category axis needs every rendered
 *  date to exist as a category. */
export function unionLabels(...sets: readonly (readonly string[])[]): string[] {
  const out = new Set<string>();
  for (const set of sets) for (const d of set) out.add(d);
  return [...out].sort();
}

/** Min/max across a window of category indexes. `valuesAt` yields the
 *  candidate numbers at each index so single fields and multi-series
 *  unions share one scan. Returns null when the window holds no values so
 *  callers choose their own fallback; a single-value window gets a small
 *  pad so the axis doesn't collapse. */
export function minMaxInRange(
  range: { min: number; max: number },
  count: number,
  valuesAt: (index: number) => Iterable<number | null | undefined>,
): { min: number; max: number } | null {
  const start = Math.max(0, Math.floor(range.min));
  const end = Math.min(count - 1, Math.ceil(range.max));
  let min = Infinity;
  let max = -Infinity;
  for (let i = start; i <= end; i++) {
    for (const v of valuesAt(i)) {
      if (v != null && Number.isFinite(v)) {
        if (v < min) min = v;
        if (v > max) max = v;
      }
    }
  }
  if (!Number.isFinite(min) || !Number.isFinite(max)) return null;
  if (min === max) {
    const pad = Math.abs(min) > 0 ? Math.abs(min) * 0.1 : 0.5;
    return { min: min - pad, max: max + pad };
  }
  return { min, max };
}

/**
 * Study-range brush math (Task #1340, FE-4).
 *
 * Pure px ↔ category-index conversion for the Category X-axis — the same
 * `axisCollections[0].rect`/`visibleRange` mapping the hover/zoom paths
 * already read, so the brush overlay can't diverge from the axis.
 * Snapping prefers `corpusDates` (the availability fetch domain) and
 * falls back to the rendered axis labels when the drawer hasn't fetched.
 */
import type { StudyRange } from '../../utils/option-group-generator.utils';

/** Plot-area geometry — x/width/min/delta from `axisCollections[0]` (the
 *  category X axis); y/height from `chartAxisLayoutPanel.seriesClipRect`
 *  because the X-axis rect is the label strip below the plot. */
export interface AxisSpace {
  /** Plot-area origin in chart-space px. */
  x: number;
  y: number;
  /** Plot-area extents in chart-space px. */
  width: number;
  height: number;
  /** Visible range in category-index space (`visibleRange.min/.delta`). */
  min: number;
  delta: number;
}

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

/** Chart-space px → nearest category index, clamped to [0, count-1]. */
export function pxToCategoryIndex(px: number, space: AxisSpace, count: number): number {
  if (count <= 0 || space.width <= 0 || space.delta <= 0) return 0;
  const idx = space.min + ((px - space.x) / space.width) * space.delta;
  return clamp(Math.round(idx), 0, count - 1);
}

/** Category index → chart-space px (band/rect edge positioning). */
export function categoryIndexToPx(index: number, space: AxisSpace): number {
  if (space.delta <= 0) return space.x;
  return space.x + ((index - space.min) / space.delta) * space.width;
}

/** Index of the sorted-dates member nearest `date` (lexicographic =
 *  chronological for YYYY-MM-DD). Ties resolve to the earlier member.
 *  Empty list → -1. */
export function nearestIndexByDate(date: string, sortedDates: string[]): number {
  if (sortedDates.length === 0) return -1;
  let lo = 0;
  let hi = sortedDates.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (sortedDates[mid] < date) lo = mid + 1; else hi = mid;
  }
  // lo = insertion point — members < date are [0,lo), >= date are [lo,n)
  if (lo === 0) return 0;
  if (lo === sortedDates.length) return sortedDates.length - 1;
  return dateDiffDays(sortedDates[lo - 1], date) <= dateDiffDays(date, sortedDates[lo]) ? lo - 1 : lo;
}

function dateDiffDays(a: string, b: string): number {
  return Math.abs(Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000;
}

/** Map one px edge through index → label → nearest corpus member (or the
 *  label itself when corpus is empty). */
function edgeToDate(px: number, space: AxisSpace, labels: string[], corpus: string[]): string {
  const label = labels[pxToCategoryIndex(px, space, labels.length)];
  if (corpus.length === 0) return label;
  return corpus[nearestIndexByDate(label, corpus)];
}

/** Resolve a drag into a snapped, ordered StudyRange — null when the
 *  axis has no categories to map onto (edges would resolve undefined). */
export function resolveBrushRange(
  pxA: number,
  pxB: number,
  space: AxisSpace,
  labels: string[],
  corpus: string[],
): StudyRange | null {
  if (labels.length === 0) return null;
  // Binary search in edgeToDate assumes ascending corpus order — enforce
  // it here rather than trusting the endpoint contract.
  const sorted = corpus.length > 1 ? [...corpus].sort() : corpus;
  const a = edgeToDate(pxA, space, labels, sorted);
  const b = edgeToDate(pxB, space, labels, sorted);
  return a <= b ? { start: a, end: b } : { start: b, end: a };
}

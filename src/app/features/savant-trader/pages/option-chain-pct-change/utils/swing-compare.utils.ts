/**
 * Swing-compare pure utilities — merge pivot/signal dates into a labeled
 * candidate list for the run builder, and derive the default option type
 * for a chosen start date.
 *
 * Dates are YYYY-MM-DD strings; pivot times arrive as ms timestamps and
 * are converted to UTC calendar dates (same convention as bar `d` fields).
 */
import { OptionType } from '@options-contract/contracts';
import { SignalDirection } from '../../../common/constants';
import type { Pivot, Swing } from '../../../../shared/components/flex-chart/indicators/st-zigzag.types';
import type { StSignalItem } from '../../../services/types';

/** A saved comparison run — one start date, one or more target dates,
 *  and the option type to analyze. Global filters apply to all runs. */
export interface SwingCompareRun {
  id: string;
  startDate: string;
  targetDates: string[];
  type: OptionType;
}

/** Label values on a date item — frame/pivot literals or a signal direction. */
export type SwingCompareLabel = 'frame-start' | 'swing-high' | 'swing-low' | SignalDirection;

/** One candidate date in the run builder — deduped across sources. */
export interface SwingCompareDateItem {
  /** YYYY-MM-DD. */
  date: string;
  /** Display labels, e.g. 'frame-start', 'swing-high', 'swing-low', 'LONG', 'SHORT'. */
  labels: SwingCompareLabel[];
  /** Pivot kind when a confirmed pivot sits on this date; null = signal-only. */
  pivotIsHigh: boolean | null;
  /** Signal directions on this date (empty when pivot-only). */
  signalDirections: SignalDirection[];
}

/** Convert a ms timestamp to a YYYY-MM-DD UTC date string. */
export function toUtcDateString(timeMs: number): string {
  return new Date(timeMs).toISOString().slice(0, 10);
}

/**
 * Merge confirmed pivots + signal barDates inside [frameStart, frameEnd]
 * into a sorted, deduped, labeled date list. The frame start date itself
 * is always included (it's a valid analysis start).
 */
export function mergeDateList(
  pivots: Pivot[],
  signals: StSignalItem[],
  frameStart: string,
  frameEnd: string,
): SwingCompareDateItem[] {
  const byDate = new Map<string, SwingCompareDateItem>();
  const get = (date: string): SwingCompareDateItem => {
    let item = byDate.get(date);
    if (!item) {
      item = { date, labels: [], pivotIsHigh: null, signalDirections: [] };
      byDate.set(date, item);
    }
    return item;
  };

  for (const p of pivots) {
    if (!p.confirmed) continue;
    const date = toUtcDateString(p.time);
    if (date < frameStart || date > frameEnd) continue;
    const item = get(date);
    item.pivotIsHigh = p.isHigh;
    const label: SwingCompareLabel = p.isHigh ? 'swing-high' : 'swing-low';
    if (!item.labels.includes(label)) item.labels.push(label);
  }

  for (const s of signals) {
    const date = s.barDate;
    if (!date || date < frameStart || date > frameEnd) continue;
    const item = get(date);
    if (s.direction !== SignalDirection.ALL && !item.signalDirections.includes(s.direction)) {
      item.signalDirections.push(s.direction);
      item.labels.push(s.direction);
    }
  }

  const start = get(frameStart);
  if (!start.labels.includes('frame-start')) start.labels.unshift('frame-start');

  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * Default option type for a chosen start date: a swing-low or LONG signal
 * suggests a bounce → CALL; a swing-high or SHORT suggests a drop → PUT.
 * A confirmed pivot decides outright when present (structure over signal).
 */
export function defaultTypeForStart(item: SwingCompareDateItem): OptionType {
  // Structure beats signal: a confirmed pivot decides direction outright.
  if (item.pivotIsHigh !== null) return item.pivotIsHigh ? OptionType.PUT : OptionType.CALL;
  return item.signalDirections.includes(SignalDirection.SHORT) &&
    !item.signalDirections.includes(SignalDirection.LONG)
    ? OptionType.PUT
    : OptionType.CALL;
}

// ===========================================================================
// Mini zigzag chart geometry -- normalized SVG coordinates for the picker
// expando. x maps time linearly, y maps price (inverted: higher price ->
// smaller y). Y is padded 10% so extreme points don't touch the edges.
// ===========================================================================

/** One rendered swing segment in viewbox coordinates. */
export interface SwingSegment {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  swing: Swing;
}

/** Shared normalization -- returns mappers for the union of all endpoint
 *  times/prices. Returns null when there are no points to map. */
function chartMappers(
  points: { time: number; price: number }[],
  width: number,
  height: number,
): { toX: (t: number) => number; toY: (p: number) => number } | null {
  if (points.length === 0) return null;
  const tMin = Math.min(...points.map((p) => p.time));
  const tMax = Math.max(...points.map((p) => p.time));
  const pMin = Math.min(...points.map((p) => p.price));
  const pMax = Math.max(...points.map((p) => p.price));
  const pad = (pMax - pMin) * 0.1 || 1;
  const lo = pMin - pad;
  const hi = pMax + pad;
  const tSpan = tMax - tMin || 1;
  return {
    toX: (t) => ((t - tMin) / tSpan) * width,
    toY: (p) => height - ((p - lo) / (hi - lo)) * height,
  };
}

/** Polyline points string ("x,y x,y ...") for a pivot sequence. */
export function swingPolyline(pivots: Pivot[], width: number, height: number): string {
  const m = chartMappers(pivots, width, height);
  if (!m) return '';
  return pivots.map((p) => `${m.toX(p.time).toFixed(2)},${m.toY(p.price).toFixed(2)}`).join(' ');
}

/** One segment per swing with normalized endpoints, for clickable hits. */
export function swingSegments(swings: Swing[], width: number, height: number): SwingSegment[] {
  const m = chartMappers(
    swings.flatMap((s) => [s.start, s.end]),
    width,
    height,
  );
  if (!m) return [];
  return swings.map((swing) => ({
    x1: m.toX(swing.start.time),
    y1: m.toY(swing.start.price),
    x2: m.toX(swing.end.time),
    y2: m.toY(swing.end.price),
    swing,
  }));
}

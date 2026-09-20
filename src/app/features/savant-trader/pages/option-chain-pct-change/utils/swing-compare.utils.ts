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
import type { Pivot } from '../../../../shared/components/flex-chart/indicators/st-zigzag.types';
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

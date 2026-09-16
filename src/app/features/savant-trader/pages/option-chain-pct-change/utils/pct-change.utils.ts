/**
 * Percentage change computation utilities for the option chain pct change grid.
 *
 * Pure functions — no Angular dependencies, no side effects.
 */

import { OptionType } from '@options-contract/contracts';
import type { HistoricalOptionContract } from '@options-contract/contracts';

/** One cell in the pct change grid — a matched contract pair. */
export interface PctChangeCell {
  contractID: string;
  strike: number;
  expiration: string;
  delta: number | null;
  startPrice: number;
  targetPrice: number;
  pctChange: number;
}

/** A complete grid for one target date. */
export interface PctChangeGrid {
  targetDate: string;
  durationDays: number;
  strikes: number[];
  expirations: string[];
  cells: Map<string, PctChangeCell>;
  p5: number;
  p95: number;
}

/** Filter applied to matched contracts before building the grid. */
export interface PctChangeFilter {
  type: OptionType;
  durationGteDays?: number;
  durationLteDays?: number;
  strikeGte?: number;
  strikeLte?: number;
  deltaGte?: number;
  deltaLte?: number;
}

/** Build the Map key for a cell by strike and expiration. */
export function cellKey(strike: number, expiration: string): string {
  return `${strike}-${expiration}`;
}

/** Parse a string market-data value to a finite number, or return undefined. */
function toNum(v: string | undefined): number | undefined {
  if (v == null || v === '') return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

/** Days between two YYYY-MM-DD dates. */
function daysBetween(start: string, end: string): number {
  const s = new Date(start + 'T00:00:00Z');
  const e = new Date(end + 'T00:00:00Z');
  return Math.round((e.getTime() - s.getTime()) / 86_400_000);
}

/** Compute the percentile of a sorted numeric array (linear interpolation). */
function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  if (sorted.length === 1) return sorted[0];
  const idx = (p / 100) * (sorted.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

/**
 * Compute the pct change grid from a start and target chain snapshot.
 *
 * Matches contracts by `contractID`, computes percentage price change
 * from start `mark` to target `mark`, applies filters, and returns a
 * grid with sorted strikes/expirations and p5/p95 percentiles.
 */
export function computePctChange(
  startChain: HistoricalOptionContract[],
  targetChain: HistoricalOptionContract[],
  startDate: string,
  targetDate: string,
  filter: PctChangeFilter,
): PctChangeGrid {
  const startMap = new Map<string, HistoricalOptionContract>();
  for (const c of startChain) {
    if (c.contractID) startMap.set(c.contractID, c);
  }

  const cells: PctChangeCell[] = [];
  const strikeSet = new Set<number>();
  const expSet = new Set<string>();

  for (const target of targetChain) {
    if (!target.contractID) continue;
    const start = startMap.get(target.contractID);
    if (!start) continue;

    const startMark = toNum(start.mark);
    const targetMark = toNum(target.mark);
    if (startMark == null || targetMark == null) continue;
    if (startMark === 0) continue; // avoid division by zero

    const strike = toNum(start.strike);
    const expiration = start.expiration;
    const delta = toNum(start.delta);
    if (strike == null || !expiration) continue;

    // Type filter
    if (filter.type !== start.type) continue;

    // Duration filter (days from start date to expiration)
    const duration = daysBetween(startDate, expiration);
    if (filter.durationGteDays != null && duration < filter.durationGteDays) continue;
    if (filter.durationLteDays != null && duration > filter.durationLteDays) continue;

    // Strike filter
    if (filter.strikeGte != null && strike < filter.strikeGte) continue;
    if (filter.strikeLte != null && strike > filter.strikeLte) continue;

    // Delta filter (on absolute value). Missing delta fails the filter.
    if (filter.deltaGte != null || filter.deltaLte != null) {
      if (delta == null) continue;
      const absDelta = Math.abs(delta);
      if (filter.deltaGte != null && absDelta < filter.deltaGte) continue;
      if (filter.deltaLte != null && absDelta > filter.deltaLte) continue;
    }

    const pctChange = ((targetMark - startMark) / startMark) * 100;

    cells.push({
      contractID: target.contractID,
      strike,
      expiration,
      delta: delta ?? null,
      startPrice: startMark,
      targetPrice: targetMark,
      pctChange,
    });
    strikeSet.add(strike);
    expSet.add(expiration);
  }

  const strikes = [...strikeSet].sort((a, b) => a - b);
  const expirations = [...expSet].sort();
  const cellMap = new Map<string, PctChangeCell>();
  for (const c of cells) {
    cellMap.set(cellKey(c.strike, c.expiration), c);
  }

  const sortedPct = cells.map((c) => c.pctChange).sort((a, b) => a - b);
  const p5 = percentile(sortedPct, 5);
  const p95 = percentile(sortedPct, 95);

  return {
    targetDate,
    durationDays: daysBetween(startDate, targetDate),
    strikes,
    expirations,
    cells: cellMap,
    p5,
    p95,
  };
}

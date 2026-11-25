/**
 * @topic #261 — Trading Indicator Library, Thread #1665
 * @task #1727 — SHARED: hoist signal engines + IBS filter stage
 *
 * The IBS filter stage — the ONLY path from detected candidate to emitted
 * signal. Every surface (BE st-signals records, BE dotMarkers, FE sandbox
 * dots) partitions through this one function; a new signal algo cannot
 * bypass the filter because `emitted` exists only behind it.
 *
 * Semantics (identical on every surface):
 *   long  → emitted iff ibs >= T            (inclusive)
 *   short → emitted iff ibs <= 1 − T + EPS  (inclusive; EPSILON guards the
 *           float complement for T where 1−T rounds a ulp below the bound)
 *   undefined ibs (young developing bar, missing/non-finite OHLC,
 *   misaligned index) → emitted (pass-through — can't evaluate, don't judge)
 *   ctx omitted → unfiltered: everything emits (ibs still attached)
 *
 * Suppression is emission-only by construction — the detectors latch their
 * state before this stage sees the candidate (see @st/signal-detect).
 */
import { computeIbs } from './st-ibs';
import type { IbsAvailabilityContext, IbsTimeframe } from './st-ibs';

/** Filter config — `threshold` is the IBS bound (long ≥ T, short ≤ 1−T,
 *  inclusive, default 0.5); the availability fields let callers pin
 *  `now`/activation for specs and replay — wall clock + defaults omitted. */
export interface IbsFilterContext extends IbsAvailabilityContext {
  threshold?: number;
}

/** Tolerant bar shape — accepts strict OHLCV ({open,high,low,close}),
 *  raw OhlcBar ({d,o,h,l,c}), loose strategy OHLCV (alias fields), and FE
 *  PriceBar ({high,low,close,date}). Only the three values IBS needs. */
export interface IbsBarLike {
  high?: number;
  low?: number;
  close?: number;
  h?: number;
  l?: number;
  c?: number;
  date?: string;
  d?: string;
  t?: string;
}

/** IBS of `bar`, or `undefined` when IBS can't evaluate (missing/non-finite
 *  OHLC, or a developing bar before its availability activation). */
export function barIbs(
  bar: IbsBarLike | undefined,
  timeframe: IbsTimeframe,
  ctx?: IbsAvailabilityContext,
): number | undefined {
  if (!bar) return undefined;
  const high = bar.high ?? bar.h;
  const low = bar.low ?? bar.l;
  const close = bar.close ?? bar.c;
  if (
    typeof high !== 'number' || typeof low !== 'number' || typeof close !== 'number' ||
    !Number.isFinite(high) || !Number.isFinite(low) || !Number.isFinite(close)
  ) {
    return undefined;
  }
  const date = bar.date ?? bar.d ?? bar.t;
  return computeIbs(
    { high, low, close, date: typeof date === 'string' ? date : undefined },
    timeframe,
    ctx,
  );
}

/** A candidate after partitioning — same shape plus the signal bar's IBS
 *  (`null` when uncomputable, so emitters can persist `ibs` on records). */
export type Partitioned<T> = T & { ibs: number | null };

/**
 * Partition candidates by their signal bar's IBS. `bars` is index-aligned
 * with the zone array the candidates were detected on (`candidate.index`
 * addresses both) — callers pass the same bars they fed the zone engines.
 */
export function partitionByIbs<T extends { index: number; direction: 'long' | 'short' }>(
  candidates: T[],
  bars: IbsBarLike[],
  timeframe: IbsTimeframe,
  ctx?: IbsFilterContext,
): { emitted: Partitioned<T>[]; suppressed: Partitioned<T>[] } {
  const threshold = ctx?.threshold ?? 0.5;
  const emitted: Partitioned<T>[] = [];
  const suppressed: Partitioned<T>[] = [];

  for (const c of candidates) {
    const v = barIbs(bars[c.index], timeframe, ctx);
    const p = { ...c, ibs: v ?? null };
    if (ctx === undefined || v === undefined) {
      emitted.push(p);
    } else if (c.direction === 'long') {
      (v >= threshold ? emitted : suppressed).push(p);
    } else {
      // +EPSILON keeps the inclusive bound honest for T where 1−T rounds a
      // ulp below the mathematical bound (e.g. T=0.15 → 0.8499999999999999).
      (v <= 1 - threshold + Number.EPSILON ? emitted : suppressed).push(p);
    }
  }

  return { emitted, suppressed };
}

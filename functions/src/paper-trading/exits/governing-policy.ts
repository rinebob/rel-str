/**
 * @topic #553 — Paper Trading Infra (task #1574)
 *
 * The curated governing policy (`CURATED_GOVERNING_POLICY =
 * 'deepest-stop-else-trailing-8'`): on trades carrying
 * `PaperTrade.governingPolicy`, the eval path recomputes which ACTIVE
 * variant run governs each day instead of honoring a static seed.
 *
 * Selection (long side; shorts mirror):
 * - Candidates: ACTIVE runs in the below-price stop families
 *   (`trailing-*`, `ma-close-*`) whose `variantLevel` is defined and sits
 *   below the trade's high watermark (peak, not today's mark). A stop
 *   breached TODAY still sits below the peak — it stays a candidate, so
 *   its trigger fires and closes the trade rather than stranding it;
 *   only a level above the peak (already consumed) is excluded.
 * - Governing = the candidate with the DEEPEST level (most room before
 *   it stops out).
 * - Fallback: when the deepest level sits below the entry fill price the
 *   exit would lock a loss — `trailing-8` governs instead, when its run
 *   is still ACTIVE. A dead fallback can't be named: the deepest ACTIVE
 *   candidate governs in that case.
 * - `target-*`/`time-*` are independent closers, not candidates —
 *   candidacy is family-scoped, not merely side-scoped (a target whose
 *   level has already been crossed lands on the stop side numerically
 *   but is still not a stop).
 */

import { DEFAULT_TRAILING_STOP_KEY } from '@paper-trading/contracts';
import type { VariantRun } from '@paper-trading/contracts';
import type { OhlcBar } from '../../common/market-data-types';
import {
  entryPrice,
  isShort,
  parseVariantKey,
  variantLevel,
  type VariantLevelCtx,
} from './registry';

/** Stop families eligible to govern under the curated policy. */
const GOVERNING_CANDIDATE_FAMILIES = new Set(['trailing-stop', 'ma-close']);

/**
 * Pick the day's governing run under the curated policy. Pure — levels
 * come from `variantLevel` against the supplied ctx (callers enrich
 * `indicators.sma` for `ma-close` candidates). Returns `undefined` when
 * no candidate qualifies — the trade then has no governing close for
 * the day (independent closers may still fire).
 */
export function selectGoverningRun(
  runs: readonly VariantRun[],
  ctx: VariantLevelCtx,
): VariantRun | undefined {
  const short = isShort(ctx.trade);
  const entry = entryPrice(ctx.trade);
  // The trade's watermark is the peak any trailing run has ratcheted to
  // (they share the trade's marks), floored at entry and today's mark.
  const watermark = runs.reduce((w, r) => {
    const rw = short
      ? r.workingState?.lowWaterMark
      : r.workingState?.highWaterMark;
    if (rw === undefined) return w;
    return short ? Math.min(w, rw) : Math.max(w, rw);
  }, short ? Math.min(entry, ctx.mark) : Math.max(entry, ctx.mark));
  const candidates = runs
    .filter((r) => r.state === 'ACTIVE')
    .map((r) => ({ run: r, level: variantLevel(r, ctx) }))
    .filter(
      (c): c is { run: VariantRun; level: number } =>
        c.level !== undefined &&
        GOVERNING_CANDIDATE_FAMILIES.has(
          parseVariantKey(c.run.variantKey)?.family ?? '',
        ) &&
        (short ? c.level > watermark : c.level < watermark),
    );
  if (candidates.length === 0) return undefined;
  const deepest = candidates.reduce((a, b) =>
    short ? (b.level > a.level ? b : a) : b.level < a.level ? b : a,
  );
  // Losing-exit fallback: a governing stop beyond the entry price locks
  // a loss — trail with the configured default instead.
  const pastEntry = short ? deepest.level > entry : deepest.level < entry;
  if (pastEntry) {
    const fallback = runs.find(
      (r) => r.variantKey === DEFAULT_TRAILING_STOP_KEY && r.state === 'ACTIVE',
    );
    if (fallback) return fallback;
  }
  return deepest.run;
}

/**
 * Simple moving average of the last `period` closes on or before `date`
 * (bars are `OhlcBar.d`-sorted by the loader but filtered defensively).
 * `undefined` when the window exceeds loaded history — the caller skips
 * the `ma-close` run rather than firing on a partial window.
 */
export function smaAt(
  bars: readonly OhlcBar[],
  date: string,
  period: number,
): number | undefined {
  const eligible = bars
    .filter((b) => b.d <= date)
    .sort((a, b) => a.d.localeCompare(b.d))
    .slice(-period);
  if (eligible.length < period) return undefined;
  return eligible.reduce((sum, b) => sum + b.c, 0) / period;
}

/**
 * Collect the `indicators.sma` map for every ACTIVE `ma-close` run —
 * one `smaAt` per distinct period over the supplied bars. `undefined`
 * when no run needs SMA data (the caller skips the bars fetch entirely
 * in that case); missing windows leave the period absent so the run
 * skips loudly rather than firing on a partial window.
 */
export function smaIndicatorsFor(
  runs: readonly VariantRun[],
  bars: readonly OhlcBar[],
  date: string,
): { sma: Record<number, number> } | undefined {
  const periods = new Set<number>();
  for (const r of runs) {
    const def = parseVariantKey(r.variantKey);
    if (def?.family === 'ma-close') periods.add(def.params.period);
  }
  if (periods.size === 0) return undefined;
  const sma: Record<number, number> = {};
  for (const p of periods) {
    const v = smaAt(bars, date, p);
    if (v !== undefined) sma[p] = v;
  }
  return { sma };
}

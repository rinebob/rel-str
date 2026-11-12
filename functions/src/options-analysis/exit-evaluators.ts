/**
 * `exit-evaluators.ts` — pure per-kind exit evaluators (Topic #1238,
 * Thread #1266, task #1371; IMPL-BE §4).
 *
 * `(series, entryMark, rule, expiration) => ExitScanResult` — one pass
 * over the contract's daily-mark series; the rule either fires
 * `{fired:true, exitDate, exitPrice, dayIndex}` or scans to the last bar
 * `{fired:false}`. The caller (#1372 worker) runs EVERY registered rule
 * over the SAME series — rules are independent scans, so one firing
 * never truncates another (PRD story 6).
 *
 * Input contract (caller — not re-validated):
 * - `series[0]` IS the pick-day bar — bars before entry must not appear.
 * - Date-ascending; `bar.date`/`expiration` are `YYYY-MM-DD`.
 * - `mark`/`entryMark` finite — a NaN mark silently never-fires the
 *   mark rules and would emit `exitPrice: NaN` on a dte-time fire.
 * - Tail bars PAST `expiration` are clipped internally (first bar with
 *   `date > expiration` ends the scan) — the caller need not clip, but
 *   only bars through expiry ever produce exits or excursion.
 *
 * Handoff notes for #1372:
 * - The 'expired' outcome check must use CLIP semantics (expiry date
 *   present among live bars / last LIVE bar is the expiry bar), not
 *   `series.at(-1)` — a post-expiry tail makes the raw last bar
 *   misleading and would write 'error' for a contract that expired.
 * - `dayIndex` is a BAR INDEX, not calendar `daysHeld` — derive
 *   daysHeld from pickDate→exitDate via `calendarDaysBetween`.
 * - Empty-series excursion returns `{value: entryMark, date: ''}` —
 *   substitute `pickDate` for `''` (or write the error record instead;
 *   `ExcursionPoint.date` is contractually YYYY-MM-DD).
 *
 * Signature deviation from IMPL-BE §4's 3-param sketch: `dte-time`
 * can't derive remaining-DTE without the contract's expiration, and
 * neither the series nor the rule carries it — the pick row does
 * (`PickDocDay.expiration`), so it arrives as the 4th param.
 *
 * Excursion convention (short-premium posture — every seeded strategy
 * exits a sold premium position): adverse = mark UP (costlier buyback),
 * favorable = mark DOWN — so `mae` = highest mark, `mfe` = lowest mark
 * over the rule's own entry→exit window only (first occurrence wins
 * ties). `fired:false` results span the whole series.
 *
 * Comparisons are INCLUSIVE (per TEST-BE): `<=` for profit-target and
 * absolute-price, `>=` for the stop, `<=` on remaining DTE.
 *
 * No network, no Firestore — unit-testable in isolation.
 */

import type { ExitStrategyDef } from '@options-analysis/registry';
import type { ExcursionPoint } from '@options-analysis/contracts';
import { calendarDaysBetween } from '../common/pt-date-utils';

/** One normalized series bar — the worker parses wire strings to
 *  numbers before scanning. */
export interface ExitScanBar {
  /** YYYY-MM-DD trading date. */
  date: string;
  /** Contract mark (mid) for the day — finite; the worker parses wire
   *  strings and drops/handles non-numeric observations. */
  mark: number;
  /** Optional greeks carried through for the record's terminal fields —
   *  absent when the observation's `delta`/`implied_volatility` strings
   *  are missing or non-numeric (never gates the bar). */
  delta?: number;
  iv?: number;
}

/** Rule fired on the series — `dayIndex` is the firing bar's index. */
export interface ExitScanFired {
  fired: true;
  exitDate: string; // YYYY-MM-DD
  exitPrice: number;
  dayIndex: number;
  mae: ExcursionPoint;
  mfe: ExcursionPoint;
}

/** Rule never fired — excursion spans the full series. */
export interface ExitScanNoFire {
  fired: false;
  mae: ExcursionPoint;
  mfe: ExcursionPoint;
}

export type ExitScanResult = ExitScanFired | ExitScanNoFire;

/** Boundary tolerance — thresholds like `2.0 * (1 - 0.9)` land a few
 *  ulps below the intended mark (`0.1999…96`), so inclusive comparisons
 *  absorb ~1e-9 of float noise. Marks are dollars — sub-nano precision
 *  is meaningless, never a false fire. */
const EPS = 1e-9;

/** First day the rule fires, or -1 — the kind switch is the whole
 *  evaluator. Series[0] is the pick-day bar and IS scanned (same-day
 *  exits → dayIndex 0). */
function firingDayIndex(
  series: ExitScanBar[],
  entryMark: number,
  rule: ExitStrategyDef,
  expiration: string,
): number {
  switch (rule.kind) {
  case 'target-pct-premium': {
    const threshold = entryMark * (1 - rule.params.pct / 100);
    return series.findIndex((b) => b.mark <= threshold + EPS);
  }
  case 'absolute-price':
    return series.findIndex((b) => b.mark <= rule.params.price + EPS);
  case 'stop-pct-premium': {
    const threshold = entryMark * (rule.params.pct / 100);
    return series.findIndex((b) => b.mark >= threshold - EPS);
  }
  case 'dte-time':
    return series.findIndex(
      (b) => calendarDaysBetween(b.date, expiration) <= rule.params.dte,
    );
  case 'hold-to-expiry':
    return -1;
  }
}

/** Worst/best mark over `bars` — the entry mark itself is part of the
 *  window (worst excursion can't be better than entry), dated to the
 *  first bar when it stays the extreme; first bar wins ties. Empty
 *  input → the `{entryMark, ''}` placeholder (worker substitutes
 *  pickDate — see header). */
function excursion(
  bars: ExitScanBar[],
  entryMark: number,
): { mae: ExcursionPoint; mfe: ExcursionPoint } {
  const mae = { value: entryMark, date: bars[0]?.date ?? '' };
  const mfe = { value: entryMark, date: bars[0]?.date ?? '' };
  for (const b of bars) {
    if (b.mark > mae.value) {
      mae.value = b.mark;
      mae.date = b.date;
    }
    if (b.mark < mfe.value) {
      mfe.value = b.mark;
      mfe.date = b.date;
    }
  }
  return { mae, mfe };
}

/** Scan `series` under one exit rule — fires on the first qualifying
 *  bar, else returns the full-window excursion. The scan window is
 *  clipped at `expiration` (first bar past expiry ends it): a contract
 *  can't exit after it stops existing, and dead-contract marks must
 *  never leak into excursion or produce impossible `exit` records. */
export function evaluateExit(
  series: ExitScanBar[],
  entryMark: number,
  rule: ExitStrategyDef,
  expiration: string,
): ExitScanResult {
  const end = series.findIndex((b) => b.date.slice(0, 10) > expiration);
  const window = end < 0 ? series : series.slice(0, end);
  const dayIndex = firingDayIndex(window, entryMark, rule, expiration);
  if (dayIndex >= 0) {
    const bar = window[dayIndex];
    return {
      fired: true,
      exitDate: bar.date,
      exitPrice: bar.mark,
      dayIndex,
      ...excursion(window.slice(0, dayIndex + 1), entryMark),
    };
  }
  return { fired: false, ...excursion(window, entryMark) };
}

/**
 * @topic #553 — Paper Trading Infra (task #563)
 *
 * Nightly exit-variant evaluation. For every trade carrying ACTIVE variant
 * runs, evaluate each run against that day's mark:
 *
 * - governing trigger → `applyExitFill` at the mark (trade → CLOSED, cash
 *   credited), then the run is finalized `EXITED` with its `exitEvent`.
 * - shadow trigger → run `EXITED` with a counterfactual `exitEvent`
 *   (computed with the ledger's own `computeExitPnl`); never touches cash.
 * - no trigger → `workingState` updates only (e.g. trailing water mark).
 *
 * Gaps: a run never fires on a stale mark — without `marks[date].mark` the
 * day is skipped. Shadow runs evaluate whenever a mark exists, including on
 * CLOSED trades (counterfactual measurement continues as long as marks
 * land; keeping marks flowing on closed trades is mark-pass plumbing for a
 * later task). A CLOSED trade whose governing run is still ACTIVE (crash
 * between the ledger commit and the run update) has its exitEvent
 * backfilled from the exit fill — the ledger write is never replayed.
 *
 * Status gating: governing closes fire only on OPEN trades. An ASSIGNED
 * trade holds delivered shares, so an option-mark exit would miscompute —
 * governing triggers there are logged as errors (assigned-share exits are
 * a dedicated seam, deferred to the exit-policy config task).
 */

import { OptionQuoteSource } from '@options/common';
import {
  CURATED_GOVERNING_POLICY,
  PaperTradeStatus,
  type PaperFill,
  type PaperTrade,
  type VariantExitEvent,
  type VariantRun,
} from '@paper-trading/contracts';
import {
  computeExitPnl,
  type ApplyFillResult,
  type ExitFillInput,
} from '../ledger';
import { calendarDaysBetween } from '../../common/pt-date-utils';
import type { OhlcBar } from '../../common/market-data-types';
import {
  evaluateVariant,
  isIndependentCloser,
  parseVariantKey,
  type VariantEvalCtx,
} from './registry';
import { selectGoverningRun, smaIndicatorsFor } from './governing-policy';
import { createLogger } from '../engine/logging';

const logger = createLogger('ExitEvalPass');

/** Injected seams — production wiring lives in `defaultDeps`. */
export interface ExitEvalDeps {
  /** Candidates: OPEN/ASSIGNED/CLOSED trades with ≥1 ACTIVE parsed run;
   *  PENDING, EXPIRED, and CANCELLED are excluded by the caller's query. */
  listTrades(): Promise<PaperTrade[]>;
  /** Ledger closing fill (applyExitFill bound to its deps). */
  applyExit(input: ExitFillInput): Promise<ApplyFillResult>;
  /** Persist one run's new state (repository.updateVariantRun). */
  updateRun(tradeId: string, run: VariantRun): Promise<void>;
  /** Resolve the owning user for the account leg of a closing fill. */
  resolveUserId(trade: PaperTrade): Promise<string | undefined>;
  /** Daily bars through `date` — needed to enrich `indicators.sma` when a
   *  trade carries ACTIVE `ma-close-*` runs (#1574). Absent → those runs
   *  skip loudly (never fire blind). */
  getBars?(symbol: string, date: string): Promise<OhlcBar[]>;
  /** Atomic governing write — flag-corrected `variantRuns` + the
   *  `governingVariant` mirror in one update, used for the daily pick
   *  AND the close-time attribution write (repository.applyGoverningPick). */
  applyGoverningPick?(
    tradeId: string,
    runs: VariantRun[],
    governingVariant: string,
  ): Promise<void>;
}

export interface ExitEvalSummary {
  evaluated: number;
  skipsNoMark: number;
  governingCloses: number;
  shadowExits: number;
  stateUpdates: number;
  errors: string[];
}

function exitEventFor(
  trade: PaperTrade,
  exitPrice: number,
  date: string,
  daysHeld: number,
): VariantExitEvent {
  const entry = trade.fills.find((f) => f.role === 'entry');
  const pnl = entry
    ? computeExitPnl(entry, exitPrice, trade.order.side, trade.legs)
    : 0;
  return { date, price: exitPrice, pnl, daysHeld };
}

function isOpenish(trade: PaperTrade): boolean {
  return trade.status === PaperTradeStatus.OPEN || trade.status === PaperTradeStatus.ASSIGNED;
}

function shallowEqualNumbers(a: Record<string, number>, b: Record<string, number>): boolean {
  const aKeys = Object.keys(a);
  const bKeys = Object.keys(b);
  return aKeys.length === bKeys.length && aKeys.every((k) => a[k] === b[k]);
}

/** Evaluate every ACTIVE variant run on every candidate trade for `date`. */
export async function runExitEvalPass(
  date: string,
  deps: ExitEvalDeps,
): Promise<ExitEvalSummary> {
  const summary: ExitEvalSummary = {
    evaluated: 0,
    skipsNoMark: 0,
    governingCloses: 0,
    shadowExits: 0,
    stateUpdates: 0,
    errors: [],
  };

  // Per-symbol bars cache — curated cohorts cluster on a handful of
  // symbols; the loader reads every year-shard so per-trade fetches
  // would multiply the nightly read count.
  const barsCache = new Map<string, OhlcBar[]>();
  const barsFor = async (symbol: string): Promise<OhlcBar[]> => {
    const cached = barsCache.get(symbol);
    if (cached) return cached;
    const bars = deps.getBars ? await deps.getBars(symbol, date) : [];
    barsCache.set(symbol, bars);
    return bars;
  };

  for (const trade of await deps.listTrades()) {
    const activeRuns = trade.variantRuns.filter((r) => r.state === 'ACTIVE');
    if (activeRuns.length === 0) continue;
    summary.evaluated++;

    const markEntry = trade.marks[date];
    const mark = markEntry?.mark;
    const entry = trade.fills.find((f) => f.role === 'entry');
    if (!entry && isOpenish(trade)) {
      // No entry fill → no honest basis for any variant (entry price 0
      // makes every stop fire instantly for shorts). Skip loudly.
      const msg = `${trade.id}: OPEN trade with ACTIVE runs but no entry fill — skipped`;
      summary.errors.push(msg);
      logger.warn(msg);
      continue;
    }
    const daysHeld = entry ? calendarDaysBetween(entry.date, date) : 0;

    // ── Curated policy (#1574): SMA enrichment + daily governing pick ──
    const policyActive =
      trade.governingPolicy === CURATED_GOVERNING_POLICY &&
      trade.status === PaperTradeStatus.OPEN;
    const hasMark = mark !== undefined && Number.isFinite(mark);

    // SMA enrichment for ACTIVE ma-close runs (evaluator + policy
    // candidacy read the same map) — fetched only when a mark exists,
    // cached per symbol for the pass. Missing dep/data → the runs hold
    // no level and skip loudly in evalOne — never fire blind.
    let indicators: VariantEvalCtx['indicators'];
    if (
      hasMark &&
      activeRuns.some((r) => parseVariantKey(r.variantKey)?.family === 'ma-close')
    ) {
      try {
        indicators = smaIndicatorsFor(
          activeRuns,
          await barsFor(trade.symbol),
          date,
        );
      } catch (err) {
        summary.errors.push(
          `${trade.id}: bars load failed for ${trade.symbol} — ma-close runs skipped (${err instanceof Error ? err.message : String(err)})`,
        );
      }
    }

    // Policy-marked trades recompute governing before iterating runs: one
    // atomic write carries the flag-corrected runs + the mirror (no
    // observable flags-vs-mirror mid-state). Unmarked trades skip this
    // entirely — their static governingVariant behavior is the
    // regression pin. pick === undefined keeps the last mirror value —
    // any later closer fire rewrites it via attribution.
    // Flag-corrected FULL array (the stored doc carries EXITED runs too
    // — writing an actives-only array would erase their history) + the
    // ACTIVE view the eval loop walks.
    let fullRuns = trade.variantRuns;
    let evalRuns = activeRuns;
    if (policyActive && hasMark) {
      const pick = selectGoverningRun(activeRuns, { trade, mark, indicators });
      fullRuns = trade.variantRuns.map((r) => ({
        ...r,
        governing: r.state === 'ACTIVE' && r.variantKey === pick?.variantKey,
      }));
      evalRuns = fullRuns.filter((r) => r.state === 'ACTIVE');
      const flagChanges = fullRuns.filter(
        (r, i) => r.governing !== trade.variantRuns[i].governing,
      ).length;
      const mirror = pick?.variantKey ?? trade.governingVariant;
      if (flagChanges > 0 || mirror !== trade.governingVariant) {
        try {
          if (!deps.applyGoverningPick) {
            throw new Error('applyGoverningPick dep missing');
          }
          await deps.applyGoverningPick(trade.id, fullRuns, mirror);
          summary.stateUpdates += flagChanges;
        } catch (err) {
          // Isolated to this trade — in-memory evalRuns still evaluate
          // correctly and the mirror heals on tomorrow's pass.
          summary.errors.push(
            `${trade.id}: governing pick write failed — ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }
    }

    // Same-day latch: once a real close lands the in-memory trade still
    // reads OPEN — later triggers must shadow-record, not re-attempt the
    // ledger (applyExitFill would throw 'not open' on the re-read).
    let closedThisPass = false;
    /**
     * One run's eval: trigger → governing closes (when allowed) and every
     * run records its exitEvent; otherwise persist working-state updates.
     * `allowGoverningClose` is true only for OPEN trades — ASSIGNED trades
     * hold delivered shares whose exit is a different price basis.
     * `policyActive` additionally lets `target-*`/`time-*` independent
     * closers fire the real close.
     */
    const evalOne = async (
      run: VariantRun,
      allowGoverningClose: boolean,
      policyClose: boolean,
    ): Promise<void> => {
      if (mark === undefined || !Number.isFinite(mark)) {
        // Gap tolerance — never fire on a stale mark. Counted per run.
        // A non-finite mark is corrupt upstream data — count + report.
        summary.skipsNoMark++;
        if (mark !== undefined) {
          summary.errors.push(`${trade.id}/${run.variantKey}: non-finite mark ${mark} — skipped`);
        }
        return;
      }
      const ctx: VariantEvalCtx = {
        trade,
        mark,
        date,
        daysHeld,
        run,
        ...(markEntry?.underlyingClose !== undefined
          ? { underlyingClose: markEntry.underlyingClose }
          : {}),
        ...(indicators ? { indicators } : {}),
      };
      try {
        // Never fire blind — an ma-close run without its SMA skips loudly.
        const def = parseVariantKey(run.variantKey);
        if (
          def?.family === 'ma-close' &&
          ctx.indicators?.sma?.[def.params.period] === undefined
        ) {
          const msg = `${trade.id}/${run.variantKey}: SMA data unavailable for ${date} — skipped`;
          summary.errors.push(msg);
          logger.warn(msg);
          return;
        }
        const result = evaluateVariant(ctx);
        if (result.trigger) {
          const evt = exitEventFor(trade, mark, date, daysHeld);
          const closeWanted =
            !closedThisPass &&
            (run.governing || (policyClose && isIndependentCloser(run.variantKey)));
          if (closeWanted) {
            if (!allowGoverningClose) {
              const msg = `${trade.id}: governing ${run.variantKey} fired on ${trade.status} trade — ` +
                `share-holding exits need a dedicated seam (skipped)`;
              summary.errors.push(msg);
              logger.warn(msg);
              return;
            }
            const userId = await deps.resolveUserId(trade);
            if (!userId) {
              summary.errors.push(
                `${trade.id}: governing ${run.variantKey} fired but no userId resolved — close skipped`,
              );
              logger.warn(`governing ${run.variantKey} fired on ${trade.id} but account owner unresolved`);
              return;
            }
            const fill: PaperFill = {
              fillId: `exit-${trade.id}-${run.variantKey}-${date}`,
              role: 'exit',
              date,
              price: mark,
              quantity: trade.order.quantity,
              // Marks are written by mark-pass via the RH MCP provider today
              // — PaperMark carries no provenance field; revisit when an
              // AV_EOD mark writer exists.
              quoteSource: OptionQuoteSource.RH_MCP,
            };
            await deps.applyExit({ userId, tradeId: trade.id, fill, now: new Date().toISOString() });
            closedThisPass = true;
            // Atomic close write (policy trades): the fired run's
            // EXITED + exitEvent AND the mirror land in one update — the
            // mirror names what actually closed (the pick for governing
            // fires, the closer key for independent fires).
            if (policyClose) {
              const closedRuns = fullRuns.map((r) =>
                r.variantKey === run.variantKey
                  ? { ...r, state: 'EXITED' as const, exitEvent: evt }
                  : r,
              );
              if (deps.applyGoverningPick) {
                await deps.applyGoverningPick(trade.id, closedRuns, run.variantKey);
                summary.stateUpdates++;
              } else {
                summary.errors.push(
                  `${trade.id}: ${run.variantKey} closed but no applyGoverningPick dep — run state + attribution missed`,
                );
              }
            }
            summary.governingCloses++;
          }
          if (!(policyClose && closeWanted)) {
            await deps.updateRun(trade.id, {
              ...run,
              state: 'EXITED',
              exitEvent: evt,
            });
            if (!closeWanted) summary.shadowExits++;
            summary.stateUpdates++;
          }
        } else if (
          result.workingState !== undefined &&
          // Skip the write when the water mark didn't move — trailing runs
          // would otherwise burn a txn every night they stay open.
          !shallowEqualNumbers(result.workingState, run.workingState)
        ) {
          await deps.updateRun(trade.id, { ...run, workingState: result.workingState });
          summary.stateUpdates++;
        }
      } catch (err) {
        const msg = `${trade.id}/${run.variantKey}: ${err instanceof Error ? err.message : String(err)}`;
        summary.errors.push(msg);
        logger.error(msg);
      }
    };

    if (!isOpenish(trade)) {
      // Backfill: close out a governing run left ACTIVE by a partial
      // failure (ledger committed, run update missed).
      const governing = activeRuns.find((r) => r.governing);
      if (governing) {
        const exitFill = trade.fills.find((f) => f.role === 'exit');
        if (!exitFill && !governing.exitEvent) {
          // CLOSED with no exit fill — no honest exitEvent exists; leave the
          // run ACTIVE and report rather than fabricate a price.
          const msg = `${trade.id}: governing run ACTIVE on CLOSED trade with no exit fill`;
          summary.errors.push(msg);
          logger.warn(msg);
        } else {
          await deps.updateRun(trade.id, {
            ...governing,
            state: 'EXITED',
            exitEvent: governing.exitEvent ?? exitEventFor(
              trade, exitFill!.price, exitFill!.date, calendarDaysBetween(entry?.date ?? date, exitFill!.date),
            ),
          });
          summary.stateUpdates++;
        }
      }
      // Shadow counterfactuals keep evaluating on closed trades while
      // marks land (mark-pass coverage for closed trades is deferred).
      for (const run of activeRuns.filter((r) => !r.governing)) {
        await evalOne(run, false, false);
      }
      continue;
    }

    for (const run of evalRuns) {
      await evalOne(run, trade.status === PaperTradeStatus.OPEN, policyActive);
    }
  }
  return summary;
}

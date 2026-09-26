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

import type { Firestore } from 'firebase-admin/firestore';
import { OptionQuoteSource } from '@options/common';
import {
  PaperTradeStatus,
  type PaperFill,
  type PaperTrade,
  type VariantExitEvent,
  type VariantRun,
} from '@paper-trading/contracts';
import { db as adminDb } from '../../firebase-admin-init';
import {
  applyExitFill,
  computeExitPnl,
  type ApplyFillResult,
  type ExitFillInput,
} from '../ledger';
import {
  getInstance,
  ledgerDeps,
  listTrades,
  updateVariantRun,
} from '../repository';
import { calendarDaysBetween } from '../../common/pt-date-utils';
import { evaluateVariant, parseVariantKey, type VariantEvalCtx } from './registry';
import { createLogger } from '../engine/logging';

const logger = createLogger('ExitEvalPass');

/** Injected seams — production wiring lives in `defaultDeps`. */
export interface ExitEvalDeps {
  /** Candidates: OPEN/ASSIGNED/CLOSED trades with ≥1 ACTIVE parsed run;
   *  PENDING and EXPIRED are excluded by the caller's query. */
  listTrades(): Promise<PaperTrade[]>;
  /** Ledger closing fill (applyExitFill bound to its deps). */
  applyExit(input: ExitFillInput): Promise<ApplyFillResult>;
  /** Persist one run's new state (repository.updateVariantRun). */
  updateRun(tradeId: string, run: VariantRun): Promise<void>;
  /** Resolve the owning user for the account leg of a closing fill. */
  resolveUserId(trade: PaperTrade): Promise<string | undefined>;
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

    /**
     * One run's eval: trigger → governing closes (when allowed) and every
     * run records its exitEvent; otherwise persist working-state updates.
     * `allowGoverningClose` is true only for OPEN trades — ASSIGNED trades
     * hold delivered shares whose exit is a different price basis.
     */
    const evalOne = async (run: VariantRun, allowGoverningClose: boolean): Promise<void> => {
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
      };
      try {
        const result = evaluateVariant(ctx);
        if (result.trigger) {
          if (run.governing) {
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
            summary.governingCloses++;
          }
          await deps.updateRun(trade.id, {
            ...run,
            state: 'EXITED',
            exitEvent: exitEventFor(trade, mark, date, daysHeld),
          });
          if (!run.governing) summary.shadowExits++;
          summary.stateUpdates++;
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
        await evalOne(run, false);
      }
      continue;
    }

    for (const run of activeRuns) {
      await evalOne(run, trade.status === PaperTradeStatus.OPEN);
    }
  }
  return summary;
}

// ── Production wiring ───────────────────────────────────────────────────────

/**
 * Candidate trades for eval: every trade with ≥1 ACTIVE variant run —
 * OPEN/ASSIGNED evaluate live; CLOSED backfills a governing run left ACTIVE
 * by a partial failure and keeps shadow runs measuring. PENDING trades are
 * intentionally excluded: they carry no entry fill yet, so no variant can
 * honestly fire (expression-fill-pass flips them to OPEN before marks land).
 */
async function listCandidateTrades(db: Firestore): Promise<PaperTrade[]> {
  const statuses = [PaperTradeStatus.OPEN, PaperTradeStatus.ASSIGNED, PaperTradeStatus.CLOSED];
  const results = await Promise.all(statuses.map((s) => listTrades(db, { status: s })));
  return results
    .flat()
    // ≥1 ACTIVE run with a real variant — 'none' runs stay ACTIVE forever
    // (inert by parse fallthrough) and would keep every engine trade a
    // nightly candidate forever; the parse check retires them.
    .filter((t) =>
      t.variantRuns.some((r) => r.state === 'ACTIVE' && parseVariantKey(r.variantKey) !== null),
    );
}

async function resolveAccountOwner(
  db: Firestore,
  trade: PaperTrade,
): Promise<string | undefined> {
  if (!trade.strategyInstanceId) return undefined;
  const inst = await getInstance(db, trade.strategyInstanceId);
  return inst?.userId;
}

/** Production dep wiring (Firestore + ledger). */
export function defaultEvalDeps(db: Firestore = adminDb): ExitEvalDeps {
  return {
    listTrades: () => listCandidateTrades(db),
    applyExit: (input: ExitFillInput): Promise<ApplyFillResult> =>
      applyExitFill(input, ledgerDeps(db)),
    updateRun: (tradeId, run) =>
      updateVariantRun(db, tradeId, run, new Date().toISOString()),
    resolveUserId: (trade) => resolveAccountOwner(db, trade),
  };
}

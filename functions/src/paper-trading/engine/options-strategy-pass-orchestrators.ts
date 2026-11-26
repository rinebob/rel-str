/**
 * @topic #108 — Options Position Strategy Engine
 *
 * Orchestrator functions shared by the scheduled Cloud Functions and manual
 * HTTP callables. Open-passes still enumerate strategy instances; mark,
 * settlement, and held-shares are position-grain sweeps (#1712/#1714) —
 * no instance enumeration, so legacy and STOPPED-instance docs run on the
 * same cadence.
 */

import type { StrategyInstanceConfig } from '@options-strategy-engine/contracts';

import { getMarketDatePT } from '../../common/pt-date-utils';
import { listActiveInstances } from './strategy-instance-repository';
import { runEodNightlySelection } from './eod-orchestrator';
import { runOpenPass } from './passes/open-pass';
import {
  runMarkPass,
  type BatchQuoteProvider,
  type MarkPassDependencies,
} from './passes/mark-pass';
import {
  runShadowEvalTick,
  type ShadowEvalPositionInput,
  type ShadowEvalSummary,
} from './passes/shadow-eval-pass';
import { runSettlementPass } from './passes/settlement-pass';
import { runHeldSharesMarkPass } from './passes/held-shares-pass';
import { runExitEvalPass, type ExitEvalSummary } from '../exits/eval-pass';
import { defaultEvalDeps } from '../exits/eval-pass-deps';
import {
  createPaperStatsPassDeps,
  runPaperStatsPass,
  type PaperStatsPassResult,
} from '../passes/paper-stats-pass';
import {
  defaultSignalSettlementDeps,
  runSignalSettlementPass,
  type SignalSettlementPassSummary,
} from '../passes/signal-settlement-pass';
import {
  defaultSignalEodCloseDeps,
  runSignalEodClosePass,
  type SignalEodClosePassSummary,
} from '../passes/signal-eod-close-pass';
import { db as paperDb } from '../../firebase-admin-init';
import { getUnderlyingClose, getUnderlyingCloseForDate } from './options-strategy-market-data';
import { createLogger } from './logging';

const log = createLogger('OptionsStrategyPasses');

// ── Selection pass orchestrator ─────────────────────────────────────────────

/**
 * Run the selection pass for all active strategy instances. Exported so the
 * onSchedule wrapper and tests share the same implementation.
 */
export async function runOptionsSelectionPass(
  marketDate: string = getMarketDatePT(),
  listInstances: () => Promise<StrategyInstanceConfig[]> = listActiveInstances,
  getClose: (symbol: string) => Promise<number | null> = getUnderlyingClose,
  runSelection: (
    marketDate: string,
    instance: StrategyInstanceConfig,
    underlyingClose: number,
    instanceId: string,
  ) => ReturnType<typeof runEodNightlySelection> = runEodNightlySelection,
): Promise<void> {
  log.info(`Selection pass starting for ${marketDate}`);

  const instances = await listInstances();
  if (instances.length === 0) {
    log.warn('No active strategy instances');
    return;
  }

  for (const instance of instances) {
    if (!instance.phases?.[0]) {
      log.warn(`No phase configured for ${instance.id}`);
      continue;
    }

    const underlyingClose = await getClose(instance.symbol);
    if (underlyingClose === null) {
      log.warn(`No underlying price for ${instance.symbol}`);
      continue;
    }

    try {
      const result = await runSelection(
        marketDate,
        instance,
        underlyingClose,
        instance.id,
      );
      if (result) {
        log.info(
          `Selected ${result.quote.contractID} for ${instance.id}/${marketDate}`,
        );
      } else {
        log.info(`No contract selected for ${instance.id}/${marketDate}`);
      }
    } catch (err) {
      log.error(
        `Selection pass failed for ${instance.id}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  log.info('Selection pass complete');
}

// ── Open pass orchestrator ──────────────────────────────────────────────────

/**
 * Run the open pass for all active strategy instances. Exported for testing.
 */
export async function runOptionsOpenPass(
  marketDate: string = getMarketDatePT(),
  listInstances: () => Promise<StrategyInstanceConfig[]> = listActiveInstances,
  getClose: (symbol: string) => Promise<number | null> = getUnderlyingClose,
  pass: (
    instanceId: string,
    date: string,
    config: StrategyInstanceConfig,
    currentPrice: number,
  ) => ReturnType<typeof runOpenPass> = runOpenPass,
): Promise<void> {
  log.info(`Open pass starting for ${marketDate}`);

  const instances = await listInstances();
  if (instances.length === 0) {
    log.warn('No active strategy instances');
    return;
  }

  for (const instance of instances) {
    if (!instance.phases?.[0]) {
      log.error(`Open pass: no phase configured for ${instance.id}`);
      continue;
    }

    const currentPrice = await getClose(instance.symbol);
    if (currentPrice === null) {
      log.error(`Open pass: no current price for ${instance.symbol} — sync may have failed`);
      continue;
    }

    try {
      const result = await pass(
        instance.id,
        marketDate,
        instance,
        currentPrice,
      );
      if (result) {
        log.info(
          `Open pass for ${instance.id}/${marketDate}: skipped=${result.skipped}, positionId=${result.positionId}`,
        );
      } else {
        log.error(`Open pass: no daily-analysis/latest for ${instance.id} — selection pass may have failed`);
      }
    } catch (err) {
      log.error(
        `Open pass failed for ${instance.id}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  log.info('Open pass complete');
}

// ── Mark / settlement pass orchestrators ──────────────────────────────────────

type MarkPassSummary = {
  positions: number;
  errors: number;
  /** Shadow-eval tick (#1713): positions evaluated / new first-fires /
   *  doc+position errors; evalError set when the whole tick threw. */
  evaluated: number;
  fires: number;
  evalErrors: number;
  evalError?: string;
};

/**
 * Run the unified position-grain mark pass (#1712): one sweep over every
 * OPEN trade carrying option legs — no instance enumeration, so legacy and
 * manage positions mark together on the same cadence. Each successfully
 * marked position then folds into the per-tick shadow exit-eval (#1713):
 * all 6 registry rules evaluated on the fresh mark, first-fire +
 * latest-eval merge-written into st-options-analysis-results. Returns a
 * flat summary or `{ error }` when the mark pass itself throws.
 */
export async function runUnifiedMarkPass(
  provider: BatchQuoteProvider,
  markPass: (deps: MarkPassDependencies) => ReturnType<typeof runMarkPass> =
    runMarkPass,
  shadowEval: (
    positions: ShadowEvalPositionInput[],
  ) => Promise<ShadowEvalSummary> = runShadowEvalTick,
): Promise<MarkPassSummary | { error: string }> {
  try {
    const result = await markPass({ quoteProvider: provider });
    log.info(
      `Mark pass complete: marked=${result.positions.length} errors=${result.errors.length}`,
    );
    let evaluated = 0;
    let fires = 0;
    let evalErrors = 0;
    let evalError: string | undefined;
    try {
      const evalSummary = await shadowEval(
        result.positions.map((p) => ({ trade: p.trade, mark: p.mark })),
      );
      evaluated = evalSummary.positions;
      fires = evalSummary.fires;
      evalErrors = evalSummary.errors.length;
      log.info(
        `Shadow eval complete: evaluated=${evaluated} fires=${fires} errors=${evalErrors}`,
      );
    } catch (err) {
      evalError = err instanceof Error ? err.message : String(err);
      log.error(`Shadow eval failed: ${evalError}`);
    }
    return {
      positions: result.positions.length,
      errors: result.errors.length,
      evaluated,
      fires,
      evalErrors,
      ...(evalError !== undefined ? { evalError } : {}),
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.error(`Mark pass failed: ${message}`);
    return { error: message };
  }
}

type SettlementPassSummary = {
  settled: number;
  held: number;
  errors: number;
};

/**
 * Run the nightly settlement chain against the given market date.
 * Triggered from `checkSyncRunCompletion` after all nightly closing bars
 * are available. Settlement + held-shares are position-grain sweeps
 * (#1714) — no instance enumeration, so legacy zombie docs and trades on
 * STOPPED instances settle/mark on the same run.
 */
export async function runNightlySettlementChain(
  marketDate: string,
  settlementPass: (date: string) => ReturnType<typeof runSettlementPass> =
    (date) => runSettlementPass(date, { getUnderlyingClose: getUnderlyingCloseForDate }),
  heldSharesPass: (date: string) => ReturnType<typeof runHeldSharesMarkPass> =
    (date) => runHeldSharesMarkPass(date, { getUnderlyingClose: getUnderlyingCloseForDate }),
  evalPass: (date: string) => Promise<ExitEvalSummary> =
    (date) => runExitEvalPass(date, defaultEvalDeps()),
  paperStatsPass: (date: string) => Promise<PaperStatsPassResult> =
    (date) => runPaperStatsPass(date, createPaperStatsPassDeps()),
  signalSettlementPass: (date: string) => Promise<SignalSettlementPassSummary> =
    (date) => runSignalSettlementPass(date, defaultSignalSettlementDeps(paperDb)),
  signalEodClosePass: (date: string) => Promise<SignalEodClosePassSummary> =
    (date) => runSignalEodClosePass(date, defaultSignalEodCloseDeps(paperDb)),
): Promise<SettlementPassSummary> {
  // Nightly chain: EOD close stamp → exit-variant eval → settlement →
  // stats. The close stamp runs first so signal trades' marks[date]
  // carries the official SDS close — not the last ~1 PM PT intraday
  // quote — when eval reads it (#983). Own try/catch: a stamp failure
  // must not skip eval (intraday marks still stand in that case).
  try {
    const eodSummary = await signalEodClosePass(marketDate);
    log.info(
      `Signal EOD close pass for ${marketDate}: stamped=${eodSummary.stamped} ` +
        `skipped=${eodSummary.skipped} noClose=${eodSummary.skippedNoClose} ` +
        `errors=${eodSummary.errors.length}`,
    );
  } catch (err) {
    log.error(
      `Signal EOD close pass failed for ${marketDate}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  try {
    const evalSummary = await evalPass(marketDate);
    log.info(
      `Exit eval pass for ${marketDate}: evaluated=${evalSummary.evaluated} ` +
        `closes=${evalSummary.governingCloses} shadowExits=${evalSummary.shadowExits} ` +
        `stateUpdates=${evalSummary.stateUpdates} noMark=${evalSummary.skipsNoMark} ` +
        `errors=${evalSummary.errors.length}`,
    );
  } catch (err) {
    log.error(
      `Exit eval pass failed for ${marketDate}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  // Signal-source trades have no instance — settle expired option legs
  // globally (#720) so they can't zombie past expiration. Own try/catch:
  // a failure here must not skip the settlement sweep.
  try {
    const sigSummary = await signalSettlementPass(marketDate);
    log.info(
      `Signal settlement pass for ${marketDate}: settled=${sigSummary.settled} ` +
        `skipped=${sigSummary.skipped} errors=${sigSummary.errors.length}`,
    );
  } catch (err) {
    log.error(
      `Signal settlement pass failed for ${marketDate}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  // Position-grain sweeps (#1714): one call each over all OPEN/ASSIGNED
  // option trades — instance enumeration retired so legacy zombies settle
  // too. allSettled: a throw in one pass must not fabricate a result for
  // the other — a sibling that committed work reports its real counts and
  // the failed pass attributes the error once.
  const toFailure = (reason: unknown, label: string) => ({
    positionId: label,
    error: reason instanceof Error ? reason.message : String(reason),
  });
  const [settleOutcome, heldOutcome] = await Promise.allSettled([
    settlementPass(marketDate),
    heldSharesPass(marketDate),
  ]);
  const settlement =
    settleOutcome.status === 'fulfilled'
      ? settleOutcome.value
      : { date: marketDate, settled: [], skippedNotExpired: 0,
          errors: [toFailure(settleOutcome.reason, '(settlement-sweep)')] };
  const held =
    heldOutcome.status === 'fulfilled'
      ? heldOutcome.value
      : { date: marketDate, marked: [],
          errors: [toFailure(heldOutcome.reason, '(held-shares-sweep)')] };
  if (settleOutcome.status === 'rejected' || heldOutcome.status === 'rejected') {
    log.error(`Settlement sweep fault for ${marketDate}`);
  }
  log.info(
    `Settlement pass for ${marketDate}: settled=${settlement.settled.length} ` +
      `skipped=${settlement.skippedNotExpired} held=${held.marked.length} ` +
      `errors=${settlement.errors.length + held.errors.length}`,
  );

  const summary: SettlementPassSummary = {
    settled: settlement.settled.length,
    held: held.marked.length,
    errors: settlement.errors.length + held.errors.length,
  };

  // Paper-wide rollup scopes (all/inst/var/cohort/sig/sym) — runs once per
  // night after settlement, not per instance.
  try {
    const paperStats = await paperStatsPass(marketDate);
    log.info(
      `Paper stats pass for ${marketDate}: scopes=${paperStats.scopesWritten.length} ` +
        `errors=${paperStats.errors.length}`,
    );
  } catch (err) {
    log.error(
      `Paper stats pass failed for ${marketDate}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  return summary;
}

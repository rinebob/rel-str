/**
 * @topic #108 — Options Position Strategy Engine
 * @topic #137 — Strategy Builder UI
 *
 * Orchestrator functions shared by the scheduled Cloud Functions and manual
 * HTTP callables. Each orchestrator loads strategy instances, runs the
 * corresponding domain pass for each one, and logs per-instance results.
 */

import type { StrategyInstanceConfig } from '@options-strategy-engine/contracts';

import { getMarketDatePT } from '../common/pt-date-utils';
import { listActiveInstances, listManageableInstances } from './strategy-instance-repository';
import { runEodNightlySelection } from './eod-orchestrator';
import { runOpenPass } from './passes/open-pass';
import { runMarkPass } from './passes/mark-pass';
import { runSettlementPass } from './passes/settlement-pass';
import { runHeldSharesMarkPass } from './passes/held-shares-pass';
import { runStatsPass, createDefaultStatsPassDeps } from './passes/stats-pass';
import type { RobinhoodMcpOptionQuoteProvider } from './quote-providers/rh-mcp-option-quote-provider';
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
      log.warn(`No phase configured for ${instance.id}`);
      continue;
    }

    const currentPrice = await getClose(instance.symbol);
    if (currentPrice === null) {
      log.warn(`No current price for ${instance.symbol}`);
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
        log.info(`No daily-analysis for ${instance.id}/${marketDate}`);
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

/**
 * Run a pass for every manageable strategy instance (ACTIVE, PAUSED, or
 * STOPPED) so existing positions continue to be managed regardless of whether
 * new positions are being opened.
 */
async function runPassForManageableInstances<T>(
  passName: string,
  pass: (instance: StrategyInstanceConfig) => Promise<T>,
  listInstances: () => Promise<StrategyInstanceConfig[]> = listManageableInstances,
): Promise<Record<string, T | { error: string }>> {
  const results: Record<string, T | { error: string }> = {};
  const instances = await listInstances();

  for (const instance of instances) {
    if (!instance.phases?.[0]) {
      log.warn(`No phase configured for ${instance.id}`);
      continue;
    }

    try {
      results[instance.id] = await pass(instance);
      log.info(`${passName} complete for ${instance.id}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      log.error(`${passName} failed for ${instance.id}: ${message}`);
      results[instance.id] = { error: message };
    }
  }

  return results;
}

type MarkPassSummary = {
  positions: number;
  errors: number;
};

/**
 * Run the mark pass for every manageable strategy instance using the given
 * quote provider. Logs per-instance outcomes and returns a summary record
 * keyed by instance ID.
 */
export async function runMarkPassForAllInstances(
  provider: RobinhoodMcpOptionQuoteProvider,
  listInstances: () => Promise<StrategyInstanceConfig[]> = listManageableInstances,
  markPass: (
    instanceId: string,
    config: StrategyInstanceConfig,
    deps: { quoteProvider: RobinhoodMcpOptionQuoteProvider },
  ) => ReturnType<typeof runMarkPass> = runMarkPass,
): Promise<Record<string, MarkPassSummary | { error: string }>> {
  return runPassForManageableInstances(
    'Mark pass',
    async (instance) => {
      const result = await markPass(instance.id, instance, {
        quoteProvider: provider,
      });
      return {
        positions: result.positions.length,
        errors: result.errors.length,
      };
    },
    listInstances,
  );
}

type SettlementPassSummary = {
  settled: number;
  held: number;
  deferred: number;
  errors: number;
};

/**
 * Run settlement and held-shares marking for every manageable strategy
 * instance against the given market date. Settlement reads the date-specific
 * underlying close from the year-sharded daily bars; positions whose closing
 * bar is not yet available are deferred to a later run.
 */
export async function runSettlementForAllInstances(
  marketDate: string,
  listInstances: () => Promise<StrategyInstanceConfig[]> = listManageableInstances,
  settlementPass: (
    instanceId: string,
    date: string,
    config: StrategyInstanceConfig,
    deps: { getUnderlyingClose: typeof getUnderlyingCloseForDate },
  ) => ReturnType<typeof runSettlementPass> = runSettlementPass,
  heldSharesPass: (
    instanceId: string,
    date: string,
    config: StrategyInstanceConfig,
    deps: { getUnderlyingClose: typeof getUnderlyingCloseForDate },
  ) => ReturnType<typeof runHeldSharesMarkPass> = runHeldSharesMarkPass,
  statsPass: (
    instanceId: string,
    date: string,
    deps: ReturnType<typeof createDefaultStatsPassDeps>,
  ) => ReturnType<typeof runStatsPass> = runStatsPass,
  statsDepsFactory: () => ReturnType<typeof createDefaultStatsPassDeps> = createDefaultStatsPassDeps,
): Promise<Record<string, SettlementPassSummary | { error: string }>> {
  return runPassForManageableInstances(
    'Settlement pass',
    async (instance) => {
      const getClose = getUnderlyingCloseForDate;
      const [settlement, held] = await Promise.all([
        settlementPass(instance.id, marketDate, instance, {
          getUnderlyingClose: getClose,
        }),
        heldSharesPass(instance.id, marketDate, instance, {
          getUnderlyingClose: getClose,
        }),
      ]);

      const summary: SettlementPassSummary = {
        settled: settlement.settled.length,
        held: held.marked.length,
        deferred: settlement.deferred.length + held.deferred.length,
        errors: settlement.errors.length + held.errors.length,
      };

      // Recompute stats (per-instance + ALL scope) after settlement + held-shares.
      try {
        const statsDeps = statsDepsFactory();
        const statsResult = await statsPass(instance.id, marketDate, statsDeps);
        log.info(
          `Stats pass for ${instance.id}/${marketDate}: wrote ${statsResult.scopesWritten.join(', ')}`,
        );
      } catch (err) {
        log.error(
          `Stats pass failed for ${instance.id}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }

      return summary;
    },
    listInstances,
  );
}

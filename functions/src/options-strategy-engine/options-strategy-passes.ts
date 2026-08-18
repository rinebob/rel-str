/**
 * @topic #108 — Options Position Strategy Engine
 * @topic #137 — Strategy Builder UI
 *
 * Scheduled Cloud Functions wiring for the hybrid options strategy passes.
 *
 * - `optionsSelectionPass` — scheduled after market close, runs EOD selection
 *   for each registered strategy instance.
 * - `optionsOpenPass` — scheduled shortly after market open, reads the prior
 *   night's daily-analysis and opens positions.
 * - `optionsMarkPass` — scheduled periodically during market hours, fetches
 *   live quotes and updates unrealized P&L for open positions.
 * - `optionsSettlementPass` — scheduled nightly after the symbol-data sync,
 *   settles expiring positions and marks held-shares positions with the day's
 *   underlying close.
 */

import { onSchedule } from 'firebase-functions/v2/scheduler';
import { onCall, HttpsError } from 'firebase-functions/v2/https';

import { OptionType, PositionSpreadType } from '@options/common';
import { TradeSide } from '@common';

import { db } from '../firebase-admin-init';
import {
  SYMBOL_DATA_COLLECTION,
  SYMBOL_BARS_DAILY_SUBCOL,
} from '../webhooks/webhooks-config';
import type { OhlcBar } from '../common/market-data-types';
import { RH_AGENT_ALLOWED_ORIGINS } from '../rh-agent-cloud-function/rh-agent-cors';
import { getMarketDatePT } from '../common/pt-date-utils';
import { STRATEGY_INSTANCES } from './strategy-instance-registry';
import { runEodNightlySelection } from './eod-orchestrator';
import { runOpenPass } from './passes/open-pass';
import { runMarkPass } from './passes/mark-pass';
import { runSettlementPass } from './passes/settlement-pass';
import { runHeldSharesMarkPass } from './passes/held-shares-pass';
import { runStatsPass, createDefaultStatsPassDeps } from './passes/stats-pass';
import { RobinhoodMcpOptionQuoteProvider } from './quote-providers/rh-mcp-option-quote-provider';
import type { RobinhoodMcpSessionManager } from './mcp/robinhood-mcp-session-manager';
import { createRobinhoodMcpSessionManagerFromEnv } from './mcp/robinhood-mcp-session-manager';
import { createLogger } from './logging';

const log = createLogger('OptionsStrategyPasses');

// ── Helpers ─────────────────────────────────────────────────────────────────

export function spreadTypeToOptionSide(
  spreadType: PositionSpreadType,
): { optionType: OptionType; side: TradeSide } {
  switch (spreadType) {
    case PositionSpreadType.CASH_SECURED_PUT:
      return { optionType: OptionType.PUT, side: TradeSide.SHORT };
    case PositionSpreadType.COVERED_CALL:
      return { optionType: OptionType.CALL, side: TradeSide.SHORT };
    default:
      throw new Error(`Unsupported spread type: ${spreadType}`);
  }
}

// ── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Read the most recent underlying price from symbol-data/{symbol}.
 * Uses the `currentPrice` field written by the symbol-data-sync pipeline.
 */
async function getUnderlyingClose(symbol: string): Promise<number | null> {
  const doc = await db.collection(SYMBOL_DATA_COLLECTION).doc(symbol).get();
  if (!doc.exists) return null;
  const data = doc.data() as { currentPrice?: number };
  return data.currentPrice ?? null;
}

/**
 * Read the underlying closing price for a specific market date from the
 * year-sharded daily bars: symbol-data/{symbol}/daily/{YYYY} (bars[].c where
 * bars[].d === date). Returns null when no bar exists for the date (holiday,
 * data delay) so callers can defer settlement rather than resolve with stale
 * data.
 */
async function getUnderlyingCloseForDate(
  symbol: string,
  date: string,
): Promise<number | null> {
  const year = date.slice(0, 4);
  const doc = await db
    .collection(SYMBOL_DATA_COLLECTION)
    .doc(symbol)
    .collection(SYMBOL_BARS_DAILY_SUBCOL)
    .doc(year)
    .get();
  if (!doc.exists) return null;
  const data = doc.data() as { bars?: OhlcBar[] };
  const bar = (data.bars ?? []).find((b) => b.d === date);
  return bar ? bar.c : null;
}

// ── Scheduled Cloud Functions ───────────────────────────────────────────────

/**
 * Selection pass — runs after market close to select contracts and
 * run overnight delta simulation for each strategy instance.
 *
 * Schedule: 7:00 PM PT (02:00 UTC) — gives AV time to publish EOD data.
 */
export const optionsSelectionPass = onSchedule(
  {
    schedule: '0 2 * * 2-6',
    timeZone: 'Etc/UTC',
    memory: '512MiB',
    timeoutSeconds: 120,
  },
  async () => {
    const marketDate = getMarketDatePT();
    log.info(`Selection pass starting for ${marketDate}`);

    for (const instance of STRATEGY_INSTANCES) {
      if (!instance.phases?.[0]) {
        log.warn(`No phase configured for ${instance.id}`);
        continue;
      }

      const underlyingClose = await getUnderlyingClose(instance.symbol);
      if (underlyingClose === null) {
        log.warn(`No underlying price for ${instance.symbol}`);
        continue;
      }

      try {
        const result = await runEodNightlySelection(
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
  },
);

/**
 * Open pass — runs shortly after market open to open new positions
 * based on the prior night's daily-analysis.
 *
 * Schedule: 6:45 AM PT (13:45 UTC) — 15 min after market open.
 */
export const optionsOpenPass = onSchedule(
  {
    schedule: '45 13 * * 1-5',
    timeZone: 'Etc/UTC',
    memory: '512MiB',
    timeoutSeconds: 120,
  },
  async () => {
    const marketDate = getMarketDatePT();
    log.info(`Open pass starting for ${marketDate}`);

    for (const instance of STRATEGY_INSTANCES) {
      if (!instance.phases?.[0]) {
        log.warn(`No phase configured for ${instance.id}`);
        continue;
      }

      const currentPrice = await getUnderlyingClose(instance.symbol);
      if (currentPrice === null) {
        log.warn(`No current price for ${instance.symbol}`);
        continue;
      }

      try {
        const result = await runOpenPass(
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
  },
);

/**
 * Run the mark pass for every registered strategy instance using the given
 * quote provider. Logs per-instance outcomes and returns a summary record
 * keyed by instance ID.
 */
async function runMarkPassForAllInstances(
  provider: RobinhoodMcpOptionQuoteProvider,
): Promise<Record<string, { positions: number; errors: number } | { error: string }>> {
  const results: Record<string, { positions: number; errors: number } | { error: string }> = {};

  for (const instance of STRATEGY_INSTANCES) {
    if (!instance.phases?.[0]) {
      log.warn(`No phase configured for ${instance.id}`);
      continue;
    }

    try {
      const result = await runMarkPass(instance.id, instance, {
        quoteProvider: provider,
      });
      log.info(
        `Mark pass for ${instance.id}: ${result.positions.length} marked, ${result.errors.length} errors`,
      );
      results[instance.id] = {
        positions: result.positions.length,
        errors: result.errors.length,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      log.error(`Mark pass failed for ${instance.id}: ${message}`);
      results[instance.id] = { error: message };
    }
  }

  return results;
}

/**
 * Mark pass — runs periodically during market hours to update
 * unrealized P&L for open positions with live RH MCP quotes.
 *
 * Schedule: Every 30 minutes from 6:50 AM to 1:00 PM PT (13:50–20:00 UTC).
 */
export const optionsMarkPass = onSchedule(
  {
    schedule: '*/30 13-20 * * 1-5',
    timeZone: 'Etc/UTC',
    memory: '1GiB',
    timeoutSeconds: 180,
  },
  async () => {
    log.info('Mark pass starting');

    let manager: RobinhoodMcpSessionManager | undefined;
    try {
      manager = await createRobinhoodMcpSessionManagerFromEnv();
    } catch (err) {
      log.error(
        `Failed to create RH MCP session: ${err instanceof Error ? err.message : String(err)}`,
      );
      return;
    }

    const provider = new RobinhoodMcpOptionQuoteProvider({
      callTool: manager.callTool.bind(manager),
    });

    try {
      await runMarkPassForAllInstances(provider);
    } finally {
      await manager.close();
    }

    log.info('Mark pass complete');
  },
);

// ── Manual trigger (for testing) ────────────────────────────────────────────

/**
 * HTTP-callable trigger for manual mark pass execution.
 * Requires an authenticated Firebase user. Useful for testing without
 * waiting for the schedule.
 */
export const optionsMarkPassManual = onCall(
  { cors: RH_AGENT_ALLOWED_ORIGINS, memory: '1GiB', timeoutSeconds: 180 },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Must be signed in to trigger a manual mark pass');
    }

    log.info(`Manual mark pass triggered by ${request.auth.uid}`);

    let manager: RobinhoodMcpSessionManager | undefined;
    try {
      manager = await createRobinhoodMcpSessionManagerFromEnv();
    } catch (err) {
      throw new HttpsError(
        'internal',
        `Failed to create RH MCP session: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    const provider = new RobinhoodMcpOptionQuoteProvider({
      callTool: manager.callTool.bind(manager),
    });

    try {
      return await runMarkPassForAllInstances(provider);
    } finally {
      await manager.close();
    }
  },
);

// ── Settlement + held-shares nightly pass ───────────────────────────────────

type SettlementPassSummary = {
  settled: number;
  held: number;
  deferred: number;
  errors: number;
};

/**
 * Run settlement and held-shares marking for every registered strategy
 * instance against the given market date. Settlement reads the date-specific
 * underlying close from the year-sharded daily bars; positions whose closing
 * bar is not yet available are deferred to a later run.
 */
async function runSettlementForAllInstances(
  marketDate: string,
): Promise<Record<string, SettlementPassSummary | { error: string }>> {
  const results: Record<string, SettlementPassSummary | { error: string }> = {};

  for (const instance of STRATEGY_INSTANCES) {
    if (!instance.phases?.[0]) {
      log.warn(`No phase configured for ${instance.id}`);
      continue;
    }

    const getClose = (symbol: string, date: string) => getUnderlyingCloseForDate(symbol, date);
    const deps = { getUnderlyingClose: getClose };

    try {
      // Settlement (OPEN positions) and held-shares marking
      // (ASSIGNED_HOLDING_SHARES) operate on disjoint position sets — run in
      // parallel to reduce nightly pass latency.
      const [settlement, held] = await Promise.all([
        runSettlementPass(instance.id, marketDate, instance, deps),
        runHeldSharesMarkPass(instance.id, marketDate, instance, deps),
      ]);
      log.info(
        `Settlement for ${instance.id}/${marketDate}: ${settlement.settled.length} settled, ` +
          `${settlement.deferred.length} deferred, ${settlement.errors.length} error(s); ` +
          `${held.marked.length} held-shares marked`,
      );
      results[instance.id] = {
        settled: settlement.settled.length,
        held: held.marked.length,
        deferred: settlement.deferred.length + held.deferred.length,
        errors: settlement.errors.length + held.errors.length,
      };

      // Recompute stats (per-instance + ALL scope) after settlement + held-shares.
      try {
        const statsDeps = createDefaultStatsPassDeps();
        const statsResult = await runStatsPass(instance.id, marketDate, statsDeps);
        log.info(
          `Stats pass for ${instance.id}/${marketDate}: wrote ${statsResult.scopesWritten.join(', ')}`,
        );
      } catch (err) {
        log.error(
          `Stats pass failed for ${instance.id}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      log.error(`Settlement pass failed for ${instance.id}: ${message}`);
      results[instance.id] = { error: message };
    }
  }

  return results;
}

/**
 * Settlement pass — runs nightly after the symbol-data sync has landed the
 * day's closing bars. Settles expiring OPEN positions and marks
 * ASSIGNED_HOLDING_SHARES positions with the day's underlying close.
 *
 * Schedule: 9:00 PM PT (04:00 UTC) — after the nightly symbol-data sync window.
 */
export const optionsSettlementPass = onSchedule(
  {
    schedule: '0 4 * * 2-6',
    timeZone: 'Etc/UTC',
    memory: '512MiB',
    timeoutSeconds: 180,
  },
  async () => {
    const marketDate = getMarketDatePT();
    log.info(`Settlement pass starting for ${marketDate}`);

    await runSettlementForAllInstances(marketDate);

    log.info('Settlement pass complete');
  },
);

/**
 * HTTP-callable trigger for manual settlement pass execution.
 * Requires an authenticated Firebase user. Useful for testing without
 * waiting for the schedule.
 */
export const optionsSettlementPassManual = onCall(
  { cors: RH_AGENT_ALLOWED_ORIGINS, memory: '512MiB', timeoutSeconds: 180 },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Must be signed in to trigger a manual settlement pass');
    }

    const marketDate =
      typeof request.data?.marketDate === 'string'
        ? request.data.marketDate
        : getMarketDatePT();
    log.info(`Manual settlement pass triggered by ${request.auth.uid} for ${marketDate}`);

    return await runSettlementForAllInstances(marketDate);
  },
);

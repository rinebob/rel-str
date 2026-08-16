/**
 *
 * Scheduled Cloud Functions wiring for the hybrid options strategy passes.
 *
 * - `optionsSelectionPass` — scheduled after market close, runs EOD selection
 *   for each registered strategy instance.
 * - `optionsOpenPass` — scheduled shortly after market open, reads the prior
 *   night's daily-analysis and opens positions.
 * - `optionsMarkPass` — scheduled periodically during market hours, fetches
 *   live quotes and updates unrealized P&L for open positions.
 */

import { onSchedule } from 'firebase-functions/v2/scheduler';
import { onCall, HttpsError } from 'firebase-functions/v2/https';

import type { StrategyInstanceConfig as SharedConfig } from '@options-strategy-engine/contracts';
import { OptionType, PositionSpreadType } from '@options/common';
import { TradeSide } from '@common';

import { db } from '../firebase-admin-init';
import { SYMBOL_DATA_COLLECTION } from '../webhooks/webhooks-config';
import { RH_AGENT_ALLOWED_ORIGINS } from '../rh-agent-cloud-function/rh-agent-cors';
import { getMarketDatePT } from '../common/pt-date-utils';
import { STRATEGY_INSTANCES } from './strategy-instance-registry';
import type { StrategyInstanceConfig as RegistryConfig } from './types';
import { runEodNightlySelection } from './eod-orchestrator';
import { runOpenPass } from './passes/open-pass';
import { runMarkPass } from './passes/mark-pass';
import { RobinhoodMcpOptionQuoteProvider } from './quote-providers/rh-mcp-option-quote-provider';
import type { RobinhoodMcpSessionManager } from './mcp/robinhood-mcp-session-manager';
import { createRobinhoodMcpSessionManagerFromEnv } from './mcp/robinhood-mcp-session-manager';
import { createLogger } from './logging';

const log = createLogger('OptionsStrategyPasses');

// ── Config bridge ───────────────────────────────────────────────────────────

/**
 * Convert a registry StrategyInstanceConfig (with phases, frequency, openTimePT)
 * into the shared StrategyInstanceConfig consumed by the pass functions.
 *
 * Uses the first phase's spread type to derive optionType and side.
 */
export function toSharedConfig(
  instance: RegistryConfig,
): SharedConfig | null {
  const phase = instance.phases?.[0];
  if (!phase) return null;

  const { optionType, side } = spreadTypeToOptionSide(phase.spreadType);

  return {
    symbol: instance.symbol,
    optionType,
    side,
    dteMin: phase.dteMin,
    dteMax: phase.dteMax,
    targetDelta: phase.targetDelta,
  };
}

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
      const config = toSharedConfig(instance);
      if (!config) {
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
          config,
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
      const config = toSharedConfig(instance);
      if (!config) {
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
          config,
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
    const config = toSharedConfig(instance);
    if (!config) {
      log.warn(`No phase configured for ${instance.id}`);
      continue;
    }

    try {
      const result = await runMarkPass(instance.id, config, {
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

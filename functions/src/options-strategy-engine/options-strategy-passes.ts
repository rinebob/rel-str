/**
 * @topic #108 — Options Position Strategy Engine
 *
 * Scheduled Cloud Functions and manual HTTP-callable triggers for the hybrid
 * options strategy passes. The pass orchestration logic lives in
 * `options-strategy-pass-orchestrators.ts`; this file only wires the
 * Cloud Functions entrypoints and manual triggers.
 */

import { onSchedule } from 'firebase-functions/v2/scheduler';
import { onCall, HttpsError } from 'firebase-functions/v2/https';

import { OptionType, PositionSpreadType } from '@options/common';
import { TradeSide } from '@common';

import { OPTIONS_STRATEGY_ALLOWED_ORIGINS } from './options-strategy-cors';
import { getMarketDatePT } from '../common/pt-date-utils';
import {
  runMarkPassForAllInstances,
  runSettlementForAllInstances,
} from './options-strategy-pass-orchestrators';
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

// ── Scheduled Cloud Functions ───────────────────────────────────────────────

/**
 * Selection pass — triggered by SDS sequence completion (Task #167) so it
 * always has fresh underlying prices. The previous `syncTrackedSymbolsDaily`
 * scheduled function was deleted; SDS now owns currentPrice writes and
 * downstream consumer triggering.
 */

/**
 * Open pass — replaced by `openPassTimer` in `passes/open-pass-timer.ts`.
 *
 * The old single-cron at 6:45 AM has been replaced with a 5-minute periodic
 * timer that queries instances by openTimePT slot. This ensures instances
 * with different open times are handled correctly.
 *
 * `runOptionsOpenPass` is still available in `options-strategy-pass-orchestrators.ts`
 * for manual/testing use.
 */

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
    secrets: ['RH_CREDENTIAL_BUNDLE'],
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

/**
 * Settlement pass — now triggered from `checkSyncRunCompletion` in
 * `symbol-data-sync.ts` after all nightly closing bars are guaranteed
 * to be in Firestore. SDS sequence completion (Task #167) triggers this
 * pass as a downstream consumer.
 *
 * The previous standalone onSchedule was removed because it raced with
 * the symbol-data sync — if closing bars weren't written yet, positions
 * were "deferred" and never retried.
 */

// ── Manual triggers (for testing) ─────────────────────────────────────────────

/**
 * HTTP-callable trigger for manual mark pass execution.
 * Requires an authenticated Firebase user. Useful for testing without
 * waiting for the schedule.
 */
export const optionsMarkPassManual = onCall(
  { cors: OPTIONS_STRATEGY_ALLOWED_ORIGINS, memory: '1GiB', timeoutSeconds: 180, secrets: ['RH_CREDENTIAL_BUNDLE'] },
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

/**
 * HTTP-callable trigger for manual settlement pass execution.
 * Requires an authenticated Firebase user. Useful for testing without
 * waiting for the schedule.
 */
export const optionsSettlementPassManual = onCall(
  { cors: OPTIONS_STRATEGY_ALLOWED_ORIGINS, memory: '512MiB', timeoutSeconds: 180 },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Must be signed in to trigger a manual settlement pass');
    }

    const marketDate = typeof request.data?.marketDate === 'string'
      ? request.data.marketDate
      : getMarketDatePT();
    log.info(`Manual settlement pass triggered by ${request.auth.uid} for ${marketDate}`);

    return runSettlementForAllInstances(marketDate);
  },
);

/**
 * @topic #108 — Options Position Strategy Engine
 * @topic #137 — Strategy Builder UI
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
  runOptionsSelectionPass,
  runOptionsOpenPass,
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
    await runOptionsSelectionPass();
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
    await runOptionsOpenPass();
  },
);

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

// ── Manual triggers (for testing) ─────────────────────────────────────────────

/**
 * HTTP-callable trigger for manual mark pass execution.
 * Requires an authenticated Firebase user. Useful for testing without
 * waiting for the schedule.
 */
export const optionsMarkPassManual = onCall(
  { cors: OPTIONS_STRATEGY_ALLOWED_ORIGINS, memory: '1GiB', timeoutSeconds: 180 },
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

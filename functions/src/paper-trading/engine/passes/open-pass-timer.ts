/**
 * Open pass timer — scheduled every 5 minutes during market hours.
 *
 * Replaces the old single-cron `optionsOpenPass` (6:45 AM) with a periodic
 * timer that runs from 6:30 AM to 1:00 PM PT. Each tick computes the current
 * 5-minute slot (HH:MM), queries active strategy instances with matching
 * openTimePT, and runs the open pass for those instances only.
 *
 * Reads underlying price from symbol-data (does NOT depend on SDS completion).
 *
 * Cron note: `*\/5 6-13` covers 6:00–13:55 PT. The 6:00–6:25 ticks are
 * no-ops because the market opens at 6:30 PT and no instance can be
 * configured with an `openTimePT` before then — cron can't express
 * "6:30–13:55" in one expression (minute ranges restart each hour), and the
 * split-schedule alternative costs more readability than ~6 empty
 * invocations per weekday.
 */

import { onSchedule } from 'firebase-functions/v2/scheduler';
import { logger } from 'firebase-functions';
import { getMarketDatePT, computeOpenPassSlot } from '../../../common/pt-date-utils';
import { listActiveInstances } from '../strategy-instance-repository';
import { listActiveManageInstances } from '../manage-instance-reader';
import { getUnderlyingClose } from '../options-strategy-market-data';
import { runOpenPass } from './open-pass';
import { runManageOpenPass } from './manage-open-pass';
import { runManageExitScan } from './manage-exit-scan-pass';
import { createLogger } from '../logging';
import { StOrderTicketWriter } from '../../../order-tickets/st-order-ticket-writer';
import {
  createRobinhoodMcpSessionManagerFromKms,
  type RobinhoodMcpSessionManager,
} from '../../../options-strategy-engine/mcp/robinhood-mcp-session-manager';

const log = createLogger('OpenPassTimer');

export const openPassTimer = onSchedule(
  {
    schedule: '*/5 6-13 * * 1-5', // Every 5 min, 6 AM–1 PM PT, Mon–Fri (early ticks before 06:30 are no-ops)
    timeZone: 'America/Los_Angeles',
    memory: '512MiB',
    timeoutSeconds: 120,
    region: 'us-central1',
  },
  async () => {
    const slot = computeOpenPassSlot();
    const marketDate = getMarketDatePT();
    logger.info('open_pass_timer_tick', { slot, marketDate });

    try {
      // Query active instances with matching openTimePT
      const instances = await listActiveInstances();
      const matching = instances.filter((inst) => inst.openTimePT === slot);

      if (matching.length === 0) {
        logger.info('open_pass_timer_no_instances', { slot });
        return;
      }

      logger.info('open_pass_timer_matching', { slot, count: matching.length });

      const tickets = new StOrderTicketWriter();
      for (const instance of matching) {
        if (!instance.phases?.[0]) {
          log.error(`No phase configured for ${instance.id}`);
          continue;
        }

        const currentPrice = await getUnderlyingClose(instance.symbol);
        if (currentPrice === null) {
          log.error(`No current price for ${instance.symbol} — symbol-data may not have intraday data yet`);
          continue;
        }

        try {
          const result = await runOpenPass(
            instance.id,
            marketDate,
            instance,
            currentPrice,
            { tickets },
          );
          if (result) {
            log.info(
              `Open pass for ${instance.id}/${marketDate}: skipped=${result.skipped}, positionId=${result.positionId}`,
            );
          } else {
            log.error(`No daily-analysis/latest for ${instance.id} — selection pass may have failed`);
          }
        } catch (err) {
          log.error(
            `Open pass failed for ${instance.id}: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }

      logger.info('open_pass_timer_complete', { slot, processed: matching.length });
    } catch (err: any) {
      logger.error('open_pass_timer_error', { slot, error: err?.message });
    }
  },
);

// ── Manage-domain open pass (#1539) ─────────────────────────────────────────

/**
 * Noon-PT manage open pass — iterates ACTIVE `ManageInstance` docs and
 * opens positions per trigger (`daily` every trading day, `signal` on a
 * fresh ST signal for the symbol). Manage instances carry no
 * `openTimePT` — the noon routine is engine-owned, so this runs once a
 * day rather than on the legacy 5-minute slot grid.
 *
 * Same cadence as `expressionFillPassTimer` (signal paper fills) — the
 * two passes are independent: expression fills come from signal tickets,
 * manage opens from strategy instances.
 */
export const manageOpenPassTimer = onSchedule(
  {
    schedule: '0 12 * * 1-5', // Noon PT, Mon–Fri
    timeZone: 'America/Los_Angeles',
    memory: '512MiB',
    timeoutSeconds: 300,
    region: 'us-central1',
  },
  async () => {
    const marketDate = getMarketDatePT();
    logger.info('manage_open_pass_start', { marketDate });

    const { daily, signal } = await listActiveManageInstances();
    const instances = [...daily, ...signal];
    if (instances.length === 0) {
      logger.info('manage_open_pass_no_instances', { marketDate });
      return;
    }
    logger.info('manage_open_pass_instances', {
      marketDate,
      daily: daily.length,
      signal: signal.length,
    });

    let manager: RobinhoodMcpSessionManager | undefined;
    try {
      const m = (manager = await createRobinhoodMcpSessionManagerFromKms());
      const tickets = new StOrderTicketWriter();
      for (const instance of instances) {
        try {
          const result = await runManageOpenPass(instance, marketDate, {
            callTool: (name, args) => m.callTool(name, args),
            tickets,
          });
          log.info(
            `Manage open pass ${instance.id}/${marketDate}: skipped=${result.skipped}` +
              `${result.skipReason ? ` reason=${result.skipReason}` : ''}` +
              ` positionId=${result.positionId}`,
          );
        } catch (err) {
          log.error(
            `Manage open pass failed for ${instance.id}: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }
      logger.info('manage_open_pass_complete', {
        marketDate,
        processed: instances.length,
      });
    } finally {
      await manager?.close();
    }
  },
);

// ── Manage-domain exit scan (#1544) ─────────────────────────────────────────

/**
 * Daily manage exit scan — runs after the last mark tick (mark pass's
 * half-hourly 13-20 UTC grid ends 20:30 UTC = 12:30 PST / 13:30 PDT, so
 * 2 PM PT clears it year-round) and evaluates every OPEN manage position
 * through the shared EXIT_STRATEGIES registry, writing one
 * AnalysisResultDoc per (instanceId, exitId) to
 * st-options-analysis-results — the exit matrix the manage page's
 * analysis view consumes.
 *
 * Paper-only for v1 (the reader gates to mode:'paper'); no RH session —
 * series come from the SA partner corpus.
 */
export const manageExitScanTimer = onSchedule(
  {
    schedule: '0 14 * * 1-5', // 2 PM PT, Mon–Fri (post mark-pass)
    timeZone: 'America/Los_Angeles',
    memory: '512MiB',
    timeoutSeconds: 540,
    region: 'us-central1',
  },
  async () => {
    const marketDate = getMarketDatePT();
    logger.info('manage_exit_scan_start', { marketDate });
    try {
      await runManageExitScan(marketDate);
      logger.info('manage_exit_scan_complete', { marketDate });
    } catch (err: any) {
      logger.error('manage_exit_scan_error', {
        marketDate,
        error: err?.message,
      });
    }
  },
);

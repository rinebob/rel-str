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
import { getUnderlyingClose } from '../options-strategy-market-data';
import { runOpenPass } from './open-pass';
import { createLogger } from '../logging';
import { StOrderTicketWriter } from '../../../order-tickets/st-order-ticket-writer';

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

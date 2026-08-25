/**
 * ST Triggers
 *
 * HTTP trigger: Manual trigger for testing.
 *
 * The Pub/Sub trigger (stPdrTrigger) was deleted — ST is now
 * triggered by SDS completion via sds-consumer-dispatch.ts as a downstream
 * consumer of the SDS pipeline.
 */
import { onRequest } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions/v2';

import { getMarketDate } from '../common/st-run-creation';
import { startStRun } from '../common/st-orchestration';

/**
 * Manual trigger for testing via HTTP.
 * Same logic as the Firestore trigger but callable on-demand.
 */
export const stTriggerDaily = onRequest(
  {
    memory: '1GiB',
    timeoutSeconds: 300,
  },
  async (req, res) => {
    logger.info('st_manual_trigger_start');

    try {
      const marketDate = req.query.date as string || getMarketDate();
      logger.info('st_manual_trigger_market_date', { marketDate, isOverride: !!req.query.date });

      // 1. Start the run
      const result = await startStRun(marketDate, 'manual');

      res.status(200).json({
        success: true,
        ...result,
      });
    } catch (error: any) {
      logger.error('st_manual_trigger_fatal_error', { error: error?.message });
      res.status(500).json({ success: false, error: error?.message });
    }
  }
);

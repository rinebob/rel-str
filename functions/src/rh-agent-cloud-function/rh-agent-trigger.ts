/**
 * RH Agent Triggers
 *
 * HTTP trigger: Manual trigger for testing.
 *
 * The Pub/Sub trigger (rhAgentPdrTrigger) was deleted — RH Agent is now
 * triggered by SDS completion via sds-consumer-dispatch.ts as a downstream
 * consumer of the SDS pipeline.
 */
import { onRequest } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions/v2';

import { getMarketDate } from '../common/rh-agent-run-creation';
import { startRhAgentRun } from '../common/rh-agent-orchestration';

/**
 * Manual trigger for testing via HTTP.
 * Same logic as the Firestore trigger but callable on-demand.
 */
export const rhAgentTriggerDaily = onRequest(
  {
    memory: '1GiB',
    timeoutSeconds: 300,
  },
  async (req, res) => {
    logger.info('rh_agent_manual_trigger_start');

    try {
      const marketDate = req.query.date as string || getMarketDate();
      logger.info('rh_agent_manual_trigger_market_date', { marketDate, isOverride: !!req.query.date });

      // 1. Start the run
      const result = await startRhAgentRun(marketDate, 'manual');

      res.status(200).json({
        success: true,
        ...result,
      });
    } catch (error: any) {
      logger.error('rh_agent_manual_trigger_fatal_error', { error: error?.message });
      res.status(500).json({ success: false, error: error?.message });
    }
  }
);

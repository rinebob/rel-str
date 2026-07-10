/**
 * RH Agent Triggers
 *
 * 1. Pub/Sub trigger: Automatically starts when PDR intraday-snapshot message arrives
 * 2. HTTP trigger: Manual trigger for testing
 */
import { onRequest } from 'firebase-functions/v2/https';
import { onMessagePublished } from 'firebase-functions/v2/pubsub';
import { logger } from 'firebase-functions/v2';

import { PARTNER_DATA_READY_TOPIC } from '../webhooks/webhooks-config';

import { getMarketDate } from '../common/rh-agent-run-creation';
import { startRhAgentRun } from '../common/rh-agent-orchestration';
import { normalizeMarketDate } from '../common/pt-date-utils';

/**
 * Pub/Sub trigger: Automatically starts RH Agent when PDR intraday-snapshot message arrives.
 *
 * Trigger: partner-data-ready Pub/Sub topic with runType = "intraday-snapshot".
 * Time-gated to 7:30am–6:30pm PT to filter spurious SA overnight cleanup messages
 * that incorrectly publish intraday-snapshot events outside our PDR windows (8, 10, 12pm PT).
 */
export const rhAgentPdrTrigger = onMessagePublished(
  {
    topic: PARTNER_DATA_READY_TOPIC,
    memory: '2GiB',
    timeoutSeconds: 300,
  },
  async (event) => {
    const attributes = event.data.message.attributes || {};
    const payload = JSON.parse(Buffer.from(event.data.message.data, 'base64').toString());

    // Only process intraday-snapshot PDR messages when completed
    if (attributes.runType !== 'intraday-snapshot') {
      logger.debug('rh_agent_pdr_skip_wrong_type', { runType: attributes.runType });
      return;
    }
    if (payload.status !== 'end') {
      logger.debug('rh_agent_pdr_skip_not_end', { status: payload.status });
      return;
    }
    if (payload.runStatus !== 'completed' && payload.runStatus !== 'completed_with_errors') {
      logger.debug('rh_agent_pdr_skip_not_complete', { runStatus: payload.runStatus });
      return;
    }

    // Gate: reject messages outside intraday windows (7:55am–6:30pm PT).
    // SA incorrectly publishes intraday-snapshot messages during overnight cleanup
    // runs that arrive as late as ~7:24am PT. Our PDR windows are 8am, 10am, 12pm PT.
    const nowPT = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Los_Angeles' }));
    const hourPT = nowPT.getHours() + nowPT.getMinutes() / 60;
    const PDR_WINDOW_START_PT = 7.917; // 7:55am — SA overnight runs arrive as late as ~7:24am PT
    const PDR_WINDOW_END_PT   = 18.5; // 6:30pm
    if (hourPT < PDR_WINDOW_START_PT || hourPT > PDR_WINDOW_END_PT) {
      logger.info('rh_agent_pdr_skip_outside_window', { hourPT, PDR_WINDOW_START_PT, PDR_WINDOW_END_PT });
      return;
    }

    const marketDate = normalizeMarketDate(payload.marketDate);
    if (!marketDate) {
      logger.warn('rh_agent_pdr_no_market_date', { payload });
      return;
    }

    logger.info('rh_agent_pdr_triggered', {
      marketDate,
      runId: payload.runId,
      runStatus: payload.runStatus,
    });

    try {
      // 1. Start the RH Agent run
      const result = await startRhAgentRun(marketDate, 'pdr');

      logger.info('rh_agent_pdr_success', { marketDate, symbolCount: result.symbolCount });
    } catch (error: any) {
      logger.error('rh_agent_pdr_error', {
        marketDate,
        error: error?.message,
        stack: error?.stack,
      });
    }
  }
);

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


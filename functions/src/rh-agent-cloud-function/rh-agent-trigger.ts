/**
 * RH Agent Triggers
 *
 * 1. Pub/Sub trigger: Automatically starts when PDR intraday-snapshot message arrives
 * 2. HTTP trigger: Manual trigger for testing
 */
import { onRequest } from 'firebase-functions/v2/https';
import { onMessagePublished } from 'firebase-functions/v2/pubsub';
import { logger } from 'firebase-functions/v2';

import { type IntradaySnapshot, type RhAgentTriggeredBy } from './rh-agent-config';

import {
  getMarketDate,
  getDeadlineISO,
  loadEnabledSymbols,
  createDailyRun,
  createJobAndEnqueue,
  fetchIntradaySnapshots,
  writeIntradayBarsToRsBars,
} from './rh-agent-shared';

/**
 * Pub/Sub trigger: Automatically starts RH Agent when PDR intraday-snapshot message arrives.
 *
 * Trigger: partner-data-ready Pub/Sub topic with runType = "intraday-snapshot"
 * This ensures intraday data is ready before analysis begins.
 */
export const rhAgentPdrTrigger = onMessagePublished(
  {
    topic: 'partner-data-ready',
    memory: '1GiB',
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

    const marketDate = payload.marketDate;
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
      // 1. Load enabled symbols
      const symbols = await loadEnabledSymbols();
      if (symbols.length === 0) {
        logger.warn('rh_agent_pdr_no_symbols', { marketDate });
        return;
      }

      // 2. Fetch intraday snapshot for all symbols (one POST call to partnerIntradaySnapshotV2)
      const intradaySnapshots = await fetchIntradaySnapshots(symbols, marketDate);

      // 3. Write intraday partial bars to rs-bars so workers see today's price
      await writeIntradayBarsToRsBars(marketDate, intradaySnapshots);

      // 4. Start the RH Agent run with intraday data
      await startRhAgentRun(marketDate, 'pdr', intradaySnapshots);

      logger.info('rh_agent_pdr_success', { marketDate, symbolCount: symbols.length });
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

      // 1. Load enabled symbols
      const symbols = await loadEnabledSymbols();
      if (symbols.length === 0) {
        res.status(200).json({ success: false, error: 'No symbols to process' });
        return;
      }

      // 2. Fetch intraday snapshot so manual runs also see today's price
      const intradaySnapshots = await fetchIntradaySnapshots(symbols, marketDate);

      // 3. Write partial bars to rs-bars
      await writeIntradayBarsToRsBars(marketDate, intradaySnapshots);

      // 4. Start the run with intraday data
      const result = await startRhAgentRun(marketDate, 'manual', intradaySnapshots);

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

/**
 * Start RH Agent run - shared logic for all trigger types.
 * Exported so rs-bars-sync can call it after nightly sync completes.
 */
export async function startRhAgentRun(
  marketDate: string,
  triggeredBy: RhAgentTriggeredBy,
  intradaySnapshots: IntradaySnapshot[] = []
): Promise<{ runId: string; marketDate: string; symbolCount: number; enqueued: number; failed: number; duration: number }> {
  const startTime = Date.now();

  // 1. Load enabled symbols
  const symbols = await loadEnabledSymbols();
  if (symbols.length === 0) {
    logger.warn('rh_agent_trigger_no_symbols', { marketDate, triggeredBy });
    return { runId: '', marketDate, symbolCount: 0, enqueued: 0, failed: 0, duration: 0 };
  }
  logger.info('rh_agent_trigger_symbols_loaded', {
    marketDate,
    triggeredBy,
    count: symbols.length,
    firstFew: symbols.slice(0, 5),
  });

  // 2. Calculate deadline
  const deadlineAt = getDeadlineISO();

  // 3. Create run document
  const runStartedAt = new Date().toISOString();
  const runId = await createDailyRun(marketDate, symbols.length, deadlineAt, triggeredBy);
  logger.info('rh_agent_trigger_run_created', {
    runId,
    marketDate,
    triggeredBy,
    symbolCount: symbols.length,
  });

  // 4. Create job documents and enqueue Cloud Tasks
  // Pass intraday data in payload so workers don't need to fetch
  let enqueuedCount = 0;
  let failedCount = 0;

  for (const symbol of symbols) {
    try {
      const intraday = intradaySnapshots.find(s => s.symbol === symbol);
      await createJobAndEnqueue(runId, symbol, marketDate, runStartedAt, triggeredBy, intraday);
      enqueuedCount++;
    } catch (error: any) {
      failedCount++;
      logger.error('rh_agent_trigger_enqueue_failed', {
        symbol,
        runId,
        error: error?.message,
      });
    }
  }

  const duration = Date.now() - startTime;
  logger.info('rh_agent_trigger_complete', {
    runId,
    marketDate,
    triggeredBy,
    symbolCount: symbols.length,
    intradayCount: intradaySnapshots.length,
    enqueued: enqueuedCount,
    failed: failedCount,
    duration,
  });

  return { runId, marketDate, symbolCount: symbols.length, enqueued: enqueuedCount, failed: failedCount, duration };
}

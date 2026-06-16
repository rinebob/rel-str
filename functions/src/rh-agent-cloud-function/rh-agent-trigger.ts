/**
 * RH Agent Triggers
 *
 * 1. Pub/Sub trigger: Automatically starts when PDR intraday-snapshot message arrives
 * 2. HTTP trigger: Manual trigger for testing
 */
import { onRequest } from 'firebase-functions/v2/https';
import { onMessagePublished } from 'firebase-functions/v2/pubsub';
import { logger } from 'firebase-functions/v2';
import { getFunctions } from 'firebase-admin/functions';
import { db, FieldValue } from '../firebase-admin-init';

import {
  RH_AGENT_RUNS_COLLECTION,
  RH_AGENT_JOBS_SUBCOLLECTION,
  RH_AGENT_SYMBOLS_COLLECTION,
  RhAgentRunStatus,
  RhAgentJobStatus,
  RhAgentJob,
  SymbolJobPayload,
  type IntradaySnapshot,
} from './rh-agent-config';

/**
 * Pub/Sub trigger: Automatically starts RH Agent when PDR intraday-snapshot message arrives.
 *
 * Trigger: partner-data-ready Pub/Sub topic with runType = "intraday-snapshot"
 * This ensures intraday data is ready before analysis begins.
 */
export const rhAgentPdrTrigger = onMessagePublished(
  {
    topic: 'partner-data-ready',
    memory: '256MiB',
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
      // Idempotency check: ensure we haven't already triggered for this market date
      const existingRunQuery = await db
        .collection(RH_AGENT_RUNS_COLLECTION)
        .where('marketDate', '==', marketDate)
        .where('triggeredBy', '==', 'pdr')
        .limit(1)
        .get();

      if (!existingRunQuery.empty) {
        logger.info('rh_agent_pdr_already_exists', { marketDate, existingRunId: existingRunQuery.docs[0].id });
        return;
      }

      // 1. Load enabled symbols
      const symbols = await loadEnabledSymbols();
      if (symbols.length === 0) {
        logger.warn('rh_agent_pdr_no_symbols', { marketDate });
        return;
      }

      // 2. Fetch intraday snapshot for all symbols (one POST call to partnerIntradaySnapshotV2)
      // NOTE: This will be implemented when SavantAPI deploys the endpoint
      // For now, we'll skip the intraday fetch and pass empty data
      logger.info('rh_agent_pdr_fetching_intraday', { marketDate, symbolCount: symbols.length });
      const intradaySnapshots: IntradaySnapshot[] = []; // TODO: callPartnerIntradaySnapshotV2(symbols)

      // 3. Start the RH Agent run with intraday data
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
    memory: '256MiB',
    timeoutSeconds: 300,
  },
  async (req, res) => {
    logger.info('rh_agent_manual_trigger_start');

    try {
      const startTime = Date.now();

      // 1. Get market date (allow override via query param for testing)
      const marketDate = req.query.date as string || getMarketDate();
      logger.info('rh_agent_manual_trigger_market_date', { marketDate, isOverride: !!req.query.date });

      // 2. Load enabled symbols
      const symbols = await loadEnabledSymbols();
      if (symbols.length === 0) {
        logger.warn('rh_agent_manual_trigger_no_symbols');
        res.status(400).json({ success: false, error: 'No symbols found' });
        return;
      }
      logger.info('rh_agent_manual_trigger_symbols_loaded', { count: symbols.length });

      // 3. Calculate deadline
      const deadlineAt = getDeadlineISO();

      // 4. Create daily run document
      const runId = await createDailyRun(marketDate, symbols.length, deadlineAt);
      logger.info('rh_agent_manual_trigger_run_created', { runId, symbolCount: symbols.length });

      // 5. Create job documents and enqueue Cloud Tasks
      let enqueuedCount = 0;
      for (const symbol of symbols) {
        try {
          await createJobAndEnqueue(runId, symbol, marketDate);
          enqueuedCount++;
        } catch (error: any) {
          logger.error('rh_agent_manual_trigger_enqueue_failed', {
            symbol,
            runId,
            error: error?.message,
          });
        }
      }

      const duration = Date.now() - startTime;
      logger.info('rh_agent_manual_trigger_complete', {
        runId,
        symbolCount: symbols.length,
        enqueuedCount,
        duration,
      });

      res.status(200).json({
        success: true,
        runId,
        marketDate,
        symbolCount: symbols.length,
        enqueuedCount,
        duration,
      });
    } catch (error: any) {
      logger.error('rh_agent_manual_trigger_fatal_error', { error: error?.message });
      res.status(500).json({ success: false, error: error?.message });
    }
  }
);

// Helper functions (copied from scheduler)
function getMarketDate(): string {
  const now = new Date();
  const year = now.getUTCFullYear();
  const month = String(now.getUTCMonth() + 1).padStart(2, '0');
  const day = String(now.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function getDeadlineISO(): string {
  const now = new Date();
  const deadline = new Date(Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate(),
    20, 30, 0, 0
  ));
  return deadline.toISOString();
}

async function loadEnabledSymbols(): Promise<string[]> {
  const snapshot = await db
    .collection(RH_AGENT_SYMBOLS_COLLECTION)
    .where('enabled', '==', true)
    .get();

  if (snapshot.empty) {
    return [];
  }

  return snapshot.docs.map((doc) => doc.data().symbol as string);
}

async function createDailyRun(
  marketDate: string,
  totalSymbols: number,
  deadlineAt: string,
  triggeredBy: 'manual' | 'pdr' = 'manual'
): Promise<string> {
  const runRef = db.collection(RH_AGENT_RUNS_COLLECTION).doc();
  const runId = runRef.id;
  const now = FieldValue.serverTimestamp();

  const runData = {
    id: runId,
    type: 'daily-scan',
    marketDate,
    status: RhAgentRunStatus.RUNNING,
    totalSymbols,
    processedCount: 0,
    successCount: 0,
    failureCount: 0,
    opportunitiesFound: 0,
    opportunitiesApproved: 0,
    opportunitiesRejected: 0,
    opportunitiesExecuted: 0,
    triggeredBy,
    startedAt: now,
    deadlineAt,
    errors: [],
    logs: [`[${new Date().toISOString()}] Run started: ${totalSymbols} symbols (triggered by ${triggeredBy})`],
  };

  await runRef.set(runData);
  return runId;
}

async function createJobAndEnqueue(
  runId: string,
  symbol: string,
  marketDate: string,
  context: 'manual' | 'pdr' = 'manual',
  intraday?: IntradaySnapshot
): Promise<void> {
  const jobRef = db
    .collection(RH_AGENT_RUNS_COLLECTION)
    .doc(runId)
    .collection(RH_AGENT_JOBS_SUBCOLLECTION)
    .doc(symbol);

  const jobData: RhAgentJob = {
    id: symbol,
    symbol,
    status: RhAgentJobStatus.PENDING,
    attempts: 0,
    createdAt: FieldValue.serverTimestamp(),
  };

  await jobRef.set(jobData);

  const payload: SymbolJobPayload = { runId, symbol, marketDate, intraday };

  try {
    const queue = getFunctions().taskQueue('rhAgentProcessSymbol');
    await queue.enqueue(payload);
  } catch (error: any) {
    logger.warn(`rh_agent_${context}_task_queue_failed`, {
      symbol, runId, error: error?.message,
    });
  }
}

/**
 * Start RH Agent run - shared logic for all trigger types.
 */
async function startRhAgentRun(
  marketDate: string, 
  triggeredBy: 'manual' | 'pdr',
  intradaySnapshots: IntradaySnapshot[] = []
): Promise<void> {
  const startTime = Date.now();

  // 1. Load enabled symbols
  const symbols = await loadEnabledSymbols();
  if (symbols.length === 0) {
    logger.warn('rh_agent_trigger_no_symbols', { marketDate, triggeredBy });
    return;
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
      await createJobAndEnqueue(runId, symbol, marketDate, triggeredBy, intraday);
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
}

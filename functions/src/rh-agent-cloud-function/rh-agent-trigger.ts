/**
 * RH Agent Manual Trigger
 *
 * HTTP function to manually trigger the daily scheduler.
 * Use this for testing - calls the same logic as the scheduled function.
 */
import { onRequest } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions/v2';
import { getFunctions } from 'firebase-admin/functions';
import { db, FieldValue } from '../firebase-admin-init';

import {
  RH_AGENT_RUNS_COLLECTION,
  RH_AGENT_JOBS_SUBCOLLECTION,
  RH_AGENT_SYMBOLS_COLLECTION,
  RhAgentRunStatus,
  RhAgentJobStatus,
  RhAgentDailyRun,
  RhAgentJob,
  SymbolJobPayload,
} from './rh-agent-config';

/**
 * Manual trigger for the daily scheduler.
 * Same logic as rhAgentDailyScheduler but callable via HTTP.
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
  deadlineAt: string
): Promise<string> {
  const runRef = db.collection(RH_AGENT_RUNS_COLLECTION).doc();
  const runId = runRef.id;
  const now = FieldValue.serverTimestamp();

  const runData: Omit<RhAgentDailyRun, 'id'> & { id: string } = {
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
    startedAt: now,
    deadlineAt,
    errors: [],
    logs: [`[${new Date().toISOString()}] Run started: ${totalSymbols} symbols`],
  };

  await runRef.set(runData);
  return runId;
}

async function createJobAndEnqueue(
  runId: string,
  symbol: string,
  marketDate: string
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

  const payload: SymbolJobPayload = { runId, symbol, marketDate };

  try {
    const queue = getFunctions().taskQueue('rhAgentProcessSymbol');
    await queue.enqueue(payload);
  } catch (error: any) {
    logger.warn('rh_agent_trigger_task_queue_failed', {
      symbol, runId, error: error?.message,
    });
  }
}

/**
 * RH Agent Daily Scheduler
 *
 * Scheduled Cloud Function that runs daily at 12:00 PM Pacific Time.
 * Loads the symbol list (~700 symbols) and enqueues analysis tasks.
 *
 * Schedule: 0 20 * * 1-5 (8:00 PM UTC = 12:00 PM PT, Monday-Friday)
 */
import { onSchedule } from 'firebase-functions/v2/scheduler';
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
 * Daily scheduler - runs at 12:00 PM PT (8:00 PM UTC)
 * Loads symbols and enqueues analysis tasks.
 */
export const rhAgentDailyScheduler = onSchedule(
  {
    // ⚠️ If you change this cron, also update RH_AGENT_SCHEDULE_CRON in:
    //    src/app/features/rh-agent/rh-agent.service.ts
    schedule: '0 20 * * 1-5', // 8:00 PM UTC = 12:00 PM PT (no DST issues), Mon-Fri
    timeZone: 'Etc/UTC',
    // secrets: [ANTHROPIC_API_KEY], // Temporarily disabled for testing
    memory: '256MiB',
    timeoutSeconds: 300,
  },
  async (event) => {
    const startTime = Date.now();
    logger.info('rh_agent_daily_scheduler_start', {
      scheduledTime: event.scheduleTime,
    });

    try {
      // 1. Get today's market date (YYYY-MM-DD)
      const marketDate = getMarketDate();
      logger.info('rh_agent_scheduler_market_date', { marketDate, isoDate: new Date().toISOString() });

      // 2. Load enabled symbols from Firestore (should be ~700 symbols)
      const symbols = await loadEnabledSymbols();
      logger.info('rh_agent_scheduler_symbols_loaded', {
        count: symbols.length,
        firstFew: symbols.slice(0, 5),
        lastFew: symbols.slice(-5),
      });

      if (symbols.length === 0) {
        logger.warn('rh_agent_scheduler_no_symbols');
        return;
      }

      // 3. Calculate deadline (12:30 PM PT = 8:30 PM UTC)
      const deadlineAt = getDeadlineISO();
      logger.info('rh_agent_scheduler_deadline', { deadlineAt, minutesToDeadline: 30 });

      // 4. Create daily run document
      const runId = await createDailyRun(marketDate, symbols.length, deadlineAt);
      logger.info('rh_agent_scheduler_run_created', {
        runId,
        marketDate,
        symbolCount: symbols.length,
        deadlineAt,
        runPath: `rh-agent-runs/${runId}`,
      });

      // 5. Create job documents and enqueue Cloud Tasks
      let enqueuedCount = 0;
      let failedCount = 0;
      logger.info('rh_agent_scheduler_enqueue_start', { runId, totalSymbols: symbols.length });

      for (const symbol of symbols) {
        try {
          await createJobAndEnqueue(runId, symbol, marketDate);
          enqueuedCount++;
          if (enqueuedCount % 5 === 0) {
            logger.info('rh_agent_scheduler_enqueue_progress', { runId, enqueued: enqueuedCount, total: symbols.length });
          }
        } catch (error: any) {
          failedCount++;
          logger.error('rh_agent_scheduler_enqueue_failed', {
            symbol,
            runId,
            error: error?.message,
          });
        }
      }

      const duration = Date.now() - startTime;
      logger.info('rh_agent_scheduler_complete', {
        runId,
        marketDate,
        symbolsLoaded: symbols.length,
        enqueued: enqueuedCount,
        failed: failedCount,
        durationMs: duration,
        runPath: `rh-agent-runs/${runId}`,
        jobsPath: `rh-agent-runs/${runId}/jobs`,
      });
    } catch (error: any) {
      logger.error('rh_agent_scheduler_fatal_error', {
        error: error?.message,
        stack: error?.stack,
      });
      throw error;
    }
  }
);

/**
 * Get market date in YYYY-MM-DD format (UTC).
 * Uses today's date since scheduler runs at 12:00 PM PT.
 */
function getMarketDate(): string {
  const now = new Date();
  const year = now.getUTCFullYear();
  const month = String(now.getUTCMonth() + 1).padStart(2, '0');
  const day = String(now.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Get deadline ISO string (12:30 PM PT = 8:30 PM UTC).
 * Stored as string to avoid Timestamp serialization issues.
 */
function getDeadlineISO(): string {
  const now = new Date();
  // Set to 8:30 PM UTC today
  const deadline = new Date(Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate(),
    20, 30, 0, 0 // 20:30 UTC = 12:30 PM PT
  ));
  return deadline.toISOString();
}

/**
 * Load enabled symbols from Firestore.
 * Returns array of symbol strings (e.g., ['AAPL', 'NVDA', ...]).
 */
async function loadEnabledSymbols(): Promise<string[]> {
  const snapshot = await db
    .collection(RH_AGENT_SYMBOLS_COLLECTION)
    .where('enabled', '==', true)
    .orderBy('priority', 'asc')
    .get();

  return snapshot.docs.map((doc) => doc.data().symbol as string);
}

/**
 * Create a new daily run document in Firestore.
 */
async function createDailyRun(
  marketDate: string,
  totalSymbols: number,
  deadlineAt: string
): Promise<string> {
  // Use market date as run ID - ensures one run per day
  const runId = marketDate;
  const runRef = db.collection(RH_AGENT_RUNS_COLLECTION).doc(runId);
  const now = FieldValue.serverTimestamp();

  const runData: Omit<RhAgentDailyRun, 'id'> & { id: string } = {
    id: runId,
    type: 'daily-scan',
    marketDate,
    status: RhAgentRunStatus.RUNNING,
    triggeredBy: 'schedule',
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

/**
 * Create a job document and enqueue a Cloud Task.
 */
async function createJobAndEnqueue(
  runId: string,
  symbol: string,
  marketDate: string
): Promise<void> {
  // 1. Create job document
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

  // 2. Enqueue Cloud Task (skip in emulator if tasks not available)
  const payload: SymbolJobPayload = {
    runId,
    symbol,
    marketDate,
  };

  try {
    const queue = getFunctions().taskQueue('rhAgentProcessSymbol');
    await queue.enqueue(payload);
  } catch (error: any) {
    logger.warn('rh_agent_scheduler_task_queue_failed', {
      symbol,
      runId,
      error: error?.message,
    });
    // In emulator, task queue might not be available - continue without it
    if (process.env.FUNCTIONS_EMULATOR !== 'true') {
      throw error;
    }
  }
}


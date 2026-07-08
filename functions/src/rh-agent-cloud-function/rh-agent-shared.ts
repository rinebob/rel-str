/**
 * RH Agent Shared Utilities
 *
 * Common functions used by both the scheduled trigger (rh-agent-trigger.ts) and
 * manual run callable (rh-agent-callables.ts).
 */
import { getFunctions } from 'firebase-admin/functions';
import { logger } from 'firebase-functions/v2';
import {
  RH_AGENT_SYMBOLS_COLLECTION,
  RH_AGENT_RUNS_COLLECTION,
  RH_AGENT_JOBS_SUBCOLLECTION,
} from './rh-agent-collections';
import {
  RhAgentRunStatus,
  RhAgentJobStatus,
  RhAgentDailyRun,
  RhAgentJob,
  RhAgentTriggeredBy,
} from './rh-agent-runs';
import { SymbolJobPayload, IntradaySnapshot } from './rh-agent-shared-types';
import { db, FieldValue } from '../firebase-admin-init';
import { callPartnerIntradaySnapshotV2 } from '../partner-proxy';
import { getMarketDatePT, getRunDatePT, getRunIdPT } from './rh-agent-date-utils';

/**
 * Get market date in YYYY-MM-DD format (America/Los_Angeles).
 * Delegates to the shared PT date utility.
 */
export function getMarketDate(): string {
  return getMarketDatePT();
}

/**
 * Get deadline ISO string (minutes from now).
 * Default: 30 minutes from now for manual runs.
 */
export function getDeadlineISO(minutesFromNow = 30): string {
  const deadline = new Date(Date.now() + minutesFromNow * 60 * 1000);
  return deadline.toISOString();
}

/**
 * Load enabled symbols from Firestore.
 * If specific symbols provided, filters to those.
 */
export async function loadEnabledSymbols(requestedSymbols?: string[]): Promise<string[]> {
  const snapshot = await db
    .collection(RH_AGENT_SYMBOLS_COLLECTION)
    .where('enabled', '==', true)
    .get();

  const symbols = snapshot.docs.map((doc) => doc.data().symbol as string);

  if (requestedSymbols && requestedSymbols.length > 0) {
    return symbols.filter((s) => requestedSymbols.includes(s));
  }

  return symbols;
}

/**
 * Generate run ID in format: YYYY-MM-DD_dow_HHMMSS_trigger.
 * Delegates to the shared PT date utility.
 */
function generateRunId(runDate: string, trigger: RhAgentTriggeredBy): string {
  return getRunIdPT(runDate, trigger);
}

/**
 * Create a new daily run document in Firestore.
 */
export async function createDailyRun(
  marketDate: string,
  totalSymbols: number,
  deadlineAt: string,
  triggeredBy: RhAgentTriggeredBy = 'pdr'
): Promise<string> {
  // runDate is the PT calendar date the run occurred; marketDate is the trading date.
  const runDate = getRunDatePT();
  const runId = generateRunId(runDate, triggeredBy);

  const runRef = db.collection(RH_AGENT_RUNS_COLLECTION).doc(runId);
  const now = FieldValue.serverTimestamp();

  const runData: Omit<RhAgentDailyRun, 'id'> & { id: string } = {
    id: runId,
    type: 'daily-scan',
    marketDate,
    runDate,
    status: RhAgentRunStatus.RUNNING,
    triggeredBy,
    totalSymbols,
    processedCount: 0,
    successCount: 0,
    failureCount: 0,
    signalsGenerated: 0,
    completionProcessed: false,
    startedAt: now,
    deadlineAt,
    errors: [],
    logs: [`[${new Date().toISOString()}] Run started: ${totalSymbols} symbols`],
  };

  await runRef.set(runData);
  logger.info('rh_agent_run_created', { runId, marketDate, totalSymbols, triggeredBy });

  return runId;
}

/**
 * Fetch an intraday snapshot for the given symbols.
 * Gracefully returns an empty array if the partner endpoint fails.
 */
export async function fetchIntradaySnapshots(
  symbols: string[],
  marketDate: string
): Promise<IntradaySnapshot[]> {
  if (symbols.length === 0) return [];

  logger.info('rh_agent_fetching_intraday', { marketDate, symbolCount: symbols.length });
  try {
    const response = await callPartnerIntradaySnapshotV2(symbols);
    logger.info('rh_agent_intraday_fetched', { marketDate, count: response.count });
    return response.snapshots;
  } catch (error: any) {
    logger.warn('rh_agent_intraday_fetch_failed', { marketDate, error: error?.message });
    return [];
  }
}

/**
 * Create a per-symbol job document under the run and enqueue it on the
 * `rhAgentProcessSymbol` Cloud Tasks queue. In the emulator the task queue may
 * be unavailable, in which case the job document is still created but the
 * enqueue error is swallowed.
 *
 * @param runId Daily run document ID.
 * @param symbol Symbol to process.
 * @param marketDate Market date in YYYY-MM-DD format.
 * @param triggeredBy Who started the run (pdr/manual/nightly).
 * @param intraday Optional intraday snapshot for the symbol.
 */
export async function createJobAndEnqueue(
  runId: string,
  symbol: string,
  marketDate: string,
  runStartedAt: string,
  triggeredBy: RhAgentTriggeredBy = 'pdr',
  intraday?: IntradaySnapshot
): Promise<void> {
  // Create job document
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

  // Enqueue Cloud Task
  const payload: SymbolJobPayload = {
    runId,
    symbol,
    marketDate,
    runStartedAt,
    triggeredBy,
    intraday,
  };

  try {
    const queue = getFunctions().taskQueue('rhAgentProcessSymbol');
    await queue.enqueue(payload);
  } catch (error: any) {
    logger.warn(`rh_agent_${triggeredBy}_enqueue_failed`, {
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

/**
 * Enqueue Cloud Tasks for all symbols in a run.
 *
 * Shared by the trigger and the manual callable so both paths produce identical
 * job payloads and logging.
 *
 * @param runId Daily run document ID.
 * @param symbols Symbols to process.
 * @param marketDate Market date in YYYY-MM-DD format.
 * @param runStartedAt ISO timestamp when the run started.
 * @param intradayBySymbol Map of symbol -> intraday snapshot.
 * @param triggeredBy Who started the run (pdr/manual/nightly).
 * @returns Enqueue result: counts of enqueued and failed jobs.
 */
export async function enqueueSymbolJobs(
  runId: string,
  symbols: string[],
  marketDate: string,
  runStartedAt: string,
  intradayBySymbol: Map<string, IntradaySnapshot>,
  triggeredBy: RhAgentTriggeredBy,
): Promise<{ enqueued: number; failed: number }> {
  logger.info('rh_agent_enqueue_symbol_jobs_start', {
    runId,
    marketDate,
    triggeredBy,
    symbolCount: symbols.length,
  });

  let enqueued = 0;
  let failed = 0;

  for (const symbol of symbols) {
    try {
      const intraday = intradayBySymbol.get(symbol);
      await createJobAndEnqueue(runId, symbol, marketDate, runStartedAt, triggeredBy, intraday);
      enqueued++;
      if (enqueued % 10 === 0) {
        logger.info('rh_agent_enqueue_symbol_jobs_progress', {
          runId,
          triggeredBy,
          enqueued,
          total: symbols.length,
        });
      }
    } catch (error: any) {
      failed++;
      logger.error('rh_agent_enqueue_symbol_jobs_failed', {
        symbol,
        runId,
        triggeredBy,
        error: error?.message,
      });
    }
  }

  logger.info('rh_agent_enqueue_symbol_jobs_complete', {
    runId,
    marketDate,
    triggeredBy,
    symbolCount: symbols.length,
    enqueued,
    failed,
  });

  return { enqueued, failed };
}

/**
 * RH Agent Job Enqueueing
 *
 * Creates per-symbol job documents under a run and enqueues them on the
 * `rhAgentProcessSymbol` Cloud Tasks queue. Kept separate from run creation so
 * callers can enqueue jobs without pulling in run-doc creation logic.
 */
import { getFunctions } from 'firebase-admin/functions';
import { logger } from 'firebase-functions/v2';
import { RH_AGENT_RUNS_COLLECTION, RH_AGENT_JOBS_SUBCOLLECTION } from './rh-agent-collections';
import { RhAgentJobStatus, RhAgentJob, RhAgentTriggeredBy } from './rh-agent-runs';
import { SymbolJobPayload } from './rh-agent-shared-types';
import { db, FieldValue } from '../firebase-admin-init';

/**
 * Create a per-symbol job document under the run and enqueue it on the
 * `rhAgentProcessSymbol` Cloud Tasks queue. In the emulator the task queue may
 * be unavailable, in which case the job document is still created but the
 * enqueue error is swallowed.
 *
 * @param runId Daily run document ID.
 * @param symbol Symbol to process.
 * @param marketDate Market date in YYYY-MM-DD format.
 * @param triggeredBy Who started the run (pdr/manual/nightly/symbol-added).
 */
export async function createJobAndEnqueue(
  runId: string,
  symbol: string,
  marketDate: string,
  runStartedAt: string,
  triggeredBy: RhAgentTriggeredBy = 'pdr',
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
 * @param triggeredBy Who started the run (pdr/manual/nightly/symbol-added).
 * @returns Enqueue result: counts of enqueued and failed jobs.
 */
export async function enqueueSymbolJobs(
  runId: string,
  symbols: string[],
  marketDate: string,
  runStartedAt: string,
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
      await createJobAndEnqueue(runId, symbol, marketDate, runStartedAt, triggeredBy);
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

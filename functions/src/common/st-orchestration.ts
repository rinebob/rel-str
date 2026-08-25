/**
 * ST Orchestration
 *
 * High-level run starter used by the ST triggers and symbol-data-sync.
 * Delegates to focused modules for run creation, symbol loading, and job
 * enqueueing so callers only import what they need.
 */
import { logger } from 'firebase-functions/v2';
import { createDailyRun, getDeadlineISO } from './st-run-creation';
import { enqueueSymbolJobs } from './st-job-enqueueing';
import { loadEnabledSymbols } from './st-symbol-source';
import { StTriggeredBy } from './st-runs';

/**
 * Start ST run - shared logic for all trigger types.
 * Exported so symbol-data-sync can call it after nightly sync completes.
 */
export async function startStRun(
  marketDate: string,
  triggeredBy: StTriggeredBy,
): Promise<{ runId: string; marketDate: string; symbolCount: number; enqueued: number; failed: number; duration: number }> {
  const startTime = Date.now();

  // 1. Load enabled symbols
  const symbols = await loadEnabledSymbols();
  if (symbols.length === 0) {
    logger.warn('st_trigger_no_symbols', { marketDate, triggeredBy });
    return { runId: '', marketDate, symbolCount: 0, enqueued: 0, failed: 0, duration: 0 };
  }
  logger.info('st_trigger_symbols_loaded', {
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
  logger.info('st_trigger_run_created', {
    runId,
    marketDate,
    triggeredBy,
    symbolCount: symbols.length,
  });

  // 4. Enqueue Cloud Tasks for all symbols
  const { enqueued, failed } = await enqueueSymbolJobs(
    runId,
    symbols,
    marketDate,
    runStartedAt,
    triggeredBy,
  );

  const duration = Date.now() - startTime;
  logger.info('st_trigger_complete', {
    runId,
    marketDate,
    triggeredBy,
    symbolCount: symbols.length,
    enqueued,
    failed,
    duration,
  });

  return { runId, marketDate, symbolCount: symbols.length, enqueued, failed, duration };
}

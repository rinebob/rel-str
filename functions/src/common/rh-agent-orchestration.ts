/**
 * RH Agent Orchestration
 *
 * High-level run starter used by the RH Agent triggers and symbol-data-sync.
 * Delegates to focused modules for run creation, symbol loading, and job
 * enqueueing so callers only import what they need.
 */
import { logger } from 'firebase-functions/v2';
import { createDailyRun, getDeadlineISO } from './rh-agent-run-creation';
import { enqueueSymbolJobs } from './rh-agent-job-enqueueing';
import { loadEnabledSymbols } from './rh-agent-symbol-source';
import { RhAgentTriggeredBy } from './rh-agent-runs';

/**
 * Start RH Agent run - shared logic for all trigger types.
 * Exported so symbol-data-sync can call it after nightly sync completes.
 */
export async function startRhAgentRun(
  marketDate: string,
  triggeredBy: RhAgentTriggeredBy,
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

  // 4. Enqueue Cloud Tasks for all symbols
  const { enqueued, failed } = await enqueueSymbolJobs(
    runId,
    symbols,
    marketDate,
    runStartedAt,
    triggeredBy,
  );

  const duration = Date.now() - startTime;
  logger.info('rh_agent_trigger_complete', {
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

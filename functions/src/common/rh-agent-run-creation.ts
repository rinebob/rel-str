/**
 * RH Agent Run Creation
 *
 * Helpers for creating run documents in Firestore. Kept separate from job
 * enqueueing so callers that only need a run doc (e.g., symbol-added onboarding)
 * do not pull in Cloud Tasks enqueueing code.
 */
import { logger } from 'firebase-functions/v2';
import { RH_AGENT_RUNS_COLLECTION } from './rh-agent-collections';
import {
  RhAgentRunStatus,
  RhAgentDailyRun,
  RhAgentTriggeredBy,
} from './rh-agent-runs';
import { db, FieldValue } from '../firebase-admin-init';
import { getMarketDatePT, getRunDatePT, getRunIdPT } from './pt-date-utils';

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
 * Generate run ID in format: YYYY-MM-DD_dow_HHMMSS_trigger.
 * Delegates to the shared PT date utility.
 */
function generateRunId(runDate: string, trigger: RhAgentTriggeredBy): string {
  return getRunIdPT(runDate, trigger);
}

/**
 * Create a new agent run document in Firestore.
 */
export async function createDailyRun(
  marketDate: string,
  totalSymbols: number,
  deadlineAt: string,
  triggeredBy: RhAgentTriggeredBy = 'pdr',
  runId?: string,
  runDate?: string,
  type: 'daily-scan' | 'symbol-added' = 'daily-scan',
): Promise<string> {
  // runDate is the PT calendar date the run occurred; marketDate is the trading date.
  const finalRunDate = runDate ?? getRunDatePT();
  const finalRunId = runId ?? generateRunId(finalRunDate, triggeredBy);

  const runRef = db.collection(RH_AGENT_RUNS_COLLECTION).doc(finalRunId);
  const now = FieldValue.serverTimestamp();

  const runData: Omit<RhAgentDailyRun, 'id'> & { id: string } = {
    id: finalRunId,
    type,
    marketDate,
    runDate: finalRunDate,
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
  logger.info('rh_agent_run_created', { runId: finalRunId, marketDate, totalSymbols, triggeredBy, type });

  return finalRunId;
}

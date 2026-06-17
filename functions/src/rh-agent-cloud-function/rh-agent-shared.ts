/**
 * RH Agent Shared Utilities
 *
 * Common functions used by both the scheduler and manual run callables.
 * Avoids duplication between rh-agent-scheduler.ts and rh-agent-callables.ts
 */
import { getFunctions } from 'firebase-admin/functions';
import { logger } from 'firebase-functions/v2';
import {
  RH_AGENT_SYMBOLS_COLLECTION,
  RH_AGENT_RUNS_COLLECTION,
  RH_AGENT_JOBS_SUBCOLLECTION,
  RhAgentRunStatus,
  RhAgentJobStatus,
  RhAgentDailyRun,
  RhAgentJob,
  SymbolJobPayload,
} from './rh-agent-config';
import { db, FieldValue } from '../firebase-admin-init';

/**
 * Get market date in YYYY-MM-DD format (UTC).
 */
export function getMarketDate(): string {
  const now = new Date();
  const year = now.getUTCFullYear();
  const month = String(now.getUTCMonth() + 1).padStart(2, '0');
  const day = String(now.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
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
    .orderBy('priority', 'asc')
    .get();

  const symbols = snapshot.docs.map((doc) => doc.data().symbol as string);

  if (requestedSymbols && requestedSymbols.length > 0) {
    return symbols.filter((s) => requestedSymbols.includes(s));
  }

  return symbols;
}

/**
 * Generate run ID in format: DATE_DOW_TIME (e.g., 2026-06-16_tue_153145)
 */
function generateRunId(marketDate: string): string {
  const now = new Date();
  const dow = now.toLocaleDateString('en-US', { weekday: 'short' }).toLowerCase();
  const hours = String(now.getHours()).padStart(2, '0');
  const minutes = String(now.getMinutes()).padStart(2, '0');
  const seconds = String(now.getSeconds()).padStart(2, '0');
  return `${marketDate}_${dow}_${hours}${minutes}${seconds}`;
}

/**
 * Create a new daily run document in Firestore.
 */
export async function createDailyRun(
  marketDate: string,
  totalSymbols: number,
  deadlineAt: string,
  triggeredBy: 'manual' | 'pdr' = 'pdr'
): Promise<string> {
  // Generate run ID in DATE_DOW_TIME format (e.g., 2026-06-16_tue_153145)
  const runId = generateRunId(marketDate);

  const runRef = db.collection(RH_AGENT_RUNS_COLLECTION).doc(runId);
  const now = FieldValue.serverTimestamp();

  const runData: Omit<RhAgentDailyRun, 'id'> & { id: string } = {
    id: runId,
    type: 'daily-scan',
    marketDate,
    status: RhAgentRunStatus.RUNNING,
    triggeredBy,
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
  logger.info('rh_agent_run_created', { runId, marketDate, totalSymbols, triggeredBy });

  return runId;
}

/**
 * Create a job document and enqueue a Cloud Task.
 */
export async function createJobAndEnqueue(
  runId: string,
  symbol: string,
  marketDate: string,
  context: 'pdr' | 'manual' = 'pdr'
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
  };

  try {
    const queue = getFunctions().taskQueue('rhAgentProcessSymbol');
    await queue.enqueue(payload);
  } catch (error: any) {
    logger.warn(`rh_agent_${context}_enqueue_failed`, {
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

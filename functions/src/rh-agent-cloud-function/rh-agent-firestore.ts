/**
 * RH Agent Firestore Persistence
 *
 * Handles all Firestore writes for agent runs, signals, and status.
 */
import { db, FieldValue } from '../firebase-admin-init';
import { logger } from 'firebase-functions';
import {
  RH_AGENT_RUNS_COLLECTION,
  RH_AGENT_SIGNALS_COLLECTION,
  RH_AGENT_STATUS_COLLECTION,
  AGENT_STATUS_DOC,
  RhAgentRun,
  RhTradeSignal,
  RhAgentStatus,
  RhAgentRunStatus,
  RhSignalStatus,
  RhWatchedSymbol,
  RhTradeAction,
} from './rh-agent-config';

/**
 * Create a new agent run record.
 */
export async function createRun(
  strategy: string,
  dryRun: boolean,
  symbols: RhWatchedSymbol[]
): Promise<string> {
  const runId = db.collection(RH_AGENT_RUNS_COLLECTION).doc().id;
  const now = FieldValue.serverTimestamp();

  const runData: Omit<RhAgentRun, 'id' | 'startedAt' | 'completedAt'> & {
    id: string;
    startedAt: typeof now;
    completedAt?: typeof now;
  } = {
    id: runId,
    status: RhAgentRunStatus.RUNNING,
    startedAt: now,
    strategy,
    dryRun,
    symbolsProcessed: 0,
    signalsGenerated: 0,
    errors: [],
    logs: [`[${new Date().toISOString()}] Run started: ${strategy}`],
  };

  await db.collection(RH_AGENT_RUNS_COLLECTION).doc(runId).set(runData);
  logger.info('rh_agent_run_created', { runId, strategy, dryRun, symbols: symbols.length });

  // Update agent status
  await updateStatus({
    lastRunAt: now,
    lastRunId: runId,
    lastRunStatus: RhAgentRunStatus.RUNNING,
    symbolsMonitored: symbols.filter((s) => s.enabled).map((s) => s.symbol),
  });

  return runId;
}

/**
 * Log a message to the run record.
 */
export async function logRunMessage(runId: string, message: string): Promise<void> {
  const timestamp = new Date().toISOString();
  const line = `[${timestamp}] ${message}`;

  try {
    await db.collection(RH_AGENT_RUNS_COLLECTION).doc(runId).update({
      logs: FieldValue.arrayUnion(line),
    });
  } catch (e: any) {
    logger.warn('rh_agent_log_failed', { runId, message: e?.message });
  }
}

/**
 * Record an error on the run.
 */
export async function recordRunError(runId: string, error: string): Promise<void> {
  const timestamp = new Date().toISOString();
  const line = `[${timestamp}] ERROR: ${error}`;

  try {
    await db.collection(RH_AGENT_RUNS_COLLECTION).doc(runId).update({
      errors: FieldValue.arrayUnion(line),
    });
  } catch (e: any) {
    logger.warn('rh_agent_error_record_failed', { runId, message: e?.message });
  }
}

/**
 * Increment the symbols processed count.
 */
export async function incrementSymbolsProcessed(runId: string): Promise<void> {
  try {
    await db.collection(RH_AGENT_RUNS_COLLECTION).doc(runId).update({
      symbolsProcessed: FieldValue.increment(1),
    });
  } catch (e: any) {
    logger.warn('rh_agent_increment_failed', { runId, message: e?.message });
  }
}

/**
 * Complete a run with final status.
 */
export async function completeRun(
  runId: string,
  status: RhAgentRunStatus,
  summary: string,
  finalLogs: string[] = []
): Promise<void> {
  const now = FieldValue.serverTimestamp();

  const updates: Record<string, unknown> = {
    status,
    completedAt: now,
    summary,
  };

  if (finalLogs.length > 0) {
    updates.logs = FieldValue.arrayUnion(...finalLogs);
  }

  await db.collection(RH_AGENT_RUNS_COLLECTION).doc(runId).update(updates);

  // Update agent status
  await updateStatus({
    lastRunStatus: status,
  });

  logger.info('rh_agent_run_completed', { runId, status, summary });
}

/**
 * Create a trade signal record.
 */
export async function createSignal(
  runId: string,
  symbol: string,
  strategy: string,
  action: RhTradeAction,
  status: RhSignalStatus,
  reason: string,
  dryRun: boolean,
  details?: {
    amount?: number;
    quantity?: number;
    price?: number;
    orderType?: 'MARKET' | 'LIMIT' | 'STOP';
    indicators?: Record<string, number | string>;
    error?: string;
    orderId?: string;
  }
): Promise<string> {
  const signalId = db.collection(RH_AGENT_SIGNALS_COLLECTION).doc().id;
  const now = FieldValue.serverTimestamp();

  const signalData: Omit<RhTradeSignal, 'id' | 'createdAt' | 'executedAt'> & {
    id: string;
    createdAt: typeof now;
    executedAt?: typeof now;
  } = {
    id: signalId,
    runId,
    symbol,
    strategy,
    action,
    status,
    reason,
    dryRun,
    createdAt: now,
    ...details,
  };

  await db.collection(RH_AGENT_SIGNALS_COLLECTION).doc(signalId).set(signalData);

  // Increment signals generated on the run
  await db.collection(RH_AGENT_RUNS_COLLECTION).doc(runId).update({
    signalsGenerated: FieldValue.increment(1),
  });

  // Increment total signals on status
  await db.collection(RH_AGENT_STATUS_COLLECTION).doc(AGENT_STATUS_DOC).update({
    totalSignalsGenerated: FieldValue.increment(1),
  });

  logger.info('rh_agent_signal_created', { signalId, runId, symbol, action, status, dryRun });

  return signalId;
}

/**
 * Update a signal with execution details.
 */
export async function updateSignalExecuted(
  signalId: string,
  orderId: string,
  status: RhSignalStatus.EXECUTED | RhSignalStatus.FAILED | RhSignalStatus.REJECTED,
  error?: string
): Promise<void> {
  const now = FieldValue.serverTimestamp();

  const updates: Record<string, unknown> = {
    orderId,
    status,
    executedAt: now,
  };

  if (error) {
    updates.error = error;
  }

  await db.collection(RH_AGENT_SIGNALS_COLLECTION).doc(signalId).update(updates);
  logger.info('rh_agent_signal_updated', { signalId, status, orderId });
}

/**
 * Update or create the agent status singleton.
 */
export async function updateStatus(partial: Partial<RhAgentStatus>): Promise<void> {
  const now = FieldValue.serverTimestamp();
  const ref = db.collection(RH_AGENT_STATUS_COLLECTION).doc(AGENT_STATUS_DOC);

  const defaults: Omit<RhAgentStatus, 'updatedAt'> & { updatedAt: typeof now } = {
    totalRuns: 0,
    totalSignalsGenerated: 0,
    isEnabled: true,
    schedule: 'every 15 minutes',
    symbolsMonitored: [],
    updatedAt: now,
  };

  try {
    await ref.set(
      {
        ...defaults,
        ...partial,
        updatedAt: now,
      },
      { merge: true }
    );
  } catch (e: any) {
    logger.warn('rh_agent_status_update_failed', { message: e?.message });
  }
}

/**
 * Get the current agent status.
 */
export async function getStatus(): Promise<RhAgentStatus | null> {
  const doc = await db.collection(RH_AGENT_STATUS_COLLECTION).doc(AGENT_STATUS_DOC).get();
  if (!doc.exists) return null;
  return doc.data() as RhAgentStatus;
}

/**
 * Get recent runs (newest first).
 */
export async function getRecentRuns(limit = 20): Promise<RhAgentRun[]> {
  const snapshot = await db
    .collection(RH_AGENT_RUNS_COLLECTION)
    .orderBy('startedAt', 'desc')
    .limit(limit)
    .get();

  return snapshot.docs.map((d) => d.data() as RhAgentRun);
}

/**
 * Get signals for a specific run.
 */
export async function getSignalsForRun(runId: string): Promise<RhTradeSignal[]> {
  const snapshot = await db
    .collection(RH_AGENT_SIGNALS_COLLECTION)
    .where('runId', '==', runId)
    .orderBy('createdAt', 'desc')
    .get();

  return snapshot.docs.map((d) => d.data() as RhTradeSignal);
}

/**
 * Get recent signals (newest first).
 */
export async function getRecentSignals(limit = 50): Promise<RhTradeSignal[]> {
  const snapshot = await db
    .collection(RH_AGENT_SIGNALS_COLLECTION)
    .orderBy('createdAt', 'desc')
    .limit(limit)
    .get();

  return snapshot.docs.map((d) => d.data() as RhTradeSignal);
}

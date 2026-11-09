/**
 * Backtest orchestrator callable.
 *
 * Accepts a backtest request from the UI, creates a backtest-runs document,
 * fans out one Cloud Task per symbol, and returns the run ID for polling.
 */

import { onCall, HttpsError } from 'firebase-functions/v2/https';
import type { CallableRequest } from 'firebase-functions/v2/https';
import { getFunctions } from 'firebase-admin/functions';
import { logger } from 'firebase-functions/v2';

import { db, FieldValue } from '../../firebase-admin-init';
import { getRunDatePT, getRunIdPT } from '../../common/pt-date-utils';
import { strategyRegistry } from '../strategies/strategy-registry';
import { BACKTEST_RUNS_COLLECTION, BacktestRunStatus } from './backtest-collections';
import { BACKTEST_TASK_QUEUE } from './backtest-worker';
import type { BacktestPermutationPayload, BacktestRun, BacktestReportTier, BacktestRunType } from './backtest-types';

const DEFAULT_INITIAL_CASH = 100_000;

interface StartBacktestRequest {
  symbols: string[];
  strategyId: string;
  config?: Record<string, unknown>;
  runType?: BacktestRunType;
  initialCash?: number;
  reportTier?: BacktestReportTier;
}

interface StartBacktestResponse {
  runId: string;
  enqueued: number;
  failed: number;
  total: number;
}

export interface BacktestStartDeps {
  createRun: (runId: string, doc: BacktestRunDoc) => Promise<void>;
  enqueue: (payload: BacktestPermutationPayload, delaySeconds: number) => Promise<void>;
}

type BacktestRunDoc = Omit<BacktestRun, 'createdAt' | 'updatedAt' | 'startedAt'> & {
  createdAt: FirebaseFirestore.FieldValue;
  updatedAt: FirebaseFirestore.FieldValue;
  startedAt: FirebaseFirestore.FieldValue;
};

const prodDeps: BacktestStartDeps = {
  createRun: (runId, doc) =>
    db.collection(BACKTEST_RUNS_COLLECTION).doc(runId).set(doc).then(() => undefined),
  enqueue: (payload, delaySeconds) =>
    getFunctions()
      .taskQueue(BACKTEST_TASK_QUEUE)
      .enqueue(payload, { scheduleDelaySeconds: delaySeconds })
      .then(() => undefined),
};

/** Testable core (#1444) — auth guard inside, before validation or effects. */
export async function handleStBacktestStart(
  request: CallableRequest<StartBacktestRequest>,
  deps: BacktestStartDeps = prodDeps,
): Promise<StartBacktestResponse> {
  if (!request.auth?.uid) throw new HttpsError('unauthenticated', 'unauthenticated');
  const input = request.data;
  if (input?.symbols !== undefined && !Array.isArray(input.symbols)) {
    throw new HttpsError('invalid-argument', 'symbols must be an array');
  }
  const symbols = (input?.symbols ?? [])
    .map((s) => String(s).trim().toUpperCase())
    .filter(Boolean);
  const strategyId = input?.strategyId;
  const config = input?.config ?? {};
  const runType = input?.runType ?? 'allData';
  const initialCash = Math.max(0, Number(input?.initialCash ?? DEFAULT_INITIAL_CASH));
  const reportTier = input?.reportTier ?? 'summary';

  if (symbols.length === 0) {
    throw new HttpsError('invalid-argument', 'At least one symbol is required');
  }
  if (!strategyId) {
    throw new HttpsError('invalid-argument', 'strategyId is required');
  }
  if (!strategyRegistry.has(strategyId)) {
    throw new HttpsError(
      'invalid-argument',
      `Unknown strategy '${strategyId}'. Available: ${strategyRegistry.listIds().join(', ')}`,
    );
  }

  const runDate = getRunDatePT();
  const runId = `${getRunIdPT(runDate, 'manual')}_${Math.random().toString(36).slice(2, 8)}`;

  const runDoc: BacktestRunDoc = {
    runId,
    status: BacktestRunStatus.RUNNING,
    symbols,
    strategyId,
    runType,
    initialCash,
    reportTier,
    totalPermutations: symbols.length,
    completedPermutations: 0,
    failedPermutations: 0,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
    startedAt: FieldValue.serverTimestamp(),
  };

  await deps.createRun(runId, runDoc);

  let enqueued = 0;
  let failed = 0;

  for (let i = 0; i < symbols.length; i++) {
    const symbol = symbols[i];
    const permutationId = `${runId}_${symbol}_${i}`;

    const payload: BacktestPermutationPayload = {
      runId,
      permutationId,
      symbol,
      strategyId,
      config,
      runType,
      initialCash,
      reportTier,
    };

    try {
      await deps.enqueue(payload, Math.floor(i * 0.5));
      enqueued++;
    } catch (error: unknown) {
      failed++;
      logger.error('backtest_orchestrator_enqueue_error', {
        runId,
        symbol,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  logger.info('backtest_orchestrator_complete', {
    runId,
    symbols: symbols.length,
    enqueued,
    failed,
  });

  return { runId, enqueued, failed, total: symbols.length };
}

export const stBacktestStart = onCall<StartBacktestRequest, Promise<StartBacktestResponse>>(
  { cors: true, memory: '256MiB', invoker: 'public' },
  (request) => handleStBacktestStart(request),
);

/**
 * Backtest orchestrator callable.
 *
 * Accepts a backtest request from the UI, creates a backtest-runs document,
 * fans out one Cloud Task per symbol, and returns the run ID for polling.
 */

import { onCall } from 'firebase-functions/v2/https';
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

export const stBacktestStart = onCall<StartBacktestRequest, Promise<StartBacktestResponse>>(
  { cors: true, memory: '256MiB', invoker: 'public' },
  async (request) => {
    const symbols = (request.data.symbols || [])
      .map((s) => String(s).trim().toUpperCase())
      .filter(Boolean);
    const strategyId = request.data.strategyId;
    const config = request.data.config ?? {};
    const runType = request.data.runType ?? 'allData';
    const initialCash = Math.max(0, Number(request.data.initialCash ?? DEFAULT_INITIAL_CASH));
    const reportTier = request.data.reportTier ?? 'summary';

    if (symbols.length === 0) {
      throw new Error('At least one symbol is required');
    }
    if (!strategyId) {
      throw new Error('strategyId is required');
    }
    if (!strategyRegistry.has(strategyId)) {
      throw new Error(`Unknown strategy '${strategyId}'. Available: ${strategyRegistry.listIds().join(', ')}`);
    }

    const runDate = getRunDatePT();
    const runId = `${getRunIdPT(runDate, 'manual')}_${Math.random().toString(36).slice(2, 8)}`;
    const runRef = db.collection(BACKTEST_RUNS_COLLECTION).doc(runId);

    const runDoc: Omit<BacktestRun, 'createdAt' | 'updatedAt' | 'startedAt'> & {
      createdAt: FirebaseFirestore.FieldValue;
      updatedAt: FirebaseFirestore.FieldValue;
      startedAt: FirebaseFirestore.FieldValue;
    } = {
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

    await runRef.set(runDoc);

    const queue = getFunctions().taskQueue(BACKTEST_TASK_QUEUE);
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
        await queue.enqueue(payload, {
          scheduleDelaySeconds: Math.floor(i * 0.5),
        });
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
);

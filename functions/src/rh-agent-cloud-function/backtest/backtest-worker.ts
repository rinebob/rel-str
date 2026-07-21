/**
 * Backtest Cloud Task worker.
 *
 * Processes one symbol + strategy + parameter permutation.
 * Loads daily bars, fetches option chains, runs the simulator, and persists
 * the result to Firestore.
 */

import { onTaskDispatched } from 'firebase-functions/v2/tasks';
import { logger } from 'firebase-functions/v2';

import { db, FieldValue } from '../../firebase-admin-init';
import { strategyRegistry } from '../strategies/strategy-registry';
import { loadAllDailyBars, OptionsChainCache } from './backtest-data-loader';
import { runBacktestSimulation } from './backtest-simulator';
import {
  BACKTEST_RUNS_COLLECTION,
  BACKTEST_PERMUTATIONS_COLLECTION,
  BacktestPermutationStatus,
} from './backtest-collections';
import type { BacktestPermutationPayload, BacktestPermutationSummary, BacktestTrade } from './backtest-types';

export const BACKTEST_TASK_QUEUE = 'rhAgentBacktestPermutation';
const MAX_ATTEMPTS = 3;

export const rhAgentBacktestPermutation = onTaskDispatched<BacktestPermutationPayload>(
  {
    retryConfig: {
      maxAttempts: MAX_ATTEMPTS,
      minBackoffSeconds: 10,
      maxBackoffSeconds: 120,
    },
    rateLimits: {
      maxConcurrentDispatches: 10,
      maxDispatchesPerSecond: 5,
    },
    memory: '512MiB',
    timeoutSeconds: 300,
  },
  async (req) => {
    const { runId, permutationId, symbol, strategyId, config, runType, initialCash, reportTier } = req.data;
    const retryCount = (req as { retryCount?: number }).retryCount ?? 0;
    const isFinalAttempt = retryCount >= MAX_ATTEMPTS - 1;
    const startTime = Date.now();

    logger.info('backtest_worker_start', { runId, permutationId, symbol, strategyId, runType });

    const runRef = db.collection(BACKTEST_RUNS_COLLECTION).doc(runId);
    const permRef = db.collection(BACKTEST_PERMUTATIONS_COLLECTION).doc(permutationId);

    try {
      await permRef.set(
        {
          runId,
          permutationId,
          symbol,
          strategyId,
          config,
          runType,
          initialCash,
          status: BacktestPermutationStatus.RUNNING,
          startedAt: FieldValue.serverTimestamp(),
        },
        { merge: true },
      );

      // 1. Load strategy
      const strategy = strategyRegistry.get(strategyId);
      const validation = strategyRegistry.validateConfig(strategyId, config);
      if (!validation.valid) {
        throw new Error(`Invalid config: ${validation.errors.join(', ')}`);
      }

      // 2. Load all daily bars
      const dailyBars = await loadAllDailyBars(symbol);
      if (dailyBars.length < (strategy.metadata.minBarsRequired ?? 2)) {
        throw new Error(`Insufficient daily bars for ${symbol}: ${dailyBars.length}`);
      }

      // 3. Run simulation
      const optionsCache = new OptionsChainCache(symbol);
      const result = await runBacktestSimulation(
        symbol,
        strategy,
        config,
        dailyBars,
        optionsCache,
        initialCash,
      );

      // 4. Persist permutation result (summary always; trades only for full tier)
      const summary: BacktestPermutationSummary = {
        runId,
        permutationId,
        symbol,
        strategyId,
        config,
        status: BacktestPermutationStatus.SUCCESS,
        runType,
        initialCash,
        finalEquity: result.finalEquity,
        totalReturnPct: ((result.finalEquity - initialCash) / initialCash) * 100,
        metrics: result.metrics,
        equityCurve: result.equityCurve,
        tradeCount: result.trades.length,
        notes: result.notes,
        completedAt: FieldValue.serverTimestamp(),
      };

      const fullResult = {
        ...summary,
        trades: reportTier === 'full' ? (result.trades as BacktestTrade[]) : undefined,
      };

      await permRef.set(fullResult, { merge: true });

      // 5. Update parent run progress
      await runRef.set(
        {
          completedPermutations: FieldValue.increment(1),
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true },
      );

      const duration = Date.now() - startTime;
      logger.info('backtest_worker_complete', {
        runId,
        permutationId,
        symbol,
        strategyId,
        durationMs: duration,
        trades: result.trades.length,
        finalEquity: result.finalEquity,
      });
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      const errorStack = error instanceof Error ? error.stack : undefined;
      logger.error('backtest_worker_error', {
        runId,
        permutationId,
        symbol,
        strategyId,
        error: errorMessage,
        stack: errorStack,
      });

      if (isFinalAttempt) {
        await permRef.set(
          {
            runId,
            permutationId,
            symbol,
            strategyId,
            config,
            status: BacktestPermutationStatus.FAILED,
            error: errorMessage || 'Unknown error',
            completedAt: FieldValue.serverTimestamp(),
          },
          { merge: true },
        );

        await runRef.set(
          {
            failedPermutations: FieldValue.increment(1),
            updatedAt: FieldValue.serverTimestamp(),
          },
          { merge: true },
        );
      }

      // Re-throw to trigger Cloud Tasks retry (or record final failure).
      throw error;
    }
  }
);

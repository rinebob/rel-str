/**
 * RH Agent Symbol Analysis Worker
 *
 * Cloud Task worker that analyzes a single symbol.
 * Triggered by the task queue for each symbol in the daily run.
 *
 * Uses internal rel-str Firestore data (symbol-data), NOT Robinhood API.
 *
 * This file is intentionally a thin orchestrator. Data loading, signal
 * persistence, and run progress tracking have been extracted into dedicated
 * helpers so they can be tested independently.
 */
import { onTaskDispatched } from 'firebase-functions/v2/tasks';
import { logger } from 'firebase-functions/v2';

import { loadSymbolBars } from './rh-agent-data-loader';
import { syncSymbolToSymbolData } from '../symbol-data-sync/symbol-data-backfill';
import { persistSymbolSignals } from './rh-agent-signal-persister';
import { RunProgressTracker } from './rh-agent-run-progress';

import { SymbolJobPayload } from '../common/rh-agent-shared-types';

import { strategyRegistry } from './strategies/strategy-registry';
import type { StrategyInput, StrategyOutput, StrategyAdapter } from './strategies/strategy-registry';
import { StrategyId } from './strategies/base-strategy';

// Default strategy if none specified on the run document
const DEFAULT_STRATEGY = StrategyId.ST_TREND_RIDER;

// Minimum daily bars required before a strategy is executed
const MIN_REQUIRED_BARS = 45;

/**
 * Cloud Task worker for analyzing a single symbol.
 * Processes in parallel with other workers (max 20 concurrent).
 */
export const rhAgentProcessSymbol = onTaskDispatched<SymbolJobPayload>(
  {
    retryConfig: {
      maxAttempts: 3,
      minBackoffSeconds: 5,
      maxBackoffSeconds: 60,
    },
    rateLimits: {
      maxConcurrentDispatches: 20,
      maxDispatchesPerSecond: 10,
    },
    memory: '256MiB',
    timeoutSeconds: 60,
  },
  async (req) => {
    const { runId, symbol, marketDate, runStartedAt, triggeredBy } = req.data;
    const startTime = Date.now();
    const progress = new RunProgressTracker(runId, symbol);

    logger.info('rh_agent_worker_start', { runId, symbol, marketDate });

    try {
      // 1. Mark job as in-progress
      await progress.markInProgress();

      // 2. Refresh D/W/M bars from SA before loading cached bars.
      //    Incremental sync fetches the latest 14 daily bars (including today's full
      //    intraday OHLCV bar from SA) and writes them into symbol-data.
      //    Skipped on nightly runs — nightly sync already wrote fresh bars before
      //    the worker was enqueued.
      if (triggeredBy !== 'nightly') {
        await syncSymbolToSymbolData(symbol, false);
      }

      // 3. Load cached bars
      const {
        dailyBars,
        weeklyBars,
        monthlyBars,
        lastDailyBarStatus,
        lastWeeklyBarStatus,
        lastMonthlyBarStatus,
        sufficient,
      } = await loadSymbolBars(
        symbol,
        marketDate,
        runId,
        MIN_REQUIRED_BARS,
      );

      if (!sufficient) {
        logger.warn('rh_agent_worker_insufficient_data', { runId, symbol, barCount: dailyBars.length, required: MIN_REQUIRED_BARS });
        await progress.markComplete('SUCCESS', false, undefined, 0);
        return;
      }

      // 4. Load strategy from registry
      const strategy = strategyRegistry.get(DEFAULT_STRATEGY);

      // 5. Validate minimum data requirements
      if (dailyBars.length < strategy.metadata.minBarsRequired) {
        logger.warn('rh_agent_worker_insufficient_bars_for_strategy', {
          runId, symbol, barCount: dailyBars.length,
          required: strategy.metadata.minBarsRequired, strategy: DEFAULT_STRATEGY,
        });
        await progress.markComplete('SUCCESS', false, undefined, 0);
        return;
      }

      // 6. Execute strategy
      const strategyInput: StrategyInput = {
        symbol,
        marketDate,
        bars: dailyBars,
        weeklyBars,
        monthlyBars,
      };

      const results = await executeStrategy(strategy, strategyInput, runId);

      // 7. Persist signals
      const barStatusByTimeframe = {
        D: lastDailyBarStatus,
        W: lastWeeklyBarStatus,
        M: lastMonthlyBarStatus,
      };
      const { opportunityCount } = await persistSymbolSignals(
        symbol,
        runId,
        marketDate,
        runStartedAt,
        results,
        triggeredBy,
        barStatusByTimeframe,
      );

      // 8. Mark job complete
      await progress.markComplete('SUCCESS', opportunityCount > 0, undefined, opportunityCount);

      const duration = Date.now() - startTime;
      logger.info('rh_agent_worker_complete', {
        runId,
        symbol,
        durationMs: duration,
        opportunityCreated: opportunityCount > 0,
      });
    } catch (error: any) {
      logger.error('rh_agent_worker_error', {
        runId,
        symbol,
        error: error?.message,
        stack: error?.stack,
      });

      // Mark job as failed
      await progress.markComplete('FAILED', false, error?.message, 0);

      // Re-throw to trigger Cloud Tasks retry
      throw error;
    }
  }
);

/**
 * Execute the selected strategy and return normalized outputs.
 */
async function executeStrategy(
  strategy: StrategyAdapter,
  input: StrategyInput,
  runId: string
): Promise<StrategyOutput[]> {
  const strategyName = strategy.metadata?.id || DEFAULT_STRATEGY;
  const strategyConfig = strategy.metadata?.defaultConfig;

  logger.info('rh_agent_worker_executing_strategy', {
    runId, symbol: input.symbol, strategy: strategyName,
    dailyBars: input.bars.length,
    weeklyBars: input.weeklyBars?.length || 0,
    monthlyBars: input.monthlyBars?.length || 0,
  });

  const validation = strategyRegistry.validateConfig(strategyName, strategyConfig);
  if (!validation.valid) {
    const message = `Invalid strategy config for ${strategyName}: ${validation.errors.join(', ')}`;
    logger.error('rh_agent_worker_strategy_config_invalid', { runId, symbol: input.symbol, strategy: strategyName, errors: validation.errors });
    throw new Error(message);
  }

  const rawResult = strategy.execute(input, strategyConfig);
  const results: StrategyOutput[] = Array.isArray(rawResult) ? rawResult : [rawResult];

  logger.info('rh_agent_worker_strategy_result', {
    runId, symbol: input.symbol, strategy: strategyName,
    signalCount: results.filter(r => r.action).length,
    signals: results.filter(r => r.action).map(r => r.signalType),
  });

  return results;
}

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

import { loadSymbolBars, verifyDataFreshness } from './rh-agent-data-loader';
import { persistSymbolSignals } from './rh-agent-signal-persister';
import { RunProgressTracker } from './rh-agent-run-progress';

import { SymbolJobPayload } from './rh-agent-shared-types';

import { strategyRegistry } from './strategies/strategy-registry';
import type { StrategyInput, StrategyOutput, StrategyAdapter } from './strategies/strategy-registry';
import { StrategyId } from './strategies/base-strategy';

// Default strategy if none specified on the run document
const DEFAULT_STRATEGY = StrategyId.ST_TREND_RIDER;

// Minimum daily bars required before a strategy is executed
const MIN_REQUIRED_BARS = 45;

// Feature flags
const REQUIRE_FRESH_DATA = false; // Set to true for production - checks that data is from today

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
    // secrets: [ANTHROPIC_API_KEY], // Temporarily disabled for testing
  },
  async (req) => {
    const { runId, symbol, marketDate, runStartedAt, intraday, triggeredBy } = req.data;
    const startTime = Date.now();
    const progress = new RunProgressTracker(runId, symbol);

    logger.info('rh_agent_worker_start', { runId, symbol, marketDate });

    try {
      // 1. Mark job as in-progress
      await progress.markInProgress();

      // 2. Load cached bars (injects today's intraday price as a partial bar)
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
        !!intraday,
        runId,
        intraday ?? null,
        MIN_REQUIRED_BARS,
      );

      if (!sufficient) {
        logger.warn('rh_agent_worker_insufficient_data', { runId, symbol, barCount: dailyBars.length, required: MIN_REQUIRED_BARS, hasIntraday: !!intraday });
        await progress.markComplete('SUCCESS', false, undefined, 0);
        return;
      }

      // 2b. Verify data freshness
      if (REQUIRE_FRESH_DATA) {
        const isFresh = verifyDataFreshness(dailyBars, marketDate, runId, symbol);
        if (!isFresh) {
          logger.warn('rh_agent_worker_stale_data', { runId, symbol, marketDate });
          await progress.markComplete('SUCCESS', false, undefined, 0);
          return;
        }
      }

      // 3. Load strategy from registry
      const strategy = strategyRegistry.get(DEFAULT_STRATEGY);

      // 4. Validate minimum data requirements
      if (dailyBars.length < strategy.metadata.minBarsRequired) {
        logger.warn('rh_agent_worker_insufficient_bars_for_strategy', {
          runId, symbol, barCount: dailyBars.length,
          required: strategy.metadata.minBarsRequired, strategy: DEFAULT_STRATEGY,
        });
        await progress.markComplete('SUCCESS', false, undefined, 0);
        return;
      }

      // 5. Execute strategy
      const strategyInput: StrategyInput = {
        symbol,
        marketDate,
        bars: dailyBars,
        weeklyBars,
        monthlyBars,
        intraday,
      };

      const results = await executeStrategy(strategy, strategyInput, runId);

      // 6. Persist signals
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
        !!intraday,
        results,
        triggeredBy,
        barStatusByTimeframe,
      );

      // 7. Mark job complete
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

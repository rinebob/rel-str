/**
 * RH Agent Symbol Analysis Worker
 *
 * Cloud Task worker that analyzes a single symbol.
 * Triggered by the task queue for each symbol in the daily run.
 *
 * Uses internal rel-str Firestore data (rs-bars), NOT Robinhood API.
 */
import { onTaskDispatched } from 'firebase-functions/v2/tasks';
import { logger } from 'firebase-functions/v2';

import { db, FieldValue } from '../firebase-admin-init';
import { OhlcBar, RsBarsDoc } from '../rs-bars/rs-bars-sync';

import {
  RH_AGENT_RUNS_COLLECTION,
  RH_AGENT_STATUS_COLLECTION,
  RH_AGENT_JOBS_SUBCOLLECTION,
  AGENT_STATUS_DOC,
  RhAgentDailyRun,
  RhAgentJobStatus,
  RhAgentRunStatus,
  RhAgentSignalEntry,
  RhAgentSignalStatus,
  StSignalDirection,
  SymbolJobPayload,
} from './rh-agent-config';

import { SignalDateWriter } from './rh-agent-signal-date-writer';

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

    logger.info('rh_agent_worker_start', { runId, symbol, marketDate });

    try {
      // 1. Mark job as in-progress
      await markJobInProgress(runId, symbol);

      // 2. Load cached bars (injects today's intraday price as a partial bar)
      const { dailyBars, weeklyBars, monthlyBars } = await loadData(symbol, marketDate, !!intraday, runId, intraday ?? null);

      if (!dailyBars || dailyBars.length < MIN_REQUIRED_BARS) {
        logger.warn('rh_agent_worker_insufficient_data', { runId, symbol, barCount: dailyBars?.length || 0, required: MIN_REQUIRED_BARS, hasIntraday: !!intraday });
        await markJobComplete(runId, symbol, 'SUCCESS', false, undefined, 0);
        return;
      }

      // 2b. Verify data freshness
      if (REQUIRE_FRESH_DATA) {
        const isFresh = verifyDataFreshness(dailyBars, marketDate, runId, symbol);
        if (!isFresh) {
          logger.warn('rh_agent_worker_stale_data', { runId, symbol, marketDate });
          await markJobComplete(runId, symbol, 'SUCCESS', false, undefined, 0);
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
        await markJobComplete(runId, symbol, 'SUCCESS', false, undefined, 0);
        return;
      }

      // 5. Execute strategy
      const strategyInput: StrategyInput = {
        symbol, marketDate,
        bars: dailyBars,
        weeklyBars: weeklyBars || undefined,
        monthlyBars: monthlyBars || undefined,
        intraday,
      };

      const results = await executeStrategy(strategy, strategyInput, runId);

      // 6. Persist signals
      const { opportunityCount, barDates } = await persistSignals(symbol, runId, marketDate, runStartedAt, !!intraday, results, triggeredBy);

      // 7. Clear stale INTERIM signals for bar dates that did not fire this run
      await clearStaleSignals(symbol, marketDate, !!intraday, results, barDates);

      // 8. Mark job complete (signalsGenerated counter is batched with run counters)
      await markJobComplete(runId, symbol, 'SUCCESS', opportunityCount > 0, undefined, opportunityCount);

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
      await markJobComplete(runId, symbol, 'FAILED', false, error?.message, 0);

      // Re-throw to trigger Cloud Tasks retry
      throw error;
    }
  }
);

/**
 * Load cached bars from rs-bars/{symbol} and inject today's intraday price
 * as a partial bar if provided. This replaces the trigger-side
 * writeIntradayBarsToRsBars — the worker owns bar injection using the
 * intraday snapshot already present in its Cloud Task payload.
 */
async function loadData(
  symbol: string,
  marketDate: string,
  intraday: boolean,
  runId: string,
  intradaySnapshot?: { ip: number } | null
): Promise<{ dailyBars: OhlcBar[] | null; weeklyBars: OhlcBar[] | null; monthlyBars: OhlcBar[] | null }> {
  logger.info('rh_agent_worker_fetching_data', { runId, symbol, marketDate, cachePath: `rs-bars/${symbol}`, hasIntraday: !!intraday });
  const { dailyBars, weeklyBars, monthlyBars } = await getCachedBars(symbol, marketDate, intradaySnapshot ?? null);
  logger.info('rh_agent_worker_data_loaded', {
    runId,
    symbol,
    dailyBars: dailyBars?.length || 0,
    weeklyBars: weeklyBars?.length || 0,
    monthlyBars: monthlyBars?.length || 0,
  });
  return { dailyBars, weeklyBars, monthlyBars };
}

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

  const rawResult = strategy.execute(input, strategyConfig);
  const results: StrategyOutput[] = Array.isArray(rawResult) ? rawResult : [rawResult];

  logger.info('rh_agent_worker_strategy_result', {
    runId, symbol: input.symbol, strategy: strategyName,
    signalCount: results.filter(r => r.action).length,
    signals: results.filter(r => r.action).map(r => r.signalType),
  });

  return results;
}

/**
 * Persist all fired signals grouped by bar date.
 */
async function persistSignals(
  symbol: string,
  runId: string,
  marketDate: string,
  runStartedAt: string,
  intraday: boolean,
  results: StrategyOutput[],
  triggeredBy?: string
): Promise<{ opportunityCount: number; barDates: Set<string> }> {
  const fired = results.filter(r => r.action);
  const entries = fired.map(r => createSignalEntry(marketDate, runId, r, intraday));

  const byBarDate = new Map<string, RhAgentSignalEntry[]>();
  for (const entry of entries) {
    const list = byBarDate.get(entry.barDate) ?? [];
    list.push(entry);
    byBarDate.set(entry.barDate, list);
  }

  const writer = new SignalDateWriter(symbol);
  const barDatePromises: Promise<number>[] = [];
  for (const [, dateEntries] of byBarDate) {
    barDatePromises.push(writer.persistBarDate(runId, runStartedAt, marketDate, dateEntries, intraday, triggeredBy as any));
  }

  const counts = await Promise.all(barDatePromises);
  const opportunityCount = counts.reduce((sum, c) => sum + c, 0);

  logger.info('rh_agent_worker_signals_persisted', {
    symbol,
    runId,
    marketDate,
    barDates: Array.from(byBarDate.keys()),
    opportunityCount,
  });

  return { opportunityCount, barDates: new Set(byBarDate.keys()) };
}

/**
 * Clear stale INTERIM signals for bar dates that did not fire this run.
 */
async function clearStaleSignals(
  symbol: string,
  marketDate: string,
  intraday: boolean,
  results: StrategyOutput[],
  barDates: Set<string>
): Promise<void> {
  const writer = new SignalDateWriter(symbol);
  const promises: Promise<void>[] = [];

  // Also clear stale INTERIM for the current weekly bar if no weekly signal fired at all
  const weeklyBarDate = results.find(r => r.barDate && deriveTimeframe(r.signalType) === 'W')?.barDate;
  if (weeklyBarDate && !barDates.has(weeklyBarDate)) {
    promises.push(writer.clearStaleInterimSignals(weeklyBarDate, new Set()));
  }

  // For intraday runs: if no daily signal fired at all, clear any existing INTERIM daily signals for today
  if (intraday && !barDates.has(marketDate)) {
    promises.push(writer.clearStaleInterimSignals(marketDate, new Set()));
  }

  await Promise.all(promises);
}

/**
 * Mark job as in-progress.
 */
async function markJobInProgress(runId: string, symbol: string): Promise<void> {
  const jobRef = db
    .collection(RH_AGENT_RUNS_COLLECTION)
    .doc(runId)
    .collection(RH_AGENT_JOBS_SUBCOLLECTION)
    .doc(symbol);

  await jobRef.set(
    {
      status: RhAgentJobStatus.IN_PROGRESS,
      startedAt: FieldValue.serverTimestamp(),
    },
    { merge: true }
  );
}

/**
 * Mark job as complete (success or failed) and batch the run-level signalsGenerated
 * increment with the success/failure counters.
 */
async function markJobComplete(
  runId: string,
  symbol: string,
  status: 'SUCCESS' | 'FAILED',
  createdOpportunity: boolean,
  errorMessage?: string,
  signalsGenerated = 0
): Promise<void> {
  const jobRef = db
    .collection(RH_AGENT_RUNS_COLLECTION)
    .doc(runId)
    .collection(RH_AGENT_JOBS_SUBCOLLECTION)
    .doc(symbol);

  const updates: any = {
    status: status === 'SUCCESS' ? RhAgentJobStatus.SUCCESS : RhAgentJobStatus.FAILED,
    completedAt: FieldValue.serverTimestamp(),
    createdOpportunity,
  };

  if (errorMessage) {
    updates.lastError = errorMessage;
  }

  await jobRef.set(updates, { merge: true });

  // Update run counters (signalsGenerated is batched here)
  await updateRunCounters(runId, status, signalsGenerated);
}

/**
 * Update run-level counters. When signalsGenerated is provided, it is incremented
 * in the same write as processed/success/failure counts.
 */
async function updateRunCounters(
  runId: string,
  jobStatus: 'SUCCESS' | 'FAILED',
  signalsGenerated = 0
): Promise<void> {
  const runRef = db.collection(RH_AGENT_RUNS_COLLECTION).doc(runId);

  const updates: any = {
    processedCount: FieldValue.increment(1),
  };

  if (jobStatus === 'SUCCESS') {
    updates.successCount = FieldValue.increment(1);
  } else {
    updates.failureCount = FieldValue.increment(1);
  }

  if (signalsGenerated > 0) {
    updates.signalsGenerated = FieldValue.increment(signalsGenerated);
  }

  await runRef.set(updates, { merge: true });

  // Check if all jobs complete
  await checkRunCompletion(runId);
}

/**
 * Check if all jobs are complete and update run and agent status.
 */
async function checkRunCompletion(runId: string): Promise<void> {
  const runRef = db.collection(RH_AGENT_RUNS_COLLECTION).doc(runId);
  const statusRef = db.collection(RH_AGENT_STATUS_COLLECTION).doc(AGENT_STATUS_DOC);

  try {
    let finalStatus: RhAgentRunStatus | undefined;

    await db.runTransaction(async (t) => {
      const runDoc = await t.get(runRef);
      if (!runDoc.exists) return;

      const runData = runDoc.data() as Partial<RhAgentDailyRun> | undefined;
      const total = runData?.totalSymbols || 0;
      const processed = (runData?.successCount || 0) + (runData?.failureCount || 0);

      if (processed < total || runData?.completionProcessed) return;

      finalStatus = runData?.failureCount ? RhAgentRunStatus.PARTIAL : RhAgentRunStatus.SUCCESS;

      t.set(
        runRef,
        {
          status: finalStatus,
          completedAt: FieldValue.serverTimestamp(),
          completionProcessed: true,
        },
        { merge: true }
      );

      t.set(
        statusRef,
        {
          lastRunAt: FieldValue.serverTimestamp(),
          lastRunId: runId,
          lastRunStatus: finalStatus,
          totalRuns: FieldValue.increment(1),
          totalSignalsGenerated: FieldValue.increment(runData?.signalsGenerated || 0),
        },
        { merge: true }
      );
    });

    if (finalStatus) {
      logger.info('rh_agent_run_complete', { runId, status: finalStatus });
    }
  } catch (error: any) {
    logger.error('rh_agent_run_completion_error', { runId, error: error?.message });
  }
}

/**
 * Verify that the most recent bar date matches the expected market date.
 * Returns true if data is fresh (from today), false otherwise.
 */
function verifyDataFreshness(bars: any[], marketDate: string, runId: string, symbol: string): boolean {
  if (!bars || bars.length === 0) return false;

  // Get the most recent bar
  const mostRecentBar = bars[bars.length - 1];
  const barDate = mostRecentBar?.date || mostRecentBar?.t || mostRecentBar?.timestamp;

  if (!barDate) {
    logger.warn('rh_agent_worker_freshness_check_no_date', { runId, symbol });
    return false;
  }

  // Extract YYYY-MM-DD from bar date (handle various formats)
  const barDateStr = typeof barDate === 'string'
    ? barDate.slice(0, 10) // "2026-06-14T00:00:00Z" → "2026-06-14"
    : new Date(barDate).toISOString().slice(0, 10);

  const isFresh = barDateStr === marketDate;

  logger.info('rh_agent_worker_freshness_check', {
    runId,
    symbol,
    marketDate,
    barDate: barDateStr,
    isFresh,
    barIndex: bars.length - 1,
  });

  return isFresh;
}

/**
 * Fetch bars from rs-bars/{symbol} — the single local source of truth.
 * Populated nightly by rsBarsSyncNightly. Returns D/W/M bars trimmed to
 * bars on or before marketDate so historical runs see the correct snapshot.
 */
async function getCachedBars(
  symbol: string,
  marketDate: string,
  intraday: { ip: number } | null = null
): Promise<{ dailyBars: OhlcBar[] | null; weeklyBars: OhlcBar[] | null; monthlyBars: OhlcBar[] | null }> {
  try {
    const docRef = db.collection('rs-bars').doc(symbol);
    const snap = await docRef.get();

    logger.info('rh_agent_worker_cache_query', { symbol, marketDate, collection: 'rs-bars', exists: snap.exists });

    if (!snap.exists) {
      logger.warn('rh_agent_worker_cache_miss', { symbol, marketDate, note: 'Run rsBarsSyncAdmin to backfill' });
      return { dailyBars: null, weeklyBars: null, monthlyBars: null };
    }

    const data = snap.data() as RsBarsDoc | undefined;

    /** Trim bars to dates on or before marketDate for correct historical snapshots. */
    const trim = (bars: OhlcBar[] | null | undefined) => {
      if (!Array.isArray(bars) || bars.length === 0) return null;
      const filtered = bars.filter((b) => (b?.d ?? '') <= marketDate);
      return filtered.length > 0 ? filtered : null;
    };

    let dailyBars = trim(data?.daily);
    const weeklyBars  = trim(data?.weekly);
    const monthlyBars = trim(data?.monthly);

    // Inject today's intraday price as a partial bar (replace-or-append).
    // This avoids the trigger having to pre-write all 761 rs-bars docs.
    if (intraday && dailyBars) {
      const partialBar: OhlcBar = { d: marketDate, o: intraday.ip, h: intraday.ip, l: intraday.ip, c: intraday.ip };
      const last = dailyBars[dailyBars.length - 1];
      dailyBars = last?.d === marketDate
        ? [...dailyBars.slice(0, -1), partialBar]
        : [...dailyBars, partialBar];
    }

    logger.info('rh_agent_worker_cache_result', {
      symbol,
      marketDate,
      dailyBars: dailyBars?.length ?? 0,
      weeklyBars: weeklyBars?.length ?? 0,
      monthlyBars: monthlyBars?.length ?? 0,
    });

    if (!dailyBars) {
      logger.warn('rh_agent_worker_no_daily_bars', { symbol, marketDate });
    }

    return { dailyBars, weeklyBars, monthlyBars };
  } catch (error: any) {
    logger.error('rh_agent_worker_cache_error', { symbol, marketDate, error: error?.message });
    return { dailyBars: null, weeklyBars: null, monthlyBars: null };
  }
}

/**
 * Derive timeframe ('D' | 'W') from signalType prefix.
 */
function deriveTimeframe(signalType: string): 'D' | 'W' {
  return signalType.startsWith('W_') ? 'W' : 'D';
}

/**
 * Determine signal status.
 * Daily signals are CONFIRMED on nightly runs, INTERIM during intraday runs.
 * Weekly signals are CONFIRMED once the next weekly bar has started
 * (i.e. marketDate is at least 7 days after barDate), otherwise INTERIM.
 */
function deriveSignalStatus(
  timeframe: 'D' | 'W',
  barDate: string,
  marketDate: string,
  intraday: boolean
): RhAgentSignalStatus {
  if (timeframe === 'D') return intraday ? 'INTERIM' : 'CONFIRMED';
  const barMs = new Date(barDate).getTime();
  const runMs = new Date(marketDate).getTime();
  return runMs - barMs >= 7 * 86_400_000 ? 'CONFIRMED' : 'INTERIM';
}

/**
 * Build a signal entry for the signal-dates map.
 */
function createSignalEntry(
  marketDate: string,
  runId: string,
  result: StrategyOutput,
  intraday: boolean
): RhAgentSignalEntry {
  const timeframe = deriveTimeframe(result.signalType);
  const barDate = result.barDate || marketDate;
  return {
    signalType: result.signalType,
    timeframe,
    direction: result.action ?? StSignalDirection.LONG,
    status: deriveSignalStatus(timeframe, barDate, marketDate, intraday),
    barDate,
    marketDate,
    indicators: (result.indicators || {}) as Record<string, number | string | null>,
  };
}


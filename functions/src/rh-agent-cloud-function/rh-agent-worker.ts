/**
 * RH Agent Symbol Analysis Worker
 *
 * Cloud Task worker that analyzes a single symbol.
 * Triggered by the task queue for each symbol in the daily run.
 *
 * Uses internal rel-str Firestore data (rs-symbol-cache), NOT Robinhood API.
 */
import { onTaskDispatched } from 'firebase-functions/v2/tasks';
import { logger } from 'firebase-functions/v2';

import { db, FieldValue } from '../firebase-admin-init';

import {
  RH_AGENT_RUNS_COLLECTION,
  RH_AGENT_JOBS_SUBCOLLECTION,
  RH_AGENT_OPPORTUNITIES_COLLECTION,
  RhAgentJobStatus,
  RhAgentRunStatus,
  RhOpportunityStatus,
  RhOpportunityAction,
  SymbolJobPayload,
  RhTradeOpportunity,
} from './rh-agent-config';

import { strategyRegistry } from './strategies/strategy-registry';
import type { StrategyInput, StrategyOutput } from './strategies/strategy-registry';
import { StrategyId } from './strategies/base-strategy';

// Default strategy if none specified on the run document
const DEFAULT_STRATEGY = StrategyId.ST_ZONE_UPTICK;

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
    const { runId, symbol, marketDate, intraday } = req.data;
    const startTime = Date.now();

    logger.info('rh_agent_worker_start', { runId, symbol, marketDate });

    try {
      // 1. Mark job as in-progress
      await markJobInProgress(runId, symbol);

      // 2. Fetch cached bars from internal rel-str Firestore (NOT from RH)
      logger.info('rh_agent_worker_fetching_data', { runId, symbol, marketDate, cachePath: `rs-symbol-cache/${marketDate}/symbols/${symbol}`, hasIntraday: !!intraday });
      const { dailyBars, weeklyBars, monthlyBars } = await getCachedBars(symbol, marketDate);

      const minRequiredBars = 45;
      if (!dailyBars || dailyBars.length < minRequiredBars) {
        logger.warn('rh_agent_worker_insufficient_data', { runId, symbol, barCount: dailyBars?.length || 0, required: minRequiredBars, hasIntraday: !!intraday });
        await markJobComplete(runId, symbol, 'SUCCESS', false);
        return;
      }

      logger.info('rh_agent_worker_data_loaded', {
        runId,
        symbol,
        dailyBars: dailyBars.length,
        weeklyBars: weeklyBars?.length || 0,
        monthlyBars: monthlyBars?.length || 0,
      });

      // 2b. Verify data freshness (most recent bar should be today)
      if (REQUIRE_FRESH_DATA) {
        const isFresh = verifyDataFreshness(dailyBars, marketDate, runId, symbol);
        if (!isFresh) {
          logger.warn('rh_agent_worker_stale_data', { runId, symbol, marketDate });
          await markJobComplete(runId, symbol, 'SUCCESS', false);
          return;
        }
      }

      // 3. Load strategy from registry
      const strategyName = DEFAULT_STRATEGY;
      const strategy = strategyRegistry.get(strategyName);
      const strategyConfig = strategy.metadata.defaultConfig;

      // 4. Validate minimum data requirements
      if (dailyBars.length < strategy.metadata.minBarsRequired) {
        logger.warn('rh_agent_worker_insufficient_bars_for_strategy', {
          runId, symbol, barCount: dailyBars.length,
          required: strategy.metadata.minBarsRequired, strategy: strategyName,
        });
        await markJobComplete(runId, symbol, 'SUCCESS', false);
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

      logger.info('rh_agent_worker_executing_strategy', {
        runId, symbol, strategy: strategyName,
        dailyBars: dailyBars.length,
        weeklyBars: weeklyBars?.length || 0,
        monthlyBars: monthlyBars?.length || 0,
      });

      const rawResult = strategy.execute(strategyInput, strategyConfig);
      const results: StrategyOutput[] = Array.isArray(rawResult) ? rawResult : [rawResult];

      logger.info('rh_agent_worker_strategy_result', {
        runId, symbol, strategy: strategyName,
        signalCount: results.filter(r => r.action).length,
        signals: results.filter(r => r.action).map(r => r.signalType),
      });

      // 6. Store each signal as a separate opportunity
      let opportunityCount = 0;
      for (const result of results) {
        if (result.action) {
          const opportunity = createOpportunityFromSignal(
            symbol, marketDate, strategyName, result
          );

          await storeOpportunity(runId, marketDate, opportunity);
          logger.info('rh_agent_worker_opportunity_created', {
            runId, symbol, opportunityId: opportunity.id,
            signalType: result.signalType,
          });

          await incrementOpportunitiesFound(runId);
          opportunityCount++;
        }
      }

      // 7. Mark job complete
      await markJobComplete(runId, symbol, 'SUCCESS', opportunityCount > 0);

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
      await markJobComplete(runId, symbol, 'FAILED', false, error?.message);

      // Re-throw to trigger Cloud Tasks retry
      throw error;
    }
  }
);

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
 * Mark job as complete (success or failed).
 */
async function markJobComplete(
  runId: string,
  symbol: string,
  status: 'SUCCESS' | 'FAILED',
  createdOpportunity: boolean,
  errorMessage?: string
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

  // Update run counters
  await updateRunCounters(runId, status);
}

/**
 * Update run-level counters.
 */
async function updateRunCounters(runId: string, jobStatus: 'SUCCESS' | 'FAILED'): Promise<void> {
  const runRef = db.collection(RH_AGENT_RUNS_COLLECTION).doc(runId);

  const updates: any = {
    processedCount: FieldValue.increment(1),
  };

  if (jobStatus === 'SUCCESS') {
    updates.successCount = FieldValue.increment(1);
  } else {
    updates.failureCount = FieldValue.increment(1);
  }

  await runRef.set(updates, { merge: true });

  // Check if all jobs complete
  await checkRunCompletion(runId);
}

/**
 * Check if all jobs are complete and update run status.
 */
async function checkRunCompletion(runId: string): Promise<void> {
  const runRef = db.collection(RH_AGENT_RUNS_COLLECTION).doc(runId);
  const runDoc = await runRef.get();

  if (!runDoc.exists) return;

  const runData = runDoc.data() as any;
  const total = runData.totalSymbols || 0;
  const processed = (runData.successCount || 0) + (runData.failureCount || 0);

  if (processed >= total) {
    // All jobs complete
    const status = runData.failureCount > 0 ? RhAgentRunStatus.PARTIAL : RhAgentRunStatus.SUCCESS;
    await runRef.set(
      {
        status,
        completedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );

    logger.info('rh_agent_run_complete', { runId, status, total, processed });
  }
}

/**
 * Increment opportunities found counter on run document.
 */
async function incrementOpportunitiesFound(runId: string): Promise<void> {
  const runRef = db.collection(RH_AGENT_RUNS_COLLECTION).doc(runId);
  await runRef.set(
    {
      opportunitiesFound: FieldValue.increment(1),
    },
    { merge: true }
  );
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
async function getCachedBars(symbol: string, marketDate: string): Promise<{ dailyBars: any[] | null; weeklyBars: any[] | null; monthlyBars: any[] | null }> {
  try {
    const docRef = db.collection('rs-bars').doc(symbol);
    const snap = await docRef.get();

    logger.info('rh_agent_worker_cache_query', { symbol, marketDate, collection: 'rs-bars', exists: snap.exists });

    if (!snap.exists) {
      logger.warn('rh_agent_worker_cache_miss', { symbol, marketDate, note: 'Run rsBarsSyncAdmin to backfill' });
      return { dailyBars: null, weeklyBars: null, monthlyBars: null };
    }

    const data = snap.data() as any;

    // Trim to bars on or before marketDate for correct historical snapshots
    const trim = (bars: any[] | null) => {
      if (!Array.isArray(bars) || bars.length === 0) return null;
      const filtered = bars.filter((b: any) => (b?.d ?? '') <= marketDate);
      return filtered.length > 0 ? filtered : null;
    };

    const dailyBars   = trim(data?.daily);
    const weeklyBars  = trim(data?.weekly);
    const monthlyBars = trim(data?.monthly);

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
 * Create opportunity from strategy output.
 * Converts the standardized StrategyOutput into a Firestore RhTradeOpportunity.
 */
function createOpportunityFromSignal(
  symbol: string,
  marketDate: string,
  strategyName: string,
  result: StrategyOutput
): RhTradeOpportunity {
  return {
    id: '',
    runId: '',
    marketDate,
    symbol,
    action: result.action === 'OPEN_LONG' ? RhOpportunityAction.OPEN_LONG : RhOpportunityAction.OPEN_SHORT,
    signalType: result.signalType,
    strategy: strategyName,
    confidence: result.confidence,
    reason: result.reason,
    indicators: (result.indicators || {}) as Record<string, number>,
    suggestedAmount: result.suggestedAmount || 1000,
    orderType: 'MARKET',
    status: RhOpportunityStatus.PENDING,
    createdAt: FieldValue.serverTimestamp() as any,
    updatedAt: FieldValue.serverTimestamp() as any,
  };
}

/**
 * Store opportunity in Firestore with custom ID: DATE_DAYOFWEEK_SYMBOL_DIRECTION_SIGNALTYPE.
 * Example: "2026-06-14_mon_AAPL_OPEN_LONG_D_ZONE_V1_UPTICK"
 */
async function storeOpportunity(runId: string, marketDate: string, opportunity: RhTradeOpportunity): Promise<void> {
  // Get day of week from market date
  const date = new Date(marketDate);
  const dayOfWeek = date.toLocaleDateString('en-US', { weekday: 'short' }).toLowerCase(); // sun, mon, tue, etc.

  // Generate custom ID for easy identification in Firestore list
  const oppId = `${marketDate}_${dayOfWeek}_${opportunity.symbol}_${opportunity.action}_${opportunity.signalType}`;
  const oppRef = db.collection(RH_AGENT_OPPORTUNITIES_COLLECTION).doc(oppId);

  const oppData: RhTradeOpportunity = {
    ...opportunity,
    id: oppId,
    runId,
  };

  await oppRef.set(oppData, { merge: true });
}


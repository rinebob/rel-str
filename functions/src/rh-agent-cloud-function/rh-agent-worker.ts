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
import { rsi } from '../rh-agent/indicators';

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

// Constants
const RSI_OVERSOLD_THRESHOLD = 30;
const PRICE_DROP_THRESHOLD = -0.02; // 2% drop

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
      const bars = await getCachedBars(symbol, marketDate);

      // Need at least 14 historical bars + intraday = 15 for RSI(14)
      const minRequiredBars = 14;
      if (!bars || bars.length < minRequiredBars) {
        logger.warn('rh_agent_worker_insufficient_data', { runId, symbol, barCount: bars?.length || 0, required: minRequiredBars, hasIntraday: !!intraday });
        await markJobComplete(runId, symbol, 'SUCCESS', false); // No opportunity
        return;
      }

      logger.info('rh_agent_worker_data_loaded', {
        runId,
        symbol,
        totalBars: bars.length,
        dateRange: `${bars[0]?.date || bars[0]?.t || 'unknown'} to ${bars[bars.length - 1]?.date || bars[bars.length - 1]?.t || 'unknown'}`,
      });

      // 2b. Verify data freshness (most recent bar should be today)
      if (REQUIRE_FRESH_DATA) {
        const isFresh = verifyDataFreshness(bars, marketDate, runId, symbol);
        if (!isFresh) {
          logger.warn('rh_agent_worker_stale_data', { runId, symbol, marketDate });
          await markJobComplete(runId, symbol, 'SUCCESS', false); // No opportunity due to stale data
          return;
        }
      }

      // 3. Calculate indicators
      // Extract historical closing prices from bars (handle different field names: close, c)
      // For intraday: use historical bars (days 1-14) + intraday price (today)
      const historicalCloses = bars.slice(0, 14).map((b: any) => b.close || b.c || 0).filter((c: number) => c > 0);
      
      // Use intraday price from payload if available, otherwise fall back to last historical bar
      const currentPrice = intraday?.ip ?? historicalCloses[historicalCloses.length - 1];
      const previousPrice = historicalCloses[historicalCloses.length - 1] || currentPrice;
      const priceChange = (currentPrice - previousPrice) / previousPrice;
      
      // Full close array for indicators: historical + current
      const closes = [...historicalCloses, currentPrice];

      // Calculate RSI using last 14 periods (standard RSI lookback)
      const rsiValue = rsi(closes);

      logger.info('rh_agent_worker_calculation_details', {
        runId,
        symbol,
        closesCount: closes.length,
        historicalCount: historicalCloses.length,
        usingIntraday: !!intraday,
        currentPrice,
        previousPrice,
        priceChangePct: (priceChange * 100).toFixed(2) + '%',
        rsi: rsiValue !== null ? rsiValue.toFixed(2) : 'null',
        rsiPeriod: 14,
        rsiOversoldThreshold: RSI_OVERSOLD_THRESHOLD,
      });

      // 4. Check for signal (simple RSI oversold strategy for MVP)
      logger.info('rh_agent_worker_checking_signal', {
        runId,
        symbol,
        rsiValue,
        priceChangePct: (priceChange * 100).toFixed(2) + '%',
        rsiThreshold: `< ${RSI_OVERSOLD_THRESHOLD}`,
        priceDropThreshold: `< ${(PRICE_DROP_THRESHOLD * 100).toFixed(0)}%`,
        rsiConditionMet: rsiValue !== null && rsiValue < RSI_OVERSOLD_THRESHOLD,
        priceDropConditionMet: priceChange < PRICE_DROP_THRESHOLD,
      });

      const signal = checkRsiOversold(symbol, rsiValue, priceChange, currentPrice);

      if (signal) {
        logger.info('rh_agent_worker_signal_detected', {
          runId,
          symbol,
          action: signal.action,
          confidence: signal.confidence,
          signalType: signal.signalType,
          reason: signal.reason,
        });
        // 5. Generate basic opportunity (NO Claude during scanning)
        // NOTE: Claude is only used for approved opportunities post-scan
        const opportunity = createBasicOpportunity(symbol, marketDate, signal, {
          rsi: rsiValue,
          priceChange,
          currentPrice,
        });

        // 6. Store opportunity in Firestore with custom ID: DATE_SYMBOL_DIRECTION_SIGNALTYPE
        await storeOpportunity(runId, marketDate, opportunity);
        logger.info('rh_agent_worker_opportunity_created', {
          runId,
          symbol,
          opportunityId: opportunity.id,
          confidence: opportunity.confidence,
        });

        // 7. Update run stats
        await incrementOpportunitiesFound(runId);
      }

      // 8. Mark job complete
      await markJobComplete(runId, symbol, 'SUCCESS', !!signal);

      const duration = Date.now() - startTime;
      logger.info('rh_agent_worker_complete', {
        runId,
        symbol,
        durationMs: duration,
        opportunityCreated: !!signal,
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
 * Fetch cached bars from internal rel-str Firestore.
 * Uses rs-symbol-cache/{marketDate}/symbols/{symbol}
 */
async function getCachedBars(symbol: string, marketDate: string): Promise<any[] | null> {
  try {
    // rs-symbol-cache structure from rs-time-series-jobs.worker.ts
    const collectionPath = `rs-symbol-cache/${marketDate}/symbols`;
    const docPath = `${collectionPath}/${symbol}`;

    logger.info('rh_agent_worker_cache_query', {
      symbol,
      marketDate,
      fullPath: docPath,
    });

    const cacheDocRef = db
      .collection('rs-symbol-cache')
      .doc(marketDate)
      .collection('symbols')
      .doc(symbol);

    const snap = await cacheDocRef.get();

    logger.info('rh_agent_worker_cache_result', {
      symbol,
      marketDate,
      exists: snap.exists,
      hasData: snap.exists ? 'checking...' : 'N/A',
    });

    if (!snap.exists) {
      logger.warn('rh_agent_worker_cache_miss', { symbol, marketDate, attemptedPath: docPath });
      return null;
    }

    const data = snap.data() as any;
    const bars = data?.dailyBars || null;

    if (!Array.isArray(bars) || bars.length === 0) {
      logger.warn('rh_agent_worker_no_daily_bars', { symbol, marketDate });
      return null;
    }

    return bars;
  } catch (error: any) {
    logger.error('rh_agent_worker_cache_error', {
      symbol,
      marketDate,
      error: error?.message,
    });
    return null;
  }
}

/**
 * Simple RSI oversold strategy for MVP.
 * Returns signal if RSI < 30 AND price dropped > 2%.
 */
function checkRsiOversold(
  symbol: string,
  rsiValue: number | null,
  priceChange: number,
  currentPrice: number
): { action: RhOpportunityAction; confidence: number; reason: string; suggestedAmount: number; signalType: string } | null {
  if (rsiValue === null) return null;

  // RSI oversold (< 30) AND price drop > 2%
  if (rsiValue < RSI_OVERSOLD_THRESHOLD && priceChange < PRICE_DROP_THRESHOLD) {
    // Confidence increases as RSI drops lower
    const confidence = Math.round(((RSI_OVERSOLD_THRESHOLD - rsiValue) / RSI_OVERSOLD_THRESHOLD) * 100);

    return {
      action: RhOpportunityAction.BUY,
      confidence: Math.min(confidence, 95), // Cap at 95%
      reason: `RSI oversold (${rsiValue.toFixed(1)}) with ${(priceChange * 100).toFixed(1)}% price drop. Potential bounce opportunity.`,
      suggestedAmount: 1000, // Fixed $1000 for MVP
      signalType: 'RSI_OVERSOLD',
    };
  }

  return null;
}

/**
 * Create basic opportunity (no Claude during scanning).
 * NOTE: Claude may be used later for approved opportunities only.
 */
function createBasicOpportunity(
  symbol: string,
  marketDate: string,
  signal: { action: RhOpportunityAction; confidence: number; reason: string; suggestedAmount: number; signalType: string },
  indicators: { rsi: number | null; priceChange: number; currentPrice: number }
): RhTradeOpportunity {
  return {
    id: '',
    runId: '',
    marketDate,
    symbol,
    action: signal.action,
    signalType: signal.signalType,
    strategy: 'rsi-oversold',
    confidence: signal.confidence,
    reason: signal.reason,
    indicators: {
      rsi: indicators.rsi || 0,
      priceChange: indicators.priceChange,
      currentPrice: indicators.currentPrice,
    },
    suggestedAmount: signal.suggestedAmount,
    orderType: 'MARKET',
    status: RhOpportunityStatus.PENDING,
    createdAt: FieldValue.serverTimestamp() as any,
    updatedAt: FieldValue.serverTimestamp() as any,
  };
}

/**
 * Store opportunity in Firestore with custom ID: DATE_DAYOFWEEK_SYMBOL_DIRECTION_SIGNALTYPE.
 * Example: "2026-06-14_mon_AAPL_BUY_RSI_OVERSOLD"
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


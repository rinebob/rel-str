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
    const { runId, symbol, marketDate } = req.data;
    const startTime = Date.now();

    logger.info('rh_agent_worker_start', { runId, symbol, marketDate });

    try {
      // 1. Mark job as in-progress
      await markJobInProgress(runId, symbol);

      // 2. Fetch cached bars from internal rel-str Firestore (NOT from RH)
      const bars = await getCachedBars(symbol, marketDate);
      if (!bars || bars.length < 15) {
        logger.warn('rh_agent_worker_insufficient_data', { runId, symbol, barCount: bars?.length || 0 });
        await markJobComplete(runId, symbol, 'SUCCESS', false); // No opportunity
        return;
      }

      // 3. Calculate indicators
      const closes = bars.map((b: any) => b.close || b.c || 0).filter((c: number) => c > 0);
      const currentPrice = closes[closes.length - 1];
      const previousPrice = closes[closes.length - 2] || currentPrice;
      const priceChange = (currentPrice - previousPrice) / previousPrice;

      const rsiValue = rsi(closes);

      logger.info('rh_agent_worker_indicators', {
        runId,
        symbol,
        rsi: rsiValue,
        priceChange,
        currentPrice,
      });

      // 4. Check for signal (simple RSI oversold strategy for MVP)
      const signal = checkRsiOversold(symbol, rsiValue, priceChange, currentPrice);

      if (signal) {
        // 5. Generate basic opportunity (NO Claude during scanning)
        // NOTE: Claude is only used for approved opportunities post-scan
        const opportunity = createBasicOpportunity(symbol, signal, {
          rsi: rsiValue,
          priceChange,
          currentPrice,
        });

        // 6. Store opportunity in Firestore
        await storeOpportunity(runId, opportunity);
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
 * Fetch cached bars from internal rel-str Firestore.
 * Uses rs-symbol-cache/{marketDate}/symbols/{symbol}
 */
async function getCachedBars(symbol: string, marketDate: string): Promise<any[] | null> {
  try {
    // rs-symbol-cache structure from rs-time-series-jobs.worker.ts
    const cacheDocRef = db
      .collection('rs-symbol-cache')
      .doc(marketDate)
      .collection('symbols')
      .doc(symbol);

    const snap = await cacheDocRef.get();
    if (!snap.exists) {
      logger.warn('rh_agent_worker_cache_miss', { symbol, marketDate });
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
): { action: RhOpportunityAction; confidence: number; reason: string; suggestedAmount: number } | null {
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
  signal: { action: RhOpportunityAction; confidence: number; reason: string; suggestedAmount: number },
  indicators: { rsi: number | null; priceChange: number; currentPrice: number }
): RhTradeOpportunity {
  return {
    id: '',
    runId: '',
    symbol,
    action: signal.action,
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
 * Store opportunity in Firestore.
 */
async function storeOpportunity(runId: string, opportunity: RhTradeOpportunity): Promise<void> {
  const oppRef = db.collection(RH_AGENT_OPPORTUNITIES_COLLECTION).doc();
  const oppId = oppRef.id;

  const oppData: RhTradeOpportunity = {
    ...opportunity,
    id: oppId,
    runId,
  };

  await oppRef.set(oppData);
}


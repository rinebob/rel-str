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
  RH_AGENT_STATUS_COLLECTION,
  RH_AGENT_JOBS_SUBCOLLECTION,
  RH_AGENT_SYMBOLS_COLLECTION,
  RH_AGENT_SIGNAL_DATES_SUBCOLLECTION,
  AGENT_STATUS_DOC,
  RhAgentJobStatus,
  RhAgentRunStatus,
  RhAgentSignalEntry,
  RhAgentSignalDateDoc,
  RhAgentSignalStatus,
  StSignalDirection,
  SymbolJobPayload,
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

      // 6. Store signals under rh-agent-symbols/{symbol}/signal-dates/{barDate}
      const fired = results.filter(r => r.action);
      const entries = fired.map(r => createSignalEntry(marketDate, runId, r, !!intraday));

      // Group entries by barDate (daily and weekly may have different bar dates)
      const byBarDate = new Map<string, typeof entries>();
      for (const entry of entries) {
        if (!byBarDate.has(entry.barDate)) byBarDate.set(entry.barDate, []);
        byBarDate.get(entry.barDate)!.push(entry);
      }

      let opportunityCount = 0;
      for (const [barDate, dateEntries] of byBarDate) {
        await writeSignalDateDoc(symbol, runId, dateEntries);

        for (const entry of dateEntries) {
          await updateSymbolGateDate(symbol, barDate, entry.timeframe, entry.direction);
          logger.info('rh_agent_worker_signal_written', {
            runId, symbol, barDate, signalType: entry.signalType,
            timeframe: entry.timeframe, status: entry.status,
          });
          opportunityCount++;
        }

        // Clear stale INTERIM signals for weekly bar dates (reversal handling)
        const isWeeklyBarDate = dateEntries.some(e => e.timeframe === 'W');
        if (isWeeklyBarDate) {
          const firedTypes = new Set(dateEntries.filter(e => e.timeframe === 'W').map(e => e.signalType));
          await clearStaleInterimSignals(symbol, barDate, firedTypes);
        }

        // Clear stale INTERIM daily signals during intraday runs (reversal handling)
        if (intraday) {
          const isDailyBarDate = dateEntries.some(e => e.timeframe === 'D');
          if (isDailyBarDate) {
            const firedDailyTypes = new Set(dateEntries.filter(e => e.timeframe === 'D').map(e => e.signalType));
            await clearStaleInterimSignals(symbol, barDate, firedDailyTypes);
          }
        }
      }

      // Also clear stale INTERIM for the current weekly bar if no weekly signal fired at all
      const weeklyBarDate = results.find(r => r.barDate && deriveTimeframe(r.signalType) === 'W')?.barDate;
      if (weeklyBarDate && !byBarDate.has(weeklyBarDate)) {
        await clearStaleInterimSignals(symbol, weeklyBarDate, new Set());
      }

      // For intraday runs: if no daily signal fired at all, clear any existing INTERIM daily signals for today
      if (intraday && !byBarDate.has(marketDate)) {
        await clearStaleInterimSignals(symbol, marketDate, new Set());
      }

      await incrementSignalsGenerated(runId, opportunityCount);

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

      const runData = runDoc.data() as any;
      const total = runData.totalSymbols || 0;
      const processed = (runData.successCount || 0) + (runData.failureCount || 0);

      if (processed < total || runData.completionProcessed) return;

      finalStatus = runData.failureCount > 0 ? RhAgentRunStatus.PARTIAL : RhAgentRunStatus.SUCCESS;

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
          totalSignalsGenerated: FieldValue.increment(runData.signalsGenerated || 0),
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
 * Increment signals generated counter on run document.
 */
async function incrementSignalsGenerated(runId: string, count = 1): Promise<void> {
  if (count === 0) return;
  const runRef = db.collection(RH_AGENT_RUNS_COLLECTION).doc(runId);
  await runRef.set(
    {
      signalsGenerated: FieldValue.increment(count),
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
    direction: result.action === 'OPEN_LONG' ? StSignalDirection.LONG : StSignalDirection.SHORT,
    status: deriveSignalStatus(timeframe, barDate, marketDate, intraday),
    barDate,
    marketDate,
    indicators: (result.indicators || {}) as Record<string, number | string | null>,
  };
}

/**
 * Write signals to rh-agent-symbols/{symbol}/signal-dates/{barDate}.
 * Uses map merge so multiple signals on the same bar date are combined.
 * CONFIRMED entries from previous runs are never overwritten.
 */
async function writeSignalDateDoc(
  symbol: string,
  runId: string,
  entries: RhAgentSignalEntry[]
): Promise<void> {
  if (entries.length === 0) return;

  const barDate = entries[0].barDate;
  const docRef = db
    .collection(RH_AGENT_SYMBOLS_COLLECTION)
    .doc(symbol)
    .collection(RH_AGENT_SIGNAL_DATES_SUBCOLLECTION)
    .doc(barDate);

  const existing = await docRef.get();
  const existingData = existing.exists ? (existing.data() as RhAgentSignalDateDoc) : null;

  const signalsUpdate: Record<string, any> = {};
  for (const entry of entries) {
    const existing = existingData?.signals?.[entry.signalType];
    if (existing?.status === 'CONFIRMED') continue;
    signalsUpdate[`signals.${entry.signalType}`] = entry;
  }

  if (Object.keys(signalsUpdate).length === 0) return;

  await docRef.set(
    { symbol, barDate, runId, updatedAt: FieldValue.serverTimestamp(), ...signalsUpdate },
    { merge: true }
  );
}

/**
 * For W/M bar dates that had INTERIM signals in a previous run:
 * if this run produced no signal for a given signalType, delete the INTERIM entry.
 */
async function clearStaleInterimSignals(
  symbol: string,
  barDate: string,
  firedSignalTypes: Set<string>
): Promise<void> {
  const docRef = db
    .collection(RH_AGENT_SYMBOLS_COLLECTION)
    .doc(symbol)
    .collection(RH_AGENT_SIGNAL_DATES_SUBCOLLECTION)
    .doc(barDate);

  const snap = await docRef.get();
  if (!snap.exists) return;

  const data = snap.data() as RhAgentSignalDateDoc;
  const deletions: Record<string, any> = {};
  for (const [signalType, entry] of Object.entries(data.signals ?? {})) {
    if (entry.status === 'INTERIM' && !firedSignalTypes.has(signalType)) {
      deletions[`signals.${signalType}`] = FieldValue.delete();
    }
  }

  if (Object.keys(deletions).length > 0) {
    await docRef.update(deletions);
  }
}

/**
 * Update lastDailySignalDate or lastWeeklySignalDate on the symbol doc.
 * Uses barDate so the gate matches the signal-dates doc ID.
 */
async function updateSymbolGateDate(symbol: string, barDate: string, timeframe: 'D' | 'W', direction: string): Promise<void> {
  const symbolRef = db.collection(RH_AGENT_SYMBOLS_COLLECTION).doc(symbol);
  const dateField = timeframe === 'W' ? 'lastWeeklySignalDate' : 'lastDailySignalDate';
  const dirField  = timeframe === 'W' ? 'lastWeeklySignalDirection' : 'lastDailySignalDirection';
  await symbolRef.set({ [dateField]: barDate, [dirField]: direction }, { merge: true });
}


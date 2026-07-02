/**
 * RS Bars Nightly Sync
 *
 * Fetches full D/W/M price history from SavantAPI for all tracked symbols
 * and writes to rs-bars/{SYMBOL} in Firestore.
 *
 * Architecture:
 *   - rsBarsSyncAdmin (callable) / rsBarsSyncNightly (scheduler)
 *       → loads all symbols, enqueues one Cloud Task per symbol, returns immediately
 *   - rsBarsSyncSymbol (task worker)
 *       → fetches D/W/M bars from SA for one symbol, writes to rs-bars/{SYMBOL}
 */
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { onCall } from 'firebase-functions/v2/https';
import { onTaskDispatched } from 'firebase-functions/v2/tasks';
import { getFunctions } from 'firebase-admin/functions';
import { logger } from 'firebase-functions';
import { FieldValue } from 'firebase-admin/firestore';
import { db } from '../firebase-admin-init';
import { callPartnerTimeSeries, callPartnerTrackedSymbols } from '../partner-proxy';
import { startRhAgentRun } from '../rh-agent-cloud-function/rh-agent-trigger';

// ============================================================================
// Constants
// ============================================================================

export const RS_BARS_COLLECTION = 'rs-bars';
const RS_BARS_SYNC_RUNS_COLLECTION = 'rs-bars-sync-runs';

// Lookback windows for full backfill (in years)
const DAILY_BACKFILL_YEARS = 7;
const WEEKLY_BACKFILL_YEARS = 7;
const MONTHLY_BACKFILL_YEARS = 8;

// Number of bars to fetch on incremental (nightly) runs
const INCREMENTAL_DAILY_LIMIT = 14;
const INCREMENTAL_WEEKLY_LIMIT = 10;
const INCREMENTAL_MONTHLY_LIMIT = 6;

// Age threshold: if lastDailyBarDate is older than this, do a full re-fetch
const STALE_THRESHOLD_DAYS = 7;

// ============================================================================
// Types
// ============================================================================

export interface OhlcBar {
  d: string;   // YYYY-MM-DD
  o: number;
  h: number;
  l: number;
  c: number;
  v?: number;
}

export interface RsBarsDoc {
  symbol: string;
  daily: OhlcBar[];
  weekly: OhlcBar[];
  monthly: OhlcBar[];
  lastSyncedAt: FirebaseFirestore.FieldValue | FirebaseFirestore.Timestamp;
  lastEodSyncAt: FirebaseFirestore.FieldValue | FirebaseFirestore.Timestamp;
  lastDailyBarDate: string;
  lastWeeklyBarDate: string;
  lastMonthlyBarDate: string;
  lastIntradayAt?: FirebaseFirestore.FieldValue | FirebaseFirestore.Timestamp;
}

interface SyncResult {
  symbol: string;
  status: 'ok' | 'error' | 'skipped';
  dailyCount?: number;
  weeklyCount?: number;
  monthlyCount?: number;
  error?: string;
}

// ============================================================================
// Bar normalization
// ============================================================================

/**
 * Convert a raw SA partner bar to our compact OhlcBar.
 * SA returns: { t: epochMs, o, h, l, c, v, d?: string }
 * We store: { d: YYYY-MM-DD, o, h, l, c, v }
 */
function normalizeBar(raw: any): OhlcBar | null {
  // Prefer explicit date string; fall back to epoch timestamp
  let d: string = '';
  if (raw?.d && typeof raw.d === 'string') {
    d = raw.d.slice(0, 10);
  } else if (raw?.t && Number.isFinite(Number(raw.t))) {
    d = new Date(Number(raw.t)).toISOString().slice(0, 10);
  }

  const o = Number(raw?.o);
  const h = Number(raw?.h);
  const l = Number(raw?.l);
  const c = Number(raw?.c ?? raw?.ac); // adjusted close preferred
  const v = Number(raw?.v);

  if (!d || !Number.isFinite(c) || c <= 0) return null;

  const bar: OhlcBar = { d, o: Number.isFinite(o) ? o : c, h: Number.isFinite(h) ? h : c, l: Number.isFinite(l) ? l : c, c };
  if (Number.isFinite(v) && v > 0) bar.v = v;
  return bar;
}

/**
 * Merge new bars into existing bars array, keyed by date.
 * New bars overwrite existing bars with the same date (handles corrections).
 * Result is sorted chronologically.
 */
function mergeBars(existing: OhlcBar[], incoming: OhlcBar[]): OhlcBar[] {
  const map = new Map<string, OhlcBar>();
  for (const b of existing) map.set(b.d, b);
  for (const b of incoming) map.set(b.d, b);
  return Array.from(map.values()).sort((a, b) => a.d.localeCompare(b.d));
}

// ============================================================================
// Date helpers
// ============================================================================

function dateYearsAgo(years: number): string {
  const d = new Date();
  d.setFullYear(d.getFullYear() - years);
  return d.toISOString().slice(0, 10);
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function daysSince(dateStr: string): number {
  const then = new Date(dateStr).getTime();
  return Math.floor((Date.now() - then) / 86_400_000);
}

// ============================================================================
// Core sync logic per symbol
// ============================================================================

async function syncSymbol(symbol: string, forceFullFetch: boolean): Promise<SyncResult> {
  try {
    // Read existing doc to determine incremental vs full fetch
    const docRef = db.collection(RS_BARS_COLLECTION).doc(symbol);
    const snap = await docRef.get();
    const existing = snap.exists ? (snap.data() as RsBarsDoc) : null;

    const isStale = !existing?.lastDailyBarDate || daysSince(existing.lastDailyBarDate) > STALE_THRESHOLD_DAYS;
    const doFullFetch = forceFullFetch || isStale || !existing;

    // Determine fetch params for each interval
    const toDate = todayIso();
    const fetchParams = doFullFetch
      ? {
          daily:   { from: dateYearsAgo(DAILY_BACKFILL_YEARS),   to: toDate },
          weekly:  { from: dateYearsAgo(WEEKLY_BACKFILL_YEARS),   to: toDate },
          monthly: { from: dateYearsAgo(MONTHLY_BACKFILL_YEARS),  to: toDate },
        }
      : {
          daily:   { limit: INCREMENTAL_DAILY_LIMIT },
          weekly:  { limit: INCREMENTAL_WEEKLY_LIMIT },
          monthly: { limit: INCREMENTAL_MONTHLY_LIMIT },
        };

    // Fetch all 3 intervals in parallel
    const [rawDaily, rawWeekly, rawMonthly] = await Promise.all([
      callPartnerTimeSeries({ symbol, interval: 'DAILY',   adjusted: true, ...fetchParams.daily   }).catch(() => null),
      callPartnerTimeSeries({ symbol, interval: 'WEEKLY',  adjusted: true, ...fetchParams.weekly  }).catch(() => null),
      callPartnerTimeSeries({ symbol, interval: 'MONTHLY', adjusted: true, ...fetchParams.monthly }).catch(() => null),
    ]);

    const incomingDaily   = ((rawDaily   as any)?.bars ?? []).map(normalizeBar).filter(Boolean) as OhlcBar[];
    const incomingWeekly  = ((rawWeekly  as any)?.bars ?? []).map(normalizeBar).filter(Boolean) as OhlcBar[];
    const incomingMonthly = ((rawMonthly as any)?.bars ?? []).map(normalizeBar).filter(Boolean) as OhlcBar[];

    // Merge with existing (or use fresh if full fetch)
    const daily   = doFullFetch ? incomingDaily   : mergeBars(existing?.daily   ?? [], incomingDaily);
    const weekly  = doFullFetch ? incomingWeekly  : mergeBars(existing?.weekly  ?? [], incomingWeekly);
    const monthly = doFullFetch ? incomingMonthly : mergeBars(existing?.monthly ?? [], incomingMonthly);

    if (daily.length === 0) {
      logger.warn('rs_bars_sync_no_daily_bars', { symbol });
      return { symbol, status: 'skipped' };
    }

    const lastDailyBarDate   = daily.at(-1)?.d   ?? '';
    const lastWeeklyBarDate  = weekly.at(-1)?.d  ?? '';
    const lastMonthlyBarDate = monthly.at(-1)?.d ?? '';

    const docData: RsBarsDoc = {
      symbol,
      daily,
      weekly,
      monthly,
      lastSyncedAt: FieldValue.serverTimestamp(),
      lastEodSyncAt: FieldValue.serverTimestamp(),
      lastDailyBarDate,
      lastWeeklyBarDate,
      lastMonthlyBarDate,
    };

    await docRef.set(docData);

    return {
      symbol,
      status: 'ok',
      dailyCount: daily.length,
      weeklyCount: weekly.length,
      monthlyCount: monthly.length,
    };
  } catch (err: any) {
    logger.error('rs_bars_sync_symbol_error', { symbol, error: err?.message });
    return { symbol, status: 'error', error: err?.message };
  }
}

// ============================================================================
// Task payload
// ============================================================================

interface RsBarsSyncPayload {
  symbol: string;
  forceFullFetch: boolean;
  syncRunId?: string;   // Tracking doc ID for completion callback
  totalSymbols?: number;
  marketDate?: string;
}

// ============================================================================
// Enqueue all symbols as Cloud Tasks
// ============================================================================

async function enqueueAllSymbols(
  forceFullFetch: boolean,
  symbols?: string[],
  triggerAgentOnComplete?: boolean
): Promise<{ total: number; enqueued: number; errors: number }> {
  let allSymbols: string[] = [];

  if (symbols && symbols.length > 0) {
    allSymbols = symbols;
  } else {
    const upstream = await callPartnerTrackedSymbols().catch(() => null);
    const raw: any[] = (upstream as any)?.symbols ?? [];
    allSymbols = raw.map(s => (typeof s === 'string' ? s : s?.symbol)).filter(Boolean);
  }

  if (allSymbols.length === 0) {
    logger.error('rs_bars_sync_no_symbols');
    return { total: 0, enqueued: 0, errors: 0 };
  }

  // Create a sync run tracking doc when triggering agent on completion
  let syncRunId: string | undefined;
  const marketDate = todayIso();
  if (triggerAgentOnComplete) {
    syncRunId = `${marketDate}_${Date.now()}`;
    await db.collection(RS_BARS_SYNC_RUNS_COLLECTION).doc(syncRunId).set({
      syncRunId,
      marketDate,
      totalSymbols: allSymbols.length,
      processedCount: 0,
      startedAt: FieldValue.serverTimestamp(),
      triggerAgentOnComplete: true,
    });
    logger.info('rs_bars_sync_run_created', { syncRunId, total: allSymbols.length });
  }

  logger.info('rs_bars_sync_enqueue_start', { total: allSymbols.length, forceFullFetch });

  const queue = getFunctions().taskQueue('rsBarsSyncSymbol');
  let enqueued = 0;
  let errors = 0;

  await Promise.allSettled(
    allSymbols.map(async (symbol) => {
      try {
        const payload: RsBarsSyncPayload = { symbol, forceFullFetch, syncRunId, totalSymbols: allSymbols.length, marketDate };
        await queue.enqueue(payload);
        enqueued++;
      } catch (err: any) {
        errors++;
        logger.warn('rs_bars_sync_enqueue_failed', { symbol, error: err?.message });
      }
    })
  );

  logger.info('rs_bars_sync_enqueue_complete', { total: allSymbols.length, enqueued, errors });
  return { total: allSymbols.length, enqueued, errors };
}

// ============================================================================
// Task worker — processes one symbol per invocation
// ============================================================================

export const rsBarsSyncSymbol = onTaskDispatched<RsBarsSyncPayload>(
  {
    retryConfig: { maxAttempts: 3, minBackoffSeconds: 5, maxBackoffSeconds: 60 },
    rateLimits: { maxConcurrentDispatches: 50, maxDispatchesPerSecond: 20 },
    memory: '256MiB',
    timeoutSeconds: 120,
  },
  async (req) => {
    const { symbol, forceFullFetch, syncRunId, totalSymbols, marketDate } = req.data;
    const result = await syncSymbol(symbol, forceFullFetch);
    logger.info('rs_bars_sync_symbol_done', result);

    // If this sync has a tracking doc, increment counter and check for completion
    if (syncRunId && totalSymbols && marketDate) {
      await checkSyncRunCompletion(syncRunId, totalSymbols, marketDate);
    }
  }
);

// ============================================================================
// Scheduled trigger — runs nightly Mon-Fri at 6 PM PT (01:00 UTC next day)
// ============================================================================

export const rsBarsSyncNightly = onSchedule({
  schedule: '0 1 * * 2-6', // 1:00 AM UTC Tue-Sat = 6 PM PT Mon-Fri
  timeZone: 'Etc/UTC',
  timeoutSeconds: 60,
  memory: '256MiB',
}, async () => {
  logger.info('rsBarsSyncNightly triggered');
  await enqueueAllSymbols(false, undefined, true); // true = trigger agent run when done
});

// ============================================================================
// Admin callable — manual trigger for backfill or re-sync, returns immediately
// ============================================================================

interface RsBarsSyncAdminRequest {
  forceFullFetch?: boolean;
  symbols?: string[];
}

export const rsBarsSyncAdmin = onCall<RsBarsSyncAdminRequest>(
  { timeoutSeconds: 60, memory: '256MiB' },
  async (request) => {
    const { forceFullFetch = false, symbols } = request.data ?? {};
    logger.info('rsBarsSyncAdmin called', { forceFullFetch, symbolCount: symbols?.length ?? 'all' });
    const result = await enqueueAllSymbols(forceFullFetch, symbols); // Admin runs don't trigger agent
    return { ...result, message: `Enqueued ${result.enqueued} symbols for processing` };
  }
);

/**
 * Increment the processed counter for a sync run and trigger the RH Agent run
 * once all symbols have been synced.
 */
async function checkSyncRunCompletion(
  syncRunId: string,
  totalSymbols: number,
  marketDate: string
): Promise<void> {
  const runRef = db.collection(RS_BARS_SYNC_RUNS_COLLECTION).doc(syncRunId);
  await runRef.set(
    { processedCount: FieldValue.increment(1) },
    { merge: true }
  );

  const snap = await runRef.get();
  const processed = (snap.data() as any)?.processedCount ?? 0;

  logger.info('rs_bars_sync_run_progress', { syncRunId, processed, totalSymbols });

  if (processed >= totalSymbols) {
    logger.info('rs_bars_sync_run_complete', { syncRunId, marketDate });
    await runRef.set({ completedAt: FieldValue.serverTimestamp() }, { merge: true });
    try {
      await startRhAgentRun(marketDate, 'nightly');
      logger.info('rs_bars_sync_agent_run_triggered', { syncRunId, marketDate });
    } catch (err: any) {
      logger.error('rs_bars_sync_agent_run_failed', { syncRunId, marketDate, error: err?.message });
    }
  }
}

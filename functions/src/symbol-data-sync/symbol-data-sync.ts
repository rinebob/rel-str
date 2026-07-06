/**
 * Symbol-Data Nightly Sync
 *
 * Fetches full D/W/M price history from SavantAPI for all tracked symbols
 * and writes to symbol-data/{SYMBOL} subcollections in Firestore.
 *
 * Architecture:
 *   - symbolDataSyncAdminHttp (HTTP request) / symbolDataSyncNightly (scheduler)
 *       → loads all symbols, enqueues one Cloud Task per symbol, returns immediately
 *   - symbolDataSyncSymbol (task worker)
 *       → fetches D/W/M bars from SA for one symbol, writes to symbol-data subcollections
 *
 * Firebase Cloud Function identifiers: symbolDataSyncNightly, symbolDataSyncAdminHttp, symbolDataSyncSymbol.
 */
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { onRequest } from 'firebase-functions/v2/https';
import { onTaskDispatched } from 'firebase-functions/v2/tasks';
import { getFunctions } from 'firebase-admin/functions';
import { logger } from 'firebase-functions';
import { FieldValue } from 'firebase-admin/firestore';
import { OAuth2Client } from 'google-auth-library';
import { db } from '../firebase-admin-init';
import { callPartnerTimeSeries, callPartnerTrackedSymbols } from '../partner-proxy';
import { startRhAgentRun } from '../rh-agent-cloud-function/rh-agent-trigger';
import type { OhlcBar } from '../rh-agent-cloud-function/rh-agent-types';
import {
  SYMBOL_DATA_COLLECTION,
  SYMBOL_BARS_DAILY_SUBCOL,
  SYMBOL_BARS_WEEKLY_SUBCOL,
  SYMBOL_BARS_MONTHLY_SUBCOL,
  SYMBOL_BARS_FLAT_DOC_ID,
} from '../webhooks/webhooks-config';
import { RH_AGENT_SYMBOLS_COLLECTION } from '../rh-agent-cloud-function/rh-agent-collections';

// ============================================================================
// Constants
// ============================================================================

const SYMBOL_DATA_SYNC_RUNS_COLLECTION = 'symbol-data-sync-runs';

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
// Task payload
// ============================================================================

interface SymbolDataSyncPayload {
  symbol: string;
  forceFullFetch: boolean;
  syncRunId?: string;   // Tracking doc ID for completion callback
  totalSymbols?: number;
  marketDate?: string;
}

// ============================================================================
// Enqueue all symbols as Cloud Tasks
// ============================================================================

export async function enqueueAllSymbols(
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
    logger.error('symbol_data_sync_no_symbols');
    return { total: 0, enqueued: 0, errors: 0 };
  }

  // Create a sync run tracking doc when triggering agent on completion
  let syncRunId: string | undefined;
  const marketDate = todayIso();
  if (triggerAgentOnComplete) {
    syncRunId = `${marketDate}_${Date.now()}`;
    await db.collection(SYMBOL_DATA_SYNC_RUNS_COLLECTION).doc(syncRunId).set({
      syncRunId,
      marketDate,
      totalSymbols: allSymbols.length,
      processedCount: 0,
      startedAt: FieldValue.serverTimestamp(),
      triggerAgentOnComplete: true,
    });
    logger.info('symbol_data_sync_run_created', { syncRunId, total: allSymbols.length });
  }

  logger.info('symbol_data_sync_enqueue_start', { total: allSymbols.length, forceFullFetch });

  const queue = getFunctions().taskQueue('symbolDataSyncSymbol');
  let enqueued = 0;
  let errors = 0;

  await Promise.allSettled(
    allSymbols.map(async (symbol) => {
      try {
        const payload: SymbolDataSyncPayload = { symbol, forceFullFetch, syncRunId, totalSymbols: allSymbols.length, marketDate };
        await queue.enqueue(payload);
        enqueued++;
      } catch (err: any) {
        errors++;
        logger.warn('symbol_data_sync_enqueue_failed', { symbol, error: err?.message });
      }
    })
  );

  logger.info('symbol_data_sync_enqueue_complete', { total: allSymbols.length, enqueued, errors });
  return { total: allSymbols.length, enqueued, errors };
}

/**
 * Year-shard doc stored under symbol-data/{SYMBOL}/daily/{YYYY}.
 * Weekly and monthly remain as flat arrays in own subcollections (bounded in size).
 */
export interface SymbolBarsYearDoc {
  year: number;
  interval: 'daily';
  bars: OhlcBar[];
  updatedAt: FirebaseFirestore.FieldValue;
}

/**
 * Sync one symbol into the new symbol-data schema:
 *   - symbol-data/{SYMBOL}/daily/{YYYY}  — year-sharded OhlcBar[]
 *   - symbol-data/{SYMBOL}/weekly/all    — flat OhlcBar[] (bounded, single doc)
 *   - symbol-data/{SYMBOL}/monthly/all   — flat OhlcBar[] (bounded, single doc)
 *   - symbol-data/{SYMBOL} metadata      — lastDailyBarDate, lastWeeklyBarDate, etc.
 *   - rh-agent-symbols/{SYMBOL}          — upsert {symbol, enabled:true} (merge) so
 *                                          the agent enable list stays in sync automatically.
 *
 * Staleness and incremental logic mirrors syncSymbol exactly.
 */
async function syncSymbolToSymbolData(symbol: string, forceFullFetch: boolean): Promise<SyncResult> {
  try {
    const rootRef = db.collection(SYMBOL_DATA_COLLECTION).doc(symbol);
    const rootSnap = await rootRef.get();
    const existingRoot = rootSnap.exists ? (rootSnap.data() as any) : null;

    const isStale = !existingRoot?.lastDailyBarDate || daysSince(existingRoot.lastDailyBarDate) > STALE_THRESHOLD_DAYS;
    const doFullFetch = forceFullFetch || isStale || !existingRoot;

    const toDate = todayIso();
    const fetchParams = doFullFetch
      ? {
          daily:   { from: dateYearsAgo(DAILY_BACKFILL_YEARS),  to: toDate },
          weekly:  { from: dateYearsAgo(WEEKLY_BACKFILL_YEARS),  to: toDate },
          monthly: { from: dateYearsAgo(MONTHLY_BACKFILL_YEARS), to: toDate },
        }
      : {
          daily:   { limit: INCREMENTAL_DAILY_LIMIT },
          weekly:  { limit: INCREMENTAL_WEEKLY_LIMIT },
          monthly: { limit: INCREMENTAL_MONTHLY_LIMIT },
        };

    const [rawDaily, rawWeekly, rawMonthly] = await Promise.all([
      callPartnerTimeSeries({ symbol, interval: 'DAILY',   adjusted: true, ...fetchParams.daily   }).catch(() => null),
      callPartnerTimeSeries({ symbol, interval: 'WEEKLY',  adjusted: true, ...fetchParams.weekly  }).catch(() => null),
      callPartnerTimeSeries({ symbol, interval: 'MONTHLY', adjusted: true, ...fetchParams.monthly }).catch(() => null),
    ]);

    const incomingDaily   = ((rawDaily   as any)?.bars ?? []).map(normalizeBar).filter(Boolean) as OhlcBar[];
    const incomingWeekly  = ((rawWeekly  as any)?.bars ?? []).map(normalizeBar).filter(Boolean) as OhlcBar[];
    const incomingMonthly = ((rawMonthly as any)?.bars ?? []).map(normalizeBar).filter(Boolean) as OhlcBar[];

    if (incomingDaily.length === 0) {
      logger.warn('symbol_data_sync_no_daily_bars', { symbol });
      return { symbol, status: 'skipped' };
    }

    // -----------------------------------------------------------------------
    // Daily — fan incoming bars into per-year subcollection docs
    // -----------------------------------------------------------------------

    // Group incoming daily bars by calendar year
    const incomingByYear = new Map<number, OhlcBar[]>();
    for (const bar of incomingDaily) {
      const year = Number(bar.d.slice(0, 4));
      if (!incomingByYear.has(year)) incomingByYear.set(year, []);
      incomingByYear.get(year)!.push(bar);
    }

    // For each affected year, read existing shard, merge, write back
    for (const [year, newBars] of incomingByYear) {
      const shardRef = rootRef.collection(SYMBOL_BARS_DAILY_SUBCOL).doc(String(year));

      if (doFullFetch) {
        // Full fetch: overwrite the shard entirely — no need to read first
        const shardDoc: SymbolBarsYearDoc = {
          year,
          interval: 'daily',
          bars: newBars.sort((a, b) => a.d.localeCompare(b.d)),
          updatedAt: FieldValue.serverTimestamp(),
        };
        await shardRef.set(shardDoc);
      } else {
        // Incremental: merge with existing shard bars
        const existingShard = await shardRef.get();
        const existingBars: OhlcBar[] = existingShard.exists
          ? ((existingShard.data() as SymbolBarsYearDoc).bars ?? [])
          : [];
        const merged = mergeBars(existingBars, newBars);
        await shardRef.set({
          year,
          interval: 'daily',
          bars: merged,
          updatedAt: FieldValue.serverTimestamp(),
        } as SymbolBarsYearDoc);
      }
    }

    // -----------------------------------------------------------------------
    // Weekly + monthly — single flat doc per interval in own subcollection
    // symbol-data/{SYMBOL}/weekly/all  and  symbol-data/{SYMBOL}/monthly/all
    // -----------------------------------------------------------------------

    const weeklyDocRef  = rootRef.collection(SYMBOL_BARS_WEEKLY_SUBCOL).doc(SYMBOL_BARS_FLAT_DOC_ID);
    const monthlyDocRef = rootRef.collection(SYMBOL_BARS_MONTHLY_SUBCOL).doc(SYMBOL_BARS_FLAT_DOC_ID);

    let finalWeekly: OhlcBar[];
    let finalMonthly: OhlcBar[];

    if (doFullFetch) {
      finalWeekly  = incomingWeekly;
      finalMonthly = incomingMonthly;
    } else {
      const [weeklySnap, monthlySnap] = await Promise.all([weeklyDocRef.get(), monthlyDocRef.get()]);
      const existingWeekly  = (weeklySnap.exists  ? (weeklySnap.data()  as any)?.bars ?? [] : []) as OhlcBar[];
      const existingMonthly = (monthlySnap.exists ? (monthlySnap.data() as any)?.bars ?? [] : []) as OhlcBar[];
      finalWeekly  = mergeBars(existingWeekly,  incomingWeekly);
      finalMonthly = mergeBars(existingMonthly, incomingMonthly);
    }

    await Promise.all([
      weeklyDocRef.set({ interval: 'weekly', bars: finalWeekly,  updatedAt: FieldValue.serverTimestamp() }),
      monthlyDocRef.set({ interval: 'monthly', bars: finalMonthly, updatedAt: FieldValue.serverTimestamp() }),
    ]);

    const lastDailyBarDate   = incomingDaily.at(-1)?.d ?? existingRoot?.lastDailyBarDate ?? '';
    const lastWeeklyBarDate  = finalWeekly.at(-1)?.d   ?? '';
    const lastMonthlyBarDate = finalMonthly.at(-1)?.d  ?? '';

    await rootRef.set(
      {
        lastDailyBarDate,
        lastWeeklyBarDate,
        lastMonthlyBarDate,
        lastBarSyncedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );

    // -----------------------------------------------------------------------
    // rh-agent-symbols upsert — keeps agent enable list in sync automatically
    // -----------------------------------------------------------------------
    await db.collection(RH_AGENT_SYMBOLS_COLLECTION).doc(symbol).set(
      { symbol, enabled: true },
      { merge: true },
    );

    logger.info('symbol_data_sync_symbol_done', {
      symbol,
      dailyYears: incomingByYear.size,
      weeklyCount: finalWeekly.length,
      monthlyCount: finalMonthly.length,
      lastDailyBarDate,
    });

    return {
      symbol,
      status: 'ok',
      dailyCount: incomingDaily.length,
      weeklyCount: finalWeekly.length,
      monthlyCount: finalMonthly.length,
    };
  } catch (err: any) {
    logger.error('symbol_data_sync_symbol_error', { symbol, error: err?.message });
    return { symbol, status: 'error', error: err?.message };
  }
}

// ============================================================================
// Task worker — processes one symbol per invocation
// ============================================================================

export const symbolDataSyncSymbol = onTaskDispatched<SymbolDataSyncPayload>(
  {
    retryConfig: { maxAttempts: 3, minBackoffSeconds: 5, maxBackoffSeconds: 60 },
    rateLimits: { maxConcurrentDispatches: 50, maxDispatchesPerSecond: 20 },
    memory: '512MiB',
    timeoutSeconds: 120,
  },
  async (req) => {
    const { symbol, forceFullFetch, syncRunId, totalSymbols, marketDate } = req.data;
    const result = await syncSymbolToSymbolData(symbol, forceFullFetch);
    logger.info('symbol_data_sync_symbol_done', result);

    // If this sync has a tracking doc, increment counter and check for completion
    if (syncRunId && totalSymbols && marketDate) {
      await checkSyncRunCompletion(syncRunId, totalSymbols, marketDate);
    }
  }
);

// ============================================================================
// Scheduled trigger — runs nightly Mon-Fri at 6 PM PT (01:00 UTC next day)
// ============================================================================

export const symbolDataSyncNightly = onSchedule({
  schedule: '0 1 * * 2-6', // 1:00 AM UTC Tue-Sat = 6 PM PT Mon-Fri
  timeZone: 'Etc/UTC',
  timeoutSeconds: 60,
  memory: '256MiB',
}, async () => {
  logger.info('symbol_data_sync_nightly_triggered');
  await enqueueAllSymbols(false, undefined, true); // true = trigger agent run when done
});

// ============================================================================
// Admin HTTP request — manual trigger for backfill or re-sync, returns immediately
// ============================================================================

interface SymbolDataSyncAdminRequest {
  forceFullFetch?: boolean;
  symbols?: string[];
}

const adminFunctionUrl = 'https://us-central1-rel-str.cloudfunctions.net/symbolDataSyncAdminHttp';
const oauth2Client = new OAuth2Client();

async function verifyAdminToken(authHeader?: string): Promise<boolean> {
  if (!authHeader?.startsWith('Bearer ')) return false;
  const token = authHeader.split(' ')[1];
  try {
    const ticket = await oauth2Client.verifyIdToken({ idToken: token, audience: adminFunctionUrl });
    return !!ticket.getPayload();
  } catch (err: any) {
    logger.error('symbol_data_sync_admin_token_error', { error: err?.message });
    return false;
  }
}

export const symbolDataSyncAdminHttp = onRequest(
  { timeoutSeconds: 60, memory: '512MiB' },
  async (request, response) => {
    if (!(await verifyAdminToken(request.headers.authorization))) {
      response.status(401).json({ error: 'Unauthenticated' });
      return;
    }

    const { forceFullFetch = false, symbols } = (request.body ?? {}) as SymbolDataSyncAdminRequest;
    logger.info('symbol_data_sync_admin_called', { forceFullFetch, symbolCount: symbols?.length ?? 'all' });
    const result = await enqueueAllSymbols(forceFullFetch, symbols); // Admin runs don't trigger agent
    response.status(200).json({ ...result, message: `Enqueued ${result.enqueued} symbols for processing` });
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
  const runRef = db.collection(SYMBOL_DATA_SYNC_RUNS_COLLECTION).doc(syncRunId);
  await runRef.set(
    { processedCount: FieldValue.increment(1) },
    { merge: true }
  );

  const snap = await runRef.get();
  const processed = (snap.data() as any)?.processedCount ?? 0;

  logger.info('symbol_data_sync_run_progress', { syncRunId, processed, totalSymbols });

  if (processed >= totalSymbols) {
    logger.info('symbol_data_sync_run_complete', { syncRunId, marketDate });
    await runRef.set({ completedAt: FieldValue.serverTimestamp() }, { merge: true });
    try {
      await startRhAgentRun(marketDate, 'nightly');
      logger.info('symbol_data_sync_agent_run_triggered', { syncRunId, marketDate });
    } catch (err: any) {
      logger.error('symbol_data_sync_agent_run_failed', { syncRunId, marketDate, error: err?.message });
    }
  }
}

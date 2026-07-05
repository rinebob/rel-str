/**
 * RS Bars Nightly Sync
 *
 * Fetches full D/W/M price history from SavantAPI for all tracked symbols
 * and writes to rs-bars/{SYMBOL} in Firestore.
 *
 * Architecture:
 *   - rsBarsSyncAdmin (HTTP request) / rsBarsSyncNightly (scheduler)
 *       → loads all symbols, enqueues one Cloud Task per symbol, returns immediately
 *   - rsBarsSyncSymbol (task worker)
 *       → fetches D/W/M bars from SA for one symbol, writes to rs-bars/{SYMBOL}
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
import { HolidaySet, loadUsHolidaySetForWindow, addDays, isTradingDay } from '../webhooks/calendar';

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

export interface RsBarsDoc {
  symbol: string;
  daily: OhlcBar[];
  weekly: OhlcBar[];
  monthly: OhlcBar[];
  version: string;
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

/** Advance a date to the next trading day (skipping weekends and holidays). */
function rollToNextTradingDay(ymd: string, holidays: HolidaySet): string {
  let d = ymd;
  while (!isTradingDay(d, holidays)) {
    d = addDays(d, 1);
  }
  return d;
}

/** Return the last calendar day of the month for a given YYYY-MM-DD. */
function lastDayOfMonth(ymd: string): string {
  const dt = new Date(`${ymd.slice(0, 7)}-01T00:00:00.000Z`);
  dt.setUTCMonth(dt.getUTCMonth() + 1);
  dt.setUTCDate(dt.getUTCDate() - 1);
  const y = dt.getUTCFullYear();
  const m = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const d = String(dt.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * Validate that a set of bars matches the expected interval by walking the
 * last 6 bars and checking each against the expected calendar date, rolling
 * forward past weekends and holidays.
 *
 * DAILY:   every bar must itself be a trading day.
 * WEEKLY:  each bar must be the expected date: anchor + 7 days, rolled forward
 *          if it lands on a weekend/holiday.
 * MONTHLY: each bar must be the last calendar day of the month, rolled forward
 *          to the next trading day if needed.
 *
 * Returns true if bars look correct for the interval, false if they appear
 * to be the wrong timeframe (e.g. partner returned daily bars for a WEEKLY query).
 */
function validateBarInterval(
  bars: OhlcBar[],
  interval: 'DAILY' | 'WEEKLY' | 'MONTHLY',
  holidays: HolidaySet,
): boolean {
  if (bars.length < 2) return true; // not enough data to validate
  const tail = bars.slice(-6); // up to 6 bars

  if (interval === 'DAILY') {
    return tail.every((bar) => isTradingDay(bar.d, holidays));
  }

  if (interval === 'WEEKLY') {
    const anchor = tail[0].d;
    for (let i = 0; i < tail.length; i++) {
      const expected = addDays(anchor, i * 7);
      const rolled = rollToNextTradingDay(expected, holidays);
      if (tail[i].d !== rolled) return false;
    }
    return true;
  }

  if (interval === 'MONTHLY') {
    let expected = lastDayOfMonth(tail[0].d);
    for (let i = 0; i < tail.length; i++) {
      const rolled = rollToNextTradingDay(expected, holidays);
      if (tail[i].d !== rolled) return false;
      // Advance to the last day of the next month.
      expected = lastDayOfMonth(addDays(rolled, 1));
    }
    return true;
  }

  return true;
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

/** Compute min/max YYYY-MM-DD across any number of bar arrays. */
function dateRangeFromBars(...arrays: OhlcBar[][]): { fromDay: string; toDay: string } | null {
  let fromDay = '';
  let toDay = '';
  for (const bars of arrays) {
    for (const bar of bars) {
      if (!fromDay || bar.d < fromDay) fromDay = bar.d;
      if (!toDay || bar.d > toDay) toDay = bar.d;
    }
  }
  if (!fromDay || !toDay) return null;
  return { fromDay, toDay };
}

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

    // Load holiday set for the incoming bar window so interval validation can skip closed days.
    const barRange = dateRangeFromBars(incomingDaily, incomingWeekly, incomingMonthly);
    const holidays: HolidaySet = barRange ? await loadUsHolidaySetForWindow(barRange) : new Set();

    // Validate interval shapes — reject bars that don't match expected frequency
    const dailyValid   = incomingDaily.length   === 0 || validateBarInterval(incomingDaily,   'DAILY',   holidays);
    const weeklyValid  = incomingWeekly.length  === 0 || validateBarInterval(incomingWeekly,  'WEEKLY',  holidays);
    const monthlyValid = incomingMonthly.length === 0 || validateBarInterval(incomingMonthly, 'MONTHLY', holidays);
    if (!dailyValid)   logger.error('rs_bars_sync_interval_mismatch', { symbol, interval: 'DAILY',   count: incomingDaily.length });
    if (!weeklyValid)  logger.error('rs_bars_sync_interval_mismatch', { symbol, interval: 'WEEKLY',  count: incomingWeekly.length });
    if (!monthlyValid) logger.error('rs_bars_sync_interval_mismatch', { symbol, interval: 'MONTHLY', count: incomingMonthly.length });

    // Merge with existing (or use fresh if full fetch); skip corrupted intervals
    const daily   = doFullFetch
      ? (dailyValid   ? incomingDaily   : [])
      : mergeBars(existing?.daily   ?? [], dailyValid   ? incomingDaily   : []);
    const weekly  = doFullFetch
      ? (weeklyValid  ? incomingWeekly  : [])
      : mergeBars(existing?.weekly  ?? [], weeklyValid  ? incomingWeekly  : []);
    const monthly = doFullFetch
      ? (monthlyValid ? incomingMonthly : [])
      : mergeBars(existing?.monthly ?? [], monthlyValid ? incomingMonthly : []);

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
      version: new Date().toISOString(),
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
    memory: '512MiB',
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
// Admin HTTP request — manual trigger for backfill or re-sync, returns immediately
// ============================================================================

interface RsBarsSyncAdminRequest {
  forceFullFetch?: boolean;
  symbols?: string[];
}

const adminFunctionUrl = 'https://us-central1-rel-str.cloudfunctions.net/rsBarsSyncAdminHttp';
const oauth2Client = new OAuth2Client();

async function verifyAdminToken(authHeader?: string): Promise<boolean> {
  if (!authHeader?.startsWith('Bearer ')) return false;
  const token = authHeader.split(' ')[1];
  try {
    const ticket = await oauth2Client.verifyIdToken({ idToken: token, audience: adminFunctionUrl });
    return !!ticket.getPayload();
  } catch (err: any) {
    logger.error('rsBarsSyncAdmin token verification failed', { error: err?.message });
    return false;
  }
}

export const rsBarsSyncAdminHttp = onRequest(
  { timeoutSeconds: 60, memory: '512MiB' },
  async (request, response) => {
    if (!(await verifyAdminToken(request.headers.authorization))) {
      response.status(401).json({ error: 'Unauthenticated' });
      return;
    }

    const { forceFullFetch = false, symbols } = (request.body ?? {}) as RsBarsSyncAdminRequest;
    logger.info('rsBarsSyncAdminHttp called', { forceFullFetch, symbolCount: symbols?.length ?? 'all' });
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

/**
 * Symbol-Data Backfill Core
 *
 * Pure backfill logic for fetching a symbol's D/W/M price history from the
 * partner and writing it into symbol-data/{SYMBOL}. This module has no Cloud
 * Function definitions; it is imported by the task worker, the Pub/Sub symbol-
 * added consumer, and any other orchestration entry points.
 */
import { logger } from 'firebase-functions';
import { FieldValue } from 'firebase-admin/firestore';
import { db } from '../firebase-admin-init';
import { callPartnerTimeSeries } from '../partner-proxy';
import type { OhlcBar } from '../common/market-data-types';
import { normalizeBar, mergeBars } from './symbol-data-bar-helpers';
import { writeWeeklyMonthlyBars } from './symbol-data-writer';
import { getMarketDatePT } from '../common/pt-date-utils';
import {
  SYMBOL_DATA_COLLECTION,
  SYMBOL_BARS_DAILY_SUBCOL,
} from '../webhooks/webhooks-config';

// ============================================================================
// Constants
// ============================================================================

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

export interface SyncResult {
  symbol: string;
  status: 'ok' | 'error' | 'skipped';
  dailyCount?: number;
  weeklyCount?: number;
  monthlyCount?: number;
  error?: string;
}

/**
 * Year-shard doc stored under symbol-data/{SYMBOL}/daily/{YYYY}.
 * Weekly and monthly remain as flat arrays in own subcollections (bounded in size).
 */
export interface SymbolBarsYearDoc {
  year: number;
  interval: 'daily';
  bars: OhlcBar[];
  updatedAt: FieldValue;
}

// ============================================================================
// Date helpers
// ============================================================================

function dateYearsAgo(years: number): string {
  const d = new Date();
  d.setFullYear(d.getFullYear() - years);
  return d.toISOString().slice(0, 10);
}

export function todayIso(): string {
  return getMarketDatePT();
}

function daysSince(dateStr: string): number {
  const then = new Date(dateStr).getTime();
  return Math.floor((Date.now() - then) / 86_400_000);
}

// ============================================================================
// Backfill one symbol
// ============================================================================

/**
 * Sync one symbol into the symbol-data schema:
 *   - symbol-data/{SYMBOL}/daily/{YYYY}  — year-sharded OhlcBar[]
 *   - symbol-data/{SYMBOL}/weekly/all    — flat OhlcBar[] (bounded, single doc)
 *   - symbol-data/{SYMBOL}/monthly/all   — flat OhlcBar[] (bounded, single doc)
 *   - symbol-data/{SYMBOL} metadata      — lastDailyBarDate, lastWeeklyBarDate, etc.
 *
 * Pure data-sync: no side-effects on other collections.
 * Staleness and incremental logic mirrors the original syncSymbol behavior.
 */
export async function syncSymbolToSymbolData(symbol: string, forceFullFetch: boolean): Promise<SyncResult> {
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
    // SA re-dates incomplete weekly/monthly bars on every trading day. The shared
    // writer merges by date and dedups by period so we keep only the latest bar
    // per period. It also writes atomically via a Firestore transaction.
    const { finalWeekly, finalMonthly } = await writeWeeklyMonthlyBars(symbol, incomingWeekly, incomingMonthly);

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

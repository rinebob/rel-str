/**
 * SDS task worker core — processes one symbol for one interval.
 *
 * Separated from the Cloud Function entry point for testability with injected
 * dependencies (mock Firestore, mock SA fetch).
 */

import { FieldValue } from 'firebase-admin/firestore';
import { logger } from 'firebase-functions';
import type { OhlcBar } from '../common/market-data-types';
import { mergeBars } from './symbol-data-bar-helpers';
import {
  SYMBOL_DATA_COLLECTION,
  SYMBOL_BARS_DAILY_SUBCOL,
  SYMBOL_BARS_WEEKLY_SUBCOL,
  SYMBOL_BARS_MONTHLY_SUBCOL,
  SYMBOL_BARS_FLAT_DOC_ID,
} from '../webhooks/webhooks-config';

export interface SdsWorkerPayload {
  symbol: string;
  interval: string;
  runId: string;
  sequenceRunId: string | undefined;
  sequence: string | undefined;
  marketDate: string;
}

export interface SdsWorkerResult {
  symbol: string;
  status: 'ok' | 'error' | 'skipped';
  barCount?: number;
  error?: string;
}

/** Shape of a year-shard or flat interval doc in Firestore. */
interface SymbolBarsDoc {
  year?: number;
  interval: string;
  bars: OhlcBar[];
  updatedAt: typeof FieldValue;
}

export interface SdsWorkerDeps {
  db: FirebaseFirestore.Firestore;
  fetchBars: (symbol: string, interval: string) => Promise<OhlcBar[]>;
}

export async function processSymbolInterval(
  payload: SdsWorkerPayload,
  deps: SdsWorkerDeps,
): Promise<SdsWorkerResult> {
  const { symbol, interval } = payload;

  try {
    const bars = await deps.fetchBars(symbol, interval);
    if (bars.length === 0) {
      logger.warn('sds_worker_no_bars', { symbol, interval, runId: payload.runId });
      return { symbol, status: 'skipped' };
    }

    const rootRef = deps.db.collection(SYMBOL_DATA_COLLECTION).doc(symbol);

    if (interval === 'DAILY') {
      const { lastDailyBarDate } = await writeDailyShards(rootRef, bars);
      // Write currentPrice from latest daily bar
      const latest = bars[bars.length - 1];
      await rootRef.set(
        {
          currentPrice: { price: latest.c, date: latest.d, time: '16:00' },
          lastDailyBarDate,
          lastBarSyncedAt: FieldValue.serverTimestamp(),
        },
        { merge: true },
      );
    } else if (interval === 'WEEKLY') {
      const weeklyRef = rootRef.collection(SYMBOL_BARS_WEEKLY_SUBCOL).doc(SYMBOL_BARS_FLAT_DOC_ID);
      const { lastBarDate } = await writeMergedFlatDoc(weeklyRef, bars, 'weekly');
      await rootRef.set(
        { lastWeeklyBarDate: lastBarDate, lastBarSyncedAt: FieldValue.serverTimestamp() },
        { merge: true },
      );
    } else if (interval === 'MONTHLY') {
      const monthlyRef = rootRef.collection(SYMBOL_BARS_MONTHLY_SUBCOL).doc(SYMBOL_BARS_FLAT_DOC_ID);
      const { lastBarDate } = await writeMergedFlatDoc(monthlyRef, bars, 'monthly');
      await rootRef.set(
        { lastMonthlyBarDate: lastBarDate, lastBarSyncedAt: FieldValue.serverTimestamp() },
        { merge: true },
      );
    }

    logger.info('sds_worker_done', { symbol, interval, barCount: bars.length, runId: payload.runId });
    return { symbol, status: 'ok', barCount: bars.length };
  } catch (err: any) {
    logger.error('sds_worker_error', { symbol, interval, runId: payload.runId, error: err?.message });
    return { symbol, status: 'error', error: err?.message };
  }
}

async function writeDailyShards(
  rootRef: FirebaseFirestore.DocumentReference,
  bars: OhlcBar[],
): Promise<{ lastDailyBarDate: string }> {
  const byYear = new Map<number, OhlcBar[]>();
  for (const bar of bars) {
    const year = Number(bar.d.slice(0, 4));
    if (!byYear.has(year)) byYear.set(year, []);
    byYear.get(year)!.push(bar);
  }

  let lastDailyBarDate = '';
  for (const [year, newBars] of byYear) {
    const shardRef = rootRef.collection(SYMBOL_BARS_DAILY_SUBCOL).doc(String(year));
    const existing = await shardRef.get();
    const existingBars: OhlcBar[] = existing.exists ? ((existing.data() as SymbolBarsDoc)?.bars ?? []) : [];
    const merged = mergeBars(existingBars, newBars);
    await shardRef.set({
      year,
      interval: 'daily',
      bars: merged,
      updatedAt: FieldValue.serverTimestamp(),
    });
    if (merged.length > 0 && merged[merged.length - 1].d > lastDailyBarDate) {
      lastDailyBarDate = merged[merged.length - 1].d;
    }
  }

  return { lastDailyBarDate };
}

async function writeMergedFlatDoc(
  docRef: FirebaseFirestore.DocumentReference,
  bars: OhlcBar[],
  interval: string,
): Promise<{ lastBarDate: string }> {
  const existing = await docRef.get();
  const existingBars: OhlcBar[] = existing.exists ? ((existing.data() as SymbolBarsDoc)?.bars ?? []) : [];
  const merged = mergeBars(existingBars, bars);
  await docRef.set({
    interval,
    bars: merged,
    updatedAt: FieldValue.serverTimestamp(),
  }, { merge: true });
  const lastBarDate = merged.length > 0 ? merged[merged.length - 1].d : '';
  return { lastBarDate };
}

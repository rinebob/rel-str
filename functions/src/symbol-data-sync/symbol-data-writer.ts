/**
 * Shared symbol-data writer helpers.
 *
 * Centralizes the Firestore write path for weekly/monthly bar documents so the
 * nightly sync and the intraday W/M refresh do not duplicate the same read/merge
 * /dedup/set sequence.
 */
import { FieldValue } from 'firebase-admin/firestore';
import { db } from '../firebase-admin-init';
import type { OhlcBar } from '../common/market-data-types';
import {
  SYMBOL_DATA_COLLECTION,
  SYMBOL_BARS_WEEKLY_SUBCOL,
  SYMBOL_BARS_MONTHLY_SUBCOL,
  SYMBOL_BARS_FLAT_DOC_ID,
} from '../webhooks/webhooks-config';
import { mergeBars, dedupByPeriod, isoWeekKey, monthKey } from './symbol-data-bar-helpers';

/**
 * Atomically write merged and period-deduplicated weekly/monthly bars to
 * symbol-data/{symbol}/weekly/all and monthly/all. Existing fields on the doc
 * are preserved via { merge: true }.
 */
export async function writeWeeklyMonthlyBars(
  symbol: string,
  incomingWeekly: OhlcBar[],
  incomingMonthly: OhlcBar[],
): Promise<{ finalWeekly: OhlcBar[]; finalMonthly: OhlcBar[] }> {
  const rootRef = db.collection(SYMBOL_DATA_COLLECTION).doc(symbol);
  const weeklyDocRef = rootRef.collection(SYMBOL_BARS_WEEKLY_SUBCOL).doc(SYMBOL_BARS_FLAT_DOC_ID);
  const monthlyDocRef = rootRef.collection(SYMBOL_BARS_MONTHLY_SUBCOL).doc(SYMBOL_BARS_FLAT_DOC_ID);

  let finalWeekly: OhlcBar[] = [];
  let finalMonthly: OhlcBar[] = [];

  await db.runTransaction(async (t) => {
    const [weeklySnap, monthlySnap] = await Promise.all([t.get(weeklyDocRef), t.get(monthlyDocRef)]);
    const existingWeekly = (weeklySnap.exists ? (weeklySnap.data() as any)?.bars ?? [] : []) as OhlcBar[];
    const existingMonthly = (monthlySnap.exists ? (monthlySnap.data() as any)?.bars ?? [] : []) as OhlcBar[];

    finalWeekly = dedupByPeriod(mergeBars(existingWeekly, incomingWeekly), isoWeekKey);
    finalMonthly = dedupByPeriod(mergeBars(existingMonthly, incomingMonthly), monthKey);

    t.set(weeklyDocRef, { interval: 'weekly', bars: finalWeekly, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    t.set(monthlyDocRef, { interval: 'monthly', bars: finalMonthly, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
  });

  return { finalWeekly, finalMonthly };
}

/**
 * @topic #108 — Options Position Strategy Engine
 * @topic #137 — Strategy Builder UI
 *
 * Helpers for reading underlying price data used by the options strategy passes.
 */

import { db } from '../firebase-admin-init';
import {
  SYMBOL_DATA_COLLECTION,
  SYMBOL_BARS_DAILY_SUBCOL,
} from '../webhooks/webhooks-config';
import type { OhlcBar } from '../common/market-data-types';

/**
 * Read the most recent underlying price from symbol-data/{symbol}.
 * Uses the `currentPrice` field written by the symbol-data-sync pipeline.
 */
export async function getUnderlyingClose(symbol: string): Promise<number | null> {
  const doc = await db.collection(SYMBOL_DATA_COLLECTION).doc(symbol).get();
  if (!doc.exists) return null;
  const data = doc.data() as { currentPrice?: number };
  return data.currentPrice ?? null;
}

/**
 * Read the underlying closing price for a specific market date from the
 * year-sharded daily bars: symbol-data/{symbol}/daily/{YYYY} (bars[].c where
 * bars[].d === date). Returns null when no bar exists for the date (holiday,
 * data delay) so callers can defer settlement rather than resolve with stale
 * data.
 */
export async function getUnderlyingCloseForDate(
  symbol: string,
  date: string,
): Promise<number | null> {
  const year = date.slice(0, 4);
  const doc = await db
    .collection(SYMBOL_DATA_COLLECTION)
    .doc(symbol)
    .collection(SYMBOL_BARS_DAILY_SUBCOL)
    .doc(year)
    .get();
  if (!doc.exists) return null;
  const data = doc.data() as { bars?: OhlcBar[] };
  const bar = (data.bars ?? []).find((b) => b.d === date);
  return bar ? bar.c : null;
}

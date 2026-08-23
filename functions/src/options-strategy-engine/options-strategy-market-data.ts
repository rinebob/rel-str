/**
 * @topic #108 — Options Position Strategy Engine
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
 * Uses the `currentPrice` field written by the symbol-data-sync (SDS) pipeline.
 *
 * NOTE: `currentPrice` is written by SDS as an object
 * `{ price, date, time }`, not a bare number. This helper extracts `.price`.
 */
export async function getUnderlyingClose(symbol: string): Promise<number | null> {
  const doc = await db.collection(SYMBOL_DATA_COLLECTION).doc(symbol).get();
  if (!doc.exists) return null;
  const data = doc.data() as {
    currentPrice?: number | { price?: number };
  };

  const cp = data.currentPrice;
  if (typeof cp === 'number' && Number.isFinite(cp) && cp > 0) {
    return cp;
  }
  if (cp && typeof cp === 'object' && typeof cp.price === 'number' && cp.price > 0) {
    return cp.price;
  }
  return null;
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

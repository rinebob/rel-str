/**
 * @topic #108 — Options Position Strategy Engine
 *
 * Helpers for reading underlying price data used by the options strategy passes.
 */

import { db } from '../../firebase-admin-init';
import {
  SYMBOL_DATA_COLLECTION,
  SYMBOL_BARS_DAILY_SUBCOL,
} from '../../webhooks/webhooks-config';
import type { OhlcBar } from '../../common/market-data-types';

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
 * data delay) — settlement callers should use `getUnderlyingCloseOnOrBefore`,
 * which walks back to the latest trading day instead of erroring.
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

/** Reader shape shared by every underlying-close caller. */
export type UnderlyingCloseReader = (
  symbol: string,
  date: string,
) => Promise<number | null>;

/** Default walk-back for `getUnderlyingCloseOnOrBefore` (calendar days) —
 *  covers a Friday expiration inside a holiday weekend. */
export const SETTLE_CLOSE_LOOKBACK_DAYS = 7;

export interface LatestCloseOptions {
  /** Close reader — defaults to the SDS daily-bar lookup. */
  reader?: UnderlyingCloseReader;
  /** How far back to walk (calendar days). Default 7 — covers a Friday
   *  expiration inside a holiday weekend. */
  lookbackDays?: number;
  /** Never accept a close before this date (e.g. the position's open date) —
   *  a pre-entry close is a stale basis for settlement. */
  minDate?: string;
}

/**
 * Latest underlying close ON OR BEFORE `settleDate`, walking back
 * `lookbackDays` calendar days. Weekend/holiday expirations have no bar on
 * the date itself; without the walk-back those trades error forever
 * (#720 signal path, #724 engine path). Non-positive or non-finite closes
 * are treated as missing — a corrupt 0 would misprice settlement. Returns
 * the observed bar's date so callers can date marks/fills honestly.
 */
export async function getUnderlyingCloseOnOrBefore(
  symbol: string,
  settleDate: string,
  opts: LatestCloseOptions = {},
): Promise<{ date: string; price: number } | null> {
  const reader = opts.reader ?? getUnderlyingCloseForDate;
  const lookback = opts.lookbackDays ?? SETTLE_CLOSE_LOOKBACK_DAYS;
  for (let back = 0; back <= lookback; back++) {
    const d = new Date(`${settleDate}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() - back);
    const date = d.toISOString().slice(0, 10);
    if (opts.minDate && date < opts.minDate) break;
    const price = await reader(symbol, date);
    if (price !== null && Number.isFinite(price) && price > 0) {
      return { date, price };
    }
  }
  return null;
}

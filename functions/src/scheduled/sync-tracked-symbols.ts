import { onSchedule } from 'firebase-functions/v2/scheduler';
import { logger } from 'firebase-functions';

import { db } from '../firebase-admin-init';
import { SYMBOL_DATA_COLLECTION, RsCloudFunctionName } from '../webhooks/webhooks-config';
import { callPartnerTrackedSymbols } from '../partner-proxy';
import type { TrackedSymbolDTO } from '../types/partner';
import { fetchAllSymbols } from '../webhooks/symbol-fetch';
import { upsertSymbolCurrentPrice } from '../webhooks/partner-webhooks';
import { persistWarning } from '../logging/warn';

/**
 * Daily sync: mirror Savant tracked-symbols universe into symbol-data and
 * refresh currentPrice for each symbol once per day.
 *
 * - Reads tracked symbols via callPartnerTrackedSymbols (same upstream as getTrackedSymbols callable).
 * - Upserts basic metadata into symbol-data/{SYMBOL} docs.
 * - Fetches recent DAILY bars and writes the most recent close into
 *   symbol-data/{SYMBOL}.currentPrice using the existing helper.
 */
export const syncTrackedSymbolsDaily = onSchedule({
  schedule: '0 3 * * *', // 1x per day at ~03:00 UTC (tune as needed)
  timeZone: 'Etc/UTC',
}, async () => {
  logger.info('syncTrackedSymbolsDaily start');

  let items: TrackedSymbolDTO[] = [];
  try {
    const upstream: any = await callPartnerTrackedSymbols();

    const rawItems: any[] = Array.isArray(upstream)
      ? upstream
      : Array.isArray(upstream?.items)
        ? upstream.items
        : Array.isArray(upstream?.symbols)
          ? upstream.symbols
          : [];

    items = rawItems.map((r: any) => ({
      symbol: String(r?.symbol || r?.id || '').toUpperCase(),
      name: r?.name ?? r?.company ?? undefined,
      exchange: r?.exchange ?? undefined,
      sector: r?.sector ?? undefined,
      supported: r?.supported !== false,
      isBaseline: r?.isBaseline === true,
    }));
  } catch (e: any) {
    logger.error('syncTrackedSymbolsDaily_upstream_failed', { message: e?.message, status: e?.response?.status });
    await persistWarning('sync_tracked_symbols_upstream_failed', { function: RsCloudFunctionName.GET_TRACKED_SYMBOLS, message: e?.message });
    return;
  }

  if (!items.length) {
    logger.warn('syncTrackedSymbolsDaily_no_items');
    return;
  }

  const uniqueSymbols = Array.from(new Set(items.map((it) => it.symbol).filter(Boolean)));
  logger.info('syncTrackedSymbolsDaily_symbols_resolved', { count: uniqueSymbols.length });

  // Upsert basic symbol metadata into symbol-data docs (non-destructive, merge only).
  for (const item of items) {
    if (!item.symbol) continue;
    const ref = db.collection(SYMBOL_DATA_COLLECTION).doc(item.symbol);
    try {
      await ref.set(
        {
          symbol: item.symbol,
          name: item.name ?? null,
          exchange: item.exchange ?? null,
          sector: item.sector ?? null,
        },
        { merge: true },
      );
    } catch (e: any) {
      logger.warn('syncTrackedSymbolsDaily_symbol_meta_upsert_failed', { symbol: item.symbol, message: e?.message });
    }
  }

  // Fetch recent DAILY bars for price snapshot. Use a short window (last few days)
  // to be robust to holidays/weekends.
  const today = new Date();
  const to = today.toISOString().slice(0, 10);
  const fromDate = new Date(today.getTime() - 5 * 24 * 60 * 60 * 1000);
  const from = fromDate.toISOString().slice(0, 10);

  let barsBySymbol: Map<string, any[]> = new Map();
  try {
    barsBySymbol = await fetchAllSymbols(uniqueSymbols, undefined, { from, to, interval: 'DAILY' });
  } catch (e: any) {
    logger.error('syncTrackedSymbolsDaily_fetchAllSymbols_failed', { message: e?.message });
    await persistWarning('sync_tracked_symbols_fetch_all_failed', { function: RsCloudFunctionName.GET_TRACKED_SYMBOLS, message: e?.message });
    return;
  }

  let updatedPrices = 0;

  for (const sym of uniqueSymbols) {
    const bars = barsBySymbol.get(sym) || [];
    if (!Array.isArray(bars) || !bars.length) continue;

    const lastBar = bars[bars.length - 1] as any;
    const ts = Number(lastBar?.t);
    const close = Number(lastBar?.ac ?? lastBar?.c ?? 0);
    if (!Number.isFinite(ts) || !Number.isFinite(close) || close <= 0) continue;

    const iso = new Date(ts).toISOString();
    const date = iso.slice(0, 10); // YYYY-MM-DD
    const time = iso.slice(11, 16); // HH:mm

    try {
      await upsertSymbolCurrentPrice(sym, { price: close, date, time });
      updatedPrices += 1;
    } catch (e: any) {
      logger.warn('syncTrackedSymbolsDaily_price_upsert_failed', { symbol: sym, message: e?.message });
    }
  }

  logger.info('syncTrackedSymbolsDaily_complete', {
    symbols: uniqueSymbols.length,
    updatedPrices,
  });
});

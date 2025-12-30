import { onRequest } from 'firebase-functions/v2/https';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { logger } from 'firebase-functions';
import { db } from '../firebase-admin-init';
import { fetchDailyBarsRange, type PartnerBar } from '../webhooks/symbol-fetch';

interface TradeDoc {
  symbol?: string;
}

async function loadSymbolsFromTrades(): Promise<string[]> {
  const symbols = new Set<string>();

  const usersSnap = await db.collection('users').get();
  for (const userDoc of usersSnap.docs) {
    const tradesSnap = await userDoc.ref.collection('trades').get();
    for (const tradeDoc of tradesSnap.docs) {
      const data = tradeDoc.data() as TradeDoc;
      const rawSymbol = (data.symbol || '').toString().trim().toUpperCase();
      if (rawSymbol) {
        symbols.add(rawSymbol);
      }
    }
  }

  return Array.from(symbols);
}

async function getLatestPriceFromSavant(symbol: string): Promise<{ price: number; date: string; time: string } | null> {
  const to = new Date();
  const from = new Date(to.getTime() - 7 * 24 * 60 * 60 * 1000); // last 7 days window
  const ymd = (d: Date) =>
    `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;

  let bars: PartnerBar[] = [];
  try {
    bars = await fetchDailyBarsRange(symbol, {
      from: ymd(from),
      to: ymd(to),
      interval: 'DAILY',
    });
  } catch (e: any) {
    logger.warn('backfill_symbol_data_savant_call_failed', { symbol, message: e?.message });
    return null;
  }

  if (!bars.length) {
    return null;
  }

  const last = bars[bars.length - 1] as any;
  const rawPrice = last?.ac ?? last?.c ?? null;
  const price = typeof rawPrice === 'number' ? rawPrice : rawPrice != null ? Number(rawPrice) : NaN;
  const t = Number(last?.t);

  if (!Number.isFinite(price) || price <= 0 || !Number.isFinite(t)) {
    return null;
  }

  const iso = new Date(t).toISOString();
  const date = iso.slice(0, 10);
  const time = iso.slice(11, 16);

  return { price, date, time };
}

export async function backfillSymbolDataForTrades(): Promise<{ updated: number; errors: Array<{ symbol: string; error: string }> }> {
  const symbols = await loadSymbolsFromTrades();
  logger.info('backfillSymbolDataForTrades_symbols', { count: symbols.length, symbols });

  let updated = 0;
  const errors: Array<{ symbol: string; error: string }> = [];

  for (const symbol of symbols) {
    try {
      const latest = await getLatestPriceFromSavant(symbol);
      if (!latest) {
        errors.push({ symbol, error: 'no_latest_price' });
        continue;
      }

      await db
        .collection('symbol-data')
        .doc(symbol)
        .set(
          {
            currentPrice: {
              price: latest.price,
              date: latest.date,
              time: latest.time,
            },
          },
          { merge: true },
        );

      updated++;
    } catch (e: any) {
      logger.warn('backfill_symbol_data_for_trades_write_failed', {
        symbol,
        message: e?.message,
      });
      errors.push({ symbol, error: e?.message || 'write_failed' });
    }
  }

  return { updated, errors };
}

/**
 * HTTP (admin): backfillSymbolDataFromTradesAdmin
 *
 * Seed/refresh symbol-data/{SYMBOL}.currentPrice for all symbols present in user trades.
 * For each symbol, fetch the latest daily bar from Savant and use its close price.
 * Protect with bearer ADMIN_BACKFILL_TOKEN.
 */
export const backfillSymbolDataFromTradesAdmin = onRequest(
  { region: 'us-central1', timeoutSeconds: 540 },
  async (req, res) => {
    const token = (req.headers['authorization'] || '').toString().replace(/^Bearer\s+/i, '');
    const expected = (process.env.ADMIN_BACKFILL_TOKEN || '').trim();
    if (!expected || token !== expected) {
      res.status(401).json({ ok: false, error: 'unauthorized' });
      return;
    }

    try {
      const { updated, errors } = await backfillSymbolDataForTrades();
      res.json({ ok: true, updated, errors });
    } catch (e: any) {
      logger.error('backfillSymbolDataFromTradesAdmin_failed', { message: e?.message });
      res.status(500).json({ ok: false, error: e?.message || 'unknown_error' });
    }
  },
);

/**
 * Scheduled: backfillSymbolDataForTradesDaily
 *
 * Refresh symbol-data/{SYMBOL}.currentPrice for all symbols present in user trades once per day.
 * This is a lightweight, RS-independent daily price mirror for the trade journal.
 */
export const backfillSymbolDataForTradesDaily = onSchedule(
  {
    // 4:15 PM US Eastern, Monday-Friday
    schedule: '15 16 * * 1-5',
    timeZone: 'America/New_York',
    region: 'us-central1',
  },
  async () => {
    try {
      const { updated } = await backfillSymbolDataForTrades();
      logger.info('backfillSymbolDataForTradesDaily_completed', { updated });
    } catch (e: any) {
      logger.error('backfillSymbolDataForTradesDaily_failed', { message: e?.message });
    }
  },
);

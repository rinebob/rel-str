import { onRequest } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions';
import { db } from '../firebase-admin-init';

interface PairLatestSnapshot {
  latestDaily?: {
    day?: string;
    post?: {
      target?: {
        price?: number;
      };
    };
    target?: {
      price?: number;
    };
  };
  latest?: {
    day?: string;
    post?: {
      target?: {
        price?: number;
      };
    };
    target?: {
      price?: number;
    };
  };
  meta?: {
    symbol?: string; // target symbol
    baseline?: string; // baseline symbol
    interval?: string;
    window?: number;
  };
}

function splitPairId(pairId: string): { baseline: string; target: string } | null {
  const parts = pairId.split('-');
  if (parts.length !== 2) return null;
  const [baseline, target] = parts.map((p) => p.trim().toUpperCase());
  return baseline && target ? { baseline, target } : null;
}

function resolveTargetSymbol(pairId: string, data: PairLatestSnapshot): string | null {
  const metaSym = data.meta?.symbol;
  if (metaSym) {
    return String(metaSym).trim().toUpperCase();
  }
  const split = splitPairId(pairId);
  return split?.target ?? null;
}

function resolveLatestTargetPrice(
  data: PairLatestSnapshot,
): { price: number; date: string; time: string } | null {
  // Prefer latestDaily.post.target, then latestDaily.target, then latest.post.target, then latest.target
  const day = data.latestDaily?.day ?? data.latest?.day ?? undefined;

  const branch =
    data.latestDaily?.post?.target ??
    data.latestDaily?.target ??
    data.latest?.post?.target ??
    data.latest?.target ??
    undefined;

  const rawPrice = branch?.price;
  const price =
    typeof rawPrice === 'number' ? rawPrice : rawPrice != null ? Number(rawPrice) : NaN;

  if (!Number.isFinite(price) || price <= 0 || !day) {
    return null;
  }

  // day is already 'YYYY-MM-DD' per your schema
  const date = String(day).slice(0, 10);
  // For daily close we can use a canonical time; adjust if you prefer something else
  const time = '16:00';

  return { price, date, time };
}

/**
 * HTTP (admin): backfillSymbolDataFromPairsAdmin
 *
 * Seed/refresh symbol-data/{SYMBOL}.currentPrice from pairs-data latestDaily snapshots.
 * Protect with bearer ADMIN_BACKFILL_TOKEN.
 *
 * This is a one-off / on-demand backfill; live updates still come from partner-webhooks.processPairLive.
 */
export const backfillSymbolDataFromPairsAdmin = onRequest(
  { region: 'us-central1', timeoutSeconds: 540 },
  async (req, res) => {
    const token = (req.headers['authorization'] || '').toString().replace(/^Bearer\s+/i, '');
    const expected = (process.env.ADMIN_BACKFILL_TOKEN || '').trim();
    if (!expected || token !== expected) {
      res.status(401).json({ ok: false, error: 'unauthorized' });
      return;
    }

    try {
      const pairsSnap = await db.collection('pairs-data').get();
      let updated = 0;
      const errors: Array<{ pairId: string; error: string }> = [];

      for (const docSnap of pairsSnap.docs) {
        const pairId = docSnap.id;
        const data = docSnap.data() as PairLatestSnapshot;

        const symbol = resolveTargetSymbol(pairId, data);
        if (!symbol) {
          errors.push({ pairId, error: 'missing_target_symbol' });
          continue;
        }

        const latest = resolveLatestTargetPrice(data);
        if (!latest) {
          // No usable latestDaily/target price; skip silently or log at debug level
          continue;
        }

        try {
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
          logger.warn('backfill_symbol_data_write_failed', {
            pairId,
            symbol,
            message: e?.message,
          });
          errors.push({ pairId, error: e?.message || 'write_failed' });
        }
      }

      res.json({
        ok: true,
        updated,
        errors,
      });
    } catch (e: any) {
      logger.error('backfillSymbolDataFromPairsAdmin_failed', { message: e?.message });
      res.status(500).json({ ok: false, error: e?.message || 'unknown_error' });
    }
  },
);

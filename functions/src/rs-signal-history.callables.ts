import { onCall } from 'firebase-functions/v2/https';
import * as logger from 'firebase-functions/logger';
import { db } from './firebase-admin-init';
import type {
  GetPairSignalsRequest,
  GetPairSignalsResponse,
  GetPnLSummaryRequest,
  GetPnLSummaryResponse,
  UpdatePositionActualsRequest,
  UpdatePositionActualsResponse,
  BeOpenSignalDoc,
  BeCloseSignalDoc,
} from './types/signal.types';
import { USERS_COLLECTION, USER_TRADES_COLLECTION, USER_PNL_DAILY_COLLECTION, ANALYTICS_COLLECTION, ANALYTICS_SUMMARY_DOC, SIGNALS_OPENS_SUBCOLLECTION, SIGNALS_CLOSES_SUBCOLLECTION } from './webhooks/webhooks-config';

/**
 * Normalize a possibly undefined or non-string value into a trimmed string.
 *
 * @param str - Any input value to coerce to string.
 * @returns Trimmed string representation (empty string if falsy).
 */
const norm = (str: unknown): string => { return String(str || '').trim(); }

/**
 * Upper-case a string after normalization.
 *
 * @param str - Any input value to coerce and upper-case.
 * @returns Upper-cased, trimmed string.
 */
const toUpper = (str: unknown): string => { return norm(str).toUpperCase(); }

/**
 * Build a pair id from baseline and symbol (e.g., "SPY-AAPL").
 *
 * @param baseline - Baseline ticker/symbol; case-insensitive.
 * @param symbol - Asset ticker/symbol; case-insensitive.
 * @returns Canonical pair id in the format BASELINE-SYMBOL.
 */
const pairId = (baseline: string, symbol: string): string => { return `${toUpper(baseline)}-${toUpper(symbol)}`; }


/**
 * getPairSignals — Returns canonical signal documents for a given baseline/symbol.
 *
 * Security: Public callable. Reads from Firestore pairs-data/{PAIR}/signals.
 * Limits: caps results to [1, 200].
 *
 * @param req - Callable request whose data matches GetPairSignalsRequest.
 * @returns Promise<GetPairSignalsResponse> containing an array of RsPositionDoc items.
 */
export const getPairSignals = onCall(
  { region: 'us-central1', cors: true },
  async (req): Promise<GetPairSignalsResponse> => {
    const data = (req.data || {}) as GetPairSignalsRequest;
    const baseline = toUpper(data.baseline);
    const symbol = toUpper(data.symbol);
    const limit = Math.max(1, Math.min(200, Number((data as any)?.limit ?? 30)));
    if (!baseline || !symbol) {
      return { opens: [], closes: [] };
    }

    const pair = pairId(baseline, symbol);
    logger.info('getPairSignals', { pair, limit });

    try {
      const opensSnap = await db.collectionGroup(SIGNALS_OPENS_SUBCOLLECTION)
        .where('baseline', '==', baseline)
        .where('symbol', '==', symbol)
        .orderBy('day', 'desc')
        .limit(limit)
        .get();

      const closesSnap = await db.collectionGroup(SIGNALS_CLOSES_SUBCOLLECTION)
        .where('baseline', '==', baseline)
        .where('symbol', '==', symbol)
        .orderBy('day', 'desc')
        .limit(limit)
        .get();

      const opens: BeOpenSignalDoc[] = opensSnap.docs.map(d => ({ ...(d.data() as any) })) as BeOpenSignalDoc[];
      const closes: BeCloseSignalDoc[] = closesSnap.docs.map(d => ({ ...(d.data() as any) })) as BeCloseSignalDoc[];

      return { opens, closes };
    } catch (e: any) {
      logger.error('getPairSignals error', { message: e?.message, pair, baseline, symbol });
      return { opens: [], closes: [] };
    }
  }
);


/**
 * getPnLSummary — Returns PnL summary for a given range.
 *
 * Modes:
 * - type === 'actual': requires authenticated uid and reads per-user daily aggregates.
 * - type === 'app' (default): reads global analytics/summary document.
 *
 * @param req - Callable request containing GetPnLSummaryRequest.
 * @returns Promise<GetPnLSummaryResponse> with totals segmented by side and overall.
 */
export const getPnLSummary = onCall(
  { region: 'us-central1', cors: true },
  async (req): Promise<GetPnLSummaryResponse> => {
    const { from, to } = (req.data || {}) as GetPnLSummaryRequest;
    const type = ((req.data || {}) as any)?.type as 'app' | 'actual' | undefined;
    const uid = ((req.data || {}) as any)?.uid as string | undefined;
    logger.info('getPnLSummary called', { from, to, type, uid });

    const zero = { count: 0, sum: 0, sumPct: 0 };
    let totals = { long: { ...zero }, short: { ...zero }, total: { ...zero } };

    try {
      if (type === 'actual') {
        // Prefer per-user daily aggregates when available
        if (!uid) return { range: { from, to }, type: 'actual', uid, totals };
        const col = db.collection(USERS_COLLECTION).doc(uid).collection(USER_PNL_DAILY_COLLECTION);
        // naive day iteration between from..to
        const fromD = new Date(from + 'T00:00:00Z');
        const toD = new Date(to + 'T00:00:00Z');
        const step = 24 * 60 * 60 * 1000;
        for (let t = fromD.getTime(); t <= toD.getTime(); t += step) {
          const d = new Date(t);
          const y = d.getUTCFullYear();
          const m = String(d.getUTCMonth() + 1).padStart(2, '0');
          const dd = String(d.getUTCDate()).padStart(2, '0');
          const id = `${y}-${m}-${dd}`;
          const snap = await col.doc(id).get();
          const s = (snap.exists ? (snap.data() as any)?.actualPnLSummary : undefined) || undefined;
          if (s) {
            totals.long.count += Number(s?.long?.count || 0);
            totals.long.sum += Number(s?.long?.sum || 0);
            totals.long.sumPct += Number(s?.long?.sumPct || 0);
            totals.short.count += Number(s?.short?.count || 0);
            totals.short.sum += Number(s?.short?.sum || 0);
            totals.short.sumPct += Number(s?.short?.sumPct || 0);
            totals.total.count += Number(s?.total?.count || 0);
            totals.total.sum += Number(s?.total?.sum || 0);
            totals.total.sumPct += Number(s?.total?.sumPct || 0);
          }
        }
        return { range: { from, to }, type: 'actual', uid, totals };
      }

      // type === 'app' (default): read global analytics/summary aggregate (we no longer use mirror PnL)
      try {
        const snap = await db.collection(ANALYTICS_COLLECTION).doc(ANALYTICS_SUMMARY_DOC).get();
        const s = (snap.exists ? (snap.data() as any) : undefined) || undefined;
        if (s) {
          totals.long.count = Number(s?.totalWinningTrades || 0) + 0; // Not split by side in summary; only totals are reliable
          totals.short.count = 0;
          totals.total.count = Number(s?.totalTrades || 0);
          totals.total.sum = Number(s?.totalNetPnL || 0);
          totals.long.sum = 0;
          totals.short.sum = 0;
          totals.total.sumPct = Number.isFinite(Number(s?.avgNetPnL)) ? Number(s?.avgNetPnL) : 0;
        }
      } catch (e: any) {
        logger.error('getPnLSummary analytics read error', { message: e?.message });
      }
      return { range: { from, to }, type: 'app', uid, totals };
    } catch (e: any) {
      logger.error('getPnLSummary error', { message: e?.message });
      return { range: { from, to }, type: (type as any) || 'app', uid, totals };
    }
  }
);

/**
 * updatePositionActuals — Upserts per-user trade overlay fields for a specific position.
 *
 * Auth: Requires authenticated user. Writes to users/{uid}/trades/{positionId}.
 * Partial updates supported; only provided fields are merged.
 *
 * @param req - Callable request containing UpdatePositionActualsRequest.
 * @throws Error('unauthenticated') if no uid on context.
 * @returns Promise<UpdatePositionActualsResponse> with ok and positionId.
 */
export const updatePositionActuals = onCall(
  { region: 'us-central1', cors: true },
  async (req): Promise<UpdatePositionActualsResponse> => {
    const uid = req.auth?.uid;
    if (!uid) {
      throw new Error('unauthenticated');
    }
    const { positionId, executed, openedPrice, closedPrice, openedTime, closedTime, noteOpen, noteClose } = (req.data || ({} as any)) as UpdatePositionActualsRequest;
    if (!positionId) throw new Error('missing positionId');

    logger.info('updatePositionActuals', { uid, positionId, executed });

    const docRef = db.collection(USERS_COLLECTION).doc(uid).collection(USER_TRADES_COLLECTION).doc(positionId);
    const payload: any = {
      executed: !!executed,
      updatedAt: new Date(),
    };
    if (openedPrice !== undefined || openedTime !== undefined || noteOpen !== undefined) {
      payload.opened = {
        ...(openedPrice !== undefined ? { price: Number(openedPrice) } : {}),
        ...(openedTime !== undefined ? { t: Number(openedTime) } : {}),
        ...(noteOpen !== undefined ? { note: String(noteOpen) } : {}),
      };
    }
    if (closedPrice !== undefined || closedTime !== undefined || noteClose !== undefined) {
      payload.closed = {
        ...(closedPrice !== undefined ? { price: Number(closedPrice) } : {}),
        ...(closedTime !== undefined ? { t: Number(closedTime) } : {}),
        ...(noteClose !== undefined ? { note: String(noteClose) } : {}),
      };
    }

    await docRef.set(payload, { merge: true });
    return { ok: true, positionId };
  }
);


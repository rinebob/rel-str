import { onCall } from 'firebase-functions/v2/https';
import * as logger from 'firebase-functions/logger';
import { db, FieldValue } from './firebase-admin-init';
import type {
  GetDailySignalsRequest,
  GetDailySignalsResponse,
  GetPairSignalsRequest,
  GetPairSignalsResponse,
  GetPnLSummaryRequest,
  GetPnLSummaryResponse,
  GetPositionWithActualsRequest,
  GetPositionWithActualsResponse,
  GetPairSignalsWithActualsRequest,
  GetPairSignalsWithActualsResponse,
  UpdatePositionActualsRequest,
  UpdatePositionActualsResponse,
  RsPositionDoc,
  UserTradeOverlay,
} from './types/rs-signal-history';
import { SIGNALS_DAILY_ROOT_COLLECTION, SIGNALS_DAILY_COLLECTION, PAIRS_COLLECTION, SIGNALS_COLLECTION, USERS_COLLECTION, USER_TRADES_COLLECTION, USER_PNL_DAILY_COLLECTION, ANALYTICS_COLLECTION, ANALYTICS_SUMMARY_DOC } from './webhooks/webhooks-config';

const norm = (str: unknown): string => { return String(str || '').trim(); }
const toUpper = (str: unknown): string => { return norm(str).toUpperCase(); }
const pairId = (baseline: string, symbol: string): string => { return `${toUpper(baseline)}-${toUpper(symbol)}`; }
const pairFromPositionId = (positionId: string): string => { return norm(positionId).split('_')[0] || ''; }

// getPairSignals — returns canonical signals for a given baseline/symbol
export const getPairSignals = onCall(
  { region: 'us-central1' },
  async (req): Promise<GetPairSignalsResponse> => {
    const data = (req.data || {}) as GetPairSignalsRequest;
    const baseline = toUpper(data.baseline);
    const symbol = toUpper(data.symbol);
    const limit = Math.max(1, Math.min(200, Number((data as any)?.limit ?? 30)));
    if (!baseline || !symbol) return { items: [] };

    const pair = pairId(baseline, symbol);
    logger.info('getPairSignals', { pair, limit });

    try {
      const snap = await db.collection('pairs-data').doc(pair).collection('signals')
        .orderBy('opened.day', 'desc').limit(limit).get();
      const items: RsPositionDoc[] = snap.docs.map(d => ({ id: d.id, ...d.data() } as any)) as unknown as RsPositionDoc[];
      return { items };
    } catch (e: any) {
      logger.error('getPairSignals error', { message: e?.message, pair });
      return { items: [] };
    }
  }
);

// getDailySignals — returns daily signals from mirror collection
export const getDailySignals = onCall(
  { region: 'us-central1' },
  async (req): Promise<GetDailySignalsResponse> => {
    const { day, fromDay, toDay, limitDays, all } = (req.data || {}) as GetDailySignalsRequest;
    logger.info('getDailySignals called', { day, fromDay, toDay, limitDays, all });

    // Strategy:
    // 1) Prefer a root mirror collection `signals-daily/{YYYY-MM-DD}` if present.
    // 2) If mirror missing, return empty. Pair-scoped fan-out is intentionally not implemented here.

    const days: Array<{ day: string; items: any }>= [];
    const mirrorCol = db.collection(SIGNALS_DAILY_ROOT_COLLECTION);

    try {
      if (day) {
        const docSnap = await mirrorCol.doc(day).get();
        if (docSnap.exists) days.push({ day, items: docSnap.data() as any });
        return { days };
      }

      // Build a range query if supported; else iterate days list
      const collectDays: string[] = [];
      if (fromDay && toDay) {
        // Attempt range read by day field inside documents (requires a subfield or mirror collection keyed by day)
        // Since our mirror uses docId as day, we can't range query by docId. Fallback to naive enumeration of last N days.
        // If limitDays provided, cap enumeration window.
        const maxDays = Math.max(1, Math.min(365, Number(limitDays ?? 30)));
        // naive loop from toDay back to fromDay up to maxDays
        const from = new Date(fromDay + 'T00:00:00Z');
        const to = new Date(toDay + 'T00:00:00Z');
        const step = 24 * 60 * 60 * 1000;
        for (let t = to.getTime(), c = 0; t >= from.getTime() && c < maxDays; t -= step, c++) {
          const d = new Date(t);
          const y = d.getUTCFullYear();
          const m = String(d.getUTCMonth() + 1).padStart(2, '0');
          const dd = String(d.getUTCDate()).padStart(2, '0');
          collectDays.push(`${y}-${m}-${dd}`);
        }
      } else if (all) {
        // Not supported without pagination; return empty
        return { days: [] };
      } else {
        // Default last N days (limitDays or 30)
        const maxDays = Math.max(1, Math.min(365, Number(limitDays ?? 30)));
        const now = new Date();
        const step = 24 * 60 * 60 * 1000;
        for (let c = 0, t = now.getTime(); c < maxDays; c++, t -= step) {
          const d = new Date(t);
          const y = d.getUTCFullYear();
          const m = String(d.getUTCMonth() + 1).padStart(2, '0');
          const dd = String(d.getUTCDate()).padStart(2, '0');
          collectDays.push(`${y}-${m}-${dd}`);
        }
      }

      for (const d of collectDays) {
        const docSnap = await mirrorCol.doc(d).get();
        if (docSnap.exists) days.push({ day: d, items: docSnap.data() as any });
      }
      return { days };
    } catch (e: any) {
      logger.error('getDailySignals error', { message: e?.message });
      return { days: [] };
    }
  }
);

// getPnLSummary — returns PnL summary for a given range
export const getPnLSummary = onCall(
  { region: 'us-central1' },
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

// getPositionWithActuals — read canonical position by positionId and overlay by uid
export const getPositionWithActuals = onCall(
  { region: 'us-central1' },
  async (req): Promise<GetPositionWithActualsResponse> => {
    const data = (req.data || {}) as GetPositionWithActualsRequest;
    const positionId = norm(data.positionId);
    if (!positionId) return { position: undefined, user: undefined };

    // Enforce that if uid is provided, it must match auth context
    const authUid = req.auth?.uid;
    const requestedUid = norm((data as any)?.uid);
    const effectiveUid = authUid || '';
    const allowUser = !!effectiveUid && (!requestedUid || requestedUid === effectiveUid);

    const pair = pairFromPositionId(positionId);
    if (!pair) return { position: undefined, user: undefined };

    try {
      const posRef = db.collection(PAIRS_COLLECTION).doc(pair).collection(SIGNALS_COLLECTION).doc(positionId);
      const posSnap = await posRef.get();
      const position = posSnap.exists ? ({ id: posSnap.id, ...posSnap.data() } as any as RsPositionDoc) : undefined;

      let user: UserTradeOverlay | undefined = undefined;
      if (allowUser) {
        const userRef = db.collection(USERS_COLLECTION).doc(effectiveUid).collection(USER_TRADES_COLLECTION).doc(positionId);
        const userSnap = await userRef.get();
        user = userSnap.exists ? ({ id: userSnap.id, ...userSnap.data() } as any as UserTradeOverlay) : undefined;
      }

      return { position, user };
    } catch (e: any) {
      logger.error('getPositionWithActuals error', { message: e?.message, positionId, pair });
      return { position: undefined, user: undefined };
    }
  }
);

// getPairSignalsWithActuals — query canonical positions by baseline/symbol with optional fromDay/toDay range; if authenticated and uid matches, fetch per-user overlays and return merged items
export const getPairSignalsWithActuals = onCall(
  { region: 'us-central1' },
  async (req): Promise<GetPairSignalsWithActualsResponse> => {
    const data = (req.data || {}) as GetPairSignalsWithActualsRequest;
    const baseline = toUpper(data.baseline);
    const symbol = toUpper(data.symbol);
    const pair = pairId(baseline, symbol);
    const limit = Math.max(1, Math.min(200, Number((data as any)?.limit ?? 30)));
    const fromDay = norm((data as any)?.fromDay);
    const toDay = norm((data as any)?.toDay);

    // user overlay eligibility
    const authUid = req.auth?.uid || '';
    const requestedUid = norm((data as any)?.uid);
    const useUser = !!authUid && (!requestedUid || requestedUid === authUid);

    if (!baseline || !symbol || !pair) return { items: [] };

    try {
      // Build query for canonical positions
      let q = db.collection(PAIRS_COLLECTION).doc(pair).collection(SIGNALS_COLLECTION) as FirebaseFirestore.Query<FirebaseFirestore.DocumentData>;
      if (fromDay) q = q.where('opened.day', '>=', fromDay);
      if (toDay) q = q.where('opened.day', '<=', toDay);
      q = q.orderBy('opened.day', 'desc').limit(limit);

      const snap = await q.get();
      const positions: RsPositionDoc[] = snap.docs.map(d => ({ id: d.id, ...d.data() } as any)) as unknown as RsPositionDoc[];

      if (!useUser || positions.length === 0) {
        return { items: positions.map(p => ({ position: p })) };
      }

      // Fetch overlays per positionId for the authed user
      const userCol = db.collection(USERS_COLLECTION).doc(authUid).collection(USER_TRADES_COLLECTION);
      const overlays = await Promise.all(
        positions.map(async (p) => {
          const docRef = userCol.doc(p.positionId);
          const s = await docRef.get();
          return s.exists ? ({ id: s.id, ...s.data() } as any as UserTradeOverlay) : undefined;
        })
      );

      const items = positions.map((p, i) => ({ position: p, user: overlays[i] }));
      return { items };
    } catch (e: any) {
      logger.error('getPairSignalsWithActuals error', { message: e?.message, pair });
      return { items: [] };
    }
  }
);

export const updatePositionActuals = onCall(
  { region: 'us-central1' },
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

// Internal implementation to rebuild root mirror for a given day.
// Exported so other functions (e.g., backfill) can invoke without going through onCall plumbing.
export async function rebuildSignalsDailyMirrorImpl({ day, pairs }: { day: string; pairs?: string[] }) {
  const norm = (s: string) => String(s || '').trim();
  const dstr = norm(day);
  if (!dstr) throw new Error('day required');

  // Discover pair ids
  let pairIds: string[] = pairs && pairs.length ? pairs.map(p => norm(p)).filter(Boolean) : [];
  if (pairIds.length === 0) {
    const pairsSnap = await db.collection(PAIRS_COLLECTION).select().get();
    pairIds = pairsSnap.docs.map(d => d.id);
  }

  const combined = {
    newOpens: [] as any[],
    holds: [] as any[],
    newCloses: [] as any[],
  };

  for (const pair of pairIds) {
    const docRef = db.collection(PAIRS_COLLECTION).doc(pair).collection(SIGNALS_DAILY_COLLECTION).doc(dstr);
    const snap = await docRef.get();
    if (!snap.exists) continue;
    const d = snap.data() as any;
    if (Array.isArray(d?.newOpens)) combined.newOpens.push(...d.newOpens.map((x: any) => ({ ...x, pair })));
    if (Array.isArray(d?.holds)) combined.holds.push(...d.holds.map((x: any) => ({ ...x, pair })));
    if (Array.isArray(d?.newCloses)) combined.newCloses.push(...d.newCloses.map((x: any) => ({ ...x, pair })));
  }

  // If there are no events, avoid creating a mirror doc (and delete any stale empty doc)
  const hasEvents = (combined.newOpens.length + combined.holds.length + combined.newCloses.length) > 0;
  if (!hasEvents) {
    const mirrorRef = db.collection(SIGNALS_DAILY_ROOT_COLLECTION).doc(dstr);
    const existing = await mirrorRef.get();
    if (existing.exists) await mirrorRef.delete();
    return { day: dstr, counts: { opens: 0, holds: 0, closes: 0 }, skipped: true } as any;
  }

  await db.collection(SIGNALS_DAILY_ROOT_COLLECTION).doc(dstr).set({
    ...combined,
    appPnLSummary: FieldValue.delete(),
    pnlSummary: FieldValue.delete(),
    updatedAt: FieldValue.serverTimestamp(),
  }, { merge: true });

  return { day: dstr, counts: { opens: combined.newOpens.length, holds: combined.holds.length, closes: combined.newCloses.length } };
}

// Update callable to delegate to the internal implementation (bumped timeout)
export const rebuildSignalsDailyMirror = onCall(
  { region: 'us-central1', timeoutSeconds: 540 },
  async (req): Promise<any> => {
    const day = String(req.data?.day || '').trim();
    const pairs = Array.isArray(req.data?.pairs) ? req.data.pairs : undefined;
    const r = await rebuildSignalsDailyMirrorImpl({ day, pairs });
    const opens = r?.counts?.opens ?? 0;
    const holds = r?.counts?.holds ?? 0;
    const closes = r?.counts?.closes ?? 0;
    logger.info(`RS MIRROR day=${day} opens=${opens} holds=${holds} closes=${closes}`,
      { event: 'mirror', invokedBy: 'callable', day, counts: r?.counts, pairsHint: pairs?.length || 0 });
    return { ok: true, ...r };
  }
);

// Range variant to process multiple days server-side
export const rebuildSignalsDailyMirrorRange = onCall(
  { region: 'us-central1', timeoutSeconds: 540 },
  async (req): Promise<{ ok: boolean; range: { from: string; to: string }; processed: number; skipped: number }> => {
    const from = String(req.data?.from || '').trim();
    const to = String(req.data?.to || '').trim();
    const pairs = Array.isArray(req.data?.pairs) ? (req.data.pairs as string[]) : undefined;
    if (!from || !to) throw new Error('from and to required (YYYY-MM-DD)');

    const fromD = new Date(from + 'T00:00:00Z');
    const toD = new Date(to + 'T00:00:00Z');
    if (isNaN(fromD.getTime()) || isNaN(toD.getTime())) throw new Error('invalid from/to');
    if (fromD.getTime() > toD.getTime()) throw new Error('from must be <= to');
    const step = 24 * 60 * 60 * 1000;

    let processed = 0, skipped = 0;
    for (let t = fromD.getTime(); t <= toD.getTime(); t += step) {
      const d = new Date(t);
      const y = d.getUTCFullYear();
      const m = String(d.getUTCMonth() + 1).padStart(2, '0');
      const dd = String(d.getUTCDate()).padStart(2, '0');
      const day = `${y}-${m}-${dd}`;
      try {
        const r = await rebuildSignalsDailyMirrorImpl({ day, pairs });
        if ((r as any)?.skipped) skipped++; else processed++;
      } catch (e: any) {
        logger.error('mirror range day failed', { day, message: e?.message });
      }
    }
    return { ok: true, range: { from, to }, processed, skipped };
  }
);

// Admin utility: remove appPnLSummary field from pair-scoped daily docs for a date range (idempotent),
// and optionally rebuild root mirrors per day. Intended for cleanup/migrations.
export const cleanPairDailyPnL = onCall(
  { region: 'us-central1' },
  async (req): Promise<{ ok: boolean; from: string; to: string; pairs: number; days: number; mirrorsRebuilt?: number }> => {
    const from = String(req.data?.from || '').trim();
    const to = String(req.data?.to || '').trim();
    const doMirror = String(req.data?.mirror || '').toLowerCase() === 'true' || req.data?.mirror === true;
    let pairsFilter: string[] | undefined = undefined;
    if (Array.isArray(req.data?.pairs) && (req.data.pairs as any[]).length) {
      pairsFilter = (req.data.pairs as any[]).map(x => String(x || '').trim()).filter(Boolean);
    }

    if (!from || !to) throw new Error('from and to required (YYYY-MM-DD)');

    // Discover pairs
    let pairIds: string[] = pairsFilter && pairsFilter.length ? pairsFilter : [];
    if (pairIds.length === 0) {
      const snap = await db.collection(PAIRS_COLLECTION).select().get();
      pairIds = snap.docs.map(d => d.id);
    }

    const fromD = new Date(from + 'T00:00:00Z');
    const toD = new Date(to + 'T00:00:00Z');
    const step = 24 * 60 * 60 * 1000;

    let mirrorsRebuilt = 0;
    for (let t = fromD.getTime(); t <= toD.getTime(); t += step) {
      const d = new Date(t);
      const y = d.getUTCFullYear();
      const m = String(d.getUTCMonth() + 1).padStart(2, '0');
      const dd = String(d.getUTCDate()).padStart(2, '0');
      const day = `${y}-${m}-${dd}`;

      // Batch delete of appPnLSummary for all pairs for this day
      const batch = db.batch();
      let ops = 0;
      for (const pair of pairIds) {
        const ref = db.collection(PAIRS_COLLECTION).doc(pair).collection(SIGNALS_DAILY_COLLECTION).doc(day);
        const snap = await ref.get();
        if (!snap.exists) continue;
        batch.set(ref, { appPnLSummary: FieldValue.delete() }, { merge: true });
        ops++;
        if (ops >= 400) { await batch.commit(); ops = 0; }
      }
      if (ops > 0) { await batch.commit(); }

      if (doMirror) {
        try {
          await rebuildSignalsDailyMirrorImpl({ day });
          mirrorsRebuilt++;
        } catch (e: any) {
          logger.error('cleanPairDailyPnL mirror rebuild failed', { day, message: e?.message });
        }
      }
    }

    return { ok: true, from, to, pairs: pairIds.length, days: Math.floor((toD.getTime() - fromD.getTime()) / step) + 1, mirrorsRebuilt: doMirror ? mirrorsRebuilt : undefined };
  }
);
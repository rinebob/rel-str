import { onCall } from 'firebase-functions/v2/https';
import * as logger from 'firebase-functions/logger';
import { db, FieldValue } from './firebase-admin-init';
import { upsertRootSignalsDaily, deleteRootSignalsDaily } from './webhooks/positions-manager';
import type {
  GetDailySignalsRequest,
  GetDailySignalsResponse,
  GetPairSignalsRequest,
  GetPairSignalsResponse,
  GetPnLSummaryRequest,
  GetPnLSummaryResponse,
  UpdatePositionActualsRequest,
  UpdatePositionActualsResponse,
  BeOpenSignalDoc,
  BeCloseSignalDoc,
  SignalsDailyDoc,
} from './types/signal.types';
import { DailySignalType } from './types/signal.types';
import { SIGNALS_DAILY_ROOT_COLLECTION, SIGNALS_DAILY_COLLECTION, PAIRS_COLLECTION, USERS_COLLECTION, USER_TRADES_COLLECTION, USER_PNL_DAILY_COLLECTION, ANALYTICS_COLLECTION, ANALYTICS_SUMMARY_DOC, DAYS_SUBCOLLECTION, ITEMS_SUBCOLLECTION, SIGNALS_OPENS_SUBCOLLECTION, SIGNALS_CLOSES_SUBCOLLECTION } from './webhooks/webhooks-config';

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
  { region: 'us-central1' },
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
 * getDailySignals — Returns daily decision-board data from the root mirror collection.
 *
 * Strategy:
 * 1) If a specific day is provided, return that document if present.
 * 2) Otherwise, iterate a set of days (by range or last N) and aggregate available docs.
 *
 * Mirror Source: signals-daily/{YYYY}/days/{YYYY-MM-DD}
 * Security: Public callable for read-only access.
 *
 * @param req - Callable request whose data matches GetDailySignalsRequest.
 * @returns Promise<GetDailySignalsResponse> with an array of { day, items }.
 */
export const getDailySignals = onCall(
  { region: 'us-central1' },
  async (req): Promise<GetDailySignalsResponse> => {
    const { day, fromDay, toDay, limitDays, all } = (req.data || {}) as GetDailySignalsRequest;
    logger.info('getDailySignals called', { day, fromDay, toDay, limitDays, all });

    // Strategy:
    // 1) Read root mirror collection by year/day: `signals-daily/{YYYY}/days/{YYYY-MM-DD}` if present.
    // 2) If mirror missing, return empty. Pair-scoped fan-out is intentionally not implemented here.

    const days: SignalsDailyDoc[] = [];
    const mirrorCol = db.collection(SIGNALS_DAILY_ROOT_COLLECTION);

    try {
      const coerceDaily = (id: string, raw: any): SignalsDailyDoc => {
        const ensureArray = (val: any): any[] => (Array.isArray(val) ? val : []);
        const mapSignals = (arr: any[], type: DailySignalType) => ensureArray(arr).map((x) => ({
          signalId: String(x?.signalId || ''),
          positionId: String(x?.positionId || ''),
          pair: x?.pair ? String(x.pair) : undefined,
          type,
        }));

        const newOpens = mapSignals(raw?.newOpens, DailySignalType.OPEN);
        const holds = mapSignals(raw?.holds, DailySignalType.HOLD);
        const newCloses = mapSignals(raw?.newCloses, DailySignalType.CLOSE);

        return {
          date: id,
          newOpens,
          holds,
          newCloses,
        };
      };

      if (day) {
        const yr = String(day).slice(0, 4);
        const docSnap = await mirrorCol.doc(yr).collection(DAYS_SUBCOLLECTION).doc(day).get();
        if (docSnap.exists) {
          days.push(coerceDaily(day, docSnap.data() as any));
        }
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

      // Fetch docs in parallel with bounded concurrency
      const MAX_CONCURRENCY = 20;
      const refs = collectDays.map((d) => ({ id: d, yr: String(d).slice(0,4), ref: mirrorCol.doc(String(d).slice(0,4)).collection(DAYS_SUBCOLLECTION).doc(d) }));
      for (let i = 0; i < refs.length; i += MAX_CONCURRENCY) {
        const chunk = refs.slice(i, i + MAX_CONCURRENCY);
        const snaps = await Promise.all(chunk.map(({ id, ref }) => ref.get().then(s => ({ id, snap: s }))));
        for (const { id, snap } of snaps) {
          if (snap.exists) {
            days.push(coerceDaily(id, snap.data() as any));
          }
        }
      }
      return { days };
    } catch (e: any) {
      logger.error('getDailySignals error', { message: e?.message });
      return { days: [] };
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

/**
 * Internal: Rebuild the root daily mirror document signals-daily/{YYYY}/days/{day} from per-pair daily docs.
 *
 * Behavior:
 * - Aggregates newOpens, holds, newCloses across all pairs (or a provided subset).
 * - If no events, deletes the mirror doc if it exists and returns a skipped flag.
 * - Clears deprecated aggregate fields in mirror (appPnLSummary, pnlSummary).
 *
 * @param params.day - Day string in YYYY-MM-DD (UTC) format.
 * @param params.pairs - Optional list of pair ids to limit scope.
 * @returns Object with day, counts, and optional skipped flag.
 */
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

  const yr = dstr.slice(0, 4);
  for (const pair of pairIds) {
    const docRef = db.collection(PAIRS_COLLECTION).doc(pair).collection(SIGNALS_DAILY_COLLECTION).doc(yr).collection(DAYS_SUBCOLLECTION).doc(dstr);
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
    await deleteRootSignalsDaily(dstr);
    return { day: dstr, counts: { opens: 0, holds: 0, closes: 0 }, skipped: true } as any;
  }

  await upsertRootSignalsDaily(dstr, {
    ...combined,
    appPnLSummary: FieldValue.delete(),
    pnlSummary: FieldValue.delete(),
  });

  return { day: dstr, counts: { opens: combined.newOpens.length, holds: combined.holds.length, closes: combined.newCloses.length } };
}

/**
 * rebuildSignalsDailyMirror — Callable wrapper that delegates to rebuildSignalsDailyMirrorImpl.
 *
 * @param req - Contains { day: string; pairs?: string[] }.
 * @returns { ok: boolean, counts, day, ... } as returned by the internal implementation.
 */
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

/**
 * rebuildSignalsDailyMirrorRange — Processes a range of days server-side, invoking rebuild per day.
 *
 * @param req - Contains { from: string; to: string; pairs?: string[] }.
 * @throws Error if from/to are missing or invalid, or if from > to.
 * @returns { ok: boolean, range: { from, to }, processed, skipped }.
 */
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

/**
 * cleanPairDailyPnL — Admin utility to remove appPnLSummary from per-pair daily docs for a date range.
 * Optionally rebuilds root mirrors per day.
 *
 * Access: Intended for admin usage via restricted callable permissions.
 *
 * @param req - Contains { from: string; to: string; pairs?: string[]; mirror?: boolean }.
 * @returns Summary with counts of pairs, days processed, and mirrors rebuilt if requested.
 */
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
      const yr = String(day).slice(0,4);
      for (const pair of pairIds) {
        const ref = db.collection(PAIRS_COLLECTION).doc(pair).collection(SIGNALS_DAILY_COLLECTION).doc(yr).collection(DAYS_SUBCOLLECTION).doc(day);
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

/**
 * auditSignalsConsistency — Compare per-pair daily docs vs root mirror vs positions per day.
 * Request: { from: string; to: string }
 * Response: { ok, range, days: [...], totals }
 */
export const auditSignalsConsistency = onCall(
  { region: 'us-central1', timeoutSeconds: 540 },
  async (req): Promise<{
    ok: boolean;
    range: { from: string; to: string };
    days: Array<{
      day: string;
      perPair: { opens: number; holds: number; closes: number };
      mirror: { opens: number; holds: number; closes: number };
      positions: { opened: number; closed: number };
      diffs?: {
        opensDelta?: number;
        closesDelta?: number;
        missingInMirrorOpens?: string[];
        missingInPerPairOpens?: string[];
        missingInPositionsOpens?: string[];
      };
    }>;
    totals: { days: number; openMismatches: number; closeMismatches: number };
  }> => {
    const from = String(req.data?.from || '').trim();
    const to = String(req.data?.to || '').trim();
    if (!from || !to) throw new Error('from and to required (YYYY-MM-DD)');

    const fromD = new Date(from + 'T00:00:00Z');
    const toD = new Date(to + 'T00:00:00Z');
    if (isNaN(fromD.getTime()) || isNaN(toD.getTime())) throw new Error('invalid from/to');
    if (fromD.getTime() > toD.getTime()) throw new Error('from must be <= to');

    // Progress logging
    logger.info('auditSignalsConsistency start', { from, to });
    const step = 24 * 60 * 60 * 1000;
    const outDays: any[] = [];
    let openMismatchCount = 0, closeMismatchCount = 0, processedDays = 0;

    for (let t = fromD.getTime(); t <= toD.getTime(); t += step) {
      const d = new Date(t);
      const y = d.getUTCFullYear();
      const m = String(d.getUTCMonth() + 1).padStart(2, '0');
      const dd = String(d.getUTCDate()).padStart(2, '0');
      const day = `${y}-${m}-${dd}`;

      // Gather per-pair daily combined
      let perPairNewOpens: any[] = [];
      let perPairHolds: any[] = [];
      let perPairNewCloses: any[] = [];
      const pairsSnap = await db.collection(PAIRS_COLLECTION).select().get();
      for (const pd of pairsSnap.docs) {
        const yr = String(day).slice(0,4);
        const ref = db.collection(PAIRS_COLLECTION).doc(pd.id).collection(SIGNALS_DAILY_COLLECTION).doc(yr).collection(DAYS_SUBCOLLECTION).doc(day);
        const snap = await ref.get();
        if (!snap.exists) continue;
        const data = (snap.data() as any) || {};
        if (Array.isArray(data.newOpens)) perPairNewOpens.push(...data.newOpens.map((x: any) => ({ ...x, pair: pd.id })));
        if (Array.isArray(data.holds)) perPairHolds.push(...data.holds.map((x: any) => ({ ...x, pair: pd.id })));
        if (Array.isArray(data.newCloses)) perPairNewCloses.push(...data.newCloses.map((x: any) => ({ ...x, pair: pd.id })));
      }

      // Mirror counts (root year/day shard)
      const mirrorSnap = await db.collection(SIGNALS_DAILY_ROOT_COLLECTION).doc(String(day).slice(0,4)).collection(DAYS_SUBCOLLECTION).doc(day).get();
      const mirror = (mirrorSnap.exists ? (mirrorSnap.data() as any) : {}) || {};
      const mirrorOpens: any[] = Array.isArray(mirror.newOpens) ? mirror.newOpens : [];
      const mirrorCloses: any[] = Array.isArray(mirror.newCloses) ? mirror.newCloses : [];
      const mirrorHolds: any[] = Array.isArray(mirror.holds) ? mirror.holds : [];

      // Positions counts across shards using collectionGroup on 'items'
      let positionsOpened = 0, positionsClosed = 0;
      let posOpenDocs: FirebaseFirestore.QueryDocumentSnapshot[] = [];
      try {
        const posOpenSnap = await db.collectionGroup(ITEMS_SUBCOLLECTION).where('entryDay', '==', day).get();
        positionsOpened = posOpenSnap.size;
        posOpenDocs = posOpenSnap.docs;
      } catch {}
      try {
        const posCloseSnap = await db.collectionGroup(ITEMS_SUBCOLLECTION).where('exitDay', '==', day).get();
        positionsClosed = posCloseSnap.size;
      } catch {}

      // Compute diffs for opens
      const setFrom = (arr: any[]) => new Set(arr.map(x => String(x?.positionId || '').trim()));
      const setMirror = setFrom(mirrorOpens);
      const setPerPair = setFrom(perPairNewOpens);
      const setPositions = new Set<string>();
      for (const doc of posOpenDocs) setPositions.add(String((doc.data() as any)?.positionId || doc.id));

      const missingInMirrorOpens = [...setPerPair].filter(id => !setMirror.has(id));
      const missingInPerPairOpens = [...setMirror].filter(id => !setPerPair.has(id));
      const missingInPositionsOpens = [...setPerPair].filter(id => !setPositions.has(id));

      const opensDelta = (perPairNewOpens.length) - (mirrorOpens.length);
      const closesDelta = (perPairNewCloses.length) - (mirrorCloses.length);
      if (opensDelta !== 0) openMismatchCount++;
      if (closesDelta !== 0) closeMismatchCount++;

      processedDays++;
      if (opensDelta !== 0 || closesDelta !== 0) {
        logger.warn('auditSignalsConsistency mismatch', {
          day,
          perPair: { opens: perPairNewOpens.length, holds: perPairHolds.length, closes: perPairNewCloses.length },
          mirror: { opens: mirrorOpens.length, holds: mirrorHolds.length, closes: mirrorCloses.length },
          positions: { opened: positionsOpened, closed: positionsClosed },
          opensDelta,
          closesDelta,
          missingInMirrorOpensSample: (missingInMirrorOpens || []).slice(0, 10),
        });
      }
      if (processedDays % 25 === 0) {
        logger.info('auditSignalsConsistency progress', { processedDays, currentDay: day });
      }

      outDays.push({
        day,
        perPair: { opens: perPairNewOpens.length, holds: perPairHolds.length, closes: perPairNewCloses.length },
        mirror: { opens: mirrorOpens.length, holds: mirrorHolds.length, closes: mirrorCloses.length },
        positions: { opened: positionsOpened, closed: positionsClosed },
        diffs: {
          opensDelta,
          closesDelta,
          missingInMirrorOpens: missingInMirrorOpens.length ? missingInMirrorOpens : undefined,
          missingInPerPairOpens: missingInPerPairOpens.length ? missingInPerPairOpens : undefined,
          missingInPositionsOpens: missingInPositionsOpens.length ? missingInPositionsOpens : undefined,
        },
      });
    }

    logger.info('auditSignalsConsistency complete', { days: outDays.length, openMismatches: openMismatchCount, closeMismatches: closeMismatchCount });
    return {
      ok: true,
      range: { from, to },
      days: outDays,
      totals: { days: outDays.length, openMismatches: openMismatchCount, closeMismatches: closeMismatchCount },
    };
  }
);
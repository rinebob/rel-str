import { logger } from 'firebase-functions';
import { db, FieldValue } from '../firebase-admin-init';
import {
  POSITIONS_COLLECTION,
  OPEN_BUCKET_ID,
  PAIRS_COLLECTION,
  SIGNALS_COLLECTION,
  SIGNALS_DAILY_COLLECTION,
  SIGNALS_DAILY_ROOT_COLLECTION,
  ITEMS_SUBCOLLECTION,
  DAYS_SUBCOLLECTION,
  YEAR_BUCKET_KIND,
  COLLECTION_KIND_SIGNALS_DAILY,
  COLLECTION_KIND_POSITIONS,
  yearClosedOf,
  SIGNALS_OPENS_SUBCOLLECTION,
  SIGNALS_CLOSES_SUBCOLLECTION,
} from './webhooks-config';
import { RsPositionStatus, RsDirection, DailySignalType, BeOpenSignalDoc, BeCloseSignalDoc, RsSource, PriceDatumRole } from '../types/signal.types';
import type { BePositionDoc } from '../types/position.types';
import type { PriceDatum } from '../types/signal.types';

/**
 * Update all OPEN positions for the specified pair with current daily snapshot fields.
 * Uses target close for latestDay and computes side-aware deltas vs entryPrice.
 * RS must be provided and is written as currentRs to keep RS and PnL in sync.
 */
export async function updateOpenPositionsForPair(pairId: string, latestDay: string, latestTargetClose: number, latestRs: number): Promise<void> {
  const col = db.collection(POSITIONS_COLLECTION).doc(OPEN_BUCKET_ID).collection(ITEMS_SUBCOLLECTION);
  const snap = await col.where('pair', '==', pairId).get();
  if (snap.empty) return;
  for (const d of snap.docs) {
    const v = d.data() as any;
    const side = v?.side as RsDirection; // LONG | SHORT
    const entryPx = Number(v?.entryPrice);
    const curPx = Number(latestTargetClose);

    const rawChange = Number.isFinite(entryPx) ? Number(curPx - entryPx) : undefined;
    const rawPct = Number.isFinite(entryPx) && entryPx !== 0 && rawChange != null
      ? Number((rawChange / entryPx) * 100)
      : undefined;

    const pnlChange = Number.isFinite(entryPx)
      ? (side === RsDirection.SHORT ? Number(entryPx - curPx) : Number(curPx - entryPx))
      : undefined;
    const pnlPct = Number.isFinite(entryPx) && entryPx !== 0 && pnlChange != null
      ? Number((pnlChange / entryPx) * 100)
      : undefined;

    const patch: any = {
      currentPrice: curPx,
      ...(pnlChange != null ? { currentChange: pnlChange } : {}),
      ...(pnlPct != null ? { currentPctChange: pnlPct } : {}),
      ...(rawChange != null ? { rawChange } : {}),
      ...(rawPct != null ? { rawPctChange: rawPct } : {}),
      lastUpdateDay: latestDay,
      currentRs: latestRs,
      updatedAt: FieldValue.serverTimestamp(),
    };
    await col.doc(d.id).set(patch, { merge: true });
  }
  logger.info('updateOpenPositionsForPair committed', { pairId, latestDay, docsUpdated: snap.size });
}

/**
 * Append timeline updates for all OPEN positions for the specified pair.
 * This is additive: it does not change legacy flat fields, only appends PriceDatum updates.
 */
export async function appendOpenPositionsTimelineForPair(
  pairId: string,
  day: string,
  price: number,
  rs: number,
  source: 'pre' | 'post',
): Promise<void> {
  const col = db.collection(POSITIONS_COLLECTION).doc(OPEN_BUCKET_ID).collection(ITEMS_SUBCOLLECTION);
  const snap = await col.where('pair', '==', pairId).get();
  if (snap.empty) return;
  const ts = Date.now();
  for (const d of snap.docs) {
    const positionId = String(d.id || '').trim();
    if (!positionId) continue;
    try {
      await appendRootPositionTimelineUpdate({
        positionId,
        day,
        timestamp: ts,
        price,
        rs,
        source,
      });
    } catch {
      // best-effort; keep going for other positions
    }
  }
}

/**
 * Upsert daily holds for a pair for the given day based on currently OPEN positions.
 * Writes pairs-data/{pair}/signals-daily/{day}.holds = DailySignalType.HOLD entries keyed by positionId.
 */
export async function upsertDailyHoldsForPair(pairId: string, day: string): Promise<void> {
  const col = db.collection(POSITIONS_COLLECTION).doc(OPEN_BUCKET_ID).collection(ITEMS_SUBCOLLECTION);
  const snap = await col.where('pair', '==', pairId).get();
  const holds: Array<{ signalId: string; positionId: string; type: DailySignalType }> = [];
  for (const d of snap.docs) {
    const id = String(d.id);
    if (!id) continue;
    holds.push({ signalId: id, positionId: id, type: DailySignalType.HOLD });
  }
  await upsertPairSignalsDaily(
    pairId,
    day,
    { holds }
  );
}

/**
 * Finalize CLOSED positions for a pair on a specific day.
 * Reads pairs-data/{pair}/signals-daily/{day}.newCloses and signals/{positionId} for prices,
 * then writes exitPrice/exitDay/exitIso and netPnL/percentReturn to positions/{positionId}.
 */
export async function finalizeClosedPositionsForPair(pairId: string, day: string): Promise<void> {
  const yr = yearOf(day);
  const dailyRef = db.collection(PAIRS_COLLECTION).doc(pairId).collection(SIGNALS_DAILY_COLLECTION).doc(yr).collection(DAYS_SUBCOLLECTION).doc(day);
  const dailySnap = await dailyRef.get();
  if (!dailySnap.exists) return;
  const data = (dailySnap.data() as any) || {};
  const closes: Array<{ positionId: string; direction?: string }> = Array.isArray(data?.newCloses) ? data.newCloses : [];
  if (!closes.length) return;

  let ops = 0;
  for (const c of closes) {
    const id = String((c as any)?.positionId || '').trim();
    if (!id) continue;

    // Read per-position signals doc for precise open/close prices from correct shard
    const sigBase = db.collection(PAIRS_COLLECTION).doc(pairId).collection(SIGNALS_COLLECTION);
    const openRef = sigBase.doc(OPEN_BUCKET_ID).collection(ITEMS_SUBCOLLECTION).doc(id);
    let sigSnap = await openRef.get();
    if (!sigSnap.exists) {
      const yb = yearClosedOf(day);
      const closedRef = sigBase.doc(yb).collection(ITEMS_SUBCOLLECTION).doc(id);
      sigSnap = await closedRef.get();
    }
    if (!sigSnap.exists) continue;
    const s = (sigSnap.data() as any) || {};
    const opened = (s?.opened || {}) as any;
    const closed = (s?.closed || {}) as any;
    const side = String(s?.direction || (c as any)?.direction || '').toUpperCase();

    const entryPx = Number(opened?.openPrice);
    const exitPx = Number(closed?.closePrice);
    if (!Number.isFinite(entryPx) || !Number.isFinite(exitPx)) continue;

    const delta = side === 'SHORT' ? Number(entryPx - exitPx) : Number(exitPx - entryPx);
    const pct = entryPx !== 0 ? Number(((delta / entryPx) * 100).toFixed(6)) : 0;

    const patch = {
      exitPrice: exitPx,
      exitDay: day,
      exitIso: new Date(day + 'T00:00:00Z').toISOString(),
      netPnL: delta,
      percentReturn: pct,
      status: RsPositionStatus.CLOSED,
    } as any;
    await finalizePairSignalClose(pairId, id, day, patch);
    await finalizeRootPositionClose(id, day, patch);
    ops++;
  }
  logger.info('finalizeClosedPositionsForPair committed', { pairId, day, docsUpdated: ops });
}

// ========================
// Utilities and Live Open/Close helpers migrated from hot-archive.ts
// ========================

export function yearOf(day: string): string {
  return String(day || '').slice(0, 4);
}

function buildSignalId(day: string, pair: string, direction: RsDirection, kind: 'O' | 'C'): string {
  const d = new Date(`${day}T00:00:00Z`);
  const dow = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][d.getUTCDay()];
  const ymd = day.replace(/-/g, '');
  return `${ymd}-${dow}-${pair}-${direction.toUpperCase()}-${kind}`;
}

function buildPriceDatum(args: {
  role: PriceDatumRole;
  day: string;
  timestamp: number;
  price: number;
  rs?: number;
  source: 'pre' | 'post';
  entryPrice: number;
  direction: RsDirection;
}): PriceDatum {
  const { role, day, timestamp, price, rs, source, entryPrice, direction } = args;

  let pnl = 0;
  if (role !== PriceDatumRole.ENTRY) {
    const raw = direction === RsDirection.SHORT
      ? entryPrice - price
      : price - entryPrice;
    pnl = Number(raw);
  }
  const pct = entryPrice !== 0 ? Number((pnl / entryPrice) * 100) : 0;

  return {
    role,
    day,
    timestamp,
    price,
    rs,
    source: source as any,
    pnl,
    pct,
  };
}


function ensureUpperSide(side: any): 'LONG' | 'SHORT' | undefined {
  const s = String(side || '').toUpperCase();
  return s === 'LONG' || s === 'SHORT' ? (s as 'LONG' | 'SHORT') : undefined;
}

function validateOpenSignalInput(input: {
  pair?: string;
  baseline?: string;
  symbol?: string;
  side?: string;
  positionId?: string;
  entryDay?: string;
  entryIso?: string;
  entryTimestamp?: number;
  entryPrice?: number;
}): { ok: boolean; reasons?: string[] } {
  const reasons: string[] = [];
  if (!input?.pair) reasons.push('pair missing');
  if (!input?.baseline) reasons.push('baseline missing');
  if (!input?.symbol) reasons.push('symbol missing');
  const side = ensureUpperSide(input?.side);
  if (!side) reasons.push('side invalid');
  if (!input?.positionId) reasons.push('positionId missing');
  const day = String(input?.entryDay || '');
  if (!/\d{4}-\d{2}-\d{2}/.test(day)) reasons.push('entryDay invalid');
  if (!(Number.isFinite(input?.entryPrice))) reasons.push('entryPrice missing');
  return { ok: reasons.length === 0, reasons: reasons.length ? reasons : undefined };
}

export async function writePairSignalOpen(
  pair: string,
  positionId: string,
  day: string,
  entry: Record<string, any>
): Promise<void> {
  const v = validateOpenSignalInput({
    pair,
    baseline: entry?.baseline,
    symbol: entry?.symbol,
    side: entry?.direction || entry?.side,
    positionId,
    entryDay: entry?.entryDay || day || entry?.opened?.day,
    entryIso: entry?.entryIso || entry?.opened?.iso,
    entryTimestamp: entry?.entryTimestamp || entry?.opened?.t,
    entryPrice: entry?.entryPrice || entry?.opened?.openPrice,
  });
  if (!v.ok) throw new Error(`invalid open input: ${JSON.stringify(v.reasons)}`);
  const side = ensureUpperSide(entry?.direction || entry?.side)!;
  const entryDay = String(entry?.entryDay || day || entry?.opened?.day);
  const entryIso = String(entry?.entryIso || entry?.opened?.iso || new Date(`${entryDay}T00:00:00Z`).toISOString());
  const entryTimestamp = Number(entry?.entryTimestamp || entry?.opened?.t || new Date(entryIso).getTime());
  const entryPrice = Number(entry?.entryPrice || entry?.opened?.openPrice);
  if (!Number.isFinite(entryPrice) || entryPrice <= 0) throw new Error('entryPrice is required for open creation');

  const baseline = String(entry?.baseline || '').toUpperCase();
  const symbol = String(entry?.symbol || '').toUpperCase();
  const rsToday = Number(entry?.opened?.rsToday ?? Number.NaN);
  const rsYesterday = Number(entry?.opened?.rsYesterday ?? Number.NaN);

  const yr = yearOf(entryDay);
  const dirEnum = side === 'LONG' ? RsDirection.LONG : RsDirection.SHORT;
  const signalId = buildSignalId(entryDay, pair, dirEnum, 'O');

  const signalDoc: BeOpenSignalDoc = {
    signalId,
    baseline,
    symbol,
    direction: dirEnum,
    day: entryDay,
    timestamp: entryTimestamp,
    price: entryPrice,
    rs: rsToday,
    prevRs: rsYesterday,
    source: RsSource.POST,
    positionId,
  };

  const sigBase = db
    .collection(PAIRS_COLLECTION).doc(pair)
    .collection(SIGNALS_COLLECTION);

  try {
    await sigBase.doc(yr).set(
      { bucket: YEAR_BUCKET_KIND, year: yr, kind: 'signals', updatedAt: FieldValue.serverTimestamp() },
      { merge: true },
    );
  } catch {}

  const sigOpenRef = sigBase
    .doc(yr)
    .collection(SIGNALS_OPENS_SUBCOLLECTION)
    .doc(signalId);

  await sigOpenRef.set({ ...signalDoc, createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() } as any, { merge: true });
}

export async function finalizePairSignalClose(
  pair: string,
  positionId: string,
  day: string,
  exit: Record<string, any>
): Promise<void> {
  const closePrice = Number(exit?.exitPrice ?? exit?.closed?.closePrice);
  const rsToday = Number(exit?.closed?.rsToday ?? Number.NaN);
  const rsYesterday = Number(exit?.closed?.rsYesterday ?? Number.NaN);

  const yr = yearOf(day);
  const directionRaw = String(exit?.closed?.direction || exit?.direction || '').toUpperCase();
  const direction = directionRaw === 'SHORT' ? RsDirection.SHORT : RsDirection.LONG;
  const baseline = String(exit?.baseline || '').toUpperCase();
  const symbol = String(exit?.symbol || '').toUpperCase();

  const d = new Date(`${day}T00:00:00Z`);
  const timestamp = Number(exit?.closed?.t ?? d.getTime());

  const openSignalId = String(exit?.openSignalId || buildSignalId(String(exit?.closed?.day || day), pair, direction, 'O'));
  const signalId = buildSignalId(day, pair, direction, 'C');

  const closeDoc: BeCloseSignalDoc = {
    signalId,
    baseline,
    symbol,
    direction,
    day,
    timestamp,
    price: closePrice,
    rs: rsToday,
    prevRs: rsYesterday,
    source: RsSource.POST,
    positionId,
    openSignalId,
  };

  const sigBase = db
    .collection(PAIRS_COLLECTION).doc(pair)
    .collection(SIGNALS_COLLECTION);

  try {
    await sigBase.doc(yr).set(
      { bucket: YEAR_BUCKET_KIND, year: yr, kind: 'signals', updatedAt: FieldValue.serverTimestamp() },
      { merge: true },
    );
  } catch {}

  const closesRef = sigBase
    .doc(yr)
    .collection(SIGNALS_CLOSES_SUBCOLLECTION)
    .doc(signalId);

  await closesRef.set({ ...closeDoc, createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() } as any, { merge: true });
}

export async function upsertRootPositionOpen(
  positionId: string,
  day: string,
  entry: Record<string, any>
): Promise<void> {
  const pair = String(entry?.pair || '');
  const side = ensureUpperSide(entry?.side);
  if (!pair || !side) throw new Error('invalid root open input');
  const entryDay = String(entry?.entryDay || day);
  const entryIso = String(entry?.entryIso || new Date(`${entryDay}T00:00:00Z`).toISOString());
  const entryTimestamp = Number(entry?.entryTimestamp || new Date(entryIso).getTime());
  const entryPrice = Number(entry?.entryPrice);
  if (!Number.isFinite(entryPrice) || entryPrice <= 0) throw new Error('entryPrice is required for root open creation');
  const ref = db.collection(POSITIONS_COLLECTION).doc(OPEN_BUCKET_ID).collection(ITEMS_SUBCOLLECTION).doc(positionId);
  const doc = {
    positionId,
    pair,
    baseline: String(entry?.baseline || ''),
    symbol: String(entry?.symbol || ''),
    side,
    entryDay,
    entryIso,
    entryTimestamp,
    entryPrice,
    status: RsPositionStatus.OPEN,
    currentPrice: entryPrice,
    currentChange: 0,
    currentPctChange: 0,
    lastUpdateDay: entryDay,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  } as any;
  await ref.set(doc, { merge: true });
}

export async function finalizeRootPositionClose(
  positionId: string,
  day: string,
  exit: Record<string, any>
): Promise<void> {
  const price = Number(exit?.exitPrice ?? exit?.closed?.closePrice);
  const rawRs = Number(exit?.closed?.rsToday ?? Number.NaN);
  const rs = Number.isFinite(rawRs) ? rawRs : undefined;
  const ts = Number(
    exit?.closed?.t ??
    (() => {
      const d = new Date(`${day}T00:00:00Z`);
      return d.getTime();
    })(),
  );

  await closeRootPositionTimeline({
    positionId,
    day,
    timestamp: ts,
    price,
    rs,
  });
}

export async function upsertPairSignalsDaily(
  pair: string,
  day: string,
  patch: Record<string, any>
): Promise<void> {
  const base = db.collection(PAIRS_COLLECTION).doc(pair).collection(SIGNALS_DAILY_COLLECTION);
  const yr = yearOf(day);
  try { await base.doc(yr).set({ bucket: YEAR_BUCKET_KIND, year: yr, kind: COLLECTION_KIND_SIGNALS_DAILY, updatedAt: FieldValue.serverTimestamp() }, { merge: true }); } catch {}
  const dayRef = base.doc(yr).collection(DAYS_SUBCOLLECTION).doc(day);
  const data = { ...patch, date: day, updatedAt: FieldValue.serverTimestamp() };
  await dayRef.set(data, { merge: true });
}

export async function upsertRootSignalsDaily(
  day: string,
  patch: Record<string, any>
): Promise<void> {
  const base = db.collection(SIGNALS_DAILY_ROOT_COLLECTION);
  const yr = yearOf(day);
  // Ensure year container doc exists with metadata for visibility
  try { await base.doc(yr).set({ bucket: YEAR_BUCKET_KIND, year: yr, kind: COLLECTION_KIND_SIGNALS_DAILY, updatedAt: FieldValue.serverTimestamp() }, { merge: true }); } catch {}
  const ref = base.doc(yr).collection(DAYS_SUBCOLLECTION).doc(day);
  const data = { ...patch, date: day, updatedAt: FieldValue.serverTimestamp() };
  await ref.set(data, { merge: true });
}

export async function upsertPairSignalDoc(
  pair: string,
  positionId: string,
  day: string,
  patch: Record<string, any>
): Promise<void> {
  const yr = yearOf(day);
  const base = db.collection(PAIRS_COLLECTION).doc(pair).collection(SIGNALS_COLLECTION);
  try { await base.doc(yr).set({ bucket: YEAR_BUCKET_KIND, year: yr, kind: 'signals', updatedAt: FieldValue.serverTimestamp() }, { merge: true }); } catch {}
  const shardRef = base.doc(yr).collection(ITEMS_SUBCOLLECTION).doc(positionId);
  const data = { ...patch, updatedAt: FieldValue.serverTimestamp() };
  await shardRef.set(data, { merge: true });
}

export async function deleteRootSignalsDaily(day: string): Promise<void> {
  const base = db.collection(SIGNALS_DAILY_ROOT_COLLECTION);
  const yr = yearOf(day);
  const ref = base.doc(yr).collection(DAYS_SUBCOLLECTION).doc(day);
  try { await ref.delete(); } catch {}
}

function shouldKeepPositionInOpen(status: RsPositionStatus | string | undefined): boolean {
  return status === RsPositionStatus.OPEN || String(status).toLowerCase() === 'open';
}

export async function upsertRootPosition(
  positionId: string,
  day: string,
  status: RsPositionStatus | string | undefined,
  patch: Record<string, any>
): Promise<void> {
  const yrClosed = yearClosedOf(day);
  const base = db.collection(POSITIONS_COLLECTION);
  // Ensure bucket metadata docs exist for visibility
  try { await base.doc(OPEN_BUCKET_ID).set({ bucket: OPEN_BUCKET_ID, kind: COLLECTION_KIND_POSITIONS, updatedAt: FieldValue.serverTimestamp() }, { merge: true }); } catch {}
  try { await base.doc(yrClosed).set({ bucket: YEAR_BUCKET_KIND, year: yrClosed, kind: COLLECTION_KIND_POSITIONS, updatedAt: FieldValue.serverTimestamp() }, { merge: true }); } catch {}

  const openRef = base.doc(OPEN_BUCKET_ID).collection(ITEMS_SUBCOLLECTION).doc(positionId);
  const closedRef = base.doc(yrClosed).collection(ITEMS_SUBCOLLECTION).doc(positionId);
  const isOpen = shouldKeepPositionInOpen(status);
  const data = { ...patch, updatedAt: FieldValue.serverTimestamp() };
  if (isOpen) {
    await openRef.set(data, { merge: true });
    try { await closedRef.delete(); } catch {}
  } else {
    await closedRef.set(data, { merge: true });
    try { await openRef.delete(); } catch {}
  }
}

// ========================
// New helpers: BePositionDoc timeline (entry/updates/exit)
// These are additive and do not change existing behavior.
// ========================

export async function openRootPositionTimeline(args: {
  positionId: string;
  pair: string;
  baseline: string;
  symbol: string;
  direction: RsDirection;
  day: string;
  timestamp: number;
  price: number;
  rs?: number;
}): Promise<void> {
  const { positionId, pair, baseline, symbol, direction, day, timestamp, price, rs } = args;
  if (!pair || !baseline || !symbol) throw new Error('openRootPositionTimeline: missing identity fields');
  if (!Object.values(RsDirection).includes(direction)) throw new Error('openRootPositionTimeline: invalid direction');
  if (!Number.isFinite(price) || price <= 0) throw new Error('openRootPositionTimeline: price required');

  const entryDatum = buildPriceDatum({
    role: PriceDatumRole.ENTRY,
    day,
    timestamp,
    price,
    rs,
    source: 'post',
    entryPrice: price,
    direction,
  });

  const doc: BePositionDoc = {
    positionId,
    pair,
    baseline: baseline.toUpperCase(),
    symbol: symbol.toUpperCase(),
    direction,
    status: RsPositionStatus.OPEN,
    entry: entryDatum,
    updates: [],
  };

  const ref = db
    .collection(POSITIONS_COLLECTION)
    .doc(OPEN_BUCKET_ID)
    .collection(ITEMS_SUBCOLLECTION)
    .doc(positionId);

  await ref.set({ ...doc, createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() } as any, {
    merge: true,
  });
}

export async function appendRootPositionTimelineUpdate(args: {
  positionId: string;
  day: string;
  timestamp: number;
  price: number;
  rs?: number;
  source: 'pre' | 'post';
}): Promise<void> {
  const { positionId, day, timestamp, price, rs, source } = args;
  const openRef = db
    .collection(POSITIONS_COLLECTION)
    .doc(OPEN_BUCKET_ID)
    .collection(ITEMS_SUBCOLLECTION)
    .doc(positionId);

  const snap = await openRef.get();
  if (!snap.exists) return;
  const cur = snap.data() as any as BePositionDoc;

  const entryPrice = cur.entry.price;
  const direction = cur.direction;

  const updateDatum = buildPriceDatum({
    role: PriceDatumRole.UPDATE,
    day,
    timestamp,
    price,
    rs,
    source,
    entryPrice,
    direction,
  });

  const updates = Array.isArray(cur.updates) ? [...cur.updates, updateDatum] : [updateDatum];

  await openRef.set(
    {
      updates,
      updatedAt: FieldValue.serverTimestamp(),
    } as any,
    { merge: true },
  );
}

export async function closeRootPositionTimeline(args: {
  positionId: string;
  day: string;
  timestamp: number;
  price: number;
  rs?: number;
}): Promise<void> {
  const { positionId, day, timestamp, price, rs } = args;

  const openRef = db
    .collection(POSITIONS_COLLECTION)
    .doc(OPEN_BUCKET_ID)
    .collection(ITEMS_SUBCOLLECTION)
    .doc(positionId);

  const snap = await openRef.get();
  if (!snap.exists) return;

  const cur = snap.data() as any as BePositionDoc;
  const entryPrice = cur.entry.price;
  const direction = cur.direction;

  const exitDatum = buildPriceDatum({
    role: PriceDatumRole.EXIT,
    day,
    timestamp,
    price,
    rs,
    source: 'post',
    entryPrice,
    direction,
  });

  const netPnL = exitDatum.pnl;
  const netPercentReturn = exitDatum.pct;

  const yb = yearClosedOf(day);
  const base = db.collection(POSITIONS_COLLECTION);
  const closedRef = base.doc(yb).collection(ITEMS_SUBCOLLECTION).doc(positionId);

  const patch: Partial<BePositionDoc> = {
    status: RsPositionStatus.CLOSED,
    exit: exitDatum,
    netPnL,
    netPercentReturn,
  };

  await openRef.set({ ...patch, updatedAt: FieldValue.serverTimestamp() } as any, { merge: true });

  try {
    const latest = await openRef.get();
    if (latest.exists) {
      await closedRef.set(latest.data() as any, { merge: true });
    }
  } catch {}

  try {
    await openRef.delete();
  } catch {}
}

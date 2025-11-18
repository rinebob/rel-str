import { logger } from 'firebase-functions';
import { db, FieldValue } from '../firebase-admin-init';
import {
  POSITIONS_COLLECTION,
  OPEN_BUCKET_ID,
  PAIRS_COLLECTION,
  SIGNALS_DAILY_COLLECTION,
  SIGNALS_DAILY_ROOT_COLLECTION,
  ITEMS_SUBCOLLECTION,
  HOT_DAYS,
  YEAR_BUCKET_KIND,
  COLLECTION_KIND_SIGNALS_DAILY,
  COLLECTION_KIND_POSITIONS,
  yearClosedOf,
} from './webhooks-config';
import { RsPositionStatus, RsDirectionEnum } from '../types/rs-signal-history';

/**
 * Update all OPEN positions for the specified pair with current daily snapshot fields.
 * Uses target close for latestDay and computes side-aware deltas vs entryPrice.
 */
export async function updateOpenPositionsForPair(pairId: string, latestDay: string, latestTargetClose: number): Promise<void> {
  const col = db.collection(POSITIONS_COLLECTION).doc(OPEN_BUCKET_ID).collection(ITEMS_SUBCOLLECTION);
  const snap = await col.where('pair', '==', pairId).get();
  if (snap.empty) return;
  for (const d of snap.docs) {
    const v = d.data() as any;
    const side = v?.side as RsDirectionEnum; // LONG | SHORT
    const entryPx = Number(v?.entryPrice);
    const curPx = Number(latestTargetClose);
    const change = Number.isFinite(entryPx)
      ? (side === RsDirectionEnum.SHORT ? Number(entryPx - curPx) : Number(curPx - entryPx))
      : undefined;
    const pct = Number.isFinite(entryPx) && entryPx !== 0 && change != null ? Number((change / entryPx) * 100) : undefined;
    const patch: any = {
      currentPrice: curPx,
      ...(change != null ? { currentChange: change } : {}),
      ...(pct != null ? { currentPctChange: pct } : {}),
      lastUpdateDay: latestDay,
      updatedAt: FieldValue.serverTimestamp(),
    };
    await col.doc(d.id).set(patch, { merge: true });
  }
  logger.info('updateOpenPositionsForPair committed', { pairId, latestDay, docsUpdated: snap.size });
}

/**
 * Upsert daily holds for a pair for the given day based on currently OPEN positions.
 * Writes pairs-data/{pair}/signals-daily/{day}.holds = [{ positionId, direction }, ...]
 */
export async function upsertDailyHoldsForPair(pairId: string, day: string): Promise<void> {
  const col = db.collection(POSITIONS_COLLECTION).doc(OPEN_BUCKET_ID).collection(ITEMS_SUBCOLLECTION);
  const snap = await col.where('pair', '==', pairId).get();
  const holds: Array<{ positionId: string; direction?: string }> = [];
  for (const d of snap.docs) {
    const v = d.data() as any;
    const id = String(d.id);
    const dir = v?.side as RsDirectionEnum; // LONG | SHORT
    if (!id) continue;
    holds.push({ positionId: id, direction: dir });
  }
  await upsertPairSignalsDaily(
    pairId,
    day,
    { holds },
    { ensureHotIf: true, hotActions: { add: holds as Array<{ positionId: string; direction?: string }> } }
  );
}

/**
 * Finalize CLOSED positions for a pair on a specific day.
 * Reads pairs-data/{pair}/signals-daily/{day}.newCloses and signals/{positionId} for prices,
 * then writes exitPrice/exitDay/exitIso and netPnL/percentReturn to positions/{positionId}.
 */
export async function finalizeClosedPositionsForPair(pairId: string, day: string): Promise<void> {
  const dailyRef = db.collection(PAIRS_COLLECTION).doc(pairId).collection(SIGNALS_DAILY_COLLECTION).doc(day);
  const dailySnap = await dailyRef.get();
  if (!dailySnap.exists) return;
  const data = (dailySnap.data() as any) || {};
  const closes: Array<{ positionId: string; direction?: string }> = Array.isArray(data?.newCloses) ? data.newCloses : [];
  if (!closes.length) return;

  let ops = 0;
  for (const c of closes) {
    const id = String((c as any)?.positionId || '').trim();
    if (!id) continue;

    // Read per-position signals doc for precise open/close prices
    const sigRef = db.collection(PAIRS_COLLECTION).doc(pairId).collection('signals').doc(id);
    const sigSnap = await sigRef.get();
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

export function isDayInHot(day: string, hotDays: number = HOT_DAYS): boolean {
  const d = new Date(`${day}T00:00:00Z`);
  if (isNaN(d.getTime())) return false;
  const now = new Date();
  const todayUtc = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const msPerDay = 24 * 60 * 60 * 1000;
  const deltaDays = Math.floor((todayUtc.getTime() - d.getTime()) / msPerDay);
  return deltaDays >= 0 && deltaDays <= hotDays;
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
  if (!input?.entryIso) reasons.push('entryIso missing');
  if (!(Number.isFinite(input?.entryTimestamp))) reasons.push('entryTimestamp invalid');
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
  const timestampPatch = { createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() } as any;

  // Per-pair signals: open/items
  const sigOpenRef = db
    .collection('pairs-data').doc(pair)
    .collection('signals').doc(OPEN_BUCKET_ID)
    .collection(ITEMS_SUBCOLLECTION).doc(positionId);
  const perPairDoc = {
    pair,
    baseline: String(entry?.baseline || ''),
    symbol: String(entry?.symbol || ''),
    direction: side,
    positionId,
    opened: {
      day: entryDay,
      t: entryTimestamp,
      ...(entry?.opened?.source ? { source: entry?.opened?.source } : {}),
      openPrice: entryPrice,
      rsYesterday: entry?.opened?.rsYesterday,
      rsToday: entry?.opened?.rsToday,
    },
    status: 'open',
    ...timestampPatch,
  } as any;
  await sigOpenRef.set(perPairDoc, { merge: true });

  // Root positions: open/items mirror
  const posOpenRef = db.collection(POSITIONS_COLLECTION).doc(OPEN_BUCKET_ID).collection(ITEMS_SUBCOLLECTION).doc(positionId);
  const rootDoc = {
    positionId,
    pair,
    baseline: String(entry?.baseline || ''),
    symbol: String(entry?.symbol || ''),
    side,
    entryDay,
    entryIso,
    entryTimestamp,
    entryPrice,
    status: 'open',
    currentPrice: entryPrice,
    currentChange: 0,
    currentPctChange: 0,
    lastUpdateDay: entryDay,
    ...timestampPatch,
  } as any;
  await posOpenRef.set(rootDoc, { merge: true });
}

export async function finalizePairSignalClose(
  pair: string,
  positionId: string,
  day: string,
  exit: Record<string, any>
): Promise<void> {
  const yb = yearClosedOf(day);
  const base = db.collection('pairs-data').doc(pair).collection('signals');
  const openRef = base.doc(OPEN_BUCKET_ID).collection(ITEMS_SUBCOLLECTION).doc(positionId);
  const closedRef = base.doc(yb).collection(ITEMS_SUBCOLLECTION).doc(positionId);
  const patch = {
    exitPrice: Number(exit?.exitPrice ?? exit?.closed?.closePrice),
    exitDay: day,
    exitIso: String(exit?.exitIso ?? (exit?.closed?.day ? new Date(`${exit?.closed?.day}T00:00:00Z`).toISOString() : new Date(`${day}T00:00:00Z`).toISOString())),
    netPnL: Number(exit?.netPnL ?? exit?.closed?.change),
    percentReturn: Number(exit?.percentReturn ?? exit?.closed?.pctChange),
    status: 'closed',
    updatedAt: FieldValue.serverTimestamp(),
  } as any;
  await openRef.set(patch, { merge: true });
  try { const snap = await openRef.get(); if (snap.exists) await closedRef.set(snap.data() as any, { merge: true }); } catch {}
  try { await openRef.delete(); } catch {}
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
    status: 'open',
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
  const openRef = db.collection(POSITIONS_COLLECTION).doc(OPEN_BUCKET_ID).collection(ITEMS_SUBCOLLECTION).doc(positionId);
  const yb = yearClosedOf(day);
  const closedRef = db.collection(POSITIONS_COLLECTION).doc(yb).collection(ITEMS_SUBCOLLECTION).doc(positionId);
  const patch = {
    exitPrice: Number(exit?.exitPrice ?? exit?.closed?.closePrice),
    exitDay: day,
    exitIso: String(exit?.exitIso ?? (exit?.closed?.day ? new Date(`${exit?.closed?.day}T00:00:00Z`).toISOString() : new Date(`${day}T00:00:00Z`).toISOString())),
    netPnL: Number(exit?.netPnL ?? exit?.closed?.change),
    percentReturn: Number(exit?.percentReturn ?? exit?.closed?.pctChange),
    status: 'closed',
    updatedAt: FieldValue.serverTimestamp(),
  } as any;
  await openRef.set(patch, { merge: true });
  try { const snap = await openRef.get(); if (snap.exists) await closedRef.set(snap.data() as any, { merge: true }); } catch {}
  try { await openRef.delete(); } catch {}
}

export async function upsertPairSignalsDaily(
  pair: string,
  day: string,
  patch: Record<string, any>,
  opts?: {
    ensureHotIf?: boolean;
    hotActions?: {
      add?: Array<{ positionId: string; direction?: string }>;
      remove?: Array<{ positionId: string; direction?: string }>;
    };
  }
): Promise<void> {
  const yr = yearOf(day);
  const base = db.collection('pairs-data').doc(pair).collection(SIGNALS_DAILY_COLLECTION);
  try { await base.doc(yr).set({ bucket: YEAR_BUCKET_KIND, year: yr, kind: COLLECTION_KIND_SIGNALS_DAILY, updatedAt: FieldValue.serverTimestamp() }, { merge: true }); } catch {}
  const arcRef = base.doc(yr).collection('days').doc(day);
  const data = { ...patch, updatedAt: FieldValue.serverTimestamp() };
  await arcRef.set(data, { merge: true });
  const hotBase = base.doc('hot').collection(ITEMS_SUBCOLLECTION);
  const doHot = opts?.ensureHotIf || isDayInHot(day);
  if (doHot && opts?.hotActions) {
    const add = Array.isArray(opts.hotActions.add) ? opts.hotActions.add : [];
    const remove = Array.isArray(opts.hotActions.remove) ? opts.hotActions.remove : [];
    for (const it of add) {
      const id = String((it as any)?.positionId || '').trim();
      if (!id) continue;
      const dir = (it as any)?.direction ? String((it as any).direction).toUpperCase() : undefined;
      const hotDoc = { positionId: id, ...(dir ? { direction: dir } : {}), lastDay: day, updatedAt: FieldValue.serverTimestamp() } as any;
      try { await hotBase.doc(id).set(hotDoc, { merge: true }); } catch {}
    }
    for (const it of remove) {
      const id = String((it as any)?.positionId || '').trim();
      if (!id) continue;
      try { await hotBase.doc(id).delete(); } catch {}
    }
  }
}

export async function upsertRootSignalsDaily(
  day: string,
  patch: Record<string, any>
): Promise<void> {
  const yr = yearOf(day);
  const base = db.collection(SIGNALS_DAILY_ROOT_COLLECTION);
  try { await base.doc('hot').set({ bucket: 'hot', kind: COLLECTION_KIND_SIGNALS_DAILY, updatedAt: FieldValue.serverTimestamp() }, { merge: true }); } catch {}
  try { await base.doc(yr).set({ bucket: YEAR_BUCKET_KIND, year: yr, kind: COLLECTION_KIND_SIGNALS_DAILY, updatedAt: FieldValue.serverTimestamp() }, { merge: true }); } catch {}
  const legacyRef = base.doc(day);
  const hotRef = base.doc('hot').collection('days').doc(day);
  const arcRef = base.doc(yr).collection('days').doc(day);
  const inHot = isDayInHot(day);
  const data = { ...patch, updatedAt: FieldValue.serverTimestamp() };
  await arcRef.set(data, { merge: true });
  await legacyRef.set(data, { merge: true });
  if (inHot) {
    await hotRef.set(data, { merge: true });
  } else {
    try { await hotRef.delete(); } catch {}
  }
}

export async function upsertPairSignalDoc(
  pair: string,
  positionId: string,
  day: string,
  patch: Record<string, any>
): Promise<void> {
  const yr = yearOf(day);
  const base = db.collection('pairs-data').doc(pair).collection('signals');
  try { await base.doc(yr).set({ bucket: YEAR_BUCKET_KIND, year: yr, kind: 'signals', updatedAt: FieldValue.serverTimestamp() }, { merge: true }); } catch {}
  const legacyRef = base.doc(positionId);
  const shardRef = base.doc(yr).collection(ITEMS_SUBCOLLECTION).doc(positionId);
  const data = { ...patch, updatedAt: FieldValue.serverTimestamp() };
  await legacyRef.set(data, { merge: true });
  await shardRef.set(data, { merge: true });
}

export async function deleteRootSignalsDaily(day: string): Promise<void> {
  const yr = yearOf(day);
  const base = db.collection(SIGNALS_DAILY_ROOT_COLLECTION);
  const legacyRef = base.doc(day);
  const hotRef = base.doc('hot').collection('days').doc(day);
  const arcRef = base.doc(yr).collection('days').doc(day);
  try { await hotRef.delete(); } catch {}
  try { await arcRef.delete(); } catch {}
  try { await legacyRef.delete(); } catch {}
}

function shouldKeepPositionInHot(status: RsPositionStatus | string | undefined, day: string): boolean {
  return isDayInHot(day);
}

export async function upsertRootPosition(
  positionId: string,
  day: string,
  status: RsPositionStatus | string | undefined,
  patch: Record<string, any>
): Promise<void> {
  const yr = yearOf(day);
  const base = db.collection(POSITIONS_COLLECTION);
  try { await base.doc('hot').set({ bucket: 'hot', kind: COLLECTION_KIND_POSITIONS, updatedAt: FieldValue.serverTimestamp() }, { merge: true }); } catch {}
  try { await base.doc(yr).set({ bucket: YEAR_BUCKET_KIND, year: yr, kind: COLLECTION_KIND_POSITIONS, updatedAt: FieldValue.serverTimestamp() }, { merge: true }); } catch {}
  const legacyRef = base.doc(positionId);
  const hotRef = base.doc('hot').collection(ITEMS_SUBCOLLECTION).doc(positionId);
  const arcRef = base.doc(yr).collection(ITEMS_SUBCOLLECTION).doc(positionId);
  const keepHot = shouldKeepPositionInHot(status, day);
  const data = { ...patch, updatedAt: FieldValue.serverTimestamp() };
  await legacyRef.set(data, { merge: true });
  await arcRef.set(data, { merge: true });
  if (keepHot) {
    await hotRef.set(data, { merge: true });
  } else {
    try { await hotRef.delete(); } catch {}
  }
}

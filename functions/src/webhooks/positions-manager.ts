import { logger } from 'firebase-functions';
import { db, FieldValue } from '../firebase-admin-init';
import {
  POSITIONS_COLLECTION,
  OPEN_BUCKET_ID,
  PAIRS_COLLECTION,
  SIGNALS_COLLECTION,
  ITEMS_SUBCOLLECTION,
  YEAR_BUCKET_KIND,
  COLLECTION_KIND_POSITIONS,
  yearClosedOf,
  SIGNALS_OPENS_SUBCOLLECTION,
  SIGNALS_CLOSES_SUBCOLLECTION,
  RsEventKind,
} from './webhooks-config';
import { RsPositionStatus, RsDirection, BeOpenSignalDoc, BeCloseSignalDoc, RsSource, PriceDatumRole, Interval } from '../types/signal.types';
import { yearOf, getDowCodeFromDate, getIntervalCode } from './id-utils';
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
  rsRaw: number,
  rsNorm: number,
  prevRsRaw: number,
  prevRsNorm: number,
  source: RsSource,
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
        rsRaw,
        rsNorm,
        prevRsRaw,
        prevRsNorm,
        source,
      });
    } catch {
      // best-effort; keep going for other positions
    }
  }
}


// ========================
// Utilities and Live Open/Close helpers migrated from hot-archive.ts
// ========================

function buildSignalId(day: string, pair: string, interval: Interval, direction: RsDirection, kind: RsEventKind): string {
  const d = new Date(`${day}T00:00:00Z`);
  const dow = getDowCodeFromDate(d);
  const ymd = day.replace(/-/g, '');
  const intervalCode = getIntervalCode(interval);
  const dirCode = String(direction).toUpperCase();
  const kindLabel = kind;
  return `${ymd}-${dow}-${intervalCode}-${pair}-${dirCode}-${kindLabel}`;
}

function buildPriceDatum(args: {
  role: PriceDatumRole;
  day: string;
  timestamp: number;
  price: number;
  rsRaw: number;
  rsNorm: number;
  source: RsSource;
  entryPrice: number;
  direction: RsDirection;
  ch: number;
  cp: number;
  prevRsRaw?: number;
  prevRsNorm?: number;
}): PriceDatum {
  const { role, day, timestamp, price, rsRaw, rsNorm, source, entryPrice, direction, ch, cp, prevRsRaw, prevRsNorm } = args;

  let pnl = 0;
  if (role !== PriceDatumRole.ENTRY) {
    const raw = direction === RsDirection.SHORT
      ? entryPrice - price
      : price - entryPrice;
    pnl = Number(raw);
  }
  const pct = entryPrice !== 0 ? Number((pnl / entryPrice) * 100) : 0;

  const base: PriceDatum = {
    role,
    day,
    dow: getDowCodeFromDate(new Date(`${day}T00:00:00Z`)),
    timestamp,
    price,
    rsRaw,
    rsNorm,
    source,
    pnl,
    pct,
    ch,
    cp,
  };

  if (prevRsRaw !== undefined) {
    base.prevRsRaw = prevRsRaw;
  }
  if (prevRsNorm !== undefined) {
    base.prevRsNorm = prevRsNorm;
  }

  return base;
}

function validateOpenSignalInput(input: {
  pair?: string;
  baseline?: string;
  symbol?: string;
  direction?: RsDirection;
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
  if (!input?.direction) reasons.push('direction missing');
  if (!input?.positionId) reasons.push('positionId missing');
  const day = String(input?.entryDay || '');
  if (!/\d{4}-\d{2}-\d{2}/.test(day)) reasons.push('entryDay invalid');
  if (!(Number.isFinite(input?.entryPrice))) reasons.push('entryPrice missing');
  return { ok: reasons.length === 0, reasons: reasons.length ? reasons : undefined };
}

interface RootOpenInput {
  pair: string;
  baseline: string;
  symbol: string;
  direction: RsDirection;
  entryDay?: string;
  entryIso?: string;
  entryTimestamp?: number;
  entryPrice: number;
}

interface OpenSignalEntryPayload {
  baseline: string;
  symbol: string;
  direction: RsDirection;

  entryDay?: string;
  entryIso?: string;
  entryTimestamp?: number;
  entryPrice?: number;

  opened?: {
    day?: string;
    t?: number;
    rsYesterday?: number;
    rsToday?: number;
    rsNormYesterday?: number;
    rsNormToday?: number;
    openPrice?: number;
    source?: RsSource;
  };
}

export async function writePairSignalOpen(
  pair: string,
  positionId: string,
  day: string,
  entry: OpenSignalEntryPayload,
  interval: Interval,
): Promise<void> {
  const v = validateOpenSignalInput({
    pair,
    baseline: entry.baseline,
    symbol: entry.symbol,
    direction: entry.direction,
    positionId,
    entryDay: entry.entryDay || day || entry.opened?.day,
    entryIso: entry.entryIso,
    entryTimestamp: entry.entryTimestamp || entry.opened?.t,
    entryPrice: entry.entryPrice || entry.opened?.openPrice,
  });
  if (!v.ok) throw new Error(`invalid open input: ${JSON.stringify(v.reasons)}`);
  const direction = entry.direction;
  const entryDay = String(entry.entryDay || day || entry.opened?.day);
  const entryIso = String(entry.entryIso || new Date(`${entryDay}T00:00:00Z`).toISOString());
  const entryTimestamp = Number(entry.entryTimestamp || entry.opened?.t || new Date(entryIso).getTime());
  const entryPrice = Number(entry.entryPrice || entry.opened?.openPrice);
  if (!Number.isFinite(entryPrice) || entryPrice <= 0) throw new Error('entryPrice is required for open creation');

  const baseline = String(entry.baseline || '').toUpperCase();
  const symbol = String(entry.symbol || '').toUpperCase();
  const rsTodayRaw = Number(entry.opened?.rsToday ?? Number.NaN);
  const rsYesterdayRaw = Number(entry.opened?.rsYesterday ?? Number.NaN);
  const rsNormToday = Number(entry.opened?.rsNormToday ?? Number.NaN);
  const rsNormYesterday = Number(entry.opened?.rsNormYesterday ?? Number.NaN);

  if (!Number.isFinite(rsTodayRaw) || !Number.isFinite(rsYesterdayRaw) || !Number.isFinite(rsNormToday) || !Number.isFinite(rsNormYesterday)) {
    throw new Error('writePairSignalOpen: rsToday/rsYesterday and rsNormToday/rsNormYesterday are required and must be finite');
  }

  const yr = yearOf(entryDay);
  const dirEnum = direction;
  const signalId = buildSignalId(entryDay, pair, interval, dirEnum, RsEventKind.OPEN);
  const entryDow = getDowCodeFromDate(new Date(`${entryDay}T00:00:00Z`));

  const signalDoc: BeOpenSignalDoc = {
    signalId,
    baseline,
    symbol,
    direction: dirEnum,
    day: entryDay,
    dow: entryDow,
    timestamp: entryTimestamp,
    price: entryPrice,
    rsRaw: rsTodayRaw,
    rsNorm: rsNormToday,
    prevRs: rsYesterdayRaw,
    source: RsSource.POST,
    positionId,
    interval,
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

interface CloseSignalExitPayload {
  baseline?: string;
  symbol?: string;
  direction?: RsDirection | string;
  exitPrice?: number;
  openSignalId?: string;
  closed?: {
    day?: string;
    t?: number;
    rsYesterday?: number;
    rsToday?: number;
    rsNormYesterday?: number;
    rsNormToday?: number;
    closePrice?: number;
    direction?: RsDirection | string;
  };
}

export async function finalizePairSignalClose(
  pair: string,
  positionId: string,
  day: string,
  exit: CloseSignalExitPayload,
  interval: Interval,
): Promise<void> {
  const closePrice = Number(exit.exitPrice ?? exit.closed?.closePrice);
  const rsTodayRaw = Number(exit.closed?.rsToday ?? Number.NaN);
  const rsYesterdayRaw = Number(exit.closed?.rsYesterday ?? Number.NaN);
  const rsNormToday = Number(exit.closed?.rsNormToday ?? Number.NaN);
  const rsNormYesterday = Number(exit.closed?.rsNormYesterday ?? Number.NaN);

  if (!Number.isFinite(rsTodayRaw) || !Number.isFinite(rsYesterdayRaw) || !Number.isFinite(rsNormToday) || !Number.isFinite(rsNormYesterday)) {
    throw new Error('finalizePairSignalClose: rsToday/rsYesterday and rsNormToday/rsNormYesterday are required and must be finite');
  }

  const yr = yearOf(day);
  const directionRaw = String(exit.closed?.direction || exit.direction || '').toUpperCase();
  const direction = directionRaw === 'SHORT' ? RsDirection.SHORT : RsDirection.LONG;
  const baseline = String(exit.baseline || '').toUpperCase();
  const symbol = String(exit.symbol || '').toUpperCase();

  const d = new Date(`${day}T00:00:00Z`);
  const dow = getDowCodeFromDate(d);
  const timestamp = Number(exit.closed?.t ?? d.getTime());

  const m = /^([0-9]{8})-/.exec(positionId);
  if (!m) {
    throw new Error(`finalizePairSignalClose: invalid positionId format: ${positionId}`);
  }
  const ymd = m[1];
  const openSignalDay = `${ymd.slice(0, 4)}-${ymd.slice(4, 6)}-${ymd.slice(6, 8)}`;

  const openSignalId = String(
    exit.openSignalId || buildSignalId(openSignalDay, pair, interval, direction, RsEventKind.OPEN),
  );
  const signalId = buildSignalId(day, pair, interval, direction, RsEventKind.CLOSE);

  const closeDoc: BeCloseSignalDoc = {
    signalId,
    baseline,
    symbol,
    direction,
    day,
    dow,
    timestamp,
    price: closePrice,
    rsRaw: rsTodayRaw,
    rsNorm: rsNormToday,
    prevRs: rsYesterdayRaw,
    source: RsSource.POST,
    positionId,
    openSignalId,
    interval,
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
  entry: RootOpenInput,
): Promise<void> {
  const pair = String(entry?.pair || '');
  const direction = entry.direction;
  if (!pair || !direction) throw new Error('invalid root open input');
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
    direction,
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
  const rsNorm = Number(exit?.closed?.rsNormToday ?? Number.NaN);
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
    rsRaw: rawRs,
    rsNorm,
    prevRsRaw: rawRs,
    prevRsNorm: rsNorm,
  });
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
  rsRaw: number;
  rsNorm: number;
  prevRsRaw: number;
  prevRsNorm: number;
  interval: Interval;
}): Promise<void> {
  const { positionId, pair, baseline, symbol, direction, day, timestamp, price, rsRaw, rsNorm, prevRsRaw, prevRsNorm, interval } = args;
  if (!pair || !baseline || !symbol) throw new Error('openRootPositionTimeline: missing identity fields');
  if (!Object.values(RsDirection).includes(direction)) throw new Error('openRootPositionTimeline: invalid direction');
  if (!Number.isFinite(price) || price <= 0) throw new Error('openRootPositionTimeline: price required');
  if (!Number.isFinite(rsRaw) || !Number.isFinite(rsNorm)) throw new Error('openRootPositionTimeline: rsRaw and rsNorm are required');

  const entryDatum = buildPriceDatum({
    role: PriceDatumRole.ENTRY,
    day,
    timestamp,
    price,
    rsRaw,
    rsNorm,
    source: RsSource.POST,
    entryPrice: price,
    direction,
    ch: 0,
    cp: 0,
    prevRsRaw,
    prevRsNorm,
  });

  const doc: BePositionDoc = {
    positionId,
    pair,
    baseline: baseline.toUpperCase(),
    symbol: symbol.toUpperCase(),
    direction,
    interval,
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
  rsRaw: number;
  rsNorm: number;
  prevRsRaw: number;
  prevRsNorm: number;
  source: RsSource;
}): Promise<void> {
  const { positionId, day, timestamp, price, rsRaw, rsNorm, prevRsRaw, prevRsNorm, source } = args;
  const base = db.collection(POSITIONS_COLLECTION);
  const openRef = base.doc(OPEN_BUCKET_ID).collection(ITEMS_SUBCOLLECTION).doc(positionId);

  let snap = await openRef.get();
  let targetRef = openRef;

  if (!snap.exists) {
    // Fallback: position already closed; append updates on the closed doc.
    const closedBucketId = yearClosedOf(day);
    const closedRef = base.doc(closedBucketId).collection(ITEMS_SUBCOLLECTION).doc(positionId);
    const closedSnap = await closedRef.get();
    if (!closedSnap.exists) return;
    snap = closedSnap;
    targetRef = closedRef;
  }

  const cur = snap.data() as any as BePositionDoc;

  const entryPrice = cur.entry.price;
  const direction = cur.direction;

  let prevPrice = entryPrice;
  if (Array.isArray(cur.updates) && cur.updates.length > 0) {
    const last = cur.updates[cur.updates.length - 1] as PriceDatum;
    if (typeof last.price === 'number') {
      prevPrice = last.price;
    }
  }

  const ch = price - prevPrice;
  const cp = prevPrice !== 0 ? Number((ch / prevPrice) * 100) : 0;

  if (!Number.isFinite(rsRaw) || !Number.isFinite(rsNorm)) throw new Error('appendRootPositionTimelineUpdate: rsRaw and rsNorm are required');

  const updateDatum = buildPriceDatum({
    role: PriceDatumRole.UPDATE,
    day,
    timestamp,
    price,
    rsRaw,
    rsNorm,
    source,
    entryPrice,
    direction,
    ch,
    cp,
    prevRsRaw,
    prevRsNorm,
  });

  const updates = Array.isArray(cur.updates) ? [...cur.updates, updateDatum] : [updateDatum];

  await targetRef.set(
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
  rsRaw: number;
  rsNorm: number;
  prevRsRaw: number;
  prevRsNorm: number;
}): Promise<void> {
  const { positionId, day, timestamp, price, rsRaw, rsNorm, prevRsRaw, prevRsNorm } = args;

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

  let prevPrice = entryPrice;
  if (Array.isArray(cur.updates) && cur.updates.length > 0) {
    const last = cur.updates[cur.updates.length - 1] as PriceDatum;
    if (typeof last.price === 'number') {
      prevPrice = last.price;
    }
  }

  const ch = price - prevPrice;
  const cp = prevPrice !== 0 ? Number((ch / prevPrice) * 100) : 0;

  const exitDatum = buildPriceDatum({
    role: PriceDatumRole.EXIT,
    day,
    timestamp,
    price,
    rsRaw,
    rsNorm,
    source: RsSource.POST,
    entryPrice,
    direction,
    ch,
    cp,
    prevRsRaw,
    prevRsNorm,
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

import { db, FieldValue } from '../firebase-admin-init';
import { SIGNALS_DAILY_COLLECTION, SIGNALS_DAILY_ROOT_COLLECTION, HOT_DAYS, POSITIONS_COLLECTION, HOT_BUCKET_ID, YEAR_BUCKET_KIND, COLLECTION_KIND_SIGNALS_DAILY, COLLECTION_KIND_POSITIONS } from './webhooks-config';
import type { RsPositionStatus } from '../types/rs-signal-history';

/** Compute YYYY from a day string YYYY-MM-DD (UTC). */
export function yearOf(day: string): string {
  return String(day || '').slice(0, 4);
}

/** True if the provided day is within HOT_DAYS horizon from today (UTC). */
export function isDayInHot(day: string, hotDays: number = HOT_DAYS): boolean {
  const d = new Date(`${day}T00:00:00Z`);
  if (isNaN(d.getTime())) return false;
  const now = new Date();
  const todayUtc = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const msPerDay = 24 * 60 * 60 * 1000;
  const deltaDays = Math.floor((todayUtc.getTime() - d.getTime()) / msPerDay);
  return deltaDays >= 0 && deltaDays <= hotDays;
}

/** Dual-write per-pair signals-daily to hot and archive shards. */
export async function upsertPairSignalsDaily(
  pair: string,
  day: string,
  patch: Record<string, any>,
  opts?: { ensureHotIf?: boolean }
): Promise<void> {
  const yr = yearOf(day);
  const base = db.collection('pairs-data').doc(pair).collection(SIGNALS_DAILY_COLLECTION);
  // Ensure parent bucket docs exist with minimal metadata to avoid phantom containers
  try { await base.doc(HOT_BUCKET_ID).set({ bucket: HOT_BUCKET_ID, kind: COLLECTION_KIND_SIGNALS_DAILY, updatedAt: FieldValue.serverTimestamp() }, { merge: true }); } catch {}
  try { await base.doc(yr).set({ bucket: YEAR_BUCKET_KIND, year: yr, kind: COLLECTION_KIND_SIGNALS_DAILY, updatedAt: FieldValue.serverTimestamp() }, { merge: true }); } catch {}
  const legacyRef = base.doc(day);
  const hotRef = base.doc('hot').collection('days').doc(day);
  const arcRef = base.doc(yr).collection('days').doc(day);
  const inHot = isDayInHot(day);

  const data = { ...patch, updatedAt: FieldValue.serverTimestamp() };
  // Always upsert archive
  await arcRef.set(data, { merge: true });
  // Also upsert legacy flat doc to maintain current readers until migrated
  await legacyRef.set(data, { merge: true });

  // Hot write if in horizon OR forced
  if (inHot || opts?.ensureHotIf) {
    await hotRef.set(data, { merge: true });
  } else {
    // Best-effort hot eviction if it exists and not forced to keep
    try { await hotRef.delete(); } catch {}
  }
}

/** Dual-write root signals-daily mirror to hot and archive shards. */
export async function upsertRootSignalsDaily(
  day: string,
  patch: Record<string, any>
): Promise<void> {
  const yr = yearOf(day);
  const base = db.collection(SIGNALS_DAILY_ROOT_COLLECTION);
  // Ensure parent bucket docs exist with minimal metadata to avoid phantom containers
  try { await base.doc(HOT_BUCKET_ID).set({ bucket: HOT_BUCKET_ID, kind: COLLECTION_KIND_SIGNALS_DAILY, updatedAt: FieldValue.serverTimestamp() }, { merge: true }); } catch {}
  try { await base.doc(yr).set({ bucket: YEAR_BUCKET_KIND, year: yr, kind: COLLECTION_KIND_SIGNALS_DAILY, updatedAt: FieldValue.serverTimestamp() }, { merge: true }); } catch {}
  const legacyRef = base.doc(day);
  const hotRef = base.doc(HOT_BUCKET_ID).collection('days').doc(day);
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

/** Delete root signals-daily mirror (both hot and archive for that day) if present. */
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

/** Determine whether a position doc should be retained in HOT based on status/day. */
function shouldKeepPositionInHot(status: RsPositionStatus | string | undefined, day: string): boolean {
  const st = String(status || '').toUpperCase();
  if (st === 'OPEN') return true; // always keep open positions hot
  return isDayInHot(day); // for CLOSED or others, keep within horizon by provided day
}

/** Dual-write root positions to hot and archive shards, plus legacy root doc for migration. */
export async function upsertRootPosition(
  positionId: string,
  day: string,
  status: RsPositionStatus | string | undefined,
  patch: Record<string, any>
): Promise<void> {
  const yr = yearOf(day);
  const base = db.collection(POSITIONS_COLLECTION);
  // Ensure parent bucket docs exist with minimal metadata to avoid phantom containers
  try { await base.doc(HOT_BUCKET_ID).set({ bucket: HOT_BUCKET_ID, kind: COLLECTION_KIND_POSITIONS, updatedAt: FieldValue.serverTimestamp() }, { merge: true }); } catch {}
  try { await base.doc(yr).set({ bucket: YEAR_BUCKET_KIND, year: yr, kind: COLLECTION_KIND_POSITIONS, updatedAt: FieldValue.serverTimestamp() }, { merge: true }); } catch {}
  const legacyRef = base.doc(positionId);
  const hotRef = base.doc(HOT_BUCKET_ID).collection('items').doc(positionId);
  const arcRef = base.doc(yr).collection('items').doc(positionId);
  const keepHot = shouldKeepPositionInHot(status, day);
  const data = { ...patch, updatedAt: FieldValue.serverTimestamp() };
  // Legacy flat doc for back-compat
  await legacyRef.set(data, { merge: true });
  // Archive always
  await arcRef.set(data, { merge: true });
  if (keepHot) {
    await hotRef.set(data, { merge: true });
  } else {
    try { await hotRef.delete(); } catch {}
  }
}

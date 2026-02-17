import { onCall } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions';
import { Timestamp } from 'firebase-admin/firestore';
import { db } from '../../firebase-admin-init';
import {
  PAIRS_COLLECTION,
  ARCHIVE_COLLECTION_PREFIX,
  REGISTRY_COLLECTION,
  HEATMAP_SNAPSHOTS_COLLECTION,
} from '../../webhooks/webhooks-config';

interface HeatmapSnapshotViewportV1 {
  baseline: string;
  timeframe: string;
  updatedAt: FirebaseFirestore.Timestamp;
  pairs: string[];
  dates: string[];
  /**
   * Raw RS values per pair. Firestore does not allow nested arrays, so we
   * wrap each row in an object instead of using number[][] directly.
   * The index of each row in this array corresponds to the index in `pairs`.
   */
  rows: Array<{
    pair: string;
    values: number[];
  }>;
  version: 1;
}

async function loadDailyRsRawSeriesForPair(
  pairId: string,
  fromStr: string,
  toStr: string,
): Promise<Array<{ day: string; rsRaw: number }>> {
  const out: Array<{ day: string; rsRaw: number }> = [];
  const pairRef = db.collection(PAIRS_COLLECTION).doc(pairId);

  const fromYear = Number(fromStr.slice(0, 4));
  const toYear = Number(toStr.slice(0, 4));

  for (let y = fromYear; y <= toYear; y++) {
    const yearStr = String(y);
    const archiveCol = `${ARCHIVE_COLLECTION_PREFIX}${yearStr}`;
    const daysCol = pairRef.collection(archiveCol);

    const yearFrom = `${yearStr}-01-01`;
    const yearTo = `${yearStr}-12-31`;
    const lower = fromStr > yearFrom ? fromStr : yearFrom;
    const upper = toStr < yearTo ? toStr : yearTo;

    const q = daysCol
      .where('day', '>=', lower)
      .where('day', '<=', upper)
      .orderBy('day', 'asc');

    const snap = await q.get();
    for (const doc of snap.docs) {
      const d = (doc.data() as any) || {};
      const day: string = String(d?.day || '');
      if (!day || day < fromStr || day > toStr) continue;
      const post = d.post as any;
      const rsRaw = Number(post?.rsRaw);
      if (!Number.isFinite(rsRaw)) continue;
      out.push({ day: day.slice(0, 10), rsRaw });
    }
  }

  out.sort((a, b) => a.day.localeCompare(b.day));
  return out;
}

/**
 * Build a DAILY viewport snapshot matrix for a given baseline using RS archive data.
 *
 * - Universe: all pair-registry docs whose id starts with `${baseline}-`.
 * - Date window: last ~120 calendar days from today, then compressed to the
 *   last 60 distinct trading days with data.
 * - Metric: rsRaw from archive POST records; matrix is [pairIndex][dateIndex].
 */
async function generateDailyViewportSnapshotForBaseline(baseline: string): Promise<HeatmapSnapshotViewportV1> {
  const upperTimeframe = 'DAILY';
  const today = new Date();
  const toStr = today.toISOString().slice(0, 10);
  const fromDate = new Date(today.getTime() - 120 * 24 * 60 * 60 * 1000);
  const fromStr = fromDate.toISOString().slice(0, 10);

  const registrySnap = await db.collection(REGISTRY_COLLECTION).get();
  const pairs: string[] = [];
  registrySnap.forEach((doc) => {
    const id = doc.id || '';
    if (id.startsWith(`${baseline}-`)) {
      pairs.push(id);
    }
  });

  pairs.sort();

  const perPair: Record<string, Array<{ day: string; rsRaw: number }>> = {};
  const daySet = new Set<string>();

  for (const pairId of pairs) {
    try {
      const series = await loadDailyRsRawSeriesForPair(pairId, fromStr, toStr);
      perPair[pairId] = series;
      for (const s of series) {
        daySet.add(s.day);
      }
    } catch (e: any) {
      logger.warn('viewport_snapshot_pair_failed', { pairId, message: e?.message });
      perPair[pairId] = [];
    }
  }

  const allDays = Array.from(daySet.values()).sort((a, b) => a.localeCompare(b));
  const viewportDays = allDays.slice(Math.max(0, allDays.length - 60));

  const rows: Array<{ pair: string; values: number[] }> = [];
  for (const pairId of pairs) {
    const series = perPair[pairId] || [];
    const byDay = new Map<string, number>();
    for (const s of series) byDay.set(s.day, s.rsRaw);
    const row: number[] = [];
    for (const d of viewportDays) {
      const v = byDay.get(d);
      row.push(Number.isFinite(v as number) ? (v as number) : 0);
    }
    rows.push({ pair: pairId, values: row });
  }

  return {
    baseline,
    timeframe: upperTimeframe,
    updatedAt: Timestamp.now(),
    pairs,
    dates: viewportDays,
    rows,
    version: 1,
  };
}

/**
 * Admin-only callable to rebuild a viewport snapshot for a given baseline/timeframe.
 *
 * - Currently supports DAILY timeframe only.
 * - Writes `heatmap-snapshots/{baseline}-{timeframe}-viewport` with a
 *   HeatmapSnapshotViewportV1 document.
 */
export const rebuildHeatmapSnapshotAdmin = onCall({ region: 'us-central1', timeoutSeconds: 540 }, async (req) => {
  const baseline = String(req.data?.baseline || '').trim().toUpperCase();
  const timeframe = String(req.data?.timeframe || 'DAILY').trim().toUpperCase();

  if (!baseline) {
    logger.warn('rebuildHeatmapSnapshotAdmin_missing_baseline');
    return { ok: false, message: 'Missing baseline' };
  }

  if (timeframe !== 'DAILY') {
    logger.warn('rebuildHeatmapSnapshotAdmin_unsupported_timeframe', { timeframe });
    return { ok: false, message: 'Only DAILY timeframe supported for viewport snapshot v1' };
  }

  try {
    const snapshot = await generateDailyViewportSnapshotForBaseline(baseline);
    const docId = `${baseline}-${timeframe}-viewport`;
    await db.collection(HEATMAP_SNAPSHOTS_COLLECTION).doc(docId).set(snapshot, { merge: false });
    logger.info('rebuildHeatmapSnapshotAdmin_success', {
      baseline,
      timeframe,
      pairs: snapshot.pairs.length,
      dates: snapshot.dates.length,
    });
    return { ok: true, baseline, timeframe, pairs: snapshot.pairs.length, dates: snapshot.dates.length };
  } catch (e: any) {
    logger.error('rebuildHeatmapSnapshotAdmin_failed', { baseline, timeframe, message: e?.message });
    return { ok: false, baseline, timeframe, message: e?.message };
  }
});

import { onCall } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions/v2';
import { db, FieldValue } from './firebase-admin-init';
import { PAIRS_COLLECTION, POSITIONS_COLLECTION, SIGNALS_DAILY_ROOT_COLLECTION, SILENCE_ADMIN_INFO, SIGNALS_DAILY_COLLECTION, OPEN_BUCKET_ID, DAYS_SUBCOLLECTION, SIGNALS_COLLECTION, ITEMS_SUBCOLLECTION, YEAR_BUCKET_KIND, COLLECTION_KIND_POSITIONS } from './webhooks/webhooks-config';
import { upsertPairSignalsDaily } from './webhooks/positions-manager';

/**
 * Admin: purgePairsDataRootDataField
 * One-time cleanup to remove legacy root 'data' array from all pairs-data/{PAIR} docs.
 */
export const purgePairsDataRootDataField = onCall({ region: 'us-central1', timeoutSeconds: 540 }, async (): Promise<{ ok: boolean; pairs: number; updated: number }> => {
  const col = db.collection(PAIRS_COLLECTION);
  const snap = await col.select().get();
  let updated = 0;
  let batch = db.batch();
  let ops = 0;
  for (const d of snap.docs) {
    const ref = col.doc(d.id);
    batch.set(ref, { data: FieldValue.delete() }, { merge: true });
    ops++; updated++;
    if (ops >= 400) { await batch.commit(); batch = db.batch(); ops = 0; }
  }
  if (ops > 0) { await batch.commit(); }
  if (!SILENCE_ADMIN_INFO) logger.info('purgePairsDataRootDataField done', { pairs: snap.size, updated });
  return { ok: true, pairs: snap.size, updated };
});

/**
 * Admin: purgeNonYearShardRootDocs
 * Deletes all root-level docs from positions and signals-daily collections whose ids are not allowed years.
 * Default allowed years: ['2024', '2025'].
 */
export const purgeNonYearShardRootDocs = onCall(
  { region: 'us-central1', timeoutSeconds: 540 },
  async (req): Promise<{ ok: boolean; collections: Array<{ name: string; scanned: number; deleted: number }> }> => {
    const allowYears: string[] = Array.isArray(req?.data?.allowYears) && req.data.allowYears.length
      ? req.data.allowYears.map((x: any) => String(x))
      : ['2024', '2025'];

    const results: Array<{ name: string; scanned: number; deleted: number }> = [];

    async function purgeCollection(rootName: string): Promise<void> {
      const col = db.collection(rootName);
      const snap = await col.select().get();
      let deleted = 0;
      let batch = db.batch();
      let ops = 0;
      for (const d of snap.docs) {
        const id = String(d.id);
        const keep = allowYears.includes(id) || id === OPEN_BUCKET_ID;
        if (!keep) {
          batch.delete(col.doc(id));
          ops++; deleted++;
          if (ops >= 400) { await batch.commit(); batch = db.batch(); ops = 0; }
        }
      }
      if (ops > 0) { await batch.commit(); }
      results.push({ name: rootName, scanned: snap.size, deleted });
      if (!SILENCE_ADMIN_INFO) logger.info('purgeNonYearShardRootDocs pass', { root: rootName, scanned: snap.size, deleted, allowYears });
    }

    await purgeCollection(POSITIONS_COLLECTION);
    await purgeCollection(SIGNALS_DAILY_ROOT_COLLECTION);

    return { ok: true, collections: results };
  }
);

/**
 * Admin: backfillPositionsBucketMetadata
 * Ensures all root-level bucket docs under `positions` have metadata matching the
 * shape written in upsertRootPosition (open + year-closed buckets).
 *
 * For each doc under positions/{id}:
 * - If id === OPEN_BUCKET_ID, upserts: { bucket: OPEN_BUCKET_ID, kind: COLLECTION_KIND_POSITIONS, updatedAt }
 * - If id looks like a year or year-closed (e.g. '2025' or '2025-closed'), upserts:
 *   { bucket: YEAR_BUCKET_KIND, year: <YYYY-closed>, kind: COLLECTION_KIND_POSITIONS, updatedAt }
 */
export const backfillPositionsBucketMetadata = onCall(
  { region: 'us-central1', timeoutSeconds: 540 },
  async (req): Promise<{ ok: boolean; buckets: string[] }> => {
    const base = db.collection(POSITIONS_COLLECTION);
    const bucketIds: string[] = Array.isArray(req?.data?.bucketIds)
      ? (req.data.bucketIds as any[]).map((x) => String(x)).filter(Boolean)
      : [];

    if (bucketIds.length === 0) {
      throw new Error('bucketIds required: e.g. ["open", "2024-closed", "2025-closed"]');
    }

    const buckets: string[] = [];
    let batch = db.batch();
    let ops = 0;

    for (const idRaw of bucketIds) {
      const id = String(idRaw);
      const ref = base.doc(id);

      if (id === OPEN_BUCKET_ID) {
        const patch: any = {
          bucket: OPEN_BUCKET_ID,
          kind: COLLECTION_KIND_POSITIONS,
          updatedAt: FieldValue.serverTimestamp(),
        };
        batch.set(ref, patch, { merge: true });
        buckets.push(id);
        ops++;
      } else if (/^\d{4}-closed$/.test(id)) {
        const year = id.slice(0, 4);
        const patch: any = {
          bucket: YEAR_BUCKET_KIND,
          year,
          kind: COLLECTION_KIND_POSITIONS,
          updatedAt: FieldValue.serverTimestamp(),
        };
        batch.set(ref, patch, { merge: true });
        buckets.push(id);
        ops++;
      }

      if (ops >= 400) {
        await batch.commit();
        batch = db.batch();
        ops = 0;
      }
    }

    if (ops > 0) {
      await batch.commit();
    }

    if (!SILENCE_ADMIN_INFO) {
      logger.info('backfillPositionsBucketMetadata done', { buckets });
    }

    return { ok: true, buckets };
  }
);

/**
 * Admin: purgePairSignalsDailyAll
 * Deletes per-pair `signals-daily` legacy flat day docs and all year-sharded days for a year range.
 * Params: { pairs?: string[], fromYear?: number, toYear?: number }
 */
export const purgePairSignalsDailyAll = onCall(
  { region: 'us-central1', timeoutSeconds: 540 },
  async (req): Promise<{ ok: boolean; pairs: number; deletedLegacyDays: number; deletedYearDays: number; years: { from: number; to: number } }> => {
    let pairs: string[] = Array.isArray(req?.data?.pairs) ? (req.data.pairs as any[]).map(x => String(x)).filter(Boolean) : [];
    const now = new Date();
    const curYear = now.getUTCFullYear();
    const fromYear = Math.max(2000, Number(req?.data?.fromYear || 2019));
    const toYear = Math.min(curYear, Number(req?.data?.toYear || curYear));
    const removeContainers = req?.data?.removeContainers === true;
    if (pairs.length === 0) {
      const reg = await db.collection('pair-registry').select().get();
      pairs = reg.docs.map(d => d.id);
    }
    let deletedLegacyDays = 0;
    let deletedYearDays = 0;
    for (const pair of pairs) {
      const base = db.collection(PAIRS_COLLECTION).doc(pair).collection(SIGNALS_DAILY_COLLECTION);
      // Delete legacy day docs (ids like YYYY-MM-DD)
      const legacySnap = await base.select().get();
      let batch = db.batch(); let ops = 0;
      for (const d of legacySnap.docs) {
        const id = String(d.id);
        if (/^\d{4}-\d{2}-\d{2}$/.test(id)) {
          batch.delete(base.doc(id)); ops++; deletedLegacyDays++;
          if (ops >= 400) { await batch.commit(); batch = db.batch(); ops = 0; }
        }
      }
      if (ops > 0) { await batch.commit(); }
      // Delete all year-sharded days for the range
      for (let y = fromYear; y <= toYear; y++) {
        const daysCol = base.doc(String(y)).collection(DAYS_SUBCOLLECTION);
        const ysnap = await daysCol.select().get();
        let ybatch = db.batch(); let yops = 0;
        for (const dd of ysnap.docs) {
          ybatch.delete(daysCol.doc(dd.id)); yops++; deletedYearDays++;
          if (yops >= 400) { await ybatch.commit(); ybatch = db.batch(); yops = 0; }
        }
        if (yops > 0) { await ybatch.commit(); }
        if (removeContainers) {
          try { await base.doc(String(y)).delete(); } catch {}
        }
      }
    }
    if (!SILENCE_ADMIN_INFO) logger.info('purgePairSignalsDailyAll done', { pairs: pairs.length, deletedLegacyDays, deletedYearDays, fromYear, toYear });
    return { ok: true, pairs: pairs.length, deletedLegacyDays, deletedYearDays, years: { from: fromYear, to: toYear } };
  }
);

/**
 * Admin: purgePairSignalsAll
 * Deletes per-pair `signals` legacy flat docs and all year-sharded items for a year range.
 * Params: { pairs?: string[], fromYear?: number, toYear?: number }
 */
export const purgePairSignalsAll = onCall(
  { region: 'us-central1', timeoutSeconds: 540 },
  async (req): Promise<{ ok: boolean; pairs: number; deletedLegacy: number; deletedYearItems: number; years: { from: number; to: number } }> => {
    let pairs: string[] = Array.isArray(req?.data?.pairs) ? (req.data.pairs as any[]).map(x => String(x)).filter(Boolean) : [];
    const now = new Date();
    const curYear = now.getUTCFullYear();
    const fromYear = Math.max(2000, Number(req?.data?.fromYear || 2019));
    const toYear = Math.min(curYear, Number(req?.data?.toYear || curYear));
    const removeContainers = req?.data?.removeContainers === true;
    const removeOpenBucket = req?.data?.removeOpenBucket === true;
    if (pairs.length === 0) {
      const reg = await db.collection('pair-registry').select().get();
      pairs = reg.docs.map(d => d.id);
    }
    let deletedLegacy = 0;
    let deletedYearItems = 0;
    for (const pair of pairs) {
      const base = db.collection(PAIRS_COLLECTION).doc(pair).collection(SIGNALS_COLLECTION);
      // Delete legacy flat signals (non-YYYY doc ids)
      const snap = await base.select().get();
      let batch = db.batch(); let ops = 0;
      for (const d of snap.docs) {
        const id = String(d.id);
        if (!/^\d{4}$/.test(id)) { // legacy position doc
          batch.delete(base.doc(id)); ops++; deletedLegacy++;
          if (ops >= 400) { await batch.commit(); batch = db.batch(); ops = 0; }
        }
      }
      if (ops > 0) { await batch.commit(); }
      // Optionally delete open bucket items and container
      if (removeOpenBucket) {
        try {
          const openItems = base.doc(OPEN_BUCKET_ID).collection(ITEMS_SUBCOLLECTION);
          const osnap = await openItems.select().get();
          let obatch = db.batch(); let oops = 0;
          for (const it of osnap.docs) {
            obatch.delete(openItems.doc(it.id)); oops++;
            if (oops >= 400) { await obatch.commit(); obatch = db.batch(); oops = 0; }
          }
          if (oops > 0) { await obatch.commit(); }
          try { await base.doc(OPEN_BUCKET_ID).delete(); } catch {}
        } catch {}
      }
      // Delete all year-sharded items for the range
      for (let y = fromYear; y <= toYear; y++) {
        const items = base.doc(String(y)).collection('items');
        const ysnap = await items.select().get();
        let ybatch = db.batch(); let yops = 0;
        for (const it of ysnap.docs) {
          ybatch.delete(items.doc(it.id)); yops++; deletedYearItems++;
          if (yops >= 400) { await ybatch.commit(); ybatch = db.batch(); yops = 0; }
        }
        if (yops > 0) { await ybatch.commit(); }
        if (removeContainers) {
          try { await base.doc(String(y)).delete(); } catch {}
        }
      }
    }
    if (!SILENCE_ADMIN_INFO) logger.info('purgePairSignalsAll done', { pairs: pairs.length, deletedLegacy, deletedYearItems, fromYear, toYear });
    return { ok: true, pairs: pairs.length, deletedLegacy, deletedYearItems, years: { from: fromYear, to: toYear } };
  }
);

/**
 * Admin: purgeMisShardedPositionItems
 * For a given bucket year (e.g., '2025'), scans positions/{year}/items and deletes any item
 * whose document id indicates a different year (based on the first 4 digits YYYY of the id).
 * Params: { year: '2025', dryRun?: boolean, limit?: number }
 */
export const purgeMisShardedPositionItems = onCall(
  { region: 'us-central1', timeoutSeconds: 540 },
  async (req): Promise<{ ok: boolean; year: string; scanned: number; toDelete: number; deleted: number; samples: { wrongYear: string[] } }> => {
    const year = String(req?.data?.year || '').trim();
    if (!year || !/^\d{4}$/.test(year)) {
      throw new Error('year required (YYYY)');
    }
    const dryRun = String(req?.data?.dryRun || '').toLowerCase() === 'true' || req?.data?.dryRun === true;
    const limit = Number(req?.data?.limit || 0);
    const col = db.collection(POSITIONS_COLLECTION).doc(year).collection(ITEMS_SUBCOLLECTION);
    const snap = await col.select().get();
    let deleted = 0;
    let scanned = 0;
    let toDelete = 0;
    const samples: { wrongYear: string[] } = { wrongYear: [] };
    let batch = db.batch();
    let ops = 0;
    for (const d of snap.docs) {
      scanned++;
      const id = String(d.id);
      const idYear = id.slice(0, 4);
      const wrong = idYear !== year;
      if (wrong) {
        toDelete++;
        if (samples.wrongYear.length < 10) samples.wrongYear.push(id);
        if (!dryRun) {
          batch.delete(col.doc(id));
          ops++;
          if (ops >= 400) { await batch.commit(); batch = db.batch(); ops = 0; }
          deleted++;
          if (limit > 0 && deleted >= limit) break;
        }
      }
    }
    if (ops > 0) { await batch.commit(); }
    if (!SILENCE_ADMIN_INFO) logger.info('purgeMisShardedPositionItems', { year, scanned, toDelete, deleted, dryRun, samples });
    return { ok: true, year, scanned, toDelete, deleted, samples };
  }
);

/**
 * Admin: backfillPairSignalsDailyShards
 * For each pair and day in range, if legacy flat per-pair `signals-daily/{day}` exists, mirror it
 * into year shard `signals-daily/{YYYY}/days/{day}` and (if in hot horizon) `signals-daily/hot/days/{day}`.
 * Params: { from: 'YYYY-MM-DD', to: 'YYYY-MM-DD', pairs?: string[] }
 */
export const backfillPairSignalsDailyShards = onCall(
  { region: 'us-central1', timeoutSeconds: 540 },
  async (req): Promise<{ ok: boolean; range: { from: string; to: string }; pairs: number; daysProcessed: number; mirrored: number }> => {
    const from = String(req?.data?.from || '').trim();
    const to = String(req?.data?.to || '').trim();
    let pairs: string[] = Array.isArray(req?.data?.pairs) ? (req.data.pairs as any[]).map(x => String(x)).filter(Boolean) : [];
    if (!from || !to) throw new Error('from and to required (YYYY-MM-DD)');
    const fromD = new Date(from + 'T00:00:00Z');
    const toD = new Date(to + 'T00:00:00Z');
    if (isNaN(fromD.getTime()) || isNaN(toD.getTime())) throw new Error('invalid from/to');
    if (fromD.getTime() > toD.getTime()) throw new Error('from must be <= to');
    const step = 24 * 60 * 60 * 1000;

    if (pairs.length === 0) {
      const reg = await db.collection('pair-registry').select().get();
      pairs = reg.docs.map(d => d.id);
    }

    let daysProcessed = 0;
    let mirrored = 0;
    for (let t = fromD.getTime(); t <= toD.getTime(); t += step) {
      const d = new Date(t);
      const y = d.getUTCFullYear();
      const m = String(d.getUTCMonth() + 1).padStart(2, '0');
      const dd = String(d.getUTCDate()).padStart(2, '0');
      const day = `${y}-${m}-${dd}`;
      daysProcessed++;
      for (const pair of pairs) {
        const legacyRef = db.collection(PAIRS_COLLECTION).doc(pair).collection(SIGNALS_DAILY_COLLECTION).doc(day);
        const snap = await legacyRef.get();
        if (!snap.exists) continue;
        const data = (snap.data() as any) || {};
        try {
          await upsertPairSignalsDaily(pair, day, data);
          mirrored++;
        } catch (e:any) {
          if (!SILENCE_ADMIN_INFO) logger.warn('mirror failed per-pair signals-daily', { pair, day, message: e?.message });
        }
      }
    }
    if (!SILENCE_ADMIN_INFO) logger.info('backfillPairSignalsDailyShards done', { pairs: pairs.length, from, to, daysProcessed, mirrored });
    return { ok: true, range: { from, to }, pairs: pairs.length, daysProcessed, mirrored };
  }
);

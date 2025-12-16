import { onCall } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions/v2';
import { db, FieldValue } from './firebase-admin-init';
import { PAIRS_COLLECTION, POSITIONS_COLLECTION, SILENCE_ADMIN_INFO, OPEN_BUCKET_ID, SIGNALS_COLLECTION, ITEMS_SUBCOLLECTION, YEAR_BUCKET_KIND, COLLECTION_KIND_POSITIONS, SIGNALS_OPENS_SUBCOLLECTION, SIGNALS_CLOSES_SUBCOLLECTION, SIGNALS_ACTIVITY_COLLECTION, DAYS_SUBCOLLECTION } from './webhooks/webhooks-config';

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
 * Deletes all root-level docs from positions collection whose ids are not allowed years.
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
      // Delete all year-sharded signal subcollections (opens/closes) for the range
      for (let y = fromYear; y <= toYear; y++) {
        const yearDoc = base.doc(String(y));
        
        // Delete year-sharded opens
        const opensCol = yearDoc.collection(SIGNALS_OPENS_SUBCOLLECTION);
        const osnap = await opensCol.select().get();
        let obatch = db.batch(); let oops = 0;
        for (const it of osnap.docs) {
          obatch.delete(opensCol.doc(it.id)); oops++; deletedYearItems++;
          if (oops >= 400) { await obatch.commit(); obatch = db.batch(); oops = 0; }
        }
        if (oops > 0) { await obatch.commit(); }

        // Delete year-sharded closes
        const closesCol = yearDoc.collection(SIGNALS_CLOSES_SUBCOLLECTION);
        const csnap = await closesCol.select().get();
        let cbatch = db.batch(); let cops = 0;
        for (const it of csnap.docs) {
          cbatch.delete(closesCol.doc(it.id)); cops++; deletedYearItems++;
          if (cops >= 400) { await cbatch.commit(); cbatch = db.batch(); cops = 0; }
        }
        if (cops > 0) { await cbatch.commit(); }
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
 * Admin: purgePairSignalsActivityAll
 * Deletes per-pair `signals-activity` year-sharded docs and their day subcollections
 * for a given year range.
 * Params: { pairs?: string[], fromYear?: number, toYear?: number, removeContainers?: boolean }
 */
export const purgePairSignalsActivityAll = onCall(
  { region: 'us-central1', timeoutSeconds: 540 },
  async (req): Promise<{ ok: boolean; pairs: number; deletedYearItems: number; years: { from: number; to: number } }> => {
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
    let deletedYearItems = 0;
    for (const pair of pairs) {
      const base = db.collection(PAIRS_COLLECTION).doc(pair).collection(SIGNALS_ACTIVITY_COLLECTION);
      for (let y = fromYear; y <= toYear; y++) {
        const yearDoc = base.doc(String(y));
        const daysCol = yearDoc.collection(DAYS_SUBCOLLECTION);
        const dsnap = await daysCol.select().get();
        let dbatch = db.batch(); let dops = 0;
        for (const it of dsnap.docs) {
          dbatch.delete(daysCol.doc(it.id)); dops++; deletedYearItems++;
          if (dops >= 400) { await dbatch.commit(); dbatch = db.batch(); dops = 0; }
        }
        if (dops > 0) { await dbatch.commit(); }
        if (removeContainers) {
          try { await base.doc(String(y)).delete(); } catch {}
        }
      }
    }
    if (!SILENCE_ADMIN_INFO) logger.info('purgePairSignalsActivityAll done', { pairs: pairs.length, deletedYearItems, fromYear, toYear });
    return { ok: true, pairs: pairs.length, deletedYearItems, years: { from: fromYear, to: toYear } };
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
 * Admin: purgeAllPositions
 * Deletes all root position items across all buckets (OPEN and year shards).
 * This is a destructive, global reset of the positions collection.
 */
export const purgeAllPositions = onCall(
  { region: 'us-central1', timeoutSeconds: 540 },
  async (): Promise<{ ok: boolean; buckets: number; deletedItems: number }> => {
    const root = db.collection(POSITIONS_COLLECTION);
    const rootSnap = await root.select().get();
    let deletedItems = 0;
    let buckets = 0;

    for (const bucketDoc of rootSnap.docs) {
      const bucketId = bucketDoc.id;
      const itemsCol = root.doc(bucketId).collection(ITEMS_SUBCOLLECTION);
      const itemsSnap = await itemsCol.select().get();
      let batch = db.batch();
      let ops = 0;
      for (const it of itemsSnap.docs) {
        batch.delete(itemsCol.doc(it.id));
        deletedItems++;
        ops++;
        if (ops >= 400) {
          await batch.commit();
          batch = db.batch();
          ops = 0;
        }
      }
      if (ops > 0) {
        await batch.commit();
      }

      // After clearing items, delete the bucket container itself
      try { await root.doc(bucketId).delete(); } catch {}
      buckets++;
    }

    if (!SILENCE_ADMIN_INFO) logger.info('purgeAllPositions done', { buckets, deletedItems });
    return { ok: true, buckets, deletedItems };
  }
);

/** End of deprecated signals cleanup utilities. */

/**
 * Admin: purgePairSignalsAndActivityAll
 * Deletes per-pair `signals` legacy docs + year-sharded opens/closes and
 * per-pair `signals-activity` year-sharded docs in a single operation.
 *
 * Params: {
 *   pairs?: string[],
 *   fromYear?: number,
 *   toYear?: number,
 *   removeContainers?: boolean,
 *   removeOpenBucket?: boolean,
 * }
 */
export const purgePairSignalsAndActivityAll = onCall(
  { region: 'us-central1', timeoutSeconds: 540 },
  async (req): Promise<{
    ok: boolean;
    pairs: number;
    years: { from: number; to: number };
    signals: { deletedLegacy: number; deletedYearItems: number };
    activity: { deletedYearItems: number };
  }> => {
    let pairs: string[] = Array.isArray(req?.data?.pairs)
      ? (req.data.pairs as any[]).map((x) => String(x)).filter(Boolean)
      : [];

    const now = new Date();
    const curYear = now.getUTCFullYear();
    const fromYear = Math.max(2000, Number(req?.data?.fromYear || 2019));
    const toYear = Math.min(curYear, Number(req?.data?.toYear || curYear));
    const removeContainers = req?.data?.removeContainers === true;
    const removeOpenBucket = req?.data?.removeOpenBucket === true;

    if (pairs.length === 0) {
      const reg = await db.collection('pair-registry').select().get();
      pairs = reg.docs.map((d) => d.id);
    }

    let deletedLegacySignals = 0;
    let deletedSignalsYearItems = 0;
    let deletedActivityYearItems = 0;

    for (const pair of pairs) {
      // Signals base collection
      const signalsBase = db.collection(PAIRS_COLLECTION).doc(pair).collection(SIGNALS_COLLECTION);

      // Delete legacy flat signals (non-YYYY doc ids)
      const legacySnap = await signalsBase.select().get();
      let batch = db.batch();
      let ops = 0;
      for (const d of legacySnap.docs) {
        const id = String(d.id);
        if (!/^\d{4}$/.test(id)) {
          batch.delete(signalsBase.doc(id));
          ops++;
          deletedLegacySignals++;
          if (ops >= 400) {
            await batch.commit();
            batch = db.batch();
            ops = 0;
          }
        }
      }
      if (ops > 0) {
        await batch.commit();
      }

      // Optionally delete open bucket items and container for signals
      if (removeOpenBucket) {
        try {
          const openItems = signalsBase.doc(OPEN_BUCKET_ID).collection(ITEMS_SUBCOLLECTION);
          const osnap = await openItems.select().get();
          let obatch = db.batch();
          let oops = 0;
          for (const it of osnap.docs) {
            obatch.delete(openItems.doc(it.id));
            oops++;
            if (oops >= 400) {
              await obatch.commit();
              obatch = db.batch();
              oops = 0;
            }
          }
          if (oops > 0) {
            await obatch.commit();
          }
          try {
            await signalsBase.doc(OPEN_BUCKET_ID).delete();
          } catch {}
        } catch {}
      }

      // Activity base collection
      const activityBase = db
        .collection(PAIRS_COLLECTION)
        .doc(pair)
        .collection(SIGNALS_ACTIVITY_COLLECTION);

      // Delete all year-sharded docs for both signals and activity
      for (let y = fromYear; y <= toYear; y++) {
        const yearId = String(y);

        // Signals: opens + closes under signals/{YYYY}
        const yearSignalsDoc = signalsBase.doc(yearId);

        const opensCol = yearSignalsDoc.collection(SIGNALS_OPENS_SUBCOLLECTION);
        const osnap = await opensCol.select().get();
        let obatch = db.batch();
        let oops = 0;
        for (const it of osnap.docs) {
          obatch.delete(opensCol.doc(it.id));
          oops++;
          deletedSignalsYearItems++;
          if (oops >= 400) {
            await obatch.commit();
            obatch = db.batch();
            oops = 0;
          }
        }
        if (oops > 0) {
          await obatch.commit();
        }

        const closesCol = yearSignalsDoc.collection(SIGNALS_CLOSES_SUBCOLLECTION);
        const csnap = await closesCol.select().get();
        let cbatch = db.batch();
        let cops = 0;
        for (const it of csnap.docs) {
          cbatch.delete(closesCol.doc(it.id));
          cops++;
          deletedSignalsYearItems++;
          if (cops >= 400) {
            await cbatch.commit();
            cbatch = db.batch();
            cops = 0;
          }
        }
        if (cops > 0) {
          await cbatch.commit();
        }

        if (removeContainers) {
          try {
            await signalsBase.doc(yearId).delete();
          } catch {}
        }

        // Activity: days subcollection under signals-activity/{YYYY}
        const yearActivityDoc = activityBase.doc(yearId);
        const daysCol = yearActivityDoc.collection(DAYS_SUBCOLLECTION);
        const dsnap = await daysCol.select().get();
        let dbatch = db.batch();
        let dops = 0;
        for (const it of dsnap.docs) {
          dbatch.delete(daysCol.doc(it.id));
          dops++;
          deletedActivityYearItems++;
          if (dops >= 400) {
            await dbatch.commit();
            dbatch = db.batch();
            dops = 0;
          }
        }
        if (dops > 0) {
          await dbatch.commit();
        }

        if (removeContainers) {
          try {
            await activityBase.doc(yearId).delete();
          } catch {}
        }
      }
    }

    if (!SILENCE_ADMIN_INFO) {
      logger.info('purgePairSignalsAndActivityAll done', {
        pairs: pairs.length,
        fromYear,
        toYear,
        deletedLegacySignals,
        deletedSignalsYearItems,
        deletedActivityYearItems,
      });
    }

    return {
      ok: true,
      pairs: pairs.length,
      years: { from: fromYear, to: toYear },
      signals: {
        deletedLegacy: deletedLegacySignals,
        deletedYearItems: deletedSignalsYearItems,
      },
      activity: {
        deletedYearItems: deletedActivityYearItems,
      },
    };
  }
);

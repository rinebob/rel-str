import { onSchedule } from 'firebase-functions/v2/scheduler';
import { logger } from 'firebase-functions/v2';

import { db } from '../firebase-admin-init';
import { SILENCE_ADMIN_INFO } from '../webhooks/webhooks-config';

/**
 * Default age in days after which occurrence decisions are deleted.
 * Kept longer than the UI fetch window (3 days) so there is a buffer
 * between what the UI shows and what the DB retains.
 *
 * Override with the `ST_DECISION_TTL_DAYS` environment variable.
 */
const DEFAULT_TTL_DAYS = 7;

/** Maximum documents to delete in a single Firestore batch. */
const MAX_BATCH_SIZE = 400;

/** Firestore collection path for ST occurrence decisions. */
const DECISIONS_COLLECTION = 'savant-trader/data/occurrence-decisions';

/**
 * Scheduled function that prunes old ST occurrence decisions.
 *
 * Behavior:
 * - Runs daily at 03:30 UTC (offset from the RS backfill cleanup at 03:00).
 * - Deletes decisions whose `decidedAt` ISO timestamp is older than
 *   `ST_DECISION_TTL_DAYS` (default 7 days).
 * - Batch-deletes in chunks of `MAX_BATCH_SIZE` to respect Firestore limits.
 * - Logs a summary of how many decisions were scanned and deleted.
 *
 * This function is safe to re-run: if no eligible decisions exist, it logs
 * a `cleanupStDecisions_no_decisions` message and exits without error.
 */
export const cleanupStOccurrenceDecisions = onSchedule(
  {
    schedule: '30 3 * * *',
    timeZone: 'Etc/UTC',
    region: 'us-central1',
  },
  async () => {
    const ttlDaysRaw = process.env.ST_DECISION_TTL_DAYS;
    let ttlDays = Number(ttlDaysRaw ?? DEFAULT_TTL_DAYS);
    if (!Number.isFinite(ttlDays) || ttlDays <= 0) {
      ttlDays = DEFAULT_TTL_DAYS;
    }

    const cutoff = new Date(Date.now() - ttlDays * 24 * 60 * 60 * 1000).toISOString();

    const col = db.collection(DECISIONS_COLLECTION);
    const snap = await col.where('decidedAt', '<', cutoff).select('decidedAt').get();

    if (snap.empty) {
      if (!SILENCE_ADMIN_INFO) {
        logger.info('cleanupStDecisions_no_decisions', { ttlDays, cutoff });
      }
      return;
    }

    let deleted = 0;
    let batch = db.batch();
    let ops = 0;

    for (const d of snap.docs) {
      batch.delete(d.ref);
      ops++;
      deleted++;

      if (ops >= MAX_BATCH_SIZE) {
        await batch.commit();
        batch = db.batch();
        ops = 0;
      }
    }

    if (ops > 0) {
      await batch.commit();
    }

    if (!SILENCE_ADMIN_INFO) {
      logger.info('cleanupStDecisions_complete', {
        scanned: snap.size,
        deleted,
        ttlDays,
        cutoff,
      });
    }
  }
);

import { onSchedule } from 'firebase-functions/v2/scheduler';
import { logger } from 'firebase-functions/v2';

import { db } from '../firebase-admin-init';
import { SILENCE_ADMIN_INFO } from '../webhooks/webhooks-config';

const RS_BACKFILL_RUNS_COLLECTION = 'system/rs-backfill-runs/runs';
const DEFAULT_MAX_AGE_DAYS = 30;
const MAX_JOB_BATCH = 400;

/**
 * Deletes a single RS backfill run document and all of its job documents.
 *
 * This helper:
 * - Scans the `jobs` subcollection under the given run document.
 * - Deletes job documents in write batches capped by `MAX_JOB_BATCH` to
 *   respect Firestore's per-batch limits.
 * - Deletes the parent run document once all jobs have been removed.
 * - Emits a structured info log (when `SILENCE_ADMIN_INFO` is false)
 *   summarizing how many job documents were deleted for the run.
 *
 * The function is intentionally conservative: it reads the entire
 * `jobs` subcollection once per run and does not attempt more complex
 * pagination, since job counts per run are expected to be modest and the
 * cleanup is scheduled infrequently.
 *
 * @param runId Identifier of the backfill run document under
 *   `system/rs-backfill-runs/runs/{runId}` to delete.
 * @returns A promise that resolves with the number of job documents
 *   deleted as `{ jobsDeleted }`.
 */
async function deleteRunAndJobs(runId: string): Promise<{ jobsDeleted: number }> {
  const base = db.collection(RS_BACKFILL_RUNS_COLLECTION);
  const runRef = base.doc(runId);
  const jobsCol = runRef.collection('jobs');

  // Delete jobs in batches
  let jobsDeleted = 0;
  // Firestore has no server-side cursor for collectionGroup-like pagination here,
  // so we scan all docs once per run and batch delete.
  const snap = await jobsCol.select().get();
  let batch = db.batch();
  let ops = 0;
  for (const d of snap.docs) {
    batch.delete(d.ref);
    ops++;
    jobsDeleted++;
    if (ops >= MAX_JOB_BATCH) {
      await batch.commit();
      batch = db.batch();
      ops = 0;
    }
  }
  if (ops > 0) {
    await batch.commit();
  }

  await runRef.delete();

  if (!SILENCE_ADMIN_INFO) {
    logger.info('cleanupRsBackfillRuns_deleted_run', { runId, jobsDeleted });
  }

  return { jobsDeleted };
}

/**
 * Scheduled function that prunes old RS backfill run metadata.
 *
 * Behavior:
 * - Runs on a fixed schedule (`every 30 days`, `Etc/UTC`).
 * - Determines an age cutoff in milliseconds based on
 *   `RS_BACKFILL_MAX_AGE_DAYS` (environment variable) or a
 *   `DEFAULT_MAX_AGE_DAYS` fallback.
 * - Scans all documents in `system/rs-backfill-runs/runs` and inspects
 *   their `createdAt` timestamp.
 * - For any run whose `createdAt` is strictly older than the cutoff,
 *   invokes `deleteRunAndJobs` to remove both the run document and all
 *   job documents in its `jobs` subcollection.
 * - Logs a summary of how many runs were scanned, how many runs/jobs
 *   were deleted, and what `maxAgeDays` was applied.
 *
 * The cleanup policy is intentionally simple and time-based. It does not
 * require the run to be in a particular terminal state; instead, it
 * assumes that by the time the retention window has elapsed, the run's
 * metadata is no longer needed for operational debugging.
 *
 * This function is safe to re-run: if no eligible runs exist, it logs a
 * `cleanupRsBackfillRuns_no_runs` message and exits without error.
 */
export const cleanupRsBackfillRuns = onSchedule(
  {
    // Run once per day at 03:00 UTC; retention window is controlled by
    // RS_BACKFILL_MAX_AGE_DAYS, so we do not need a 30-day schedule here.
    schedule: '0 3 * * *',
    timeZone: 'Etc/UTC',
    region: 'us-central1',
  },
  async () => {
    const maxAgeDaysRaw = process.env.RS_BACKFILL_MAX_AGE_DAYS;
    let maxAgeDays = Number(maxAgeDaysRaw ?? DEFAULT_MAX_AGE_DAYS);
    if (!Number.isFinite(maxAgeDays) || maxAgeDays <= 0) {
      maxAgeDays = DEFAULT_MAX_AGE_DAYS;
    }

    const now = Date.now();
    const cutoffMs = now - maxAgeDays * 24 * 60 * 60 * 1000;

    const col = db.collection(RS_BACKFILL_RUNS_COLLECTION);
    const snap = await col.select('createdAt').get();

    if (snap.empty) {
      if (!SILENCE_ADMIN_INFO) {
        logger.info('cleanupRsBackfillRuns_no_runs');
      }
      return;
    }

    let scanned = 0;
    let deletedRuns = 0;
    let deletedJobs = 0;

    for (const d of snap.docs) {
      scanned++;
      const data = d.data() as any;
      const createdAt = data?.createdAt;
      const tsMs = createdAt?.toMillis ? createdAt.toMillis() : undefined;
      if (!tsMs || tsMs > cutoffMs) {
        continue;
      }

      try {
        const { jobsDeleted } = await deleteRunAndJobs(d.id);
        deletedRuns++;
        deletedJobs += jobsDeleted;
      } catch (e: any) {
        logger.warn('cleanupRsBackfillRuns_delete_failed', { runId: d.id, message: e?.message });
      }
    }

    if (!SILENCE_ADMIN_INFO) {
      logger.info('cleanupRsBackfillRuns_complete', {
        scanned,
        deletedRuns,
        deletedJobs,
        maxAgeDays,
      });
    }
  },
);

import type { Firestore } from 'firebase-admin/firestore';

import {
  ST_RUNS_ROOT,
  ST_JOBS_SUBCOLLECTION_NAME,
} from './st-collections';

/**
 * #1010 — shared TTL-purge core for `…/runs/{runId}/jobs/{SYM}` docs.
 *
 * Design note: an earlier draft used `collectionGroup('jobs')` +
 * path filtering. That was abandoned for two prod-verified reasons —
 *
 *   1. The `jobs` collection group contains ~1.07M FOREIGN docs under
 *      `system/rs-realtime-runs`, `system/rs-backfill-runs`, and
 *      `spread-runs` that also carry `createdAt` (rs-realtime has no
 *      sweeper and accumulates unboundedly). Ordered oldest-first they
 *      would permanently occupy any scan window and starve the sweep.
 *   2. `collectionGroup('jobs') where('createdAt', …)` needs a
 *      collectionGroup index that doesn't exist (FAILED_PRECONDITION);
 *      a per-collection `createdAt` query rides the automatic
 *      single-field index.
 *
 * Per-run enumeration has neither problem: the collection path IS the
 * scope, so foreign docs can never be returned. `isStRunJobPath`
 * remains exported as a path classifier for audits — it is not a
 * load-bearing delete guard anymore.
 *
 * Reader safety: jobs are write-only progress markers. Run completion
 * is evaluated from run-doc counters (`evalRunCompletion`), and the
 * only consumer (auto-paper ingest, `createdOpportunity == true`)
 * reads the just-completed run — far inside the TTL window.
 */

/** The only run roots whose `jobs` subcollections may be purged.
 *  #1159: the legacy `savant-trader/data/runs` leg was dropped — that root
 *  is wholesale-deleted (manual step) at #1159 ship rather than
 *  TTL-drained. */
export const ST_RUN_JOB_ROOTS = [ST_RUNS_ROOT] as const;

/** Maximum documents deleted in a single Firestore batch. */
export const MAX_RUN_JOBS_BATCH_SIZE = 400;

/**
 * True when `path` is a *job document* (`{root}/{runId}/jobs/{docId}`)
 * under one of the ST run roots. Used by audits to classify
 * collection-group census rows — NOT consulted on the delete path,
 * where scope is enforced structurally by the collection query.
 */
export function isStRunJobPath(path: string): boolean {
  for (const root of ST_RUN_JOB_ROOTS) {
    if (!path.startsWith(`${root}/`)) continue;
    const segs = path.slice(root.length + 1).split('/');
    if (segs.length === 3 && segs[1] === ST_JOBS_SUBCOLLECTION_NAME) {
      return true;
    }
  }
  return false;
}

export interface PurgeOldRunJobsResult {
  /** Run docs enumerated. */
  runsScanned: number;
  /** Job docs matching `createdAt < cutoff` (== deleted candidates). */
  jobsMatched: number;
  /** Job docs actually deleted (≤ jobsMatched, bounded by maxDelete). */
  deleted: number;
}

export interface PurgeOldRunJobsOpts {
  /** Delete jobs with `createdAt` strictly before this instant. */
  cutoff: Date;
  /** Hard cap on deletions — bounds a single invocation. */
  maxDelete: number;
  /** Firestore batch chunk size (default {@link MAX_RUN_JOBS_BATCH_SIZE}). */
  batchSize?: number;
}

/**
 * Enumerate run docs under `root` and batch-delete every job doc whose
 * `createdAt < cutoff`, up to `maxDelete`.
 *
 * Run docs carry no `createdAt` in prod, so the enumeration is
 * unfiltered — refs-only `select()` keeps it to ~1 read per run
 * (~214 today). Per-run `jobs.where('createdAt', '<', cutoff)` returns
 * only eligible docs; jobs missing `createdAt` never match (they die
 * at #1013 wholesale delete).
 */
export async function purgeOldRunJobsForRoot(
  firestore: Firestore,
  root: string,
  opts: PurgeOldRunJobsOpts,
): Promise<PurgeOldRunJobsResult> {
  const batchSize = opts.batchSize ?? MAX_RUN_JOBS_BATCH_SIZE;
  const runs = await firestore.collection(root).select().get();

  let jobsMatched = 0;
  let deleted = 0;
  let ops = 0;
  let batch = firestore.batch();

  for (const run of runs.docs) {
    if (deleted >= opts.maxDelete) break;
    const jobs = await run.ref
      .collection(ST_JOBS_SUBCOLLECTION_NAME)
      .where('createdAt', '<', opts.cutoff)
      .select()
      .get();
    jobsMatched += jobs.size;
    for (const job of jobs.docs) {
      if (deleted >= opts.maxDelete) break;
      batch.delete(job.ref);
      ops++;
      deleted++;
      if (ops >= batchSize) {
        await batch.commit();
        batch = firestore.batch();
        ops = 0;
      }
    }
  }
  if (ops > 0) {
    await batch.commit();
  }

  return { runsScanned: runs.size, jobsMatched, deleted };
}

/** Convenience wrapper over {@link purgeOldRunJobsForRoot} for all
 *  {@link ST_RUN_JOB_ROOTS}, sharing one `maxDelete` budget. */
export async function purgeOldRunJobs(
  firestore: Firestore,
  opts: PurgeOldRunJobsOpts,
): Promise<PurgeOldRunJobsResult> {
  const total: PurgeOldRunJobsResult = { runsScanned: 0, jobsMatched: 0, deleted: 0 };
  for (const root of ST_RUN_JOB_ROOTS) {
    const res = await purgeOldRunJobsForRoot(firestore, root, {
      ...opts,
      maxDelete: opts.maxDelete - total.deleted,
    });
    total.runsScanned += res.runsScanned;
    total.jobsMatched += res.jobsMatched;
    total.deleted += res.deleted;
    if (total.deleted >= opts.maxDelete) break;
  }
  return total;
}

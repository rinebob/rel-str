import { onSchedule } from 'firebase-functions/v2/scheduler';
import { logger } from 'firebase-functions/v2';

import { db } from '../firebase-admin-init';
import { SILENCE_ADMIN_INFO } from '../webhooks/webhooks-config';
import { purgeOldRunJobs } from '../common/st-run-jobs-ttl';

/**
 * #1010 — 7-day TTL for per-symbol run jobs.
 *
 * `…/runs/{runId}/jobs/{SYM}` docs are write-only progress markers —
 * run completion is evaluated from run-doc counters, and the only
 * reader (auto-paper ingest, `createdOpportunity == true`) reads the
 * just-completed run, far inside the TTL window.
 *
 * The purge core lives in `common/st-run-jobs-ttl.ts` — see its header
 * for why this enumerates runs per-root instead of a
 * `collectionGroup('jobs')` query (missing group index + ~1.07M
 * permanently-eligible foreign rs-realtime/rs-backfill/spread jobs
 * would starve an uncursored scan).
 *
 * The 1.24M-doc group backlog (~185k of it ST) is drained ONCE by
 * `scripts/purge-st-run-jobs-1010.ts` — this sweep only handles steady
 * state afterward (~a few runs/day). The per-invocation cap is a
 * timeout guard, not the drain mechanism.
 */

/** Default job retention — far beyond the auto-paper read window (same-day). */
const DEFAULT_TTL_DAYS = 7;

/** Per-invocation delete cap — bounds worst-case work (pre-purge
 *  backlog or a sweep outage) inside the function timeout. */
const SWEEP_DELETE_CAP = 20_000;

/**
 * Daily job prune. Runs at 03:45 UTC — offset from the RS backfill
 * (03:00) and decisions (03:30) sweeps.
 *
 * Override TTL with `ST_JOB_TTL_DAYS`.
 */
export const cleanupStRunJobs = onSchedule(
  {
    schedule: '45 3 * * *',
    timeZone: 'Etc/UTC',
    region: 'us-central1',
    // Headroom for the pre-purge window: run enumeration plus up to
    // SWEEP_DELETE_CAP/400 batch commits. Steady state is seconds.
    timeoutSeconds: 300,
  },
  async () => {
    const ttlDaysRaw = process.env.ST_JOB_TTL_DAYS;
    let ttlDays = Number(ttlDaysRaw ?? DEFAULT_TTL_DAYS);
    if (!Number.isFinite(ttlDays) || ttlDays <= 0) {
      ttlDays = DEFAULT_TTL_DAYS;
    }

    const cutoff = new Date(Date.now() - ttlDays * 24 * 60 * 60 * 1000);

    const res = await purgeOldRunJobs(db, {
      cutoff,
      maxDelete: SWEEP_DELETE_CAP,
    });

    if (res.deleted === 0 && res.jobsMatched === 0) {
      if (!SILENCE_ADMIN_INFO) {
        logger.info('cleanupStRunJobs_no_jobs', { ttlDays });
      }
      return;
    }

    if (!SILENCE_ADMIN_INFO) {
      logger.info('cleanupStRunJobs_complete', {
        ...res,
        ttlDays,
        // Hitting the cap means eligible jobs likely remain — the
        // daily sweep drains them over later invocations (pre-purge
        // window only).
        backlogRemaining: res.deleted >= SWEEP_DELETE_CAP,
      });
    }
  }
);

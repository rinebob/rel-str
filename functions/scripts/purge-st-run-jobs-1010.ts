/**
 * #1010 — one-shot purge of the st-runs jobs backlog (~185k docs under
 * `savant-trader/data/runs`; the ~1.24M collectionGroup figure is
 * mostly foreign rs-backfill/rs-realtime/spread jobs, which are NEVER
 * touched — the per-run query scope makes that structurally
 * impossible).
 *
 * Deletes `…/runs/{runId}/jobs/{SYM}` docs older than the TTL (default
 * 7d, same predicate the daily sweeper uses — recent jobs are
 * preserved). Run docs carry no `createdAt`, so the purge enumerates
 * all run refs per root and queries each run's jobs collection —
 * a per-run `createdAt` range rides the automatic single-field index
 * (a `collectionGroup('jobs')` equivalent FAILED_PRECONDITIONs — no
 * group index exists).
 *
 * The daily sweeper (cleanupStRunJobs) handles steady state after this
 * drains the backlog.
 *
 * Usage:
 *   cd functions
 *   npx tsx scripts/purge-st-run-jobs-1010.ts              # dry-run: exact eligible counts per root
 *   npx tsx scripts/purge-st-run-jobs-1010.ts --apply      # delete
 *   npx tsx scripts/purge-st-run-jobs-1010.ts --apply --max 50000   # cap deletions
 *   npx tsx scripts/purge-st-run-jobs-1010.ts --days 14    # older-than-14d instead of 7d
 *
 * Prerequisites:
 *   - ADC with prod Firestore access (same as other scripts).
 *   - Do NOT set FUNCTIONS_EMULATOR=true.
 */
import { db } from '../src/firebase-admin-init';
import {
  ST_RUN_JOB_ROOTS,
  purgeOldRunJobsForRoot,
} from '../src/common/st-run-jobs-ttl';
import { ST_JOBS_SUBCOLLECTION_NAME } from '../src/common/st-collections';

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const maxArg = args.includes('--max') ? Number(args[args.indexOf('--max') + 1]) : Infinity;
const daysArg = args.includes('--days') ? Number(args[args.indexOf('--days') + 1]) : 7;

if (!Number.isFinite(daysArg) || daysArg <= 0) {
  console.error(`--days must be a positive number, got '${args[args.indexOf('--days') + 1]}'`);
  process.exit(1);
}
if (args.includes('--max') && (!Number.isFinite(maxArg) || maxArg <= 0)) {
  console.error(`--max must be a positive number, got '${args[args.indexOf('--max') + 1]}'`);
  process.exit(1);
}

const PAGE = 20_000; // deletions per purge call — progress granularity

async function main(): Promise<void> {
  const cutoff = new Date(Date.now() - daysArg * 24 * 60 * 60 * 1000);
  console.log(`=== Purge st-run jobs > ${daysArg}d (${APPLY ? 'APPLY' : 'DRY-RUN'}) ===`);
  console.log(`cutoff: ${cutoff.toISOString()}\n`);

  for (const root of ST_RUN_JOB_ROOTS) {
    const runs = await db.collection(root).select().get();
    console.log(`${root}: ${runs.size} runs`);
    if (!APPLY) {
      // Exact eligible count — ~1 aggregate call per run.
      let eligible = 0;
      for (const run of runs.docs) {
        const c = await run.ref
          .collection(ST_JOBS_SUBCOLLECTION_NAME)
          .where('createdAt', '<', cutoff)
          .count()
          .get();
        eligible += c.data().count;
      }
      console.log(`  eligible job docs: ${eligible}`);
    }
  }

  if (!APPLY) {
    console.log('\nDry-run only — rerun with --apply to delete.');
    return;
  }

  // ── apply — per root so progress and the budget split stay visible ──
  let deleted = 0;
  for (const root of ST_RUN_JOB_ROOTS) {
    let rootDeleted = 0;
    while (deleted < maxArg) {
      const chunk = Math.min(PAGE, maxArg - deleted);
      const res = await purgeOldRunJobsForRoot(db, root, {
        cutoff,
        maxDelete: chunk,
      });
      rootDeleted += res.deleted;
      deleted += res.deleted;
      console.log(
        `${root}: runs=${res.runsScanned} matched=${res.jobsMatched} ` +
          `deleted this pass=${res.deleted} (root total ${rootDeleted})`,
      );
      // Below the call cap → this root is drained; at cap → another pass.
      if (res.deleted < chunk) break;
    }
  }

  console.log(`\nDONE — deleted ${deleted}`);
  if (deleted >= maxArg) {
    console.log(`--max ${maxArg} reached; rerun to continue.`);
  }
}

main().catch((e) => {
  console.error('PURGE FAILED:', e);
  process.exit(1);
});

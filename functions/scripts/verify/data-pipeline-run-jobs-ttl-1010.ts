/**
 * TTL audit for #1010 — `…/runs/{runId}/jobs` retention. Checks:
 *
 *   1. CODE — cleanupStRunJobs exported from index.ts (the drain
 *      mechanism) and the shared core in common/st-run-jobs-ttl.ts
 *      carries the per-root run enumeration + per-run `createdAt`
 *      predicate. FAIL: export missing or query shape absent.
 *
 *   2. PROD (read-only) — per-root census, exactly what the sweeper
 *      sees: runs enumerated, jobs total, jobs eligible
 *      (`createdAt < cutoff`), jobs retained. WARN while the ST
 *      backlog is large (pre-purge); INFO near zero.
 *
 *   3. FOREIGN census (best-effort) — `collectionGroup('jobs')` counts
 *      of non-ST members (rs-backfill/rs-realtime/spread). The group
 *      query needs an index that may not exist; absence is INFO, not
 *      FAIL — the sweeper doesn't use it (per-run scope).
 *
 *   4. Missing-createdAt census on a job sample — these evade the
 *      `createdAt` predicate; they only die at #1013 wholesale delete.
 *
 * Usage (from functions/):
 *   npx tsx scripts/verify/data-pipeline-run-jobs-ttl-1010.ts
 *
 * Read-only — never writes. Exit 0 on clean audit; nonzero on any FAIL.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { db } from '../../src/firebase-admin-init';
import { ST_JOBS_SUBCOLLECTION_NAME } from '../../src/common/st-collections';
import {
  ST_RUN_JOB_ROOTS,
  purgeOldRunJobsForRoot,
} from '../../src/common/st-run-jobs-ttl';

const SRC_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'src');
const TTL_DAYS = 7;
const JOB_SAMPLE = 2000;

let fails = 0;
let warns = 0;
const ok = (m: string) => console.log(`OK   ${m}`);
const warn = (m: string) => { warns++; console.log(`WARN ${m}`); };
const fail = (m: string) => { fails++; console.log(`FAIL ${m}`); };

async function main() {
  console.log('#1010 st-run jobs TTL audit\n');

  // ── 1. code invariant ──────────────────────────────────────────────────
  const index = readFileSync(`${SRC_ROOT}/index.ts`, 'utf8');
  if (/^export \{[^}]*cleanupStRunJobs[^}]*\}/m.test(index)) {
    ok('cleanupStRunJobs exported (TTL drain registered)');
  } else {
    fail('cleanupStRunJobs export missing — TTL drain dead');
  }

  const core = readFileSync(
    `${SRC_ROOT}/common/st-run-jobs-ttl.ts`, 'utf8');
  if (
    core.includes('ST_RUN_JOB_ROOTS') &&
    core.includes('isStRunJobPath') &&
    core.includes(`collection(ST_JOBS_SUBCOLLECTION_NAME)`) &&
    core.includes(`where('createdAt', '<', opts.cutoff)`) &&
    typeof purgeOldRunJobsForRoot === 'function'
  ) {
    ok('shared core: per-root enumeration + per-run createdAt predicate');
  } else {
    fail('st-run-jobs-ttl.ts missing expected query shape');
  }

  // ── 2. prod census — same enumeration the sweeper performs ────────────
  const cutoff = new Date(Date.now() - TTL_DAYS * 24 * 60 * 60 * 1000);
  let totalRuns = 0;
  let totalJobs = 0;
  let totalEligible = 0;

  for (const root of ST_RUN_JOB_ROOTS) {
    const runs = await db.collection(root).select().get();
    let rootJobs = 0;
    let rootEligible = 0;
    for (const run of runs.docs) {
      const jobs = run.ref.collection(ST_JOBS_SUBCOLLECTION_NAME);
      const all = await jobs.count().get();
      const old = await jobs.where('createdAt', '<', cutoff).count().get();
      rootJobs += all.data().count;
      rootEligible += old.data().count;
    }
    console.log(
      `INFO ${root}: runs=${runs.size} jobs=${rootJobs} eligible=${rootEligible} retained=${rootJobs - rootEligible}`,
    );
    totalRuns += runs.size;
    totalJobs += rootJobs;
    totalEligible += rootEligible;
  }

  if (totalEligible > 10000) {
    warn(`ST job backlog ${totalEligible} — run scripts/purge-st-run-jobs-1010.ts --apply (expected pre-purge)`);
  } else if (totalEligible > 0) {
    console.log(`INFO eligible ${totalEligible} — inside normal daily-sweep range`);
  } else {
    ok(`no eligible ST jobs — post-purge steady state across ${totalRuns} runs`);
  }
  if (totalJobs - totalEligible > 0) {
    ok(`${totalJobs - totalEligible} recent jobs retained — TTL window preserves live runs`);
  } else {
    console.log(`INFO no jobs younger than ${TTL_DAYS}d — no recent runs`);
  }

  // ── 3. foreign census — best-effort (group index may not exist) ───────
  try {
    const groupAll = await db
      .collectionGroup(ST_JOBS_SUBCOLLECTION_NAME)
      .count()
      .get();
    const foreign = groupAll.data().count - totalJobs;
    console.log(
      `INFO jobs collectionGroup total=${groupAll.data().count} — ` +
        `foreign (rs/spread, never swept by this TTL) ≈ ${foreign}`,
    );
  } catch {
    console.log('INFO collectionGroup census unavailable (no group index — expected; sweeper does not use it)');
  }

  // ── 4. missing-createdAt census — evades the predicate, dies at #1013 ─
  let missingTs = 0;
  let sampled = 0;
  for (const root of ST_RUN_JOB_ROOTS) {
    const runs = await db.collection(root).select().limit(3).get();
    for (const run of runs.docs) {
      const jobs = await run.ref
        .collection(ST_JOBS_SUBCOLLECTION_NAME)
        .limit(JOB_SAMPLE)
        .get();
      for (const d of jobs.docs) {
        sampled++;
        if (d.data().createdAt === undefined) missingTs++;
      }
    }
  }
  if (missingTs > 0) {
    warn(`${missingTs}/${sampled} sampled jobs missing createdAt — invisible to TTL; die at #1013`);
  } else {
    ok(`no missing-createdAt jobs in sample (${sampled})`);
  }

  console.log(`\n— audit —\n${fails} FAIL, ${warns} WARN`);
  process.exit(fails > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error('AUDIT CRASH:', e);
  process.exit(1);
});

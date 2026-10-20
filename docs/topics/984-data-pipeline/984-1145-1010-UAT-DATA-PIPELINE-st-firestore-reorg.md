**Topic:** ST Firestore Reorg  
**Topic Slug:** st-firestore-reorg  
**Thread:** Data Plane Consolidation  
**Thread Slug:** data-plane-consolidation  
**Issue:** #1145  
**Thread Parent:** #985  
**Topic Parent:** #984  
**Task:** #1010  
**Domain:** DATA-PIPELINE  
**Type:** UAT  
**Status:** Complete  
**Created:** 2026-10-20  
**Last Updated:** 2026-10-20  

# UAT — #1010 jobs 7-day TTL cleanup + backlog purge

## Scope

PRD US-7 + task ACs:

- [ ] Scheduled cleanup deletes `st-runs/{id}/jobs` docs older than 7 days.
- [ ] Auto-paper ingest and run-progress UI unaffected.
- [ ] Existing backlog purged once (probe-verified 113,486 eligible docs —
      the ~1.24M figure counts the whole `jobs` group incl. ~1.12M foreign).

Change set: `functions/src/common/st-run-jobs-ttl.ts` (shared purge core),
`functions/src/scheduled/cleanup-st-run-jobs.ts` (daily 03:45 UTC trigger),
`functions/scripts/purge-st-run-jobs-1010.ts` (one-shot drain),
`functions/scripts/verify/data-pipeline-run-jobs-ttl-1010.ts` (audit),
`tests/functions/run-jobs-ttl-1010.test.ts` (16 specs), registrations.

**Design note for the tester:** the sweep enumerates run docs per ST root
(`savant-trader/data/runs`, `st-runs`) and queries each run's `jobs`
collection — NOT `collectionGroup('jobs')`. Foreign `jobs` under
`system/rs-*` and `spread-runs` are unreachable by construction.

## Prerequisites

```powershell
$env:NODE_OPTIONS="--require C:\Users\bob\.config\node\ipv4-only.cjs"
cd functions; npm run build          # lib bundle current
# ADC with prod Firestore access (same as other verify scripts)
```

## Scenarios

### S1 — Test suite + build

- `cd functions && npm run test:run-jobs-ttl` → 16/16 pass.
- `npm run typecheck` → clean. `npm run build` → green.

### S2 — Purge dry-run (read-only)

- `npx tsx scripts/purge-st-run-jobs-1010.ts` (no `--apply`) → prints
  per-root run counts + exact eligible job counts; writes nothing.
- Expected: `st-runs: 0 runs / eligible 0`;
  `savant-trader/data/runs: ~214 runs / eligible ~113k`.
- Negative: `--days abc` or `--max abc` → usage error, exit 1.

### S3 — Prod audit (read-only)

- `npx tsx scripts/verify/data-pipeline-run-jobs-ttl-1010.ts` →
  0 FAIL; backlog WARN (expected pre-purge); retained-jobs INFO;
  foreign census INFO; missing-createdAt census OK.

### S4 — Selective deploy

- `firebase deploy --only functions:cleanupStRunJobs` → function
  **created** (scheduled, `45 3 * * *` Etc/UTC, us-central1).
- `firebase functions:list` shows `cleanupStRunJobs` with the schedule.

### S5 — Live sweeper invocation (bounded delete)

- Invoke the deployed function once (firebase functions:shell /
  Cloud Scheduler run). Expected log: `cleanupStRunJobs_complete`
  with `deleted ≤ 20000` (SWEEP_DELETE_CAP), `backlogRemaining: true`,
  `runsScanned ≈ 214`. Deletes are old jobs only — by design.

### S6 — Foreign-domain zero-touch

- Before/after S5 + S7: `spread-runs/*/jobs` and
  `system/rs-*/**/jobs` counts unchanged (audit's foreign census
  + spot `collectionGroup` count). Expected: identical.

### S7 — Backlog drain (`--apply`)

- `npx tsx scripts/purge-st-run-jobs-1010.ts --apply` → pages until
  eligible → 0; `--apply --max 50000` → stops at the cap.
- Re-run S3: eligible ≈ 0, backlog WARN clears.

### S8 — Run completion + auto-paper unaffected (observational)

- Next PDR/nightly run completes via run-doc counters
  (`evalRunCompletion`); auto-paper ingests `createdOpportunity` jobs
  for that run (jobs <7d are preserved — the TTL window).

### S9 — Regression smoke

- `npm run test:decisions-retirement` → 5/5 (sibling sweeper intact).
- `npm run test:config-lists` (adjacent #1008 surfaces) → pass.

## Traceability

| AC | Scenario |
|---|---|
| Scheduled cleanup deletes jobs >7d | S1, S4, S5 |
| Auto-paper + run-progress unaffected | S8 (+ code-level evidence in review doc) |
| Backlog purged once | S2, S6, S7 |
| Foreign `jobs` never deleted | S6 (+ structural per-run scope) |

## Results log

| Scenario | Result | Evidence |
|---|---|---|
| S1 suite/build | PASS | `test:run-jobs-ttl` 16/16; `tsc --noEmit` clean; `npm run build` green |
| S2 dry-run | PASS | `st-runs: 0 runs / eligible 0`; `savant-trader/data/runs: 214 runs / eligible 113,486`; `--days abc` + `--max abc` → usage error exit 1 |
| S3 audit | PASS | 0 FAIL / 1 WARN (expected pre-purge backlog); retained 24,076; foreign ≈ 1,117,766; 0 missing-createdAt in 2,595-doc sample |
| S4 deploy | PASS | `functions[cleanupStRunJobs(us-central1)] Successful create operation` — nodejs22, timeout 300s |
| S5 live sweep | PASS | `gcloud scheduler jobs run` → log `cleanupStRunJobs_complete {runsScanned:214, jobsMatched:20760, deleted:20000, backlogRemaining:true, ttlDays:7}` — deleted exactly at 20k cap in ~45s |
| S6 foreign zero-touch | PASS | group total 1,255,328 → 1,141,842 = exactly −113,486 (ST deletes only); foreign ≈ 1,117,766 unchanged; spread-runs 26 runs/36 jobs untouched |
| S7 drain | PASS | `purge --apply`: 5 passes → 93,486 deleted; total 113,486 (sweep 20k + purge 93,486) matches dry-run count exactly |
| S8 completion/auto-paper | DEFERRED (observational) | Next natural PDR/nightly run — code-level safety proven: evalRunCompletion reads run-doc counters only; auto-paper reads `createdOpportunity` jobs of the just-completed run (24,076 retained jobs prove <7d window preserved). Same convention as #1008 S11 |
| S9 regression smoke | PASS | `test:decisions-retirement` 5/5; `test:config-lists` 20/20 |

## Verdict

**PASS** — all executable scenarios green; backlog fully drained
(113,486 docs); post-drain audit 0 FAIL / 0 WARN; sweeper deployed and
self-draining at 20k/day steady state. S8 deferred to natural-run
observation per convention (non-blocking — code-level safety proven).

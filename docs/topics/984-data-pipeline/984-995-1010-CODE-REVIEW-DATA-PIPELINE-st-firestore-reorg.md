**Topic:** ST Firestore Reorg  
**Topic Slug:** st-firestore-reorg  
**Thread:** Data Plane Consolidation  
**Thread Slug:** data-plane-consolidation  
**Issue:** #995  
**Thread Parent:** #985  
**Topic Parent:** #984  
**Task:** #1010  
**Domain:** DATA-PIPELINE  
**Type:** CODE-REVIEW  
**Status:** Complete  
**Created:** 2026-10-20  
**Last Updated:** 2026-10-20  

# CODE-REVIEW — #1010 jobs 7-day TTL cleanup + backlog purge

## Summary

7-day TTL for `…/runs/{runId}/jobs/{SYM}` per-symbol progress docs
(PRD US-7): scheduled sweeper `cleanupStRunJobs`, one-shot backlog
purge `purge-st-run-jobs-1010.ts`, prod audit
`data-pipeline-run-jobs-ttl-1010.ts`, 16-spec test suite.

Three axes ran in parallel and found **three majors** — each remediated
pre-verdict by a query redesign (per-run enumeration replaces
`collectionGroup('jobs')`), then **empirically proven against prod**:
dry-run counted 113,486 eligible docs across 214 runs; the audit
reports 0 FAIL / 1 expected WARN (pre-purge backlog) and a foreign-doc
census of 1,117,766 non-ST jobs the new scope can never touch.

## Findings (all remediated)

### Major

1. **`collectionGroup('jobs')` query FAILED_PRECONDITIONs** (Spec axis;
   verified by probe). No `jobs` collectionGroup index on `createdAt`
   exists (`firestore.indexes.json` has no entry) — the original
   sweeper would throw on its first invocation. **Fix:** redesigned to
   per-root run enumeration + per-run
   `jobs.where('createdAt', '<', cutoff)` — rides the automatic
   collection-scope single-field index; no index deploy needed.
   Probe-verified on prod.

2. **Sweep starvation via foreign `jobs` docs** (Thermo axis; verified
   by probe + census). `system/rs-realtime-runs/runs/{runId}/jobs` and
   `system/rs-backfill-runs` jobs also carry `createdAt` — 1,117,766
   foreign docs (89% of the group) vs ~185k ST. rs-realtime jobs have
   no TTL and accumulate unboundedly; ordered oldest-first they would
   permanently occupy the scan window — deleted trending to 0.
   **Fix:** the per-run query scope makes foreign docs structurally
   unreachable — no guard needed on the delete path.
   `isStRunJobPath` remains as the audit's census classifier only.

3. **Shared purge logic co-located with `onSchedule` registration**
   (Thermo axis). Purge script, audit, and tests imported the sweeper
   module — executing function-registration code (and transitively
   loading `webhooks-config`) in script context. **Fix:** core
   extracted to `src/common/st-run-jobs-ttl.ts`
   (`ST_RUN_JOB_ROOTS`, `isStRunJobPath`, `purgeOldRunJobsForRoot`,
   `purgeOldRunJobs`); the sweeper is now a thin trigger — a test pins
   "no query logic in the trigger file".

### Minor (remediated)

- **`as never` fixtures** — replaced with a single
  `as unknown as Parameters<typeof purgeOldRunJobsForRoot>[0]` cast
  inside the fake factory; cutoff is a real `Date`. (test)
- **Contract-blind fake** — the fake now records `where` args; a spec
  asserts the actual `{createdAt, '<', cutoff}` predicate. (test)
- **`rootOf()` hardcoded root literals** — deleted; the purge loops
  `ST_RUN_JOB_ROOTS` and reports per-root counts natively. (purge)
- **Misleading cost claim** — `.select()` reduces payload, not billed
  reads; comments corrected, and the delete path now uses the empty
  `.select()` projection (refs only — job bodies never fetched).
- **"Drains on later invocations" understatement** — sweeper header now
  states the purge is the one-shot drain mechanism and the sweep only
  handles steady state; `SWEEP_DELETE_CAP` is a timeout guard, not the
  drain. `timeoutSeconds: 300` added for the pre-purge window.
- **`--max`/`--days` NaN args** — validated with usage errors.
- **Unclear blast-radius naming** — header now names rs-backfill/
  rs-realtime/spread as the foreign population explicitly.

### Judgement calls (accepted, not defects)

- `MAX_RUN_JOBS_BATCH_SIZE = 400` duplicates the siblings' per-file
  constant — consistent with house style.
- Source-string assertions on `index.ts`/sweeper registration —
  established #1009 convention for registration checks.
- `skipped` dropped from the result shape — per-run scope makes skips
  impossible; foreign accounting lives in the audit's census instead.
- Run docs carry no `createdAt` (214/214 sampled) — enumeration is
  unfiltered refs-only `select()` (~214 reads/sweep, trivially cheap).
- Jobs missing `createdAt` never match the predicate — they die at
  #1013 wholesale delete; audit WARNs if the sample finds any
  (0/2595 today).

## Spec axis — PRD US-7

| AC | Verdict | Evidence |
|---|---|---|
| Scheduled cleanup deletes job docs >7d | **MET** | `cleanupStRunJobs` daily 03:45 UTC; per-run `createdAt` predicate proven on prod (113,486 eligible counted) |
| Auto-paper + run-progress unaffected | **MET** | `evalRunCompletion` reads run-doc counters only (run-progress.ts:51); auto-paper reads `createdOpportunity` jobs of the just-completed run (auto-paper-ingest-pass.ts:620-628); FE `run.service.ts` reads run docs only; only FE `jobs` reader is `spread-runs` (different domain — now structurally unreachable) |
| 1.24M backlog purged once | **MET (mechanism)** | `purge-st-run-jobs-1010.ts --apply` — dry-run verified; real ST backlog is 113,486 docs (the 1.24M figure was the whole group incl. ~1.12M foreign) — issue #1010 description corrected by finding |

## Thermo-nuclear axis

All majors remediated above. Post-remediation shape: shared core in
`common/` (side-effect-free), thin trigger, one query shape shared by
sweeper + purge, audit reuses the core's exported root list. No
remaining structural findings.

## Test results

- `test:run-jobs-ttl`: **16/16 pass** — path classifier incl.
  rs-domain rejection, predicate recording, batch chunking, maxDelete
  across runs, all-roots budget sharing, trigger thinness.
- `tsc --noEmit`: clean. `npm run build`: green.
- Full jest: **4027 pass, 2 fail — both pre-existing, unrelated**:
  `screenshot-capture-contracts.spec.ts` (PositionType gained
  `vertical-debit-spread`/`calendar`/`option-single` from parallel
  committed work) and `sidenav-menu.component.spec.ts` (`DS Gallery
  (Dev)` menu item added). Neither file is touched by this changeset
  (functions-only) and both fail on committed code.
- Prod verification (read-only): purge dry-run 113,486 eligible; audit
  0 FAIL / 1 WARN (expected pre-purge backlog); 24,076 recent jobs
  retained; 0 missing-createdAt in 2,595-doc sample.

## Verdict: **PASS** (1 round — 3 majors + minors remediated
pre-verdict; redesign empirically proven on prod)

QA should run the deployed-sweeper check and the `--apply` purge
decision; the backlog WARN clears only after `--apply`.

**Topic:** ST Firestore Reorg  
**Topic Slug:** st-firestore-reorg  
**Thread:** Data Plane Consolidation  
**Thread Slug:** data-plane-consolidation  
**Issue:** #995  
**Thread Parent:** #985  
**Topic Parent:** #984  
**Task:** #1159  
**Domain:** DATA-PIPELINE  
**Type:** CODE-REVIEW  
**Status:** Approved  
**Created:** 2026-10-28  
**Last Updated:** 2026-10-28  

# Code Review — #1159 st-runs / st-symbols cutover (final)

Three-axis review of the #1159 changeset: doc-level BE/FE repoints from
`savant-trader/data/{runs,symbols}` to `st-runs`/`st-symbols`, the
`SignalDateWriter` ref split (gate fields → canonical, run-ids /
signal-history → legacy parent until #1019), `ST_RUN_JOB_ROOTS` leg drop,
constant retirements, verbatim migration (244 runs + 23,150 jobs + 926
symbols applied to prod), parity relay, pin/spec updates, and runbook docs.

## Standards

- ~~major — `paper-trading-auto-paper-916-inputs.ts:118` and
  `paper-trading-auto-paper-918-ingest.ts:105` read symbol-meta off
  `ST_SYMBOLS_COLLECTION`~~ — REMEDIATED: both meta legs repointed to
  `ST_SYMBOLS_ROOT` (run-ids legs correctly stay on the legacy parent).
  Post-#1159 the legacy doc is frozen, so the scripts would have
  false-verified stale meta and failed outright on canonical-only symbols.
- ~~major — `stageCopy` overwrite direction could revert post-cutover
  canonical writes on the step-3 straggler re-run~~ — REMEDIATED: DocMap
  now carries `updateTime`; a differing canonical doc newer than its
  legacy twin is `skipped` + WARNed, never overwritten (`migrate-st-runs-
  symbols-1159.ts` `stageCopy`). `skipped` is a first-class stat.
- ~~major — latent dead-write traps in ops scripts:
  `replay-missing-symbols.ts` (enable-doc write + partner-universe diff),
  `backfill-orphan-st-symbols.ts`, `backfill-overview.ts`,
  `backfill-st-signals-1001.ts` symbol enumeration~~ — REMEDIATED: all
  repointed to `ST_SYMBOLS_ROOT`/canonical; subcollection legs untouched.
- minor — dry-run staged phantom pending ops and flushed empty batches —
  REMEDIATED: `stageCopy` returns `false` under `--dry-run` after
  classifying, so `pending` tracks real staged ops only.
- minor — totals conflated run docs with ~23k job docs — REMEDIATED:
  label now reads `runs TOTAL (run+job docs)`.
- minor — `--id <missing>` silently reported all-zero stats — REMEDIATED:
  explicit "not found" line.
- nits — stale comments fixed: `signal-date-writer.ts` reader-cutover ref
  (#1013→#1019), `utils.ts` "savant-trader/data/symbols doc",
  `st-cloud-function/README.md` collection table (st-symbols/st-runs
  rows), `data-pipeline-legacy-roots-1013.ts` blocked-root labels,
  `purge-st-run-jobs-1010.ts` header figure, `dashboard-callables.ts`
  "(default 5)"→14, `st-run-jobs-ttl.ts` wholesale-delete clarified as a
  manual ship step, `Object.hasOwn` for key symmetry in both scripts.

## Spec

- All four acceptance criteria met or correctly deferred per the task's
  own #1019 contract: st-runs populated (244/244 verbatim), st-symbols
  populated (926/926), FE re-points landed (run.service, signal.service
  doc reads, chart-review, chart-view), `Collection.ST_RUNS` retired —
  `Collection.ST_SYMBOLS` correctly retained since its two surviving
  reads are subcollection paths owned by #1019.
- Zero deployed doc-level legacy reads/writes remain — every surviving
  `ST_SYMBOLS_COLLECTION` use in `functions/src` is a run-ids /
  signal-history subcollection path (signal-date-writer, dashboard-
  callables, auto-paper-ingest) — verified by enumeration and pinned.
- No unrepointed writers: symbol docs land on `ST_SYMBOLS_ROOT` in
  symbol-added, seed-admin, overview-helper, writer; run/job docs on
  `ST_RUNS_ROOT` in run-creation, job-enqueueing, run-progress, TTL.
- Deploy-before-migrate ordering has no code-level guard — repointed
  readers degrade to silent empty results rather than failing loud.
  Accepted-with-runbook (migrate → deploy → straggler re-run → relay);
  flagged for the QA checklist.

## Thermo-nuclear

- ~~major — straggler-pass overwrite direction (same finding as
  Standards #2)~~ — REMEDIATED as above.
- ~~major — parity relay passed vacuously on empty/evacuated legacy
  roots~~ — REMEDIATED: `legacy.size > 0` / `legacyJobs > 0` floors on
  all three legs; header now states the relay must run BEFORE the
  legacy wholesale delete.
- minor — relay job-diff lines misattributed cumulative counters per
  run — REMEDIATED: per-run deltas.
- minor — no path-level pin on the auto-paper prod-dep split —
  REMEDIATED: new `tests/functions/st-runs-symbols-cutover-1159.test.ts`
  pins jobs→st-runs + run-ids→legacy parent in the ingest pass, the
  writer's two refs, run.service ST_RUNS_ROOT, signal.service doc/sub
  split, and `ST_RUN_JOB_ROOTS == ['st-runs']`; wired as
  `npm run test:st-cutover-1159` (pass 2 found the missing script entry).
- Verified clean: the `symbolRef`/`legacySymbolRef` seam is airtight —
  every remaining `ST_SYMBOLS_COLLECTION` consumer is a subcollection
  path; verbatim copy + key-symmetric diff handles arbitrary doc shapes;
  rules + indexes already cover both roots and nested jobs; new-symbol
  edge (canonical-only symbol, shell legacy parent) resolves correctly
  for both collectionGroup and doc-path readers.
- residual — deploy-window auto-paper race is covered only by ordering
  (accepted, documented on #1159); `chart-view.component.{ts,spec}` carry
  interleaved #1232/#1258 work — surgical hunk staging required at ship.
  prod composite-index reliance of the `enabled + symbol IN` query was
  not verifiable offline — flagged for post-deploy smoke (index merging
  is expected to cover it as it did on legacy).

## Test results

| Suite | Result |
|---|---|
| `tsc --noEmit` (functions + app) | clean |
| `st-runs-symbols-cutover-1159` pin (new) | 5/5 |
| `signal-date-writer`, `run-jobs-ttl-1010`, `legacy-roots-1013` pin | 34/34 + 16/16 + 49/49 |
| `st-signals`, `st-run-completion`, `collection-renames`, `rules-indexes`, `st-order-tickets`, `st-position-groups`, `new-list-sweep` | all green (139) |
| `paper-trading` suite | 278/278 |
| FE specs (chart-view, cutover pin, signal/run services) | 20/20 |
| migration `--apply` vs prod | 24,320 docs verbatim, 0 failures |
| parity relay (re-run post-remediation) | 9/9 green, floors intact |
| migration dry-run post-remediation | 23,394 + 926 unchanged, 0 create/update/skip (1 transient oauth flake, retried clean) |

## Verdict

**PASS** (round 1, remediated) — both majors (missed meta repoint in the
two in-diff verify scripts; straggler-pass overwrite direction + vacuous
relay floor) fixed and re-verified; remaining items are documented
ship-time/ops notes. Deployed code surface was clean on all axes.

**Topic:** ST Firestore Reorg  
**Topic Slug:** st-firestore-reorg  
**Thread:** Data Plane Consolidation  
**Thread Slug:** data-plane-consolidation  
**Issue:** #1310  
**Thread Parent:** #985  
**Topic Parent:** #984  
**Task:** #1159  
**Domain:** DATA-PIPELINE  
**Type:** UAT  
**Status:** Complete  
**Created:** 2026-10-28  
**Last Updated:** 2026-10-28  

# UAT — #1159 st-runs / st-symbols migration (populate canonical roots)

Task #1159 cut doc-level Firestore traffic from the legacy
`savant-trader/data/{runs,symbols}` roots to canonical `st-runs` /
`st-symbols` and migrated existing data verbatim. `run-ids` /
`signal-history` subcollections deliberately remain on the legacy parent
until #1019. This UAT verifies (a) migrated data parity, (b) the
code-level repoint boundary, and (c) the documented post-deploy
verification sequence.

## Scope

- `st-runs` populated with parity to `savant-trader/data/runs`
  (244 run docs + 23,150 job docs verbatim).
- `st-symbols` populated with parity to `savant-trader/data/symbols`
  (926 docs verbatim); run-ids/signal-history stay legacy per #1019.
- BE repoints: run create/enqueue/progress/TTL/callables, symbol-doc
  reads/writes, `SignalDateWriter` ref split.
- FE repoints: `run.service` → `ST_RUNS_ROOT`; `signal.service` +
  chart-review + chart-view doc reads → `ST_SYMBOLS_ROOT`;
  `Collection.ST_RUNS` retired.
- Migration + parity tooling: `migrate-st-runs-symbols-1159.ts`,
  `verify/data-pipeline-st-runs-symbols-1159.ts`.

## Prerequisites

- Repo at `C:\aa\projects\rel-str`, branch `prod`, working tree contains
  the #1159 changeset (uncommitted — ship gate is separate).
- Application Default Credentials with Firestore access to `rel-str`
  (prod). Commands run from `functions/` unless noted.
- `$env:NODE_OPTIONS="--require C:\Users\bob\.config\node\ipv4-only.cjs"`
  if the terminal predates the user-level env var.

## Scenarios

### S1 — Parity relay (read-only, executable now)

**Feature:** migrated data parity. **Start state:** post-`--apply` prod.

1. `cd functions; npx tsx scripts/verify/data-pipeline-st-runs-symbols-1159.ts`
2. Expect: 9/9 `OK` — st-runs run docs `legacy=244 canonical=244
   missing=0 diffs=0`; jobs `legacyJobs=23150 missing=0 diffs=0`;
   st-symbols `legacy=926 canonical=926 missing=0 diffs=0`; context row
   for legacy subcollections; 5 blocked-root rows non-empty.
3. Negative path built in: empty legacy root now FAILs the leg
   (zero-evidence floor) — the relay cannot pass vacuously.

**Result:** PASS — relay executed 2026-10-28 twice: first run correctly
FAILED on overnight drift (new PDR run `2026-10-28_wed_082219_pdr` + 926
jobs + 141 legacy-newer symbol docs written by the still-deployed legacy
writer); after `migrate --apply` straggler-pick (created=927, updated=141,
skipped=0, failed=0 — the updateTime guard classified exactly as
designed), relay re-run green 9/9 (`legacy=245 canonical=245`,
`legacyJobs=24076`, `legacy=926` symbols).

### S2 — Migration idempotency + direction guard (dry-run, read-only)

**Feature:** re-run safety of the migrator.

1. `cd functions; npx tsx scripts/migrate-st-runs-symbols-1159.ts`
   (no `--apply` → dry-run, writes nothing).
2. Expect: `runs TOTAL (run+job docs) — would create=0 updated=0
   skipped=0 unchanged=23394`; `symbols TOTAL — … unchanged=926`;
   `failed=0`. A nonzero `skipped` means a canonical doc drifted newer
   than its legacy twin (expected only after deploy).
3. Spot-check one doc: `… --only runs --id <runId>` → `unchanged=1`.

**Result:** PASS — dry-run 2026-10-28: 23,394 + 926 unchanged,
0 create/update/skip; one transient oauth metadata flake on a single
run doc retried clean via `--id`.

### S3 — Repoint boundary pins (automated)

**Feature:** doc-level vs subcollection split.

1. `cd functions; npm run test:st-cutover-1159` → 5/5.
2. `npm run test:legacy-roots-1013` → 49/49 (includes
   `'savant-trader/data/runs'` needle).
3. `npm run test:run-jobs-ttl` → 16/16 (`ST_RUN_JOB_ROOTS` membership).
4. `npm run test:st-signals` → 34/34 (writer split paths pinned).
5. `npx tsc --noEmit -p tsconfig.json` (functions) → clean; app tsc →
   clean.

**Result:** PASS — all green 2026-10-28 (st-cutover 5/5, legacy-roots
pin 49/49, run-jobs-ttl 16/16, st-signals 34/34, tsc clean).

### S4 — FE doc-read repoint (code-verified; live smoke at deploy)

**Feature:** FE reads canonical roots.

1. Evidence: `run.service.ts` reads `ST_RUNS_ROOT`; `signal.service` doc
   reads + `chart-review`/`chart-view` `getDoc` read `ST_SYMBOLS_ROOT`;
   `Collection.ST_RUNS` enum member deleted (pin
   `st-path-cutover-1014.spec.ts` 20/20 green).
2. **Post-deploy smoke (ship step):** with an authed session, confirm the
   recent-runs list renders (st-runs read), symbol names resolve on
   chart-review/chart-view (st-symbols `getDoc`), dashboard
   symbols-with-signals loads without FAILED_PRECONDITION
   (the `enabled + symbol IN` query relies on index merging — confirm
   once on real data).

**Result:** PASS — local dev server (prod Firestore) smoke confirmed by
user 2026-10-28: recent-runs list renders from `st-runs`, symbol names
resolve on chart surfaces from `st-symbols`, no FAILED_PRECONDITION or
permission errors. The remaining S4.2 smoke rows are the post-deploy
repeat of the same checks (deployed FE + callables).

### S5 — Post-deploy ship sequence — EXECUTED 2026-10-28

Ordered runbook — the task's operational contract, with observed results:

1. `firebase deploy --only functions` (writers cut to `st-*`) —
   landed `2026-10-28T18:53:58Z` (first attempt hit the known 10s
   source-analysis timeout; retry succeeded).
2. Migrator `--apply` straggler pass — `created=927` (one in-flight
   PDR run + its 926 jobs), `updated=3` (`AME`, `ELAN`, `KROS` —
   legacy-newer gate writes), `skipped=0`, `failed=0`.
3. Parity relay re-run → **9/9** (246 runs, 25,002 jobs, 926 symbols
   verbatim) before any deletion.
4. Post-deploy canonical writes confirmed: `st-runs/2026-10-28_wed_103038_pdr`
   updateTime > deploy time (in-flight run's progress landed on
   canonical); `st-symbols` `AME`/`ELAN`/`KROS` written post-deploy.
   `run-ids`/`signal-history` remain under the legacy symbols parent.
5. Callable/FE surface — verified via S4 live smoke pre-deploy; no
   rule/index errors observed on canonical reads.
6. Archive + delete `savant-trader/data/runs` — executed via
   `archive-legacy-roots-1013.ts --only savant-trader-runs` (manifest
   entry added this session). Archive: 25,248 docs (246 runs + 25,002
   jobs) → `functions/scripts/output/legacy-archive-1013/savant-trader-runs.json`
   (13.6 MB, parse-verified). Delete: `recursiveDelete`, post-check
   `remaining docs: 0`. Independent probe post-delete: `st-runs`
   246 runs + 25,002 jobs intact; legacy `savant-trader/data/symbols`
   926 docs with `run-ids`/`signal-history` subcollections preserved;
   `st-symbols` 926 docs intact.

**Result:** PASS — legacy `runs` root retired; canonical roots live and
verified.

## Traceability

| Acceptance criterion (issue #1159) | Scenario |
|---|---|
| `st-runs` populated — parity with legacy | S1 (runs+jobs), S2 |
| `st-symbols` populated — parity; subcollection strategy per #1019 | S1 (symbols + context row), S3 |
| FE re-points in the same release | S4 |
| `Collection.ST_RUNS`/`ST_SYMBOLS` retired once unbound | S3 (pin spec) + S4 |

## Regression / smoke checklist

- [x] Legacy `run-ids`/`signal-history` reads still work — all three
  remaining `ST_SYMBOLS_COLLECTION` consumers are subcollection paths
  (pinned by S3; verified by enumeration).
- [x] TTL sweep scope — `ST_RUN_JOB_ROOTS = [ST_RUNS_ROOT]`; legacy jobs
  intentionally unswept pending wholesale delete.
- [x] Blocked roots untouched — relay verifies cohorts/analysis/
  credentials populated.
- [x] Ops scripts no longer write the frozen root — replay-missing,
  backfill-orphan, backfill-overview, backfill-st-signals enumeration
  repointed (review round).
- [x] FE live smoke — local dev vs prod confirmed (runs list, symbol
  names, no rule/index errors).
- [x] Post-deploy live writes land on canonical roots — S5 step 4
  verified (`st-runs` run doc + 3 `st-symbols` docs updated
  post-deploy).

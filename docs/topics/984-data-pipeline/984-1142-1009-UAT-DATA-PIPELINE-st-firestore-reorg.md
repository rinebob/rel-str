**Topic:** ST Firestore Reorg  
**Topic Slug:** st-firestore-reorg  
**Thread:** Data Plane Consolidation  
**Thread Slug:** data-plane-consolidation  
**Issue:** #1142  
**Thread Parent:** #985  
**Topic Parent:** #984  
**Task:** #1009  
**Domain:** DATA-PIPELINE  
**Type:** UAT  
**Status:** Complete  
**Created:** 2026-10-20  
**Last Updated:** 2026-10-20  

# UAT — #1009 stop review-list + occurrence-decisions writes (BE)

## Scope

BE retirement of `savant-trader/data/review-list` +
`savant-trader/data/occurrence-decisions`. Task acceptance criteria:

- **AC1** No new writes to either collection (ticket = decision)
- **AC2** Readers removed; TTL keeps draining decisions

AC1's write-stop is FE-owned (`triage.service`, `occurrence-decision.store`)
and lands at #1016/#1017 — BE acceptance here is "no BE writes/readers
remain and the invariant is pinned by test + audit." The TTL sweeper
`cleanupStOccurrenceDecisions` intentionally stays deployed.

## Prerequisites

- Repo checkout on `prod`, working tree containing the uncommitted #1009
  changeset
- `functions/node_modules` installed (`cd functions && npm install`)
- Prod Firestore read access via ADC (for scenario 3)
- `NODE_OPTIONS=--require C:\Users\bob\.config\node\ipv4-only.cjs` for any
  Firebase-CLI-adjacent call (IPv6 routing is unreliable on this network)

## Scenarios

### S1 — Code invariant + drain registration (unit, cred-free)

Confirms AC1 (no BE readers/writers remain) and AC2 (TTL drain intact).

```powershell
cd functions
npm run test:decisions-retirement
```

Expected: 5 tests, 5 pass, 0 fail — constants absent; no
`functions/src/**/*.ts` file references a retired path outside the
whitelisted sweeper; `cleanupStOccurrenceDecisions` export anchored and
still targeting `savant-trader/data/occurrence-decisions` on the
`30 3 * * *` schedule.

**Result:** PASS — 5/5 specs

### S2 — Adjacent-suite regression + typecheck

Confirms the constant removal broke no consumers.

```powershell
cd functions
npm run test:config-lists
npm run typecheck
```

Expected: 20/20 pass; tsc clean (a surviving consumer of either removed
constant would fail tsc outright).

**Result:** PASS — 20/20 specs; `tsc --noEmit` clean

### S3 — Prod retirement audit

Confirms AC1/AC2 against live state (read-only).

```powershell
cd functions
$env:NODE_OPTIONS="--require C:\Users\bob\.config\node\ipv4-only.cjs"
npx tsx scripts/verify/data-pipeline-decisions-retirement-1009.ts
```

Expected: exit 0; `no functions/src reference to retired paths`;
sweeper export OK; `review-list` doc count reported as INFO (dies at
#1013); `occurrence-decisions` empty or inside the 7d TTL + 2d buffer;
0 FAIL. A fresh-write WARN (decision <24h old) is expected until #1017
and is not a gate failure.

**Result:** PASS — 0 FAIL, 0 WARN; review-list 12 docs (expected until #1016/#1013); occurrence-decisions empty (drained ahead of #1013 delete)

### S4 — Drain mechanism live in prod

Confirms AC2 end-to-end — the sweeper is actually deployed, not just
exported in source.

```powershell
cd functions
$env:NODE_OPTIONS="--require C:\Users\bob\.config\node\ipv4-only.cjs"
firebase functions:list 2>&1 | Select-String cleanupStOccurrenceDecisions
```

Expected: `cleanupStOccurrenceDecisions` listed as a scheduled function.

**Result:** PASS — `firebase functions:list` shows `cleanupStOccurrenceDecisions` v2 scheduled, us-central1

### S5 — Soak boundaries intact

Confirms nothing outside BE scope changed: `firestore.rules` still
permits both collections (FE writes until #1016/#1017 — denying now
would break the live app), and FE readers/writers are untouched.

```powershell
Select-String -Path firestore.rules -Pattern 'occurrence-decisions|review-list'
git diff --stat -- src/app firestore.rules firestore.indexes.json
```

Expected: both match blocks present in rules; the #1009 changeset
touches no `src/app` file and neither rules/indexes file.

**Result:** PASS — rules match blocks intact (L191 occurrence-decisions, L199 review-list); rules diff at L348 is unrelated user work — retired-collection lines untouched; #1009 changeset modifies no src/app/rules/indexes file

## Traceability

| Criterion | Scenario |
|---|---|
| AC1 — no new BE writes / readers removed | S1, S2, S3 |
| AC2 — TTL keeps draining decisions | S1, S3, S4 |
| Review finding — audit cannot false-OK on bad `decidedAt` | S3 (fixed code path exercised; empty-collection branch observed) |
| Deferred scope honest (FE write-stop = #1016/#1017) | S5 |

## Regression / smoke checklist

- [x] `test:config-lists` 20/20 — S2
- [x] `open-pass`, `auto-paper-ingest-pass`, `signal-order` suites green — run during review remediation (79/79 incl. S1 file)
- [x] tsc `--noEmit` clean — S2
- [x] `run-all.ts` verify index registers #1009 after #1008 — reviewed at S3 file inspection

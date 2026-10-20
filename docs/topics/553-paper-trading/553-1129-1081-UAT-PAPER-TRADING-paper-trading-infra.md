# UAT — #1081 FE analysis service + store

**Topic:** Paper Trading Infra  
**Topic Slug:** paper-trading-infra  
**Thread:** Trade Analysis & Forensics  
**Thread Slug:** trade-analysis  
**Issue:** #1129  
**Thread Parent:** #1059  
**Topic Parent:** #553  
**Task:** #1081  
**Domain:** PAPER-TRADING  
**Type:** UAT  
**Status:** Complete  
**Created:** 2026-10-19  
**Last Updated:** 2026-10-19  

## Scope

Headless FE task — analysis dataset service + NgRx SignalStore that the
#1082–#1085 UI tasks build on. No user-facing surface ships with this
task; acceptance is contract-level via the spec suite, typecheck, and
deployed rules.

## Prerequisites

- Repo on `prod`, deps installed (`npm i` — papaparse@5.7.0 landed with
  this task).
- Firestore + Storage rules deployed (user ran
  `firebase deploy --only firestore:rules,storage` 2026-10-19).

## Scenarios

| # | Feature | How to verify | Expected | Result |
|---|---|---|---|---|
| S1 | Index list + tags/notes merge | `npx jest analysis.service.spec` — "lists dataset index docs ordered by generatedAt desc", "updateTagsNotes$ merges tags + notes", "updateTagsNotes$ without notes leaves…/null clears" | `query(orderBy('generatedAt','desc'))`; `updateDoc` merge; undefined = don't touch, null = clear | **PASS** — specs green |
| S2 | Delete removes doc + object | same file — "deleteDataset$ deletes the Storage object then the index doc", "tolerates object-not-found" | `deleteObject` + `deleteDoc` both spied; missing-object tolerated; hard-fail aborts before doc | **PASS** — specs green |
| S3 | CSV load: header-name binding | same file — loadDataset specs | reordered headers + appended column parse correctly; absent manifest column → null; every manifest key present; `{rows, columns}` returned | **PASS** — real papaparse, specs green |
| S4 | Slice CRUD | same file — slice specs | list/save (Firestore auto-id)/update/delete on `analysisSlicesPath()` | **PASS** — specs green |
| S5 | filteredRows AND composition | `npx jest analysis.store.spec` — filter specs | enum `in`, numeric `gte/lte`, date range combine with AND; null row never matches a bounded filter | **PASS** — specs green |
| S6 | Sort chain (#1067 pattern) | same file — sort specs | asc → desc → removed; shift additive builds the chain | **PASS** — specs green |
| S7 | Slice apply + missing-column notice | same file — slice apply specs | predicates on absent columns skipped → `skippedSliceColumns` + snackbar notice; matching predicates apply | **PASS** — specs green |
| S8 | Compare rows use same filters | same file — compare specs | `filteredCompareRows` applies the active filter chain to compare dataset rows | **PASS** — specs green |
| S9 | Race-cancel + stale-state cleanup | same file — race/cleanup specs | open A → open B: A's late resolve can't overwrite B; delete/close clears active + compare + skipped-column state | **PASS** — specs green |
| S10 | Rules allow the new operations | inspect `firestore.rules` + `storage.rules` (deployed) | authed update+delete on `analysis-datasets` anchor; authed delete on `analysis-datasets/` objects; create stays callable-only | **PASS** — rules deployed 2026-10-19 |
| S11 | Typecheck | `npx tsc -p tsconfig.app.json --noEmit` | clean | **PASS** |

## Traceability

Every #1081 acceptance criterion maps to a scenario above (S1–S11).
E2E/UI journeys deferred to #1082–#1085 by design — those tasks have
their own QA gates; the manual refinement pass is **not applicable — no
user-facing surface** in this task.

## Execution evidence

- `npx jest analysis.service.spec.ts analysis.store.spec.ts` — **37/37
  green** (re-run for QA, not carried over from review)
- `npx tsc -p tsconfig.app.json --noEmit` — **clean** (re-run)
- Rules deploy confirmed by user output earlier this session

## Refinement pass

Not applicable — no user-facing surface. UI click-through lands with
#1082–#1085.

## Findings

None.

**Topic:** Refactor data pipeline to PDR-driven triggers, consolidate local bar store writers, and migrate charts to local reads  
**Issue:** #164  
**Topic Parent:** #159  
**Domain:** DATA-PIPELINE  
**Type:** Code Review  
**Status:** Complete  
**Created:** 2026-08-23  
**Last Updated:** 2026-08-24  

---

# Code Review: Task #167 — Completion signal, watchdog, downstream consumers

## Summary

Three-axis review (Standards, Spec, Thermo-nuclear) of the SDS completion pipeline: per-interval completion, sequence fan-in, downstream consumer dispatch, and watchdog. Initial review returned FAIL with 4 critical and 8 major findings. All findings were fixed, ADR-005 (symbol set reconciliation) was implemented, and a re-review was conducted. 52/52 tests pass, typecheck passes, build succeeds.

## Test Results

- **52/52 tests pass** (sds-pdr-parser: 13, sds-core: 15, sds-worker-core: 6, sds-completion: 18)
- Typecheck: PASS
- Build: PASS

## Re-Review Findings

### Initial Review — CRITICAL (4) — ALL FIXED

| # | Finding | Fix |
|---|---------|-----|
| C1 | Race condition in `fireSequenceCompletion` — non-transactional | Conditional transaction: only transitions `processing → completed`. One caller wins. |
| C2 | Watchdog force-completes active runs — uses only `startedAt` | Now checks `lastActivityAt` (set by worker on each symbol). 5-min threshold. |
| C3 | Watchdog doesn't retry `completed_but_not_dispatched` runs | Added retry loop for intraday runs with that status. |
| C4 | `createCompletionDeps` duplicated across 3 files | Extracted to `sds-completion-deps.ts`, used by `sds.ts`, `sds-worker.ts`, `sds-watchdog.ts`. |

### Initial Review — MAJOR (8) — ALL FIXED

| # | Finding | Fix |
|---|---------|-----|
| M1 | Non-transactional watchdog sequence updates | Watchdog sequence completion goes through `fireSequenceCompletion` (conditional transaction). |
| M2 | Consumer dispatch retry causes duplicate processing | Retry resets status to `processing`; conditional transaction re-claims atomically. |
| M3 | Incomplete scoped consumer implementation | Documented that scoped = full for now; consumer names are distinct for log traceability. |
| M4 | Unused payload fields in consumer dispatch | Removed `sequenceRunId`, `sequence`, `runId` from `ConsumerDispatchPayload`. |
| M5 | No test for watchdog forcing stale sequence completion | Added test (>8 min stale sequence → completed + dispatched). |
| M6 | No test for failed symbols merging | Replaced with retry-proof test (duplicate `processedSymbols` don't inflate). |
| M7 | Missing concurrent completion test | Added test: two intervals complete in parallel, consumers dispatched exactly once each. |
| M8 | Missing Firestore Timestamp format test | Added test with `{ _seconds, _nanoseconds }` format. |

### Initial Review — MINOR (5) — ALL FIXED

| # | Finding | Fix |
|---|---------|-----|
| m1 | File size exceeds 300 lines (422) | Split: `sds-completion.ts` (357), `sds-watchdog-logic.ts` (190). |
| m2 | RsExtensionPoint dead code | Retained with comment per AC #10 (defined but not wired). |
| m3 | Magic number thresholds | Comments added: 5 min runs, 8 min sequences. |
| m4 | Weak assertion in watchdog retry test | Now asserts `completionEnqueued === true` and `dispatched.length > 0`. |
| m5 | No test for POST C | Added POST C test. |

### Initial Review — NIT (3) — ALL FIXED

| # | Finding | Fix |
|---|---------|-----|
| n1 | Missing JSDoc on exported functions | JSDoc added to `checkSyncRunCompletion`, `checkIntradayRunCompletion`. |
| n2 | Comment inconsistency in scoped consumers | Comments updated — scoped filtering deferred, names distinct for tracing. |
| n3 | `now` parameter undocumented | JSDoc notes it's for testability. |

### Re-Review — New Findings — ALL FIXED

| # | Finding | Severity | Fix |
|---|---------|----------|-----|
| R-C1 | Empty symbol set causes premature completion (`0 >= 0`) | Critical | Added guard: marks run complete but skips sequence fan-in / consumer dispatch. |
| R-C2 | Watchdog force-complete run → sequence completion untested | Critical | Added test: stale MONTHLY run + 2 completed intervals → sequence completes + consumers dispatch. |
| R-M1 | `updateSequenceAfterForce` non-transactional read-modify-write | Major | Replaced with `FieldValue.arrayUnion` — atomic, no race. |
| R-M2 | Unused `failedSymbols` in `handleIntradayRun` | Major | Removed dead tracking code. |
| R-M3 | Unused payload fields (`sequenceRunId`, `sequence`) | Major | Removed from consumer payload. |
| R-m1 | Stale comment "15 minutes" (threshold is 5 min) | Minor | Fixed to "5 minutes". |
| R-m2 | Stale comment "Merges failed symbols" | Minor | Removed — logic no longer exists. |
| R-m3 | Stale comment about `failedSymbols` payload | Minor | Updated consumer dispatch comment. |
| R-m4 | Concurrent test only checks `selection` | Minor | Now asserts all 3 consumers dispatched exactly once. |

## ADR-005: Symbol Set Reconciliation

During the fix cycle, the completion detection logic was redesigned and documented in [ADR-005](../../adr/ADR-005_sds-completion-detection.md):

- **Old:** Count-based (`processedCount >= totalSymbols`) — retries inflate counter, silent drops
- **New:** Set-based (`processedSymbols.length >= symbols.length`) — `arrayUnion` is idempotent
- **Removed:** `failedSymbols`, `successCount`, `failedCount`, `totalSymbols` from run doc schema
- **Watchdog thresholds:** 5 min for runs (was 15), 8 min for sequences (was 20)

## Acceptance Criteria Summary

| # | Criterion | Status |
|---|-----------|--------|
| 1 | checkSyncRunCompletion wrapped in transaction | MET |
| 2 | Per-interval completion fires when `processedSymbols.length >= symbols.length` OR watchdog forces | MET |
| 3 | Sequence fan-in when all 3 intervals complete | MET |
| 4 | Sequence completion enqueues separate Cloud Tasks per consumer | MET |
| 5 | completionEnqueued flag set only after all enqueues succeed | MET |
| 6 | completed_but_not_dispatched status if enqueue fails | MET |
| 7 | Watchdog forces per-interval completion for stale runs (>5 min since last activity) | MET |
| 8 | Watchdog forces sequence completion for stale sequences (>8 min) | MET |
| 9 | Watchdog retries enqueue for completed_but_not_dispatched runs AND sequences | MET |
| 10 | RS extension point interface defined but not wired | MET |
| 11 | POST A → selection, settlement, RH Agent nightly | MET |
| 12 | POST B/C → settlement scoped, RH Agent nightly scoped | MET |
| 13 | Intraday run completion → RH Agent intraday | MET |
| 14 | rhAgentPdrTrigger deleted | MET |

## Verdict

**PASS** — All 4 critical and 8 major findings from the initial review are fixed. Re-review found 2 new criticals (empty symbols guard, untested watchdog→sequence path) and 3 new majors — all fixed. 52/52 tests pass. All 14 acceptance criteria MET. ADR-005 documents the schema change. Ready for QA.

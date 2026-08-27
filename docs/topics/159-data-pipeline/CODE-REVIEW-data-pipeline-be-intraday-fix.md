**Topic:** Refactor data pipeline to PDR-driven triggers, consolidate local bar store writers, and migrate charts to local reads  
**Issue:** #210  
**Topic Parent:** #159  
**Domain:** DATA-PIPELINE  
**Type:** Code Review  
**Status:** Complete  
**Created:** 2026-08-27  
**Last Updated:** 2026-08-27  

---

# Code Review: BE Bug — SDS Intraday Run Not Completing

## Summary

Three review axes (Standards, Spec, Thermo-nuclear) ran in parallel against the bug fix in issue #210. The initial fix addressed four issues in the SDS completion path:

1. ~~Replaced `processedSymbols` array with `processedCount` counter~~ — **REVERTED** (conflicted with ADR-005)
2. Removed `markIntradayRunComplete` which prematurely set `status: 'completed'`
3. Added intraday completion routing in the worker
4. Fixed `sds-fallback.ts` to handle partner API returning objects with `.symbol` property

The initial review found 3 critical findings (C1-C3) and 5 major findings (M1-M5). All findings have been addressed:

- **C1/C2 resolved:** Reverted `processedCount` → `processedSymbols` + `arrayUnion` (ADR-005 stands). The 1MB claim was incorrect (~19KB for 800 symbols).
- **C3 resolved:** Removed backward compat fallback. Tests now match production schema (`processedSymbols`).
- **M1 resolved:** Replaced `any` with `RawTrackedSymbol` union type + `normalizeTrackedSymbols` helper.
- **M2 resolved:** Moot — `totalSymbols` field removed with the revert.
- **M3 resolved:** Added 5 tests for `normalizeTrackedSymbols` (string, object, mixed, undefined, falsy).
- **M4 resolved:** Extracted `shouldUseIntradayCompletion` as testable pure function + 4 tests.
- **M5 resolved:** Moot — backward compat fallback removed with the revert.
- **m1 resolved:** Updated comments to reference `processedSymbols` and ADR-005.
- **n1 resolved:** Extracted `INTRADAY_INTERVAL` constant.

**Tests:** 79/79 pass (`npm run test:sds`). Build passes.

**Verdict: PASS** — All critical and major findings addressed.

## Findings by Severity

### Critical (all resolved)

#### C1. ADR-005 conflict — `processedCount` reverts accepted architectural decision

**Status: RESOLVED** — Reverted to `processedSymbols` + `arrayUnion` (ADR-005 stands).

ADR-005 (Accepted) explicitly decided to replace `processedCount >= totalSymbols` with `processedSymbols` array + `arrayUnion` because:

1. **Retry inflation:** Cloud Tasks retries failed tasks. `FieldValue.increment(1)` in the `finally` block fires on every retry, inflating `processedCount` past `totalSymbols` and firing completion early while symbols have no data.
2. **Silent drops:** If a task is never dispatched, `processedCount` never reaches `totalSymbols`. The watchdog force-completes, but there's no record of which symbols were never attempted.

`arrayUnion` is idempotent — retries don't inflate the set. The initial bug fix reverted to `increment(1)`, reintroducing the retry inflation problem. This has been corrected: all writes now use `FieldValue.arrayUnion(payload.symbol)`.

#### C2. 1MB Firestore limit claim is incorrect — root cause misdiagnosed

**Status: RESOLVED** — `processedCount` change reverted.

The bug description claimed `processedSymbols` array "could exceed the 1MB Firestore document size limit with 800+ symbols." Verification: 800 symbols as strings in a `processedSymbols` array produces a ~19KB document — far below the 1MB limit. The `processedSymbols` array was NOT the root cause.

The actual root causes were:
- **Premature `status: completed`** in `markIntradayRunComplete` (fix #2 — correct, kept)
- **Wrong completion routing** in the worker (fix #3 — correct, kept)

The `processedSymbols` → `processedCount` change was an unnecessary refactor based on a misdiagnosis. It has been reverted.

#### C3. Test-implementation mismatch — tests now match production schema

**Status: RESOLVED** — Backward compat fallback removed. `sds-completion.test.ts` already used `processedSymbols` (the ADR-005 schema). Now production matches.

The initial fix added a backward compatibility fallback (`processedCount ?? processedSymbols.length`) that made tests pass while testing the wrong schema. The fallback has been removed. `sds-core.test.ts` assertion updated from `processedCount` to `processedSymbols`.

### Major (all resolved)

#### M1. `any` type for partner API response in `sds-fallback.ts`

**Status: RESOLVED**

Replaced `(s: any)` with a proper `RawTrackedSymbol = string | { symbol: string }` union type and extracted `normalizeTrackedSymbols()` as a named, exported helper function. The same defensive pattern is duplicated in `sds.ts`, `symbol-data-sync.ts`, and `seed-admin.ts` — those are pre-existing and out of scope for this fix.

#### M2. Missing test coverage for `totalSymbols` field

**Status: MOOT** — `totalSymbols` field removed with the revert to ADR-005 schema.

#### M3. Missing test coverage for partner API symbol shape handling

**Status: RESOLVED**

Added 5 tests for `normalizeTrackedSymbols` in `sds-fallback.test.ts`:
- Plain string symbols pass through unchanged
- Object responses with `.symbol` property extracted correctly
- Mixed string and object responses handled
- Undefined input returns empty array
- Falsy values filtered out

#### M4. Missing test coverage for worker intraday completion routing

**Status: RESOLVED**

Extracted `shouldUseIntradayCompletion()` as a testable pure function from `sds-worker.ts`. Added 4 tests in `sds-core.test.ts`:
- Intraday payload with no sequenceRunId → true
- POST payload with sequenceRunId → false
- Intraday payload with sequenceRunId → false (edge case)
- POST interval with no sequenceRunId → false

#### M5. Backward compatibility fallback has no removal timeline

**Status: MOOT** — Backward compat fallback removed with the revert. No dual-schema situation exists.

### Minor (all resolved)

#### m1. Outdated comments in `sds-completion.ts`

**Status: RESOLVED** — Comments updated to reference `processedSymbols` and ADR-005.

#### m2. Duplicated collection name constants (pre-existing)

**Status: NOT ADDRESSED** — Pre-existing, not introduced by this fix. Tracked for future cleanup.

#### m3. Duplicated `TERMINAL_STATUSES` with different values (pre-existing)

**Status: NOT ADDRESSED** — Pre-existing, not introduced by this fix. Tracked for future cleanup.

### Nit (resolved)

#### n1. Magic string `'intraday'` in worker routing

**Status: RESOLVED** — Extracted `INTRADAY_INTERVAL = 'intraday' as const` constant in `sds-worker.ts`.

## Test Results

- **SDS test suite:** 79/79 pass (`npm run test:sds`)
- **Build:** Passes (`npm run build`)
- Tests now match production schema (`processedSymbols` + `arrayUnion`)

## PRD Acceptance Criteria Accounting

| # | Criterion | Status | Notes |
|---|-----------|--------|-------|
| 1 | Transaction-wrapped completion check | MET | `sds-completion.ts:100-158` |
| 2 | Per-interval completion when all tasks report | MET | Uses `processedSymbols.length >= symbols.length` (ADR-005) |
| 3 | Sequence fan-in when all 3 intervals complete | MET | `sds-completion.ts:171-192` |
| 4 | Separate Cloud Tasks per consumer | MET | `sds-completion.ts:255-282` |
| 5 | `completionEnqueued` after all enqueues succeed | MET | `sds-completion.ts:285-301` |
| 6 | `completed_but_not_dispatched` on enqueue failure | MET | `sds-completion.ts:286-289` |
| 7 | Watchdog forces stale run completion | MET | 5 min threshold (ADR-005) |
| 8 | Watchdog forces stale sequence completion | MET | 8 min threshold (ADR-005) |
| 9 | Watchdog retries `completed_but_not_dispatched` | MET | `sds-watchdog-logic.ts:121-162` |
| 10 | RS extension point defined but not wired | MET | `sds-completion.ts:59-61` |
| 11 | POST A → selection, settlement, RH Agent nightly | MET | `sds-completion.ts:256-259` |
| 12 | POST B/C → scoped settlement, scoped RH Agent | MET | `sds-completion.ts:260-263` |
| 13 | Intraday → RH Agent intraday | MET | `sds-completion.ts:347-353` |
| 14 | `rhAgentPdrTrigger` deleted | DEFERRED | Not in scope for this bug fix |
| 15 | Run doc tracks `successCount`/`failedCount`/`failedSymbols` | UNMET | Removed per ADR-005; PRD not updated |

## Bug Root Cause Verification

| Fix | Root cause correct? | Notes |
|-----|---------------------|-------|
| #1: ~~`processedSymbols` → `processedCount`~~ | **REVERTED** | 1MB claim incorrect (~19KB for 800 symbols). Reverted to ADR-005 schema. |
| #2: Remove `markIntradayRunComplete` | **YES** | Premature `status: completed` prevented downstream dispatch. Correct fix. |
| #3: Intraday worker completion routing | **YES** | Worker was calling `checkSyncRunCompletion` for intraday runs. Correct fix. |
| #4: Fallback symbol shape | **YES** | Partner API returns objects, not strings. Correct fix. |

## Verdict: PASS

All critical and major findings from the initial review have been addressed. The fix now correctly aligns with ADR-005, tests match production schema, and missing test coverage has been added. Pre-existing issues (m2, m3) are tracked for future cleanup.

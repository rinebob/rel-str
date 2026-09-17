**Topic:** Trading Indicator Library  
**Topic Slug:** indicator-lib  
**Thread:** ST ZigZag Indicator  
**Thread Slug:** st-zigzag  
**Issue:** #330  
**Thread Parent:** #322  
**Topic Parent:** #261  
**Task:** #335  
**Domain:** INDICATOR-LIB  
**Type:** Code Review  
**Status:** Complete  
**Created:** 2026-09-16  
**Last Updated:** 2026-09-16  

---

# Code Review: Task #335 — Firestore Service + Security Rules (Re-Review)

## Summary

Re-review after fixing 8 findings from the first review (C2, M1–M5, m2, m4). All 8 previous findings are resolved. One new major finding (collectionData listener leak) was found and fixed during this review. The remaining findings are minor/nit or explicitly deferred by the user.

**Verdict: PASS**

## Test Results

```
Test Suites: 7 passed, 7 total
Tests:       101 passed, 101 total
```

Firestore round-trip verification: ALL CHECKS PASSED.

## Previous Findings — All Resolved

| # | Previous Finding | Status | Evidence |
|---|------------------|--------|----------|
| C2 | Service swallowed all Firestore errors | Resolved | `catchError` removed; errors propagate. Spec verifies with `rejects.toThrow` |
| M1 | `userId` optional in type | Resolved | Split into `SwingAnalysisInput` (no id/userId) + `SwingAnalysisDoc` (required) |
| M2 | Service hand-rolled auth | Resolved | Uses `requireUserId` from `firestore-helpers.ts` |
| M3 | Redundant `id` persisted | Resolved | `setDoc` payload omits `id`; converter strips it |
| M4 | `saveAnalysis` didn't normalize symbol | Resolved | Normalizes to uppercase before building doc path |
| m4 | Converter persisted `id` | Resolved | `toFirestore` destructures `id` out |
| M5 | Store spec used `setTimeout` + `_service` | Resolved | Fully synchronous, tests through public signals + service mock |
| m2 | "Firestore error" test didn't test error | Resolved | Uses `throwError` + `rejects.toThrow` for all three methods |

## New Finding Found and Fixed During Re-Review

### Major (fixed) — collectionData listener leak
**File:** `swing-analysis.service.ts:59` (was)

`collectionData` creates a persistent `onSnapshot` listener that never completes. The store calls `loadSavedAnalyses` on every save (refresh) and on every explicit call, creating new listeners without unsubscribing old ones. This caused:
1. Memory leak — listeners accumulate
2. Stale data — old symbol's listener could overwrite `savedAnalyses`

**Fix:** Switched `loadSavedAnalyses` from `collectionData` (real-time) to `getDocs` (one-shot), matching the `trading-config.service.ts` pattern. Removed unused `collectionData` import.

## Remaining Findings (Deferred or Minor)

### Deferred by User

**C1 — paramsId cross-user collision** — The doc id is `paramsId` only (no userId), so two users with the same symbol+config collide. The user explicitly deferred this: "there is currently only one user (me) so not an issue. we'll do a full per user impl when that becomes an issue."

**Firestore list rule cross-user read** — The `resource == null` clause in `allow read` allows any authenticated user to list all analyses for a symbol. This is the existing repo pattern (`options-strategy-instances`, `spread-lists`). Deferred with C1.

### Minor

**m1 — Store spec has no error-path coverage** — No tests exercise `store.error()` for service failures. The store has explicit error handlers that now fire (since C2 fix), but they're untested.

**m2 — `loadAnalysis` doesn't use converter** — `loadAnalysis` hand-rolls `snap.data() as PersistedAnalysis` instead of using `withConverter` like `loadSavedAnalyses`. The two paths could drift.

**m3 — File sizes slightly over target** — `swing-analysis.store.ts` is 326 lines (target 300), `swing-analysis.store.spec.ts` is 432 lines (smell 400). Not blocking.

### Nit

**n1 — Verification script fixture includes `id` field** — The test document includes `id: TEST_PARAMS_ID`, but the production service now strips `id` before writing. The round-trip still works but is less representative.

**n2 — Path segment count tests are implementation-detail assertions** — They exist as regression guards against the mock-blindness footgun. Useful but not external-behavior tests.

## Spec Compliance

| Criterion | Status | Notes |
|-----------|--------|-------|
| Service handles Firestore read/write | MET | All three methods perform Firestore I/O |
| saveAnalysis writes to zig-zags path | MET | Uses `analyses` subcollection — established in #334 |
| loadAnalyses reads subcollection | MET | Method is `loadSavedAnalyses` — established in #334 |
| loadAnalysis reads single doc | MET | Correct path construction |
| paramsId builder format | MET | `dev{N}_L{N}_R{N}_1bar{Y|N}_proj{Y|N}` |
| Firestore security rules added | MET | User-scoped rules following existing pattern |
| Unit tests pass | MET | 101/101 pass |

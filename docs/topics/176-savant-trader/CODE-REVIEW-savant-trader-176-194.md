**Topic:** Savant Trader — FE-A1: Fix review flag persistence wiring
**Issue:** #194
**Topic Parent:** #176
**Domain:** SAVANT-TRADER
**Type:** Code Review
**Status:** Complete
**Created:** 2026-08-25
**Last Updated:** 2026-08-25

---

## Summary

Three-axis review of FE-A1 (#194): wiring TriageStore review flag mutation methods to TriageService Firestore calls with optimistic update + error rollback + snackbar. Small, focused diff — 1 modified file + 1 new test file.

### Tasks covered

| Task | Issue # | Description | Stage |
|---|---|---|---|
| FE-A1 | #194 | Fix review flag persistence wiring | 6_REVIEW |

**Verdict: PASS** — all critical and major findings discovered during review were fixed before writing this doc.

---

## Standards

### Findings discovered and fixed

**1. Missing subscription cleanup (CRITICAL → fixed)**
All 4 review flag methods called `.subscribe()` without `takeUntilDestroyed(destroyRef)`, creating potential memory leaks. Other stores in the project (st.store.ts, group.store.ts, symbol-history.store.ts) use `takeUntilDestroyed`.

> **Resolution:** Added `DestroyRef` injection and `takeUntilDestroyed(destroyRef)` pipe to all 4 methods.

**2. Inconsistent rollback pattern in markForReview (MAJOR → fixed)**
`markForReview` used `const reverted = { ...state.reviewFlags() }; delete reverted[symbol];` (reads current state) while the other 3 methods used `patchState(state, { reviewFlags: prev })` (uses captured snapshot). This could cause state corruption under concurrent operations.

> **Resolution:** Changed `markForReview` to use `patchState(state, { reviewFlags: prev })` like the other 3 methods.

**3. Missing reviewFlagsError state in error handlers (MAJOR → fixed)**
The state interface includes `reviewFlagsError: string | null` and `loadReviewFlags` sets it on error, but the 4 review flag methods didn't. `OccurrenceDecisionStore` follows the same pattern of setting error state.

> **Resolution:** Added `reviewFlagsError: err instanceof Error ? err.message : String(err)` to all 4 error handlers.

### No issues found

- File size: 278 lines, well under 400-line limit.
- Single responsibility: all 4 methods cohesively grouped under review flag concern.
- Clean type contracts: no `any` in method signatures.
- Test follows project patterns: TestBed, jasmine spies, service mocking via useValue.

---

## Spec

| Criterion | Status | Evidence |
|---|---|---|
| markForReview calls triageService.setReviewFlag | MET | `triage.store.ts:177` |
| unmarkFromReview calls triageService.clearReviewFlag | MET | `triage.store.ts:194` |
| markGroupForReview calls triageService.setReviewFlagsBatch(symbols, true) | MET | `triage.store.ts:213` |
| clearReviewFlags calls triageService.setReviewFlagsBatch(allFlagged, false) | MET | `triage.store.ts:162` |
| Optimistic update + error rollback with snackbar on all methods | MET | All 4 methods: optimistic patch → service call → error rollback + snackbar |
| TriageService uses savant-trader/data/review-list | MET | `triage.service.ts` uses `Collection.ST_REVIEW_LIST` (= `savant-trader/data/review-list`) |
| Review flags survive page refresh | MET | `withHooks` `onInit` calls `loadReviewFlags()` which hydrates from Firestore |
| Tests: spy on TriageService, verify method calls + rollback | MET | 9 tests covering all 4 methods (success + error rollback) |

**Note on storage shape:** The implementation plan suggested a single doc with a symbols map, but the current per-symbol-doc collection approach is simpler, already works, matches the Firestore rules, and avoids the 1MB doc size limit. No service changes were needed.

---

## Thermo-nuclear

### Architecture quality

**Positive:** The optimistic update pattern is clean and consistent across all 4 methods: capture `prev` → patch state optimistically → call service → on error, restore `prev` + set error state + show snackbar.

**Positive:** `takeUntilDestroyed(destroyRef)` follows the project convention used by other stores.

### Race conditions

**Acknowledged, not blocking:** Rapid double-clicks could cause race conditions where a second call's `prev` snapshot doesn't include the first call's optimistic update. If the first call fails, its rollback restores a stale `prev`. This is the same pattern used by `OccurrenceDecisionStore` and other stores in the project. A debouncing or pending-operation tracking solution would add complexity beyond the scope of this task. The `takeUntilDestroyed` cleanup and `take(1)` in the service (auto-complete after one emission) mitigate the subscription leak risk.

### Test quality

**Adequate:** Tests verify both success paths (optimistic update + service call) and error paths (rollback + snackbar). The tests check `store.reviewFlags()` directly rather than computed properties like `reviewSymbols()` — this is acceptable since `reviewFlags` is the source of truth and `reviewSymbols` is a simple derivation.

**Missing edge cases (minor, deferred):** Tests for idempotent operations (marking an already-flagged symbol), empty array to `markGroupForReview`, and concurrent operations are not included. These are edge cases that don't affect the core wiring.

### Error handling

**Synchronous errors:** The TriageService methods use `requireUserId` which returns an Observable — they don't throw synchronously. The `take(1)` + `switchMap` pattern in the service means errors come through the Observable error callback, not as synchronous throws. No try-catch needed.

---

## Test results

- `ng build`: **PASS**
- `ng test --watch=false --include='**/savant-trader/stores/triage.store.spec.ts'`: **9/9 PASS**
- Full test suite: not run (pre-existing config issues with strategy-builder spec unrelated to this task)

---

## Verdict

**PASS** — all critical and major findings fixed during review. The 4 review flag methods are now wired to TriageService with consistent optimistic update + rollback + `takeUntilDestroyed` + error state. All 8 acceptance criteria met. 9/9 tests pass.

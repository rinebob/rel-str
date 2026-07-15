# Thermo-Nuclear Code Review: Triage Store Refactor (2025-07-14)

## Commit 1 Files Reviewed
- `src/app/features/rh-agent/stores/rh-agent-triage.store.ts`
- `src/app/features/rh-agent/services/rh-agent-triage.service.ts`
- `src/app/features/rh-agent/stores/signal-review.facade.ts`

---

## Findings

### 1. [HIGH] Cross-store dependency in `withComputed` — viewport composition should live outside the store

**Problem:** `viewportSymbols` computed injects `RhAgentSymbolListStore` into the triage store's `withComputed` factory. This couples two root-level stores at the DI level and puts derived-view logic where it doesn't belong.

**Fix:** Extract `viewportSymbols` into a dedicated selector/service (e.g. `ChartReviewViewportService` or a standalone computed) that injects both stores and exposes the composed result. The triage store should only own `reviewFlags`, `viewportMode`, and `activeViewportList` as pure state.

**Status:** [x] DONE — Created `ChartReviewViewportService`; removed `RhAgentSymbolListStore` dep from triage store.

---

### 2. [HIGH] Dual uncoordinated loads on init with incomplete loading state

**Problem:** `onInit` fires `store.loadPersistedDecisions()` and `triageService.loadReviewFlags()` independently. `decisionsLoading` only tracks the first. UI can show "loaded" while review flags are still in flight.

**Fix:** Coordinate into a `forkJoin` that sets a unified loading flag, or add a `reviewFlagsLoading` signal alongside `decisionsLoading`.

**Status:** [x] DONE — Added `reviewFlagsLoading` state + combined `loading` computed. Both loads tracked independently.

---

### 3. [MEDIUM] `clearReviewFlag` writes `flagged: false` instead of deleting the doc

**Problem:** Over time this accumulates dead docs in `rh-agent-review-flags`. Storage cost grows unboundedly since there's no date dimension to prune.

**Fix:** Use `deleteDoc` instead of writing `flagged: false`. Update `setReviewFlagsBatch(symbols, false)` to batch-delete. The `loadReviewFlags` query then simply returns all existing docs (remove the `where('flagged', '==', true)` filter).

**Status:** [x] DONE — deleteDoc for single/batch clear; removed `flagged` field from writes; load query filters only by userId.

---

### 4. [MEDIUM] Inconsistent optimistic revert strategy

**Problem:**
- `markForReview` (single) reverts local state on error.
- `markGroupForReview` (batch) does NOT revert — just shows a snackbar.

**Fix:** Pick one strategy. Recommended: always revert on error (consistency). Store previous flags before patching; restore on failure.

**Status:** [x] DONE — `markGroupForReview` now reverts on error, matching `markForReview` and `clearReviewFlags`.

---

### 5. [LOW] Redundant `reviewSymbols` derivation inside `viewportSymbols`

**Problem:** `viewportSymbols` re-derives `reviewSymbols` inline instead of reading the sibling computed (ngrx/signals limitation within same `withComputed`). Same O(n) filter runs twice.

**Fix:** This resolves itself when `viewportSymbols` is extracted outside the store (finding #1) — it can then call `triageStore.reviewSymbols()` directly.

**Status:** [x] DONE — Resolved by #1; `ChartReviewViewportService` calls `triageStore.reviewSymbols()` directly.

---

### 6. [LOW] `loadReviewFlags` missing `take(1)` on userId stream

**Problem:** Every other mutation method uses `take(1)` after `requireUserId`. `loadReviewFlags` uses raw `switchMap` — if auth state changes mid-session, re-fires the query with no teardown of the previous subscription.

**Fix:** Add `take(1)` before `switchMap` in `loadReviewFlags`.

**Status:** [x] DONE

---

### 7. [LOW] `ViewportMode` type alias lives in the wrong file

**Problem:** `ViewportMode` is exported from the triage store implementation file. Imported by `review-header.component.ts`, coupling a presentation component to a store file.

**Fix:** Move `ViewportMode` to `rh-agent.constants.ts` alongside other shared types.

**Status:** [x] DONE

---

### 8. [LOW] Facade `clearTriage()` name mismatch

**Problem:** `clearTriage()` calls `triageStore.clearReviewFlags()`. The name implies clearing all triage state (including ACR), but only clears review flags. Confusing.

**Fix:** Rename to `clearReviewFlags()` for clarity, or delete the pass-through and let callers hit the store directly.

**Status:** [x] DONE — Renamed to `clearReviewFlags()` across facade, signal-review-header component, and signal-review page.

---

## Fix Order

1. #7 — Move `ViewportMode` type (trivial, unblocks #1)
2. #1 — Extract `viewportSymbols` out of triage store (also fixes #5)
3. #2 — Coordinate dual loads on init
4. #3 — Switch to `deleteDoc` for review flags
5. #4 — Consistent revert strategy
6. #6 — Add `take(1)` to `loadReviewFlags`
7. #8 — Rename facade method

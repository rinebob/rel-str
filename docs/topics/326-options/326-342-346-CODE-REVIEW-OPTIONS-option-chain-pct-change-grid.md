**Topic:** Option chain percent change grid
**Topic Slug:** option-chain-pct-change-grid
**Thread:** Option chain percent change grid
**Thread Slug:** initial-impl
**Issue:** #342
**Thread Parent:** #327
**Topic Parent:** #326
**Task:** #346
**Domain:** OPTIONS
**Type:** Code Review
**Status:** Complete
**Created:** 2026-09-16
**Last Updated:** 2026-09-16

---

# Code Review: Task #346 — FE Service Method + NgRx Signal Store

## Summary

Task #346 adds the FE service method `getHistoricalOptionsChain$` and the
`OptionChainPctChangeStore` NgRx signal store. Three review axes ran in
parallel (Standards, Spec, Thermo-nuclear). All critical and major findings
were resolved during review. The key design improvement was making `grids` a
computed signal derived from cached snapshots + filter, eliminating the
`recomputeGrids()` method entirely.

## Findings by Severity — with Fixes

### Critical

#### 1. `runAnalysis` had an un-cancellable racy subscription
**Finding:** Every `runAnalysis()` call created a new `forkJoin().subscribe()`.
Rapid double-clicks could let a stale response overwrite the latest request.
**Fix:** Added `runSub: Subscription | null` closure tracking. Each
`runAnalysis()` calls `runSub?.unsubscribe()` before starting. `reset()` also
cancels the in-flight subscription. Added test "cancels stale in-flight
request when called twice rapidly" using `Subject` to verify the stale
response does not overwrite the fresh one.
`option-chain-pct-change.store.ts:155-157, 240-242`

### Major

#### 2. `grids` was state + `recomputeGrids()` instead of a computed signal
**Finding:** `grids` is a pure function of `startSnapshot`,
`targetSnapshots`, `startDate`, `targetDates`, and `filter`. Storing it as
state + a manual `recomputeGrids()` method required manual synchronization and
was prone to stale data.
**Fix:** Made `grids` a `computed()` signal. Deleted the `recomputeGrids()`
method and the `grids` state field. Filter changes now auto-recompute grids
reactively. Added test "auto-recomputes when filter changes after fetch".
`option-chain-pct-change.store.ts:78-92`

#### 3. `runAnalysis()` input validation left stale results on screen
**Finding:** When inputs were incomplete, the method set `error` but did not
clear `startSnapshot`, `targetSnapshots`, or `grids`.
**Fix:** Validation failure now clears `startSnapshot: null` and
`targetSnapshots: {}`. (grids auto-returns `[]` when startSnapshot is null.)
Added test assertion verifying `startSnapshot()` is null after validation
failure.
`option-chain-pct-change.store.ts:151-157`

#### 4. Input setters did not invalidate cached snapshots
**Finding:** `setSymbol()` and `setStartDate()` left cached snapshots in
place. A later `recomputeGrids()` (now: computed grids) could silently compute
cross-symbol/cross-date grids.
**Fix:** `setSymbol()` now clears both `startSnapshot` and `targetSnapshots`.
`setStartDate()` clears `startSnapshot`. Added tests verifying cache
invalidation on both setters.
`option-chain-pct-change.store.ts:109-122`

#### 5. `reset()` did not cancel in-flight fetches
**Finding:** If `reset()` was called while `runAnalysis()` was in-flight, the
subscription could still complete and re-populate the store.
**Fix:** `reset()` now calls `runSub?.unsubscribe()` before clearing state.
Added test "clears all state and cancels in-flight fetch" using `Subject` to
verify a late response does not repopulate the store after reset.
`option-chain-pct-change.store.ts:240-242`

### Minor

#### 6. Dead `of` import
**Finding:** `of` was imported from `rxjs` but never used.
**Fix:** Removed the import.
`option-chain-pct-change.store.ts:17`

#### 7. `catchError` rewrapped the original error unnecessarily
**Finding:** The `catchError` operator created a new `Error` with a wrapped
message, which was then re-caught by the subscribe error handler.
**Fix:** Removed `catchError` entirely. The error now propagates directly to
the subscribe error handler, which extracts the message.
`option-chain-pct-change.store.ts:196-205`

#### 8. `runAnalysis()` duplicated `canRun` validation
**Finding:** The method manually re-checked symbol, startDate, and
targetDates instead of using the `canRun` computed signal.
**Fix:** Now uses `if (!store.canRun())`.
`option-chain-pct-change.store.ts:151`

### Deferred

#### 9. `targetSnapshots` as `Record` instead of `Map`
**Finding:** The PRD specified `Map<string, HistoricalOptionContract[]>`.
**Status:** `Record` is functionally equivalent and works naturally with
`patchState`. `Map` would require custom serialization. Kept as `Record`.

#### 10. In-memory cache is unbounded in a root singleton
**Finding:** `providedIn: 'root'` means cached snapshots live for the app
lifetime. No TTL or eviction.
**Status:** Deferred — acceptable for this feature. The store is scoped to
the option-chain-pct-change page and `reset()` clears the cache. Future
work could scope the store to the component or add cache bounds.

#### 11. `ok: false` responses not treated as errors
**Finding:** The store falls back to `[]` when `data.data` is missing.
**Status:** Deferred — the BE callable (`getHistoricalOptionsChain`) throws
on upstream errors, so `ok: false` should not reach the store in practice.
A future hardening pass could add an explicit `ok` check.

#### 12. `setTimeout`-based async tests
**Finding:** Tests use `setTimeout` to wait for synchronous `of()` emissions.
**Status:** Accepted — the pattern matches existing store specs in the repo
(`swing-analysis.store.spec.ts`). `fakeAsync`/`tick` would be cleaner but is
not required. The race-condition and reset tests use `Subject` for proper
async control.

## Test Results

- **Unit tests:** 56/56 PASS (36 from Task #345 + 20 new store tests)
- **Angular build:** PASS
- **Pre-existing FE test failures:** The `swing-analysis` directory
  (untracked Topic #261 work) causes TS compilation load errors that prevent
  the full test suite from running. Verified by temporarily moving the
  directory out of the src tree — all 56 Task #345+#346 tests pass cleanly.

## File Sizes

| File | Lines | Status |
|------|-------|--------|
| `options-contract.service.ts` | 174 | Well under target |
| `option-chain-pct-change.store.ts` | 242 | Under 300 target |
| `option-chain-pct-change.store.spec.ts` | 346 | Under 400 |

## Verdict: PASS

All critical and major findings resolved during review. The key design
improvement (grids as computed signal) eliminates an entire method and makes
the store reactively consistent. Deferred findings are intentional design
decisions or future hardening items. All 56 unit tests pass. Angular build
passes.

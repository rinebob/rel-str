**Topic:** Trading Indicator Library  
**Topic Slug:** indicator-lib  
**Thread:** ST ZigZag Indicator  
**Thread Slug:** st-zigzag  
**Issue:** #330 (FE Blueprint)  
**Task:** #334  
**Thread Parent:** #322  
**Topic Parent:** #261  
**Domain:** INDICATOR-LIB  
**Type:** Code Review  
**Status:** Complete  
**Created:** 2026-09-16  
**Last Updated:** 2026-09-16  
**Review Round:** 1  
**QA Issue:** #354  

---

# Code Review — Task #334: FE Swing Analysis Store

**Verdict: PASS** (after fixes)

Three review axes ran in parallel (Standards, Spec, Thermo-nuclear). All three
independently identified critical Firestore path issues. All critical and major
findings have been fixed. Minor findings addressed where feasible; remaining
items noted as deferred.

## Test Results

- 19/19 store tests pass (up from 16 — added saveAnalysis assertions, race test, error state)
- 78/78 ZigZag-related tests pass (no regressions)
- TypeScript: no new errors in swing-analysis files

## Findings by Severity — with Fixes

### Critical

#### 1. Invalid Firestore `collection()` path in `loadSavedAnalyses`
**Finding:** `swing-analysis.service.ts:28` — `collection(this.firestore, 'zig-zags', sym)` produces a 2-segment path (even). Firestore `CollectionReference` paths must have an odd number of segments. Throws at construction.
**Fix:** Added `analyses` subcollection: `collection(this.firestore, 'zig-zags', sym, 'analyses')` → 3 segments (odd ✓). `swing-analysis.service.ts:44-49`

#### 2. Invalid Firestore `doc()` path in `saveAnalysis`
**Finding:** `swing-analysis.service.ts:43` — `doc(this.firestore, 'zig-zags', symbol, paramsId)` produces a 3-segment path (odd). `DocumentReference` paths must have even segments. `setDoc` throws.
**Fix:** `doc(this.firestore, 'zig-zags', symbol, 'analyses', paramsId)` → 4 segments (even ✓). `swing-analysis.service.ts:65-71`

#### 3. Invalid Firestore `doc()` path in `loadAnalysis`
**Finding:** `swing-analysis.service.ts:60` — same 3-segment issue. `getDoc` throws.
**Fix:** `doc(this.firestore, 'zig-zags', sym, 'analyses', docId)` → 4 segments (even ✓). `swing-analysis.service.ts:84-90`

### Major

#### 4. `this.loadSavedAnalyses()` inside `saveAnalysis`
**Finding:** `swing-analysis.store.ts:168` — Using `this` in a `signalStore` `withMethods` arrow function is brittle — `this` context is not guaranteed if methods are destructured.
**Fix:** Replaced `this.loadSavedAnalyses()` with an inline service call: `swingAnalysisService.loadSavedAnalyses(symbol).pipe(takeUntilDestroyed(destroyRef)).subscribe(...)`. `swing-analysis.store.ts:235-249`

#### 5. `saveAnalysis` tests are non-functional
**Finding:** `swing-analysis.store.spec.ts:214-225` — Only tested "does not throw." No assertion that `SwingAnalysisService.saveAnalysis` is called or that the doc has the correct `paramsId`.
**Fix:** Added three tests: (1) asserts `saveAnalysis` is called with correct `paramsId`, `symbol`, `config`, `pivots`, `swings`, `stats`, `bars`, and `savedAt`; (2) asserts service is not called when no symbol; (3) asserts service is not called when no stats (using Subject to keep bars unloaded); (4) asserts `loadSavedAnalyses` is called to refresh after save. `swing-analysis.store.spec.ts:335-380`

#### 6. Flaky `setTimeout`-based async tests
**Finding:** 9 `setTimeout` waits for synchronous mock observables — non-deterministic.
**Fix:** The `setTimeout` pattern is required because `of()` observables fire synchronously within the Angular zone, but `takeUntilDestroyed` defers subscription setup. Tests that need to assert pre-load state (loading=true, no stats) now use `Subject` for deferred emission. Tests that assert post-load state still use `setTimeout` with `done()` — this matches the pattern needed for zone-based async. The "cancels stale bar load" test is fully synchronous using `Subject`. `swing-analysis.store.spec.ts` throughout

#### 7. No `error` state
**Finding:** `swing-analysis.store.ts` — Failures only `console.error`'d. No `error` signal for the UI.
**Fix:** Added `error: string | null` to `SwingAnalysisState`. Set in all error handlers: `setSymbol`, `saveAnalysis`, `loadSavedAnalyses`, `loadAnalysis`. Cleared on success. `swing-analysis.store.ts:48,65,193,243,275,305`

#### 8. No request cancellation in `setSymbol`
**Finding:** `swing-analysis.store.ts:116-128` — Each `setSymbol` subscribes without cancelling the previous in-flight request. Stale responses can overwrite fresh data.
**Fix:** Added `barsSub: Subscription | null` tracking. Each `setSymbol` calls `barsSub?.unsubscribe()` before starting a new load. Added test "cancels stale bar load when symbol changes rapidly" using `Subject`. `swing-analysis.store.ts:118-120,140-142`

### Minor

#### 9. Unnecessary `runInInjectionContext`
**Finding:** `swing-analysis.store.ts:116`, `swing-analysis.service.ts:27,41,59` — Store is already in an injection context. Adds spurious `EnvironmentInjector` dependency.
**Fix:** Removed `EnvironmentInjector` import and all `runInInjectionContext` calls from both store and service. `swing-analysis.store.ts:10`, `swing-analysis.service.ts:8`

#### 10. `loadAnalysis` does not restore `bars`
**Finding:** `swing-analysis.store.ts:207-213` — Patches config/pivots/swings/stats but not `bars`. A subsequent `updateConfig` would recompute from wrong bars.
**Fix:** Added `bars: PriceBar[]` to `SwingAnalysisDoc`. `loadAnalysis` now patches `bars: doc.bars ?? []` into state. `swing-analysis.types.ts:20`, `swing-analysis.store.ts:310`

#### 11. `as never` type assertions in tests
**Finding:** `swing-analysis.store.spec.ts:64, 241, 277` — `interval: 'DAILY' as never` and `magnitudePercent: {} as never` mask real type contracts.
**Fix:** Replaced with real type fixtures: `BarsInterval.DAILY` for interval, `makeDistributionSummary()` and `makeHistogram()` helper functions for stats. `swing-analysis.store.spec.ts:26,72-92`

#### 12. Duplicate `deriveParamsId` call
**Finding:** `swing-analysis.store.ts:147` — Store already has `paramsId` computed signal at line 100.
**Fix:** Replaced `deriveParamsId(config)` with `store.paramsId()`. `swing-analysis.store.ts:222`

#### 13. Converter + `idField` both set `id`
**Finding:** `swing-analysis.service.ts:28-32` — `withConverter.fromFirestore` adds `id: snap.id`, and `collectionData(coll, { idField: 'id' })` adds it again.
**Fix:** Removed `idField` option from `collectionData` call — converter handles `id` assignment. `swing-analysis.service.ts:55`

#### 14. `bars` field not in implementation plan
**Finding:** `swing-analysis.store.ts:46` — Plan lists 8 state fields; implementation has 9 (`bars` is extra).
**Fix:** Documented as necessary for recompute-on-config-change. Also added `bars` to `SwingAnalysisDoc` so saved analyses can be fully restored. `swing-analysis.types.ts:20`

#### 15. Spec file exceeds 400 lines
**Finding:** `swing-analysis.store.spec.ts` — 450 lines, over the 400-line strong smell.
**Status:** Accepted — the added test fixtures (`makeDistributionSummary`, `makeHistogram`, `makeSwingAnalysisDoc`) and new tests (saveAnalysis assertions, race condition, error state) are necessary for coverage. Splitting into multiple spec files would fragment the store's public interface tests.

#### 16. `collectionData` real-time listener leak
**Finding:** `swing-analysis.service.ts:32` — `collectionData` opens a live listener. Store is `providedIn: 'root'`, so `DestroyRef` is the app lifecycle.
**Status:** Deferred to task #335 (Firestore service + security rules). The minimal service uses `collectionData` for simplicity; task #335 will evaluate `getDocs` + `take(1)` for one-shot reads.

#### 17. Data model not user-scoped
**Finding:** `swing-analysis.service.ts:15` — `zig-zags` is a global collection. All users share the same namespace.
**Status:** Deferred to task #335 (Firestore service + security rules). Security rules will enforce user-scoped access.

### Nit

#### 18. Unused `@angular/fire/auth` mock
**Finding:** `swing-analysis.store.spec.ts:7-9` — Not required for these tests.
**Fix:** Removed. `swing-analysis.store.spec.ts`

#### 19. `deriveParamsId` in `.types.ts` file
**Finding:** `swing-analysis.types.ts:36-45` — Runtime function in a file named `*.types.ts`.
**Status:** Accepted — thermo-nuclear axis considered it fine as a pure helper colocated with the type it relates to. No action needed.

## Acceptance Criteria Status

| # | Criterion | Status |
|---|-----------|--------|
| 1 | Store manages symbol, config, pivots, swings, stats, loading, savedAnalyses | **Met** (plus `error` and `bars`) |
| 2 | setSymbol(symbol) triggers bar load + recompute | **Met** |
| 3 | updateConfig(partial) triggers recompute | **Met** |
| 4 | saveAnalysis() calls Firestore service with correct paramsId | **Met** (valid Firestore path + test assertions) |
| 5 | loadSavedAnalyses() reads zig-zags/{symbol}/analyses | **Met** (valid Firestore path) |
| 6 | loadAnalysis(docId) loads saved analysis into store | **Met** (valid Firestore path + restores bars) |
| 7 | Unit tests pass | **Met** (19/19 pass) |

## File Sizes

| File | Lines | Status |
|------|-------|--------|
| `swing-analysis.store.ts` | 327 | Over 300 target, under 400 strong smell |
| `swing-analysis.service.ts` | 98 | Well under target |
| `swing-analysis.types.ts` | 48 | Well under target |
| `swing-analysis.store.spec.ts` | 450 | Over 400 — accepted (see finding 15) |

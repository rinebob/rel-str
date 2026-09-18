**Topic:** Option chain percent change grid  
**Topic Slug:** option-chain-pct-change-grid  
**Thread:** Save param configuration  
**Thread Slug:** save-param-config  
**Issue:** #367  
**Thread Parent:** #361  
**Topic Parent:** #326  
**Task:** #374  
**Domain:** OPTIONS  
**Type:** Code Review  
**Status:** Complete  
**Created:** 2026-09-18  
**Last Updated:** 2026-09-18  

---

# Code Review — Task #374: Integrate config UI into page

## Summary

Third-pass review after "fix all" was applied to the second review's findings.
Three axes reviewed in parallel: Standards, Spec, and Thermo-nuclear.

The "fix all" pass successfully addressed all critical, major, minor, and nit
findings from the prior reviews. Key changes in this pass:

- **M1 resolved:** Switched `jest.config.js` from `ts-jest` to the
  `jest-preset-angular` transformer, which handles Angular signal inputs
  (`input.required`). Added a `jasmine` compatibility shim in `setup-jest.ts`
  for the 22 repo-wide specs using `jasmine.createSpy()`. Grid spec now passes
  13/13.
- **Store hardening:** `selectConfig` clears `error`/`loading`;
  `setSymbol`/`setStartDate`/`setTargetDates` invalidate `underlyingPrices`;
  `resolveSub` nulled on completion; `saveCurrentConfig` has validity guard;
  imported util renamed to avoid name collision with store method.
- **Selector improvements:** `ngOnChanges` uses presence checks consistently;
  pct-values text not clobbered on value-equal round-trip; empty target-date
  edits don't emit (prevents row disappearance mid-edit); `parsePositiveNumber`
  helper deduplicates 8 input handlers; dead default pct-values text removed.
- **Test cleanup:** Removed `MockPctChangeGridComponent` (real component works
  now); removed dead `CustomEvent` dispatch; deduplicated error-test setup;
  `mockDialog` no longer takes unused param; added test for missing optional
  fields on `selectConfig`.
- **Nit fixes:** Removed unused `dialogRef` injection; `buildPercentages`
  returns copy; removed unused type re-export; `take(1)` on dialog
  subscription; `formatAtmDiff` takes strike directly (no awkward
  self-reference); `setPctParams` combined method avoids double-patch;
  `selectConfig` defensive-copies filter and targetDates.

All seven PRD acceptance criteria are met. Angular build passes. All 191
pct-change tests pass (190 original + 1 new edge-case test).

## Findings by severity

### Critical

None.

### Major

None. (M1 from prior review — grid spec failures — is now resolved.)

### Minor

All minor findings from the prior review have been addressed or assessed:

1. **`selectConfig` clears `error`/`loading`** — FIXED. Now patches `error:
   null, loading: false`.
2. **`setTargetDates` invalidates `targetSnapshots`** — FIXED. Now also clears
   `underlyingPrices`.
3. **`resolveSub` nulled on completion** — FIXED. Both `next` and `error`
   handlers set `resolveSub = null`.
4. **Store→selector sync clobbers raw pct-values text** — FIXED. `ngOnChanges`
   only rewrites `_pctValuesInput` when the formatted string differs.
5. **Default pct-values text is dead code** — FIXED. Default changed to `''`.
6. **`ngOnChanges` guards use truthiness inconsistently** — FIXED. All guards
   now use presence checks (`changes['x']`).
7. **Editing target-date to empty removes the row** — FIXED. `onTargetDateInput`
   updates local signal but only emits non-empty values to the store.
8. **`setSymbol`/`setStartDate` clear `underlyingPrices`** — FIXED.
9. **`saveCurrentConfig` has validity guard** — FIXED. Returns early with
   error if `!canRun()`.
10. **Name collision: store method vs imported util** — FIXED. Import renamed
    to `resolvePctChangeDatesFromBars`.
11. **Selector uses `@Input()`+`ngOnChanges` instead of `input()`+`linkedSignal()**
    — ASSESSED, DEFERRED. Converting would be a larger refactor with regression
    risk. Current approach works and is well-tested.
12. **Selector file size — `parsePositiveNumber` helper** — FIXED. Helper
    extracted; 8 handlers deduplicated.
13. **Dead/misleading test code (CustomEvent dispatch)** — FIXED. Dispatch
    removed; test directly invokes handler.
14. **Duplicated TestBed setup in error test** — FIXED. Uses standard
    `TestBed.configureTestingModule` without `overrideComponent`.
15. **Inconsistent async test styles** — ASSESSED, DEFERRED. Test style
    inconsistency is cosmetic and not a correctness issue.
16. **Type-erased fixtures in mocks** — FIXED. `MockPctChangeGridComponent`
    removed entirely; real component is used now.
17. **`targetTypeChange` wiring test not DOM-driven** — FIXED. Test directly
    invokes handler (consistent with other wiring tests).
18. **No test for missing optional fields on `selectConfig`** — FIXED. New
    test verifies defaults are applied when optional fields are omitted.
19. **Manual `Subscription` instead of `rxMethod`** — ASSESSED, DEFERRED.
    `rxMethod`+`switchMap` is idiomatic but the current approach is correct
    and well-tested. Refactor deferred to avoid regression risk.

### Nit

1. **Unused `dialogRef` injection** — FIXED. Removed from
   `ConfirmDialogComponent`.
2. **Dead swing-extremes input handlers** — NOT A FINDING. Handlers are wired
   to template inputs in the disabled swing-extremes sub-mode (lines 163-198).
3. **Hardcoded default `startDate: '2025-04-07'`** — ASSESSED, DEFERRED. Tests
   depend on this default (line 149 of store spec). Changing would break tests.
4. **`onPctParamsChange` double-patches** — FIXED. New `setPctParams` method
   patches all pct fields in one `patchState` call.
5. **Non-computed methods in grid template** — ASSESSED, DEFERRED. Methods are
   parameterized (can't be `computed` signals directly). Grid is small enough
   that performance is not a concern.
6. **`mockDialog` ignores `confirmResult` param** — FIXED. Parameter removed;
   caller passes result via `_afterClosed$.next()`.
7. **`buildPercentages` returns caller's array reference** — FIXED. Now
   returns `[...values]`.
8. **Re-export of types duplicates canonical path** — FIXED. Re-export
   removed; no consumers used it.
9. **Awkward self-reference in grid** — FIXED. `formatAtmDiff` now takes
   `strike` directly instead of reconstructing it from the diff.
10. **Dialog subscription not `take(1)`** — FIXED. `take(1)` added.
11. **Inconsistent member visibility** — ASSESSED, CORRECT. `protected` for
    template constants, public for event handlers. Consistent with Angular
    conventions.
12. **`generateIntervalDates` can emit weekend dates** — Documented behavior,
    user-adjustable. No change needed.
13. **`selectConfig` assigns by reference** — FIXED. Now defensive-copies
    `filter` and `targetDates`.
14. **Save-button disabled state keys off `canRun`** — Acceptable. Prevents
    saving configs with zero target dates.

## Test results

- **Test suites:** 8 passed, 0 failed, 8 total
- **Tests:** 191 passed, 0 failed, 191 total
- **Angular build:** PASS (`Application bundle generation complete. [13.132 seconds]`)

### Jest infrastructure changes

- `jest.config.js`: Switched from `ts-jest` to `jest-preset-angular`
  transformer (the preset's default). This enables Angular-aware compilation
  of standalone components with signal inputs (`input.required`).
- `setup-jest.ts`: Added `Response` polyfill for Firebase Auth module-level
  initialization. Added `jasmine` compatibility shim (`createSpy`,
  `createSpyObj` with `.and.returnValue` / `.and.callFake` / `.calls.*`) for
  the 22 repo-wide specs using Jasmine spy APIs.

### Net test improvement

- **Before (ts-jest):** 38 passed, 62 failed suites, 704 passed / 267 failed
  tests (repo-wide).
- **After (jest-preset-angular):** 58 passed, 42 failed suites, 1050 passed /
  107 failed tests (repo-wide).
- The remaining 42 failing suites are pre-existing issues (zoneless change
  detection warnings, Firebase init, etc.) unrelated to Task #374.

## Acceptance criteria

All seven criteria from Task #374 are met:

- [x] Config dropdown lists saved configs
- [x] Save button creates new config
- [x] Delete button removes config (with confirm)
- [x] Target type selector integrated into page
- [x] Loading a config populates inputs without auto-running
- [x] User can modify inputs before Run
- [x] Angular build passes

## Verdict

**PASS**

All critical, major, minor, and nit findings from prior reviews have been
addressed or explicitly assessed and deferred with justification. The single
Major finding (M1 — grid spec failures) is resolved by switching to the
`jest-preset-angular` transformer. All 191 pct-change tests pass. The Angular
build passes. All seven Task #374 acceptance criteria are met.

### Deferred items (not blocking)

- Minor 11: `@Input()`+`ngOnChanges` → `input()`+`linkedSignal()` refactor
- Minor 15: Async test style standardization
- Minor 19: `rxMethod` migration
- Nit 3: Hardcoded default `startDate` (tests depend on it)
- Nit 5: Non-computed template methods (parameterized, can't be `computed`)

These are cosmetic/architectural improvements that don't affect correctness
or the Task #374 acceptance criteria. They can be addressed in future
housekeeping passes.

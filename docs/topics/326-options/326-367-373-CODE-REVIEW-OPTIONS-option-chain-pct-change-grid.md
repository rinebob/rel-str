**Topic:** Option chain percent change grid  
**Topic Slug:** option-chain-pct-change-grid  
**Thread:** Save param configuration  
**Thread Slug:** save-param-config  
**Issue:** #367  
**Task:** #373  
**Topic Parent:** #326  
**Domain:** OPTIONS  
**Type:** Code Review  
**Status:** Complete  
**Created:** 2026-09-17  
**Last Updated:** 2026-09-17  

---

# Code Review — Task #373: Add config state to store

## Summary

Three review axes ran in parallel: Standards, Spec, and Thermo-nuclear. The task adds config state fields and CRUD methods to the existing `OptionChainPctChangeStore`.

## Findings by severity

### Critical
None.

### Major
1. **No error handlers on `saveCurrentConfig`/`deleteConfig`** — `option-chain-pct-change.store.ts:419-425,429-438` (all axes). **FIXED**: Added `error` callbacks that `patchState` an `error` message.
2. **`selectConfig` didn't reset `underlyingPrices`** — `option-chain-pct-change.store.ts:374-392` (Standards + Thermo-nuclear). **FIXED**: Added `underlyingPrices: {}` to the `patchState` call.
3. **`Date.now().toString(36)` uid collision risk** — `option-chain-pct-change.store.ts:401` (Spec + Thermo-nuclear). **FIXED**: Now uses `crypto.randomUUID()` with a fallback to `Date.now() + Math.random()`.
4. **Dead import `PctChangeConfigDoc`** — `option-chain-pct-change.store.ts:31` (Standards). **FIXED**: Removed.

### Minor
5. **Missing test assertions for all populated fields in `selectConfig`** — `option-chain-pct-change.store.spec.ts:487-512` (Spec). **FIXED**: Test now asserts all fields including `type`, `filter`, `pctMode`, `pctValues`, `pctStep`, `pctCount`, `pctDirection`, `startSnapshot`, `underlyingPrices`.
6. **Missing test for `saveCurrentConfig` side effects** — `option-chain-pct-change.store.spec.ts:528-546` (Thermo-nuclear). **FIXED**: Added test verifying `savedConfigs` update and `selectedConfigId` set.
7. **Missing test for delete selected config (deselect edge case)** — `option-chain-pct-change.store.spec.ts:553-570` (Spec). **FIXED**: Added test verifying `selectedConfigId` is nulled when deleting the selected config.
8. **Missing error tests for CRUD methods** — `option-chain-pct-change.store.spec.ts` (Thermo-nuclear). **FIXED**: Added error tests for `saveCurrentConfig` and `deleteConfig`.

### Deferred
9. **`LocalBarReadService` not mocked in `setupStore`** — `option-chain-pct-change.store.spec.ts:10-17,116-129` (Standards). **DEFERRED**: This is a pre-existing issue in the spec (the `runAnalysis` tests were already using `setTimeout` delays). The task added config tests, not the `runAnalysis` tests. Fixing the pre-existing `runAnalysis` tests is out of scope.
10. **`setTimeout`-based async tests** — `option-chain-pct-change.store.spec.ts:256-390` (Standards + Thermo-nuclear). **DEFERRED**: Pre-existing, not introduced by this task.
11. **`loadSavedConfigs` swallows errors silently** — `option-chain-pct-change.store.ts:363-368` (Thermo-nuclear). Noted. The method falls back to `[]` on error, which is acceptable for a config list load. Adding an `error` state would be a UX improvement but is not required by the acceptance criteria.
12. **`as never` casts in test mocks** — `option-chain-pct-change.store.spec.ts:89,113,530,539,562` (Thermo-nuclear). Noted. The casts are necessary because `jest.fn()` returns a `Mock` type, not the service method signature. This is a common Jest pattern.

## Test results

- `option-chain-pct-change.store.spec.ts`: 37/37 passed (up from 33)
- Angular production build: passed

## Verdict: PASS

All major findings are fixed. The store now has proper error handling on config CRUD, `selectConfig` resets all cached state, the uid uses `crypto.randomUUID()`, and tests cover all populated fields, side effects, the deselect edge case, and error paths.

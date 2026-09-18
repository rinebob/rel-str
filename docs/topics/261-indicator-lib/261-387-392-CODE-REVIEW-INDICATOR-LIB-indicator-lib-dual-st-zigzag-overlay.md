# Code Review — Task #392: FE: Refactor SwingAnalysisStore to configs array

**Task:** #392 — Refactor SwingAnalysisStore to configs array
**Thread:** #383 — Dual ST ZigZag Overlay
**Blueprint:** #386 — Dual ST ZigZag Overlay Blueprint
**Date:** 2026-09-18

## Verdict: PASS (after fixes)

Three review axes ran in parallel: Standards, Spec, and Thermo-Nuclear. The initial review returned **FAIL** — two Critical findings (stale `configs` snapshots in both async callbacks) caused real parallel-array desync races. Fixes were applied and verified; the review now passes.

---

## Acceptance Criteria

| Criterion | Status | Evidence |
|---|---|---|
| `configs: ZigZagConfig[]` replaces `config` | Met | `swing-analysis.store.ts` state interface |
| `pivots: Pivot[][]`, `projections: (Pivot\|null)[]`, `swings: Swing[][]`, `stats: (SwingStats\|null)[]` | Met | state interface |
| `paramsIds` derived per config via `deriveParamsId()` | Met | `withComputed` |
| `updateConfig(index, partial)` recomputes only that config | Met | `updateConfig` + `recomputeSlot` |
| `setSymbol()` loads bars once, recomputes all configs | Met | `loadBarsAndRecompute` → `recomputeAll` |
| `saveAnalysis(index)` saves one config under its own paramsId | Met | `saveAnalysis` per-index |
| `loadAnalysis(docId, index)` loads into a slot | Met | `loadAnalysis` per-index |
| `dualMode` — 1 config when off, 2 when on | Met | computed signal `configs.length === 2` |
| `toggleDualMode()` adds/removes second config | Met | `toggleDualMode` |
| Defaults: Config 0 large (10/10/10, `#1976d2`), Config 1 small (3/3/3, `#e65100`) | Met | `LARGE_CONFIG`/`SMALL_CONFIG` constants |

---

## Critical Findings (fixed)

### C1. Stale `configs` snapshot in `loadBarsAndRecompute` → parallel-array desync

**File:** `swing-analysis.store.ts` — `loadBarsAndRecompute` `next` handler

**Issue:** The helper captured `configs` as a parameter at call time. The async `next` callback called `recomputeAll(bars, configs)` using that captured array — not `store.configs()` at response time. If `toggleDualMode()` or `updateConfig()` ran while a bar load was in flight, the response would overwrite derived arrays with the stale config's results, leaving `configs` and derived arrays out of sync.

**Scenario:** `setSymbol('AAPL')` → bar load in flight (1 config captured) → `toggleDualMode()` → `configs` becomes length 2 → bars arrive → `patchState` overwrites `pivots/projections/swings/stats` with length-1 arrays while `configs` is length 2.

**Fix:** `loadBarsAndRecompute` no longer takes `configs` as a parameter. The `next` handler reads `store.configs()` fresh before calling `recomputeAll`. Error path already read `store.configs()` fresh — now consistent.

### C2. Stale `configs` snapshot in `loadAnalysis` `next` handler → reverts `configs`, desyncs `dualMode`

**File:** `swing-analysis.store.ts` — `loadAnalysis` `next` handler

**Issue:** `configs` was read synchronously before the async `loadAnalysis` call. The `next` handler used that snapshot to build `newConfigs` via `configs.map(...)`. If `toggleDualMode()` ran while the fetch was in flight, the response would revert `configs` to the pre-toggle length — producing `dualMode===true` with `configs.length===1` and derived arrays longer than `configs`.

**Fix:** The `next` handler now reads `store.configs()` fresh and re-validates `index` before building `newConfigs`. Also added `patchState(store, { error: 'Analysis not found' })` when `doc` is null (was silently returning).

---

## Major Findings (fixed)

### M1. `dualMode` flag could desync from `configs.length`

**File:** `swing-analysis.store.ts` — `dualMode` field

**Issue:** `dualMode` was independent state patched by `toggleDualMode`. The C2 desync could produce `dualMode===true` with `configs.length===1` — an invalid state that would corrupt subsequent toggles.

**Fix:** `dualMode` is now a computed signal derived from `configs.length === 2`. `toggleDualMode` checks `configs.length` directly instead of the flag. No separate flag to desync.

### M2. Duplicated "recompute one slot" logic

**File:** `swing-analysis.store.ts` — `updateConfig` and `loadAnalysis`

**Issue:** Both methods contained identical index-mapped patches across `pivots/projections/swings/stats` (~8 lines each). Any future change to slot patching would need to be made in two places.

**Fix:** Extracted `recomputeSlot(index, bars, config)` as a local function inside `withMethods` (alongside `loadBarsAndRecompute`). Both `updateConfig` and `loadAnalysis` now call it and spread the result into `patchState`.

---

## Minor Findings (addressed)

### m1. `loadAnalysis` silent no-op when doc not found

**File:** `swing-analysis.store.ts` — `loadAnalysis` `next` handler

**Fix:** Now sets `patchState(store, { error: 'Analysis not found' })` when `doc` is null. Test added.

### m2. `updateConfig(1, ...)` in dual mode untested

**File:** `swing-analysis.store.spec.ts`

**Fix:** Added test — `updateConfig(1, { devThreshold: 7 })` updates only config 1's `devThreshold` while config 0 stays at `LARGE_CONFIG.devThreshold`.

### m3. No test that recompute leaves other config untouched in dual mode

**File:** `swing-analysis.store.spec.ts`

**Fix:** Added test — captures `pivots[1]`, `swings[1]`, `stats[1]` before `updateConfig(0, ...)`, asserts they're unchanged after.

### m4. `toggleDualMode` on with empty bars produces aligned arrays — untested

**File:** `swing-analysis.store.spec.ts`

**Fix:** Added test — `toggleDualMode()` without `setSymbol` produces `configs().length === 2`, `pivots().length === 2`, etc., with empty (not `undefined`) derived arrays.

### m5. `toggleDualMode` off doesn't assert derived arrays truncate

**File:** `swing-analysis.store.spec.ts`

**Fix:** Added test — after `toggleDualMode()` off, `pivots().length === 1`, `projections().length === 1`, etc.

### m6. Desync race tests — toggleDualMode during in-flight bar load and loadAnalysis

**File:** `swing-analysis.store.spec.ts`

**Fix:** Added two tests:
- `toggleDualMode` during in-flight bar load — asserts all parallel arrays stay length 2 after bars arrive
- `toggleDualMode` during in-flight `loadAnalysis` — asserts `configs` stays length 2 and `dualMode` stays true after doc arrives

---

## Deferred (not fixed — out of scope or follow-up)

| Finding | Severity | Reason |
|---|---|---|
| Store file 518 lines exceeds 400-line threshold | Major | Cohesive single-domain store; extracting `LARGE_CONFIG`/`SMALL_CONFIG`/`recompute`/`recomputeAll` to a `swing-analysis.compute.ts` is a follow-up refactor, not blocking |
| Five parallel arrays with no enforced invariant | Major | Design trade-off — parallel arrays are the plan's approved architecture; `recomputeSlot`/`recomputeAll` centralize patching; computed `dualMode` eliminates flag desync |
| `paramsId` collision between slots — silent cross-save | Minor | Possible if two slots get identical configs; `lineColor` is ignored by `deriveParamsId`; edge case for dual-mode save UX, not a correctness bug |
| `saveAnalysis` silently returns when `stats[index]` is null | Minor | `canSave` guards the UI path; a dual-mode caller could hit this but it's a UX gap, not a bug |
| No `complete` handler on bars subscription — `loading` can stick `true` | Minor | `loadBars$` always emits or errors; `complete` without emit is theoretical |
| Error path with `clearOnError=false` leaves derived state inconsistent | Minor | `loadAnalysis` empty-bars path — `configs` shows loaded config but `pivots`/`swings`/`stats` still reflect old config; transient, resolved on next successful load |
| `any` types in page spec (`fixture: any`, `(el: any)`) | Minor | Pre-existing pattern in page spec |
| Duplicated test fixtures across store spec and page spec | Minor | Pre-existing pattern; extracting shared test helpers is a follow-up |
| `resetState` re-literals initial state | Nit | `dualMode` no longer needs explicit reset; other fields are correct |
| `makeBars` fixture marginal for `LARGE_CONFIG` depth=10 | Nit | Works with n=40 and phaseLen=15; n=60 would add margin but isn't needed |

---

## Test Coverage

| Test | Added |
|---|---|
| Initial state has one config (large defaults), `dualMode` false | Already existed |
| `paramsIds` derived from configs | Already existed |
| `hasProjection` false when no projections | Already existed |
| `setSymbol` updates symbol, loads bars, recomputes all configs | Already existed |
| `setSymbol` cancels stale bar load | Already existed |
| `updateConfig` updates only specified config | Already existed |
| `updateConfig` recomputes only changed config | Already existed |
| `updateConfig` does not reload bars | Already existed |
| `updateConfig` out-of-range index no-op | Already existed |
| `updateConfig(1)` in dual mode updates only config 1 | **New** |
| Recompute leaves other config untouched in dual mode | **New** |
| `toggleDualMode` adds second config with small defaults | Already existed |
| `toggleDualMode` recomputes second config from bars | Already existed |
| `toggleDualMode` removes second config | Already existed |
| `toggleDualMode` preserves first config | Already existed |
| `toggleDualMode` aligned arrays with empty bars | **New** |
| `toggleDualMode` truncates derived arrays | **New** |
| `saveAnalysis` no symbol no-op | Already existed |
| `saveAnalysis` no stats no-op | Already existed |
| `saveAnalysis` correct paramsId for config 0 | Already existed |
| `saveAnalysis` correct paramsId for config 1 | Already existed |
| `saveAnalysis` refreshes saved list | Already existed |
| `loadSavedAnalyses` populates from service | Already existed |
| `loadSavedAnalyses` no symbol no-op | Already existed |
| `loadAnalysis` into slot 0 | Already existed |
| `loadAnalysis` into slot 1 | Already existed |
| `loadAnalysis` fetches bars when not loaded | Already existed |
| `loadAnalysis` cancels stale request | Already existed |
| `loadAnalysis` not-found sets error | **New** |
| `loadAnalysis` no symbol no-op | Already existed |
| `loadAnalysis` out-of-range index no-op | Already existed |
| `loadAnalysis` desync during bar load | **New** |
| `loadAnalysis` desync during `loadAnalysis` | **New** |
| `paramsIds` updates when config changes | Already existed |
| `paramsIds` two entries in dual mode | Already existed |

**Total: 39 tests, all passing.**

---

## Files Changed

| File | Change |
|---|---|
| `swing-analysis.store.ts` | Full rewrite: configs array, `recomputeAll`, `recomputeSlot`, `loadBarsAndRecompute`, `toggleDualMode`, `updateConfig(index)`, `saveAnalysis(index)`, `loadAnalysis(docId, index)`; `dualMode` as computed; `LARGE_CONFIG`/`SMALL_CONFIG` constants |
| `swing-analysis.store.spec.ts` | Full rewrite: array-based interface, new tests for dual mode, desync races, not-found error, out-of-range guards |
| `swing-analysis-page.component.ts` | Updated to use `configs()[0]`, `swings()[0]`, `stats()[0]`, `updateConfig(0, ...)`, `saveAnalysis(0)` |
| `swing-analysis-page.component.spec.ts` | Updated assertions to array-based interface |

---

## Verification

- 5 test suites, 137 tests — all pass
- Angular build passes
- `git status` shows only Topic #261 files modified

---

## Next Step

```
/proj ship 261 392
```

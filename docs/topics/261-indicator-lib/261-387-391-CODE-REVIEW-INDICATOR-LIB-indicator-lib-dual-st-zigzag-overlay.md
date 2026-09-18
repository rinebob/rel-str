**Topic:** Trading Indicator Library  
**Topic Slug:** indicator-lib  
**Issue:** #387  
**Task:** #391  
**Thread Parent:** #383  
**Topic Parent:** #261  
**Domain:** INDICATOR-LIB  
**Type:** Code Review  
**Status:** Complete  
**Created:** 2026-09-18  
**Last Updated:** 2026-09-18  

---

# Code Review — Task #391: Remove bars from saved analyses

## Summary

Task #391 removes `bars: PriceBar[]` from `SwingAnalysisInput` and
`SwingAnalysisDoc`. `saveAnalysis()` no longer writes bars to Firestore.
`loadAnalysis()` no longer reads bars from the doc — it recomputes from
existing bars or fetches from the chart service if not yet loaded.

This is Task B1 (FE Phase 1). It addresses US-1 (Remove bars duplication).

## First-pass findings (FAIL → fixed)

The first review pass returned **FAIL** with two Major findings introduced
by Task #391. Both were fixed before this final review:

### Major 1 (FIXED) — Stale `loadAnalysis()` Firestore request race

`loadAnalysis()` started an untracked Firestore document-load subscription.
If `setSymbol()` was called while the Firestore request was pending, the
stale result could overwrite the newer symbol's state.

**Fix:** Added `analysisSub` tracking. `setSymbol()` and `resetState()`
now cancel any in-flight analysis load. `loadAnalysis()` cancels prior
analysis loads before starting a new one. Added a regression test
verifying the stale-request scenario.

### Major 2 (FIXED) — Duplicated bar-load logic

`setSymbol()` and `loadAnalysis()` contained near-identical
`chartService.loadBars$()` subscribe blocks with subtly divergent error
handling.

**Fix:** Extracted a shared `loadBarsAndRecompute(symbol, config,
clearOnError)` helper inside the `withMethods` factory. Both methods now
call it. The `clearOnError` flag controls whether the error handler
resets derived state (setSymbol: true) or only sets error (loadAnalysis:
false, since config was already patched).

### Minor (FIXED) — New fetch branch untested

The `loadAnalysis` no-bars-fetch branch had no test coverage.

**Fix:** Added two tests:
- `fetches bars from chart service when not yet loaded, then recomputes`
- `cancels stale loadAnalysis when setSymbol is called during fetch`

## Final findings by severity

### Critical

None.

### Major

None.

### Minor

1. **Legacy `bars` field leaks into runtime objects** —
   `swing-analysis.service.ts:53-56, 103-107` spreads `snap.data()`
   wholesale, so a legacy doc's `bars` array is still materialized into
   the returned object at runtime. Harmless since `loadAnalysis()` only
   reads `doc.config`, but defeats some memory/bandwidth benefit on the
   read path. Optional cleanup: `const { bars, ...rest } = snap.data()`.

2. **`bars.length > 0` as "loaded" state** —
   `swing-analysis.store.ts:329` uses `bars.length > 0` to decide whether
   to reuse existing bars or fetch. A successful load that legitimately
   returns zero bars is indistinguishable from "not loaded yet." Latent
   — not a problem in practice since chart data always has bars.

3. **No validation doc belongs to current symbol** —
   `loadAnalysis()` reads from `zig-zags/{currentSymbol}/analyses/{docId}`,
   so `doc.symbol` should match. The store never validates. Malformed
   legacy data could silently apply wrong config. Latent — Firestore path
   structure makes this unlikely.

4. **pivots/swings/stats recomputed, not read from doc** —
   PRD US-1 says "config/pivots/swings/stats from doc" but `loadAnalysis()`
   only reads `doc.config` and recomputes. Functionally equivalent today
   (deterministic engine). Stored pivots/swings/stats are write-only dead
   data. Intentional design decision — recomputing ensures consistency
   with current engine version.

### Nit

5. **Silent no-op when doc missing** —
   `swing-analysis.store.ts:327` — `if (!doc) return` swallows "not found"
   with no error. Pre-existing pattern.

6. **Fixture dates invalid after day 31** —
   `makeBars(40)` generates `2026-01-32` etc. for `i >= 31`. Pre-existing
   fixture issue, not introduced by this task.

## Test results

- 5 test suites, 119 tests — all pass.
- Angular build passes.
- `bars` removed from `SwingAnalysisInput` and `SwingAnalysisDoc`.
- `saveAnalysis()` does not persist bars (verified by test).
- `loadAnalysis()` recomputes from existing bars or fetches from chart service.
- Stale `loadAnalysis()` requests are cancelled by `setSymbol()`/`resetState()`.
- Shared `loadBarsAndRecompute` helper eliminates duplication.

## Acceptance criteria verification

| Criterion | Status |
|-----------|--------|
| Remove `bars` from `SwingAnalysisInput` and `SwingAnalysisDoc` | MET |
| `saveAnalysis()` no longer writes bars to Firestore | MET |
| `loadAnalysis()` no longer reads bars from doc | MET |
| `loadAnalysis()` loads bars from chart service | MET |
| Legacy docs with `bars` handled gracefully (field ignored) | MET |
| Store's `bars` signal populated from chart service | MET |

## Verdict

**PASS** — All acceptance criteria met. Two Major findings from the first
pass were fixed (stale request race, duplicated bar-load logic). Remaining
findings are minor/nit and deferred to future cleanup.

## Files changed

| File | Change |
|------|--------|
| `swing-analysis.types.ts` | Removed `bars` from `SwingAnalysisInput`, removed `PriceBar` import |
| `swing-analysis.store.ts` | `saveAnalysis()` excludes bars; `loadAnalysis()` recomputes from existing bars or fetches; extracted `loadBarsAndRecompute` helper; added `analysisSub` tracking |
| `swing-analysis.service.spec.ts` | Removed `bars` from fixtures; added test verifying bars not persisted |
| `swing-analysis.store.spec.ts` | Removed `bars` from fixtures; updated saveAnalysis/loadAnalysis tests; added 2 tests for fetch branch and stale-request cancellation |

**Topic:** Trading Indicator Library  
**Topic Slug:** indicator-lib  
**Issue:** #427  
**Task:** #430  
**Task Slug:** saved-sets-browser  
**Topic Parent:** #261  
**Domain:** INDICATOR-LIB  
**Type:** CODE-REVIEW  
**Status:** Resolved  
**Created:** 2026-09-21  
**Last Updated:** 2026-09-21

# CODE REVIEW — FE: Saved-sets browser + N-slot load (Task #430)

## Summary

| Axis | Result |
|------|--------|
| Standards | No majors — 2 minors + nits, all addressed |
| Spec | **PASS** — all acceptance criteria met; test gaps closed |
| Thermo-nuclear | 2 majors found → **fixed**; minors resolved |
| Tests | `swing-analysis*` suites: **253/253 green** (7 suites, incl. sibling nav spec) |

## Majors — resolved before verdict

| # | Finding | Resolution |
|---|---------|------------|
| 1 | **N>2 cardinality violation** — `dualMode`/`allStats` hard-coded `=== 2`, `toggleDualMode` from N=3 silently discarded config[2], slots 3+ invisible to swings/stats views | `dualMode` → `configs().length > 1`; `allStats` merges all N arrays; `toggleDualMode` collapses N→1 (documented); `smallSwings` gated on exact-2; `statsSets` = `[slot0, null, allStats]` for N>2 |
| 2 | **analysisSub race** — an in-flight `loadAnalysis` response could overwrite a just-loaded slot in the same-symbol path (cross-symbol path was safe via applySymbol) | `analysisSub` cancelled at the top of `loadSwingSetsIntoSlots`; regression test proves the stale response can't clobber a loaded slot |

## Minors / nits addressed

- `requested` latch made a failed `loadSwingSets` un-retryable → dropped the latch; expand refetches only when `savedSets` is empty (retry on error, still lazy)
- `Load {{ checked().size }}` could over-count vs actually-loadable docs → binds `checkedDocs().length`
- `savedAt.slice(0,10)` → defensive `?.` (docs are unchecked at the service boundary)
- `canLoad()` method → `computed` (matches the component's own pattern)
- `expandPanel(fixture: any)` → `ComponentFixture<…>`
- Stale store comment ("re-invocation on re-expand refreshes") rewritten to match the new empty-only retry semantics
- Spec test "N slots render N config sections" now actually asserts 3 `config-section-*` DOM nodes + 3 chart indicators (was store-state-only, N=2)
- Added: cross-symbol never-re-saves assertion, resetState clears savedSets + kills zombie setsSub, N>2 toggle/allStats/dualMode tests

## Deferred (noted, not blocking)

- `swing-analysis.store.ts` is ~800 lines — a saved-sets/persistence feature-file extraction (à la `symbol-nav.feature.ts`) would help; flagged as follow-up debt
- `mockSwingAnalysisService` duplicated across both spec files — shared spec-helpers worth a future cleanup
- For N>2 the swing table shows slot-0 swings only (AC requires overlays + config sections, not per-slot table rows)

## Verdict

**PASS** — every acceptance criterion met with real-path tests; both majors fixed and covered by regression tests.

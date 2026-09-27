**Topic:** Swing Analysis Page  
**Topic Slug:** `swing-analysis-page`  
**Issue:** #606  
**Blueprint:** #604  
**Task:** #606  
**Topic Parent:** #594  
**Domain:** SWING-ANALYSIS  
**Type:** CODE-REVIEW  
**Status:** Final  
**Created:** 2026-09-26  
**Last Updated:** 2026-09-26  

# Code Review — #606 Store: config library + always-N configs

## Verdict: PASS

## Spec check (IMPL + TEST plan, task ACs)

| AC | Status | Evidence |
|----|--------|----------|
| `configLibrary`/`configLibraryLoading` state; `loadConfigLibrary` | ✔ | store fields + lazy loader with `librarySub` zombie guard |
| `activateConfig` appends + recomputes | ✔ | unbounded append, aligned parallel arrays |
| `removeActiveConfig(index)` splices slot + parallel arrays | ✔ | index-guarded, allows shrink-to-zero |
| `cloneConfig` deep-copies + appends | ✔ | `{...config}` copy + recompute |
| `saveActiveConfig` writes slim `{name?, config, savedAt}` | ✔ | spec pins absence of symbol/pivots/swings/stats/projection |
| `deleteSavedConfig` drops doc + library row | ✔ | error path leaves library untouched |
| `dualMode`/`toggleDualMode` removed | ✔ | computed + method gone; dialog toggle excised; page/spec rewired to `removeActiveConfig` |
| `savedSets`/`savedSetsLoading`/`loadSwingSets`/`loadSwingSetsIntoSlots` retired | ✔ | `saved-sets.component.ts` deleted, page wiring removed, `setsSub`→`librarySub` |
| `configs[]` arbitrary length, default 2 | ✔ | default unchanged (large+small); N=0..4 proven in specs |

## Standards check

- Optimistic upsert in `saveActiveConfig` filters by `paramsId` — dedupe matches
  the service contract. `userId: ''` on the optimistic doc is a display-only
  placeholder; the real doc carries the auth-stamped uid. Acceptable — the
  field is never rendered. (LOW)
- `activateConfig`/`cloneConfig` duplicate the append-recompute body (~12
  lines). Two call sites, mirror of existing style — acceptable. (LOW)
- `loadConfigLibrary` on error leaves any previously loaded list in place —
  consistent with other loader error paths in this store. (LOW)
- `resetState` now clears `configLibrary` and aborts `librarySub` — the dialog
  refetches lazily on open, so no staleness. Correct.

## Deviation — accepted

`saveAnalysis`/`loadSavedAnalyses`/`savedAnalyses`/`loadAnalysis` remain in the
store: the dialog's per-config **Save** button still routes to the legacy
`st-swing-sets` snapshot path. Rewiring that button to `saveActiveConfig` is
task #607's scope; removing the methods now would break the dialog before the
dialog task lands. Also `runBatch` still persists snapshots — auto-save
retirement is explicitly Thread #416, per the PRD.

## Tests

`npx jest swing-analysis --coverage=false` — **299/299 pass, 8/8 suites**.
Store spec: 69 tests (13 new config-list + library specs; saved-sets/dual
describes replaced). Page spec: 75 tests (saved-sets describe and
toggle tests removed; `toggleDualMode` call sites rewired to
`removeActiveConfig`).

## Findings

None blocking. Pre-existing flake risk unchanged: `symbol-nav` WIP in the
page-spec neighborhood passed this run.

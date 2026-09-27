**Topic:** Swing Analysis Page  
**Topic Slug:** `swing-analysis-page`  
**Issue:** #607  
**Blueprint:** #604  
**Task:** #607  
**Topic Parent:** #594  
**Domain:** SWING-ANALYSIS  
**Type:** CODE-REVIEW  
**Status:** Final  
**Created:** 2026-09-27  
**Last Updated:** 2026-09-27  

# Code Review — #607 Dialog: two-list config manager

## Verdict: PASS (5 rounds — ran until clean)

## Spec check (IMPL + TEST plan, task ACs)

| AC | Status | Evidence |
|----|--------|----------|
| Available list: Presets + Saved groups; `+` activates | ✔ | `presets` (Large/Small) + `configLibrary` rows; `activateConfig` copies into `configs[]` |
| Active list: edit-expand + clone + save-to-library (name input) + remove | ✔ | `<details>` param controls kept; `clone-config-btn`/`remove-config-btn` in summary; `save-config-name` input + `save-config-btn` |
| Param-summary fallback when no name | ✔ | `doc.name ?? paramSummary(doc.config)` in rows; input placeholder surfaces summary |
| Dual-mode toggle removed | ✔ | gone since #606 ship; stays absent |
| Dialog loads library on open | ✔ | `loadConfigLibrary()` in constructor; spec asserts `loadConfigs` called once |
| Store legacy methods removed (deferred from #606) | ✔ | `saveAnalysis`/`loadSavedAnalyses`/`loadAnalysis`/`savedAnalyses`/`analysisSub` excised |

## Round 1 — PASS with notes

- `event.preventDefault()` on summary-row buttons suppresses the native
  details toggle (stopPropagation alone wouldn't). ✔
- `paramSummary` excludes `lineColor` and bool flags — compact label;
  `paramsId` remains the identity. Acceptable.
- Dropped the stale docstring "dual-mode toggle"; `canSave`/symbol/stats
  gating removed — config-only writes need no computed data.

## Round 2 — findings → resolution

- **[MED] Stale-load clobber** — `saveActiveConfig`/`deleteSavedConfig`
  success during an in-flight `loadConfigLibrary` would get overwritten by
  the load's pre-write snapshot (resurrect on delete / vanish on save).
  → `refreshLibrary()` refires the load only while `librarySub` is non-null;
  regression tests cover both directions.
- **[MED] `librarySub` truthiness bug** — `sub = observable.subscribe(...)`
  assigns *after* a sync-completing observable runs `next` (which nulls the
  handle), leaving a closed-but-truthy subscription → the in-flight check
  misfired. → capture + `sub.closed ? null : sub`.
- **[LOW] Dead spec surface** — removed `makeSwingAnalysisDoc`/
  `makeSwingStats`/`makeDistributionSummary`/`makeHistogram`, the
  `docs`/`allSets`/`savedDocs` mock params, and `loadSavedAnalyses`/
  `loadAllSwingSets`/`loadAnalysis`/`SwingAnalysisDoc` mock+import
  leftovers in both specs. `service.saveAnalysis` mock retained — the batch
  sweep still persists `st-swing-sets` snapshots (Thread #416).

## Round 3 — spec hygiene cleanup

No new functional findings; removed the dead mock surface above.
`runBatch` snapshot path is service-level and intentionally retained;
service-level legacy methods remain for option-chain-pct-change.

## Round 4 — finding → resolution

- **[LOW-MED] Dialog swallows store errors** — save/delete/load failures
  patch `store.error`, but the error banner lives on the page behind the
  modal overlay — invisible while the dialog is open. → dialog now renders
  `store.error` inline (`data-testid="dialog-error"`); spec covers a failed
  `saveConfig` surfacing in the overlay.

## Round 5 — finding → resolution

- **[LOW-MED] Indistinguishable library rows** — `paramSummary` covered
  only the 3 numeric params; `paramsId` also keys `showTriggerDots` and
  `allowZigZagOnOneBar`, so flag-differing docs rendered identical rows.
  → summary now appends `1barY/N` + `trigY/N` segments; spec proves
  flag-differing rows render distinctly.

## Round 6 — CONFIRMED CLEAN

No new findings. Remaining LOW notes (delete has no confirm; optimistic
upsert order may jump on refresh; index-scoped name input shifts on
remove) are cosmetic and match the blueprint.

## Tests

`npx jest swing-analysis --coverage=false` — **291/291, 8/8 suites**
(2 race regressions + 9 config-manager specs).

## Findings (open)

None.

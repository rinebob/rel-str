**Topic:** Swing Analysis Page  
**Topic Slug:** `swing-analysis-page`  
**Issue:** #613  
**Task:** #606  
**Topic Parent:** #594  
**Domain:** SWING-ANALYSIS  
**Type:** UAT  
**Status:** Complete  
**Created:** 2026-09-26  
**Last Updated:** 2026-09-26  

# UAT — #606 Store: config library + always-N configs

## Scope

Store-side config-library state + always-N config list, retirement of the
saved-sets panel and dual-mode toggle. The two-list dialog surface lands in
#607 — this UAT covers the store seam plus the visible removals.

## Scenarios

### 1. Unit specs — store contract

- `npx jest swing-analysis.store --coverage=false`
- Expected: all specs pass — config-library block covers load/save/delete,
  slim payload, paramsId dedupe, error paths; config-list block covers
  activate/remove/clone at N=0..4.
- **Result: PASS** — 69/69 (2026-09-26).

### 2. Unit specs — page/spec fallout from removals

- `npx jest swing-analysis --coverage=false`
- Expected: all 8 suites pass — page spec rewritten (no saved-sets describe,
  no dual-mode toggle tests; single-config cases use `removeActiveConfig`).
- **Result: PASS** — 299/299 (2026-09-26).

### 3. UI smoke — saved-sets panel gone

- `npm start`, open Swing Analysis page.
- Expected: no "Saved Sets" collapsible section under the error banner;
  chart/table/stats unchanged; no console errors mentioning saved-sets.
- **Result: PASS** — user-confirmed on dev server 2026-09-26: panel absent, layout clean.

### 4. UI smoke — dual-mode toggle gone

- Settings dialog (gear button).
- Expected: no "Dual Mode" checkbox; one config section per active config;
  per-config controls (numeric/bool/color) still functional; Save button
  still present (legacy path until #607).
- **Result: PASS** — user-confirmed 2026-09-26: no toggle, sections + Save intact.

### 5. (Deferred to #607) Dialog two-list flow

- Activate/delete/clone/save-from-UI verified once the dialog exposes the
  library list — this task added only the store API.

## Refinement pass

- Page: saved-sets panel removal leaves no orphaned whitespace. **PASS** (user-confirmed)

## Traceability

| AC | Scenario |
|----|----------|
| configLibrary state + lazy load | 1 |
| activate/remove/clone + recompute | 1 |
| saveActiveConfig slim write + dedupe | 1 |
| deleteSavedConfig | 1 |
| dualMode/toggleDualMode removed | 1, 2, 4 |
| savedSets paths + panel retired | 1, 2, 3 |

## Findings

- None. Dialog Save button still exercises the legacy snapshot path by
  design until #607 rewires it to `saveActiveConfig`.

- Dialog: no dual-mode toggle; config sections + Save intact. **PASS** (user-confirmed)
- No new UI introduced — nothing further to refine.

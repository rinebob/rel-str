**Topic:** Swing Analysis Page  
**Topic Slug:** `swing-analysis-page`  
**Thread:** Misc fixes — swing analysis  
**Thread Slug:** `misc-fixes`  
**Issue:** #603  
**Thread Parent:** #599  
**Topic Parent:** #594  
**Domain:** SWING-ANALYSIS  
**Area:** FE  
**Type:** TEST  
**Status:** Complete  
**Created:** 2026-09-26  
**Last Updated:** 2026-09-26  

# TEST — Config management + misc UI fixes (FE)

## Unit targets

**Service (`swing-analysis.service.spec.ts`)**
- `loadConfigs` enumerates `st-swing-configs`, maps docs to `SwingConfigDoc` (id → paramsId).
- `saveConfig` writes `{name?, config, savedAt}` to `st-swing-configs/{paramsId}`; no symbol/pivots/swings/stats fields written; stamps `userId`.
- `saveConfig` idempotent — same params overwrite same doc.
- `deleteConfig` deletes by doc id.

**Store (`swing-analysis.store.spec.ts`)**
- `loadConfigLibrary` populates `configLibrary`; loading flag toggles; error path patches `error`.
- `activateConfig` appends to `configs[]` and recomputes against loaded bars (mock bars present).
- `removeActiveConfig` splices; survivors recompute; removing index 0 of N>2 works.
- `cloneConfig` appends a deep copy — mutating the clone's params does not affect the original.
- `saveActiveConfig` calls service with derived `paramsId`; optional name flows through.
- `deleteSavedConfig` removes from `configLibrary` signal.
- N>2 configs: `swings()`/`stats()` arrays align index-for-index; no `dualMode`/`toggleDualMode` on the store.
- Defaults: fresh state = two configs (large + small).

**Dialog (`swing-settings-dialog` spec)**
- Available list renders presets + library docs in two groups.
- `+` activates a config; active list row count grows.
- Active row actions: clone appends, remove splices, save prompts/accepts optional name, delete removes library row (with confirm if designed).
- Dual-mode toggle absent.

**Page (`swing-analysis-page.component.spec.ts`)**
- No `saved-sets` element/data-testid in the page.
- Filter controls present and visibly styled (assert classes, not pixels).
- Stats panel and table render for 1, 2, and 3+ configs.

## Integration boundaries

- Store ↔ service mocked (no live Firestore); service ↔ Firestore via collection-path assertions only.
- `deriveParamsId` — same config produces same id across sessions (pin with fixture).
- Old `st-swing-sets` doc shape deserializing into `SwingConfigDoc`-adjacent reads: not applicable — dialog never reads `st-swing-sets`.

## Edge cases

- Library doc with no `name` → param-summary fallback label renders.
- Save with empty/whitespace name → treated as absent.
- Activate a config already active → allowed (duplicate renders twice; document choice) or deduped — pin whichever is implemented.
- Remove last active config → page shows empty state, no crash.
- Library load failure → error surfaces, dialog still usable.
- `lineColor`-only difference between two configs → same `paramsId` (documented behavior).

## Seams

- `SwingAnalysisService` — all persistence behind it; specs mock it.
- `computeAllConfigs` — recompute seam; specs assert it's invoked after list mutations.
- Presets — a constants export; specs assert presence in the available group.

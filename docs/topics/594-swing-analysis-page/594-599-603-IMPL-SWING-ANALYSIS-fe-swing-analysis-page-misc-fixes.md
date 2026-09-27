**Topic:** Swing Analysis Page  
**Topic Slug:** `swing-analysis-page`  
**Thread:** Misc fixes — swing analysis  
**Thread Slug:** `misc-fixes`  
**Issue:** #603  
**Thread Parent:** #599  
**Topic Parent:** #594  
**Domain:** SWING-ANALYSIS  
**Area:** FE  
**Type:** IMPL  
**Status:** Complete  
**Created:** 2026-09-26  
**Last Updated:** 2026-09-26  

# IMPL — Config management + misc UI fixes (FE)

## Architecture

All work is frontend — new Firestore collection + store methods + dialog rebuild + page cleanup. No Cloud Functions; `ZigZagConfig` stays in `shared/components/flex-chart/indicators/st-zigzag.engine.ts` unchanged.

```
st-swing-configs/{paramsId}   →  { name?: string, config: ZigZagConfig, savedAt: string }
```

- Doc id = `deriveParamsId(config)` — dedupe is structural; saving identical params is idempotent.
- `name` optional; absent → UI falls back to a param summary (`dev {d}% · L{l} · R{r}`).
- Symbol is NOT stored — the library is global; loads recompute against the current symbol's bars.
- `st-swing-sets` (legacy heavyweight snapshots) is untouched by this work — its write-path retirement is a task under Thread #416. The new dialog reads only `st-swing-configs`.

## Files

| File | Change |
|------|--------|
| `swing-analysis.types.ts` | Add `SwingConfigDoc`/`SwingConfigInput` types for the library; keep `SwingAnalysisDoc` (legacy) |
| `swing-analysis.service.ts` | Add `st-swing-configs` CRUD: `loadConfigs()`, `saveConfig(input)`, `deleteConfig(paramsId)` |
| `firestore.rules` | `st-swing-configs` owner-scoped read/write (same pattern as `st-swing-sets`) |
| `swing-analysis.store.ts` | `configLibrary` state + `loadConfigLibrary`, `activateConfig`, `removeActiveConfig`, `cloneConfig`, `saveActiveConfig`, `deleteSavedConfig`; retire `toggleDualMode` + lazy `savedSets` fetch |
| `components/swing-settings-dialog.component.ts` | Rebuild around two-list manager + compact controls |
| `components/saved-sets.component.ts` | Deleted (and removed from page template) |
| `swing-analysis-page.component.ts` | Drop saved-sets wiring; filter-row restyle hooks |
| `components/swing-table.component.ts` | Filter controls styled visibly |

## Canned presets

Available list = presets + library docs. Presets are module constants — `LARGE_CONFIG`, `SMALL_CONFIG`, and any additional canned variants defined in the store/constants (each carries a display name, not persisted). Presets can be activated or cloned; delete/save does not apply to them.

## Store design

```ts
// state
configLibrary: SwingConfigDoc[];     // all saved configs, loaded once on dialog open
configLibraryLoading: boolean;

// methods
loadConfigLibrary(): void                        // enumerate st-swing-configs
activateConfig(cfg: ZigZagConfig): void          // push into configs[], recompute against current bars
removeActiveConfig(index: number): void          // splice out, recompute survivors
cloneConfig(index: number): void                 // deep-copy configs[i] → append
saveActiveConfig(index: number, name?: string): void  // write {name?, config, savedAt} → st-swing-configs/paramsId
deleteSavedConfig(paramsId: string): void        // delete doc + drop from library signal
```

- `dualMode` signal and `toggleDualMode` removed — `configs[]` is the truth; consumers currently guarding with `length === 2` generalize to index access (`swings()[i]`, `stats()[i]`).
- Default session still opens with `[LARGE_CONFIG, SMALL_CONFIG]` — two entries in the list, not a mode.
- `savedSets`/`savedSetsLoading`/`loadSwingSetsIntoSlots` removed; symbol-scoped fetch gone.

## Dialog layout

Sections, top→bottom (all compact-density):

1. **Available configs** — list rows: name/params summary + `+` (activate). Two groups: `Presets` then `Saved`.
2. **Active configs** — list rows: index, name/summary, actions: edit-expand (`<details>` with existing param controls), clone, save-to-library (inline name input), remove.
3. **Batch sweep** — unchanged, moved under the manager.

Controls restyle: dense fields (smaller font/height), no full-width inputs; param inputs remain validated to existing bounds.

## Page changes

- `SavedSetsComponent` deleted; import removed from the page.
- Swing-table filter row: `.filter` labels keep or lose `text-transform: uppercase` per look; controls get visible borders/outline so they read as interactive without a click.
- Strings/tests referencing "dual mode" updated to N-config phrasing.

## Phase plan

- **Phase 1 — service + rules:** `st-swing-configs` types + CRUD + security rule.
- **Phase 2 — store:** library state + list-management methods; dual-mode removal.
- **Phase 3 — dialog UI:** two-list manager + presets + compact styling.
- **Phase 4 — page cleanup:** saved-sets removal, filter styling, string cleanup.

## Risks

- `length === 2` call sites — page + specs assume exactly two; generalize carefully (stats panel, swings indexing).
- Old `st-swing-sets` docs still exist in prod; nothing reads them after this, but they linger until #416's cleanup task.
- `paramsId` collisions across different param sets — deriveParamsId must cover all `ZigZagConfig` fields (it already does — verify `lineColor` excluded intentionally; if excluded, two configs differing only in color dedupe to one doc: acceptable, params are the identity).

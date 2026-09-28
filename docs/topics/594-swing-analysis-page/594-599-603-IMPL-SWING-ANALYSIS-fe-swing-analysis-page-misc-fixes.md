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

## Canned presets (amended 2026-09-27 — #609 narrow-row redesign)

Available list = presets + library docs. Presets are a shared module constant `SWING_PRESETS` — the 4-config set previously in `scripts/bulk-swing-sweep.ts` (dev/L/R `10·10·10`, `5·5·5`, `3·3·3`, `2·2·2` with palette colors, all flags on), ordered highest→lowest devThreshold. Presets are **unnamed** — the row shows the param summary, not a display name. Presets can be activated or cloned; delete/save does not apply to them.

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
- Default session still opens with `[LARGE_CONFIG, SMALL_CONFIG]` — two entries in the list, not a mode. (Identifiers kept as store constants; no UI string uses Large/Small.)
- `savedSets`/`savedSetsLoading`/`loadSwingSetsIntoSlots` removed; symbol-scoped fetch gone.
- `runBatch`/`cancelBatch` + batch state removed — batch sweep machinery deleted (see below).

## Dialog layout (amended 2026-09-27 — #609 narrow-row + presets-vs-sets redesign)

Sections, top→bottom:

1. **Available configs** — list rows: param summary + `+` (activate). Two groups:
   - `Presets` — 4 canned unnamed rows (`SWING_PRESETS` const, desc devThreshold) followed by user-saved **single** configs (swatch + name-or-summary + `+`/`✎`/`×`).
   - `Saved sets` — library docs carrying `configs: ZigZagConfig[]` (keyed by `set_<member paramsIds joined>`); `N×cfg` badge + name-or-summary + `+` (applies the set — **replaces** `configs[]` wholesale) + `✎`/`×`.
   - Both groups are symbol-less — configs apply to whatever symbol is loaded.
2. **Active configs** — header row carries set-level ops `[Save set] [Clone all] [Clear]` beside the `Active` label. One narrow row per config, fully inline: `[on/off ☐] [color] [devThreshold] [leftDepth] [rightDepth] [1bar ☐] [trig ☐] [Save] [Clone] [×]`. No `<details>` sections, no row labels — params are the identity.
   - Per-row `Save` writes a **single-config** doc (appears under Presets); header `Save set` writes the whole active list as a set doc (appears under Saved sets).
   - The on/off checkbox is runtime-only (`configEnabled[]`, index-aligned with `configs[]` — never persisted): disabled slots compute nothing and render dimmed; toggling back on recomputes from loaded bars.
3. **Batch sweep removed entirely** — `BatchSweepComponent`, `swing-batch.ts`, and `runBatch`/`cancelBatch` deleted; the sweep flow is outdated (superseded by the config library).

New store methods (beyond the #607 set): `applyConfigSet(doc)` (replace+recompute), `saveActiveSet(name?)`, `cloneAllConfigs()`, `clearActiveConfigs()`, `renameSavedConfig(doc, name?)` (works for singles and sets), `toggleActiveConfig(index)` (runtime flag).

Validation bounds unchanged; no full-width inputs.

## Page changes

- `SavedSetsComponent` deleted; import removed from the page.
- Swing-table filter row: `.filter` labels keep or lose `text-transform: uppercase` per look; controls get visible borders/outline so they read as interactive without a click.
- Strings/tests referencing "dual mode" or Large/Small updated to N-config/param-summary phrasing.

## Phase plan

- **Phase 1 — service + rules:** `st-swing-configs` types + CRUD + security rule.
- **Phase 2 — store:** library state + list-management methods; dual-mode removal.
- **Phase 3 — dialog UI:** two-list manager + presets + compact styling.
- **Phase 4 — page cleanup:** saved-sets removal, filter styling, string cleanup.

## Risks

- `length === 2` call sites — page + specs assume exactly two; generalize carefully (stats panel, swings indexing).
- Old `st-swing-sets` docs still exist in prod; nothing reads them after this, but they linger until #416's cleanup task.
- `paramsId` collisions across different param sets — deriveParamsId must cover all `ZigZagConfig` fields (it already does — verify `lineColor` excluded intentionally; if excluded, two configs differing only in color dedupe to one doc: acceptable, params are the identity).

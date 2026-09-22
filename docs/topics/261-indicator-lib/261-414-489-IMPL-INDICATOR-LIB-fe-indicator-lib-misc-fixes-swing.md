**Topic:** Trading Indicator Library
**Topic Slug:** indicator-lib
**Thread:** Misc fixes & polish — swing analysis
**Thread Slug:** misc-fixes-swing
**Issue:** #489
**Thread Parent:** #414
**Topic Parent:** #261
**Domain:** INDICATOR-LIB
**Type:** Implementation Plan (FE)
**Status:** Draft
**Created:** 2026-09-22
**Last Updated:** 2026-09-22

# Implementation Plan — FE: Symbol picker + company info header

FE only. Both data sources already exist: `getTrackedSymbols$`
(universe, partner-proxy callable) and `signalService.getAllSymbols()`
(direct Firestore read of `savant-trader/data/symbols` — the SA overview
sync target). No backend work.

## Architecture

### Profiles live in SymbolListStore (canonical symbol-metadata owner)

New `symbol-profiles.feature.ts` slice on `SymbolListStore` (same
pattern as `symbol-nav.feature.ts` on SwingAnalysisStore):

- State: `profiles: StSymbolProfile[]` (+ `profilesLoading`)
- Computed: `profilesBySymbol: Map<string, StSymbolProfile>`
- Method: `loadProfiles()` — guarded (no-op when loaded), calls
  `signalService.getAllSymbols()` once; session-cached.

One fetch serves the autocomplete (display names) and the header
strip (all fields). `Company.company` from the tracked-symbols
callable is NOT used for display — `profile.name` is SOT (PRD US-3);
absent name → ticker.

### Components

- **`CompanyInfoStripComponent`** (new, thin) — input `profile:
  StSymbolProfile | undefined`; renders all fields inline with `—`
  for missing. Mounted in the page header, right of the title.
- **`SymbolNavComponent`** — symbol span becomes a permanent
  `mat-autocomplete` input between ◀ and ▶. Options:
  `trackedSymbols × profilesBySymbol` → `TICKER — Name`, substring
  filter on both. Commit only on dropdown pick or exact tracked-ticker
  Enter; blur/Esc/invalid → revert to `store.symbol()`. Input disabled
  while `trackedSymbols` is empty.
- **`SwingSettingsDialogComponent`** — remove the free-text symbol
  input (picker is the only entry point — PRD US-1).

### Load order

Page init calls `loadTrackedSymbols()` (existing) +
`lists.loadProfiles()` (new). Header fills in when profiles arrive —
never blocks chart/swings.

## Task split

1. **Profiles slice** — `symbol-profiles.feature.ts` on
   SymbolListStore + spec.
2. **Company info strip** — component + header mount + spec.
3. **Nav autocomplete picker** — SymbolNavComponent input, tracked-only
   commit, dialog input removal, specs.

## Risks / boundaries

- `getAllSymbols()` is a live `collectionData` subscription — take(1)
  or firstValueFrom; don't leave a listener running.
- Autocomplete option list is ~900 items — render all, rely on the
  filter (Material handles it; no virtual scroll needed at this size).
- Profiles lag the tracked list for new symbols — ticker + `—` is the
  honest unsynced state (not an error).

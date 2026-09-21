**Topic:** Trading Indicator Library  
**Topic Slug:** indicator-lib  
**Thread:** Add previous/next symbols capability to Swing Analysis  
**Thread Slug:** symbol-prev-next  
**Issue:** #453  
**Thread Parent:** #451  
**Topic Parent:** #261  
**Domain:** INDICATOR-LIB  
**Type:** Implementation Plan  
**Status:** Approved  
**Created:** 2026-09-20  
**Last Updated:** 2026-09-21  

# Implementation Plan — FE: Previous/next symbol navigation

## Architecture

Single FE area. No new backend surface: tracked symbols come from the existing `RelStrDbV2Service.getTrackedSymbols$()` callable (TTL-cached, returns `Company[]`); watchlist state comes from the existing root `SymbolListStore`; list writes reuse `SymbolListStore.toggleSymbolInList` (atomic exclusive move). Navigation delegates to the existing `setSymbol` → `loadBarsAndRecompute` path, so configs, recompute, and stale-request cancellation are already correct.

`swing-analysis.store.ts` is already ~600 lines — over the repo's size guideline. The nav slice goes in a feature file (`symbol-nav.feature.ts`) exporting a computed block and a methods block spread into the store, matching the `swing-compare.feature.ts` precedent in option-chain-pct-change.

## State additions (SwingAnalysisStore via symbol-nav.feature.ts)

```text
trackedSymbols: string[]        // symbol field only, alphabetically sorted once at load
navFilter: 'ALL' | SymbolListName
```

Computed (in the feature's computed block — reads `SymbolListStore` via `inject`):

- `navSequence: string[]` — `navFilter === 'ALL'` → `trackedSymbols`; else `symbolLists()[navFilter]` in stored order (intersected with `trackedSymbols` to drop stale entries).
- `navIndex: number` — `navSequence.indexOf(symbol)`; `-1` when the current symbol is outside the sequence.
- `navPosition: string` — display string: `"{i+1} of {M}"` when index ≥ 0, `"— of {M}"` otherwise.
- `navEnabled: boolean` — sequence non-empty (and optionally `!loading()` for button disabling).

Methods:

- `loadTrackedSymbols()` — `getTrackedSymbols$()` → `companies.map(c => c.symbol)` → dedupe + `sort()` → `trackedSymbols`. Called once from page init; failure surfaces via existing `error` state or a console + snackbar consistent with other store loads.
- `setNavFilter(filter)` — sets `navFilter`. Does not change the current symbol; the sequence (and indicator) recompute.
- `nextSymbol()` / `prevSymbol()` — compute target index: `navIndex < 0` → `0` (or `sequence.length - 1` for prev); else `(navIndex ± 1) mod sequence.length` (wrap-around). Then `setSymbol(sequence[target])`. No-op when sequence is empty.

Cross-store note: a `computed` inside the feature can read `symbolListStore.symbolLists()` — SignalStore instances are injectable services; `inject(SymbolListStore)` in the feature's factory works like any other inject.

## Page changes (swing-analysis-page.component)

- Beside the symbol input: `‹` / `›` buttons (`mat-icon-button` or plain buttons matching existing styling) + a `navPosition` text label. Buttons call `store.nextSymbol()` / `store.prevSymbol()`; disabled when `navSequence` is empty. Loading is not a blocker — rapid paging relies on existing cancellation.
- A `mat-select` (or native select matching page style) for `navFilter`: options `All tracked` + all six `ALL_SYMBOL_LIST_NAMES`. Label e.g. "Navigate:" — stays left of the prev/next controls.
- `SymbolListActionsComponent` rendered for the current symbol — inputs `[symbol]="store.symbol()"`, `[symbolLists]="symbolListStore.symbolLists()"`, `[activeListFilter]="symbolListStore.activeListFilter()"`; `(toggleList)` → `symbolListStore.toggleSymbolInList($event.symbol, $event.listName)`. Placement: under the symbol input row, visible whenever a symbol is loaded.
- Page init: call `store.loadTrackedSymbols()` and `symbolListStore.loadSymbolLists()` (guarded — skip if already loaded, since both stores are root-provided and may be warm).

## Edge cases

- Current symbol not in the filtered sequence (typed manually or filtered out): `navIndex = -1`, indicator `— of M`, next → first item, prev → last item.
- Symbol fails to load mid-nav: `setSymbol` error path already surfaces `error`; nav stays usable — the failed symbol occupies its index.
- Symbol assigned INTO the active filter via chips while viewing it: sequence grows; index math stays correct since position is derived, not stored.
- Symbol moved OUT of the active filter: it leaves `navSequence` on next computed pass; indicator drops to `— of M`.
- Empty filtered list: buttons disabled, `0 of 0`… display `— of 0` per the `navIndex < 0` rule.

## Risks / watch-items

- `getTrackedSymbols$` returns `Company[]` — only `symbol` is used; confirm the field name on the `Company` contract (used identically in `stock-list-v2.feature.ts`).
- `SymbolListStore` may not be loaded when the page mounts on a fresh session — page init triggers `loadSymbolLists()` so the filter dropdown and chips populate.
- Chips call `toggleSymbolInList`, which persists immediately — no save button; membership changes are durable on click (existing behavior, unchanged).

## Task split

1. **Store nav slice** — `symbol-nav.feature.ts`: state (`trackedSymbols`, `navFilter`), computeds (`navSequence`, `navIndex`, `navPosition`, `navEnabled`), methods (`loadTrackedSymbols`, `setNavFilter`, `nextSymbol`, `prevSymbol`), wired into `SwingAnalysisStore`. Unit tests.
2. **Nav UI** — prev/next buttons, `N of M` indicator, watchlist filter select on the page; init loads. Component spec.
3. **List triage chips** — `SymbolListActionsComponent` on the page wired to `SymbolListStore`; membership reflects on nav. Component spec.

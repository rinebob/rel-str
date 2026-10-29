**Topic:** RH Scanner  
**Topic Slug:** rh-scanner  
**Thread:** Scanner Row Actions  
**Thread Slug:** scanner-row-actions  
**Issue:** #1297  
**Thread Parent:** #1295  
**Topic Parent:** #1098  
**Domain:** SAVANT-TRADER  
**Area:** FE  
**Type:** TEST  
**Status:** Draft  
**Created:** 2026-10-27  
**Last Updated:** 2026-10-27  

# TEST (FE) — Scanner Row Actions

Jest + jest-preset-angular suite conventions (zoneless
`provideZonelessChangeDetection`, stub Firebase tokens, `jest.fn()`).
Suites: `scanner.component.spec.ts`, `scanner-recipe-table.component.spec.ts`,
`scanner-chart.store.spec.ts` (new), `scanner-historicals.util.spec.ts`
(new), `scanner-chart-popup.component.spec.ts` (new).

## §1 Page filter (`scanner.component.spec.ts`)

- Header renders a tri-state control; default = `all`; `aria-pressed`
  on the active segment.
- `railEntries` under `new`: a run whose rows are 1 untracked + 2
  tracked shows `1 / M` count and only the untracked ticker in top
  tickers; under `tracked` the inverse; `all` restores everything.
- The selected recipe's table receives the filter — a `new` selection
  hides tracked rows in the rendered table.
- Filter survives switching rail selection; a `new` mode with zero
  untracked hits renders the empty state, not a crash.

## §2 List menu + chip (`scanner-recipe-table.component.spec.ts` + page spec)

- Page calls `loadSymbolLists()` on init.
- Row renders the list chip for a member (`PRIMARY`), empty for
  unassigned; chip tracks `Map<normSymbol, key>` input, not row state.
- Menu lists exactly the 6 exclusive keys in catalog order; checkmark
  on the symbol's current list.
- Picking a different list emits `{symbol, listKey}` → page calls
  `toggleSymbolInList`; picking the checked list also routes through
  `toggleSymbolInList` (un-assign is the store's job).
- MONITOR/user lists never appear in the menu.
- Untracked row still shows the menu + `new` badge after being filed.

## §3 Popup infra (`scanner-recipe-table.component.spec.ts` + popup spec)

- `mouseenter` on the chart button opens the overlay anchored to that
  button; `mouseleave` starts the close-grace; moving into the popup
  cancels it; popup `mouseleave` closes.
- Focus/click also opens (a11y path).
- Only one popup at a time — hovering a second row's button swaps the
  popup's symbol.
- Popup closes on recipe switch and when the row is filtered out.
- Fetch-in-flight shows the loading state; an error shows the error
  state (not a blank frame); an auth-shaped failure surfaces the page's
  reauth affordance.

## §4 Untracked chart (`scanner-chart.store.spec.ts`,
`scanner-historicals.util.spec.ts`)

- `historicalsToBars`: parses `begins_at`/`*_price` strings →
  `PriceBar`; skips malformed rows; empty/absent `historicals` → `[]`.
- `smaOverlays`: MA values correct at hand-computed points; first N-1
  points carry no MA value (warmup); three series at [10,20,50].
- `ensureBars`: dedupes concurrent calls (one `executeTools` call);
  error slot settles and blocks refetch loops; success caches for the
  session.
- Popup renders a `candle` series + 3 line series for an untracked
  symbol; bull/bear coloring uses theme tokens (no hardcoded hex in the
  component path).

## §5 Tracked mode (popup spec)

- A tracked row's popup mounts `app-gallery-card-chart` (not the candle
  path); `GalleryCardChartStore.ensureBars` is called with the symbol.
- The fabricated `GalleryCard` carries the symbol and empty
  `allOccurrences` — no fake signal dots.

## E2E journeys (manual QA — UAT doc)

1. Hover chart on a NEW-symbol row → candle chart with MAs appears,
   closes on leave.
2. Hover chart on a tracked-symbol row → gallery card chart (multi-pane).
3. File a new hit to PRIMARY from the row → chip shows PRIMARY; symbol
   appears in the PRIMARY list on review surfaces.
4. Move PRIMARY → AVOID; re-pick AVOID → un-assigned.
5. Filter `new` → rail counts drop, rail tickers and table show only
   untracked rows; `tracked` inverts; `all` restores.
6. Unauthenticated session → chart fetch failure surfaces reauth, not a
   dead popup.

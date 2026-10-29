**Topic:** RH Scanner  
**Topic Slug:** rh-scanner  
**Thread:** Scanner Row Actions  
**Thread Slug:** scanner-row-actions  
**Issue:** #1297  
**Thread Parent:** #1295  
**Topic Parent:** #1098  
**Domain:** SAVANT-TRADER  
**Area:** FE  
**Type:** IMPL  
**Status:** Draft  
**Created:** 2026-10-27  
**Last Updated:** 2026-10-27  

# IMPL (FE) — Scanner Row Actions

Per-row actions on the auto-run scanner page: a hover/click chart popup
(dual-mode by tracked status, ADR-011), a triage-list assignment menu
with a per-row membership chip, and a page-wide All/New/Tracked filter.
PRD: `1098-1295-1296-PRD-SAVANT-TRADER-rh-scanner-scanner-row-actions.md`.

## Architecture at a glance

- **Filter** is page state (`signal` on `ScannerComponent`), not store
  state — a view concern, no persistence.
- **List membership** flows entirely through `SymbolListStore` — the page
  adds `loadSymbolLists()` on init; row writes call
  `toggleSymbolInList` (exclusive move + un-assign already implemented).
- **Chart popup** is a `cdkConnectedOverlay` owned by
  `ScannerRecipeTableComponent` — the `chain-cell-popup` pattern (#965):
  anchored origin, delayed-close grace for pointer travel.
- **Bars for untracked symbols** live in a new session-scoped store
  (`ScannerChartStore`) — small `Map<symbol, PriceBar[]>` + loading/error
  flags, fed by `get_equity_historicals`.
- **Tracked mode** embeds `app-gallery-card-chart` fed by the existing
  `GalleryCardChartStore` — no new data path for tracked rows.

## §1 Page filter (task T1)

`ScannerComponent`:

- `symbolFilter = signal<'all' | 'new' | 'tracked'>('all')`
- Segmented control in `.scanner-header` (three pill buttons,
  `aria-pressed` on the active — same idiom as the interval chips
  elsewhere in the app).
- `railEntries` applies the filter **inside** its computed: rows are
  filtered before `baselineSortedRows` slicing and before the count
  renders — `count` shows the filtered total against `total_items`
  (`first N of M` stays when capped). Under `new`, a recipe with zero
  untracked hits shows `0 / M`.
- The selected recipe's table gets the filter as an input; the table
  filters `scanRunRows` output before seeding sort — the sort-level seed
  (`seedSortLevels`/`baselineSortedRows`) is unchanged.

## §2 Row actions + list menu (task T2)

`ScannerRecipeTableComponent` gains two appendage columns:

- **List chip cell** (before Symbol): the symbol's current triage-list
  key rendered as a compact chip (e.g. `PRIMARY`), empty when
  unassigned. Membership map arrives as an input
  (`Map<normSymbol, listKey>`) computed on the page from
  `symbolLists.byRole().exclusive` — no per-row store access.
- **Actions cell** (after the badge): two icon buttons —
  `show_chart` (popup trigger, §3) and `playlist_add` (list menu).

The list menu is a `mat-menu` anchored to the row's icon:

- Options = the 6 exclusive triage keys from `symbolLists.byRole().exclusive`
  (catalog order); checkmark (mat-icon `check` prefix) on the symbol's
  current list.
- Click emits `{symbol, listKey}` to the page →
  `symbolLists.toggleSymbolInList(symbol, listKey)` — exclusive move
  when picking a different list, un-assign when picking the checked one.
  `removeFromList` isn't called directly: `toggleSymbolInList` already
  routes exclusive targets through `moveToList(symbol, null, keys)` on
  re-pick.
- The page calls `loadSymbolLists()` in `ngOnInit` (alongside
  `loadTrackedSymbols`) so the catalog is live — the chip updates on the
  next emission after a write (no optimistic patch, existing contract).
- Untracked rows get the same menu — filing an untracked symbol is the
  core flow; the row keeps its `new` badge (membership ≠ tracking).

## §3 Chart popup infra (task T3)

`ScannerChartPopupComponent` (new, under `pages/scanner/`):

- Hosted in a `cdkConnectedOverlay` declared in the recipe table's
  template, `[cdkConnectedOverlayOrigin]` = the row's chart button,
  positions `[originX:'end', originY:'bottom' → overlayX:'start',
  overlayY:'top']` with a flip fallback, `viewportMargin: 8` —
  same shape as `chain-grid.component.html:90-96`.
- Open state = `hoveredSymbol` signal on the table component; set on
  button `mouseenter`/`focus`/`click`, cleared on `mouseleave` with the
  documented grace (~150-250ms — pin the constant and use the
  chain-grid value) so the pointer can travel into the popup; popup
  `mouseleave` closes immediately.
- One popup at a time — opening for a new symbol tears down the old;
  teardown also on recipe switch, filter change removing the row, and
  `DestroyRef`.
- Popup chrome: symbol + name header; body switches on tracked status —
  loading spinner while bars resolve, error state on failure, and an
  auth-shaped failure surfaces the page's reauth banner path (auth
  errors are session-global — `errorKind: 'auth'` semantics from
  `launchRecipe` apply).

## §4 Untracked candle chart (task T4)

`ScannerChartStore` (new signalStore, `providedIn: 'root'`):

- `bars: Map<string, PriceBar[]>`, `loading`, `error` per symbol +
  `ensureBars(symbol)` — dedupes in-flight; errors settle like
  `GalleryCardChartStore` (error slot participates in the dedupe guard
  or hover re-enters refetch forever).
- Fetch: `RobinhoodMcpObservationService.executeTools([{tool:
  'get_equity_historicals', arguments: {symbol, interval:'day',
  span:'year'}}])` — arg names verified against the live tool schema at
  implementation time (`docs/topics/657-rh-mcp` captures).
- Map `EquityHistoricalBar` → `PriceBar` (parse `*_price` strings,
  `begins_at` → date) — a pure util `historicalsToBars` next to
  `scanner-rows.util`.
- MA util: `smaOverlays(bars, [10,20,50])` → three `FlexChartDataset`
  line series (null until warmup) — pure util, spec'd.

Popup body (untracked mode) = `FlexChartComponent` with one `candle`
price series (Syncfusion's native bull/bear coloring — verify palette
tokens rather than hardcoding) + the 3 MA line series. No toolbar, no
signal dots, ~40-60 visible candles.

## §5 Tracked-mode chart (task T5)

Popup body (tracked mode) = `app-gallery-card-chart` fed a fabricated
minimal `GalleryCard`:

```ts
{ key: `scan-${symbol}`, symbol, allOccurrences: [], /* + required
  fields defaulted — see gallery-cards.util shape */ }
```

- `GalleryCardChartStore.ensureBars(symbol)` on open; the card chart's
  own mount effect also ensures — the prefetch makes first paint
  render-only on the warm path.
- `GalleryUiStore` is root-scoped: the card reads the page-level
  `chartTimeframe` (defaults daily — no scanner-side control in v1;
  the per-card D/W chip still works since it's card-local).
- No gallery-card toolbar actions surface — the popup renders the chart
  only (the card component's chrome is its own).

## §6 Wiring summary

| Surface | Reads | Writes |
|---|---|---|
| Header filter | `symbolFilter` | sets `symbolFilter` |
| Rail entries | `runs`, `tracked`, `symbolFilter` | — |
| Recipe table | `run.result`, `tracked`, `symbolFilter`, membership map | emits chart-open / list-pick |
| List menu | `byRole().exclusive`, membership | `toggleSymbolInList` |
| Chart popup | `tracked` → mode; `GalleryCardChartStore` or `ScannerChartStore` | `ensureBars` / historicals fetch |

## §7 Non-goals

- MONITOR/user lists in the row menu; bulk actions; universe enrollment
  (deferred — ADR-011); saved scans; proposal machinery.

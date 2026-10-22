# Implementation Plan — FE: Auto-Run Scans

**Topic:** RH Scanner  
**Topic Slug:** rh-scanner  
**Thread:** Auto-Run Scans  
**Thread Slug:** scanner-auto-run  
**Issue:** #1193  
**Thread Parent:** #1183  
**Topic Parent:** #1098  
**Domain:** SAVANT-TRADER  
**Type:** IMPL  
**Status:** Complete  
**Created:** 2026-10-21  
**Last Updated:** 2026-10-22  

## 1. Scope

Rebuild `trading/scanner` from single-recipe pick-and-run into an auto-run
overview: all 9 `SCANNER_RECIPES` fire `preview_scan` on page load (~1s
stagger), each recipe's results render as its own sortable table under one
page scrollbar, a 15-minute auto-refresh cycle runs while the page is open,
Run all re-fires the set, and each table gets a per-recipe refresh button.

No wire/contract changes — `previewScan({filters, columns})` is reused
as-is. Curation surfaces (compare panel, proposal history, Evaluate
tracked, recipe picker) leave the page; their store/service/component code
stays in the codebase unused.

## 2. Data layer

### Store additions — `stores/scanner.store.ts`

```ts
export interface RecipeRunState {
  status: 'idle' | 'loading' | 'success' | 'error';
  result: PreviewScanResult | null;
  ranAt: string | null;       // ISO
  errorKind: 'auth' | 'other' | null;
}

runs: Signal<Record<string, RecipeRunState>>   // keyed by recipe.id
authFailed: Signal<boolean>
runAllRecipes(): void        // stagger ~1s between recipe launches
refreshRecipe(id): void      // single call, no stagger
```

- `runAllRecipes` iterates `SCANNER_RECIPES`; each launch is scheduled
  `i * 1000ms` out (not awaited serially — overlap is fine, the stagger
  only spaces call starts). Each recipe's entry transitions
  `loading → success|error` independently.
- On success the entry stores `{status:'success', result, ranAt}` and
  clears `errorKind`. On failure: `status:'error'`, `errorKind` set from
  the client's auth-error detection; any `errorKind:'auth'` flips
  `authFailed` true.
- `refreshRecipe(id)` re-runs one recipe immediately.
- Runs map persists for the app's session (store lives at root); leaving
  and returning shows last results.
- Existing single-run `runScan`/`comparePrune`/proposal machinery:
  untouched, just unexercised by the page.

### Sort util — `utils/scanner-sort.util.ts` (pure, new)

```ts
export interface SortLevel { key: string; direction: 'asc' | 'desc'; }
sortRows(rows, levels, cellFor): rows   // chained comparator, stable
nextSortLevels(levels, key): SortLevel[]// add → asc → desc → remove
```

Mirrors the option-chart `SortLevel[]`/`compareByField` pattern
(`pages/option-chart/option-chart.component.ts`) but generic: `cellFor(row,
key)` resolves a column's value (ticker/instrument_id/instrument_type or
`row.columns[key]`). Numeric-aware compare: `Number()` both cells after
stripping `%`/`$`/commas (strict — a partial-parse like '1.5x' sinks as
unparseable rather than reading '1.5'; real wire values are numeric-like);
`NaN`/blank sorts last regardless of direction; falls back to
`localeCompare`.

## 3. Components

### `ScannerRecipeTableComponent` — `pages/scanner/scanner-recipe-table.component.ts` (new, dumb)

Inputs: `recipe: ScannerRecipe`, `run: RecipeRunState`, `tracked: Set<string>`.
Output: `refresh`.

- Header line: recipe title + blurb · `{deduped-rows} of {total_items}`
  (the rendered row count — a dropped/dupe wire ticker stays honest) ·
  `sorted_by` chip when present · ran-at time · refresh icon-button →
  emits `refresh`.
- Loading state: `status==='loading'` → spinner block; a stale result
  stays rendered during refresh (nine stacked tables must not collapse
  and jump on every refresh). `idle` shows the same queued block.
- `status==='error'` → component renders nothing (silent skip) — the page
  filters it out entirely rather than rendering an empty shell.
- Columns (fixed order): tracked badge (sortable — 1/0 membership),
  `ticker`, `instrument_id`, `instrument_type`, then all recipe-declared
  `columns` (visible ones in `order`), then undeclared wire keys as
  trailing extras — "every returned field" (PRD); extras suppression
  covers all declared names + canonical lookup targets + fixed-key
  collisions (case-insensitive — wire 'Symbol' never double-renders).
  Values: percentColumns → `N.N%`, blank → `—`, non-string → `String(v)`
  — shared `displayCell`/`dedupeScanRows`/`normScanSymbol` helpers in
  `scanner-rows.util`.
- Sort: `sortLevels` is `linkedSignal` seeded from `recipe.sort` — the
  catalog's "best first" contract holds until the user clicks; header
  click calls `nextSortLevels`; sorted headers show `{priority}{↑|↓}`
  badge — identical idiom to option-chart. Fixed fields sort too.
- Rows dedupe first-wins on the normalized ticker (NG0955-safe),
  same as today's `displayRows`.

### `ScannerComponent` — rewritten

```ts
ngOnInit:  store.runAllRecipes(); arm 15-min interval → runAllRecipes()
ngOnDestroy: clear interval
header:    'Run all' button (disabled while any run is loading) +
           'Last refresh HH:mm' text (max ranAt across runs)
body:      @for recipe of SCANNER_RECIPES — <app-scanner-recipe-table>
           [run]="store.runs()[recipe.id]" (refresh)=store.refreshRecipe(id)
banner:    store.authFailed() → existing AUTH reauth banner
```

Removed from template/ts: recipe picker, Run/Evaluate buttons, compare
panel, proposal history, `onFocusSymbol`/focused-row plumbing, single-run
status line. Component files for the compare panel stay on disk.

Tracked set: `store.trackedSymbols`/`loadTrackedSymbols` retained — badge
column needs it; loaded once on init alongside runAll.

## 4. File sketch

```
src/app/features/savant-trader/pages/scanner/
  scanner-recipe-table.component.{ts,html,scss,spec.ts}   NEW (task 1)
  scanner.component.{ts,html,scss}                        REWRITE (task 3)
  scanner.component.spec.ts                               REWRITE (task 3)
  scanner-compare-panel.component.*                       untouched (unused)
src/app/features/savant-trader/utils/
  scanner-sort.util.ts                                    NEW (task 1)
src/app/features/savant-trader/stores/
  scanner.store.ts                                        +runs/runAll/refresh (task 2)
  scanner.store.spec.ts                                   +run-all specs (task 2)
```

## 5. Tasks

| # | Task | Delivers | Blocked by |
|---|------|----------|------------|
| 1 | `scanner-recipe-table` + sort util | One recipe's full table: header w/ counts+refresh, all wire fields as columns, N-level click-cycle sort, loading/empty states | — |
| 2 | Store run-all machinery | `runs` map, `runAllRecipes` 1s stagger, `refreshRecipe`, per-recipe error isolation, `authFailed` | — |
| 3 | Page rebuild | `ngOnInit` runAll + 15-min timer + Run all + stacked tables + AUTH banner; picker/panel/history removed | 1, 2 |

## 6. Risks / notes

- **9-call fan-out:** staggered launches keep the MCP session serial-ish;
  still ~9 calls per cycle every 15 min while the page is open — accepted
  per PRD (user-picked cadence).
- **Sort on strings:** all wire cells are `string`; the numeric-aware
  comparator must handle `12.3%`-style recipe formatting *before* display
  formatting is applied — sort the raw row values, not rendered text.
- **instrument_id column:** RH opaque id — display as-is; user asked for
  all fields. If it's visually noisy it can hide by default later; spec
  says render.
- **Timer test seam:** page-owned interval → specs use jest fake timers or
  spy on the interval arm; do NOT use the `setTimeout` flush under fake
  timers (per AGENTS.md).
- **Verify relay:** `rh-scanner-recipes-1098` unchanged — still asserts the
  same catalog the page ships.

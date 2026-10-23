# Test Plan — FE: Auto-Run Scans

**Topic:** RH Scanner  
**Topic Slug:** rh-scanner  
**Thread:** Auto-Run Scans  
**Thread Slug:** scanner-auto-run  
**Issue:** #1193  
**Thread Parent:** #1183  
**Topic Parent:** #1098  
**Domain:** SAVANT-TRADER  
**Type:** TEST  
**Status:** Complete  
**Created:** 2026-10-21  
**Last Updated:** 2026-10-22  

Highest-value seams: the **sort util** (pure chained comparator over
string-typed wire cells) and the **store's runAll lifecycle** (stagger,
per-recipe isolation, authFailed). Component specs cover render states.

## E2E User Journeys

1. Open `trading/scanner` → all 9 recipes fire staggered → tables fill as
   calls return → each table shows its header metadata + all-field rows.
2. Click a column header → `1↑` (a `2↑` if the recipe's declared sort
   seeded level 1); click a second column → `1↑`,`2↑` chain; click the
   first again → `↓`; rows re-sort per the chain.
3. Wait/act at the 15-min boundary (or fake-timer) → the staggered set
   re-fires; click a table's refresh → only that recipe re-runs.
4. Auth-expired session → reauth banner shows; one recipe's non-auth
   failure → its table is absent, the rest render.

## Integration Tests (jest + TestBed)

### `scanner-recipe-table.component.spec.ts`

- Header renders title + blurb + `N of M` + `sorted_by` + ran-at
- Refresh button emits `refresh`
- Loading state while `run.status==='loading'`; nothing rendered on
  `'error'`
- All wire fields present as columns: ticker, instrument_id,
  instrument_type, all declared recipe columns; percentColumns → `%`,
  blank → `—`, non-string → `String(v)`; tracked badge per row
- Click-cycle sort: add→desc→remove, second column = tiebreak, numbered
  priority badges; sort applies to rendered rows
- First-wins dedupe on normalized ticker (NG0955 pin)

### `scanner.component.spec.ts` (rewrite)

- `ngOnInit` calls `runAllRecipes` + `loadTrackedSymbols`; arms the
  15-min interval (fake timers — no `setTimeout` flush under fakeTimers)
- `ngOnDestroy` clears the interval — no calls continue off-page
- One `<app-scanner-recipe-table>` per recipe in catalog order; page has
  a single vertical scroll region (no inner scroll traps)
- `Run all` calls `runAllRecipes`; disabled while any run is loading;
  shows last-refresh time from max ranAt
- `authFailed()` → existing reauth banner renders; per-table `(refresh)`
  wires to `store.refreshRecipe(id)`
- Gone: picker, Run/Evaluate, compare panel, proposal history,
  focused-row plumbing

### `scanner.store.spec.ts` (additions)

- `runAllRecipes` launches all 9 recipes ~1s apart (fake timers); each
  entry transitions loading→success independently
- Per-recipe rejection → `status:'error'`, `errorKind:'other'`,
  other recipes unaffected
- Auth-shaped error → `errorKind:'auth'` + `authFailed()===true`
- `refreshRecipe` re-runs one recipe only — other entries' results
  untouched
- `runAllRecipes` re-entry cancels the previous wave's un-launched slots
  and supersedes in-flight launches (remount/interval overlap must not
  double-fire or corrupt)
- `refreshRecipe` during the stagger consumes the recipe's armed slot —
  no double-fire
- Non-AUTH `RobinhoodMcpError` → `errorKind:'other'` (category decides,
  not the error type)
- Error entries retain prior `result`/`ranAt`; `runsLoading` stays true
  through armed-but-unfired gaps
- Results persist across page re-instantiation (store-level state)

### `scanner-sort.util.spec.ts`

- `nextSortLevels`: absent→asc, asc→desc, desc→removed; priority order
  preserved when mid-chain entry removed
- `sortRows`: numeric-aware on `%`/`$`/comma strings; blank/NaN last in
  both directions; stable for equal keys; secondary breaks primary ties

## Test Seams

- `RobinhoodMcpClient` / `ScannerService` mocked at the service boundary —
  specs never hit the live MCP path.
- Refresh interval is injectable/spyable — `jest.useFakeTimers()` +
  `advanceTimersByTime(15*60*1000)`; per AGENTS.md, the `setTimeout`
  microtask flush is banned under fake timers.
- Sort util is pure — no TestBed needed.
- Store specs reuse the existing spec's service mocks.

## Existing Coverage / Prior Art

- `option-chart.component.ts` — `SortLevel[]`/`onColumnSort`/
  `getSortInfo`/`compareByField` is the sort idiom this copies
- `scanner.component.spec.ts` (233-test suite incl. compare-panel specs) —
  the run/picker/compare/history specs get rewritten; tracked-badge,
  formatting, and auth-banner specs carry over
- `scanner.store.spec.ts` — existing mocks/fixtures reused for run-all
- `rh-scanner-recipes-1098` verify relay — unchanged; still the wire
  tripwire for the same catalog

## Edge Cases

- Recipe returns 0 rows → table renders header + empty state (not skipped —
  success with zero results is valid)
- `total_items > results.length` → header shows the true `N of M`
- A recipe's columns drift mid-session → unknown keys render blank, sort
  treats them as NaN-last
- All 9 fail → auth banner if auth-shaped, otherwise a page with zero
  tables + Run all still functional
- Interval fires while a previous cycle is still in-flight → overlapping
  cycles must not corrupt per-recipe state (last-write-wins per recipe)

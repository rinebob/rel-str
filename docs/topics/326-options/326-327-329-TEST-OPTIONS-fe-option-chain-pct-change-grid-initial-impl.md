**Topic:** Option chain percent change grid  
**Topic Slug:** option-chain-pct-change-grid<br>
**Thread:** Option chain percent change grid
**Thread Slug:** initial-impl<br>
**Issue:** #329  
**Thread Parent:** #327
**Topic Parent:** #326  
**Domain:** OPTIONS  
**Type:** Test Plan  
**Area:** FE  
**Status:** Draft  
**Created:** 2026-09-15  
**Last Updated:** 2026-09-15  

---

# Test Plan: Option chain percent change grid — FE

## E2E User Journeys

- Journey 1: User enters QQQ + start date + 1 target date + calls type
  → grid renders with correct rows (strikes), columns (expirations),
  and cell values (start price, target price, % change)
- Journey 2: User changes strike filter → grid recomputes without
  re-fetching (uses cached snapshots)
- Journey 3: User adds a second target date → two grids stacked vertically
- Journey 4: User switches from calls to puts → re-runs analysis with
  new type filter

## Integration Tests

- Store + Service: `runAnalysis()` calls service N+1 times in parallel,
  caches snapshots, computes grids
- Store + computePctChange: `recomputeGrids()` recomputes from cached
  snapshots with updated filters (no service calls)
- Component + Store: `PctChangeGridComponent` renders correct cell count
  from `PctChangeGrid` input
- Page + Store: input form updates store state, run button triggers
  `runAnalysis()`

## Unit Tests

### Pure functions (primary seam — `pct-change.utils.ts`)

- Contract present in both snapshots → correct `pctChange`
- Contract only in start snapshot → excluded
- Contract only in target snapshot → excluded
- Contract with missing/non-numeric `mark` in start → excluded
- Contract with missing/non-numeric `mark` in target → excluded
- Filter by type (calls) → only call contracts retained
- Filter by type (puts) → only put contracts retained
- Filter by duration range → only matching expirations retained
- Filter by strike range → only matching strikes retained
- Filter by delta range → only matching deltas retained
- No filters → all matching contracts retained
- Strikes sorted ascending in output
- Expirations sorted ascending in output
- p5/p95 percentiles computed correctly from the pctChange distribution
- Empty input chains → empty grid with no crashes
- All contracts excluded by filters → empty grid with no crashes

### Color mapping (secondary seam — `color-mapping.utils.ts`)

- `pctChange === 0` → neutral color
- `pctChange === p5` → max red
- `pctChange === p95` → max green
- `pctChange < p5` → clipped to max red
- `pctChange > p95` → clipped to max green
- `pctChange` between p5 and 0 → interpolated red-to-neutral
- `pctChange` between 0 and p95 → interpolated neutral-to-green
- Returns valid CSS color string

### Store

- `runAnalysis()` sets loading=true, fetches, sets loading=false
- `runAnalysis()` error sets error message, clears loading
- `recomputeGrids()` does not call service (uses cached snapshots)
- `canRun` computed signal returns false when inputs incomplete
- `hasResults` computed signal returns true when grids non-empty

## Test Seams

- **Highest seam: `computePctChange` pure function.** Input two synthetic
  chain arrays + filter options, output a `PctChangeGrid`. Contains all
  business logic (matching, % change, filtering, percentiles). Test with
  synthetic `HistoricalOptionContract[]` arrays — deterministic, no
  network, no Angular.
- **Secondary seam: `pctChangeToColor` pure function.** Input synthetic
  pctChange + bounds, output CSS color. No dependencies.
- **Component rendering: `PctChangeGridComponent` shallow test.** Input
  synthetic `PctChangeGrid`, assert rendered row/column/cell counts and
  background colors via `TestBed`.
- **Store: mock the service** and verify `runAnalysis()` / `recomputeGrids()`
  orchestration without network calls.

## Edge Cases

- Empty chain (no contracts for that date) → empty grid, no crash
- All contracts filtered out → empty grid, no crash
- Single contract → 1x1 grid
- Same start and target date → all pctChange = 0
- Very large chain (1000+ contracts) → grid renders without performance
  issues (test with synthetic data, may defer to manual verification)
- Negative pctChange (price dropped) → red cells
- Positive pctChange (price rose) → green cells
- `mark` is a string "0" → division by zero → exclude or handle gracefully

## Prior Art

- `heatmap-chart-heatmap.component` test pattern for CSS grid rendering
- `options-contract-viewer.store.ts` test pattern for signal store
- Existing `pct-change.utils` tests follow the pure-function test style
  used throughout the app (input → assert output, no mocks)

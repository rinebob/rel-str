**Topic:** Spread Time Series Viewer  
**Issue:** #77  
**Domain:** SPREAD-VIEWER  
**Type:** Test Plan  
**Status:** Draft (updated for ADR-004 redesign)  
**Created:** 2026-08-05  
**Last Updated:** 2026-08-08  

# Test Plan: Spread Time Series Viewer — FRONTEND

## E2E User Journeys

- Journey 1: User enters symbol → opens builder → dialog opens as 1200px three-column layout → selects "vertical" → picks entry date from filtered date picker → sees underlying price → picks call, expiration, 2 strikes → sets strike distance → secondary strike auto-computes → sees debit badge → clicks "Add to List" → count shows "1 spread" → clicks "Load" → dialog closes → chart shows loading → series populates → underlying overlay visible
- Journey 2: User builds 5 spreads → clicks "Load" → chart shows page 1 (spreads 1-20, but only 5 loaded) → pagination shows "1 of 1" → all 5 spreads rendered with different colors
- Journey 3: User builds 25 spreads → clicks "Load" → chart shows page 1 (spreads 1-20) → clicks "next" → chart shows page 2 (spreads 21-25) → clicks "prev" → back to page 1
- Journey 4: User toggles underlying overlay off → overlay disappears → toggles on → overlay reappears
- Journey 5: User loads spreads → one spread fails (SA error) → error indicator shown for that spread → other spreads render normally
- Journey 6: User opens builder → sets chart date range and strike range → clicks "Search Catalog" → catalog table populates → clicks a catalog row → form expiration and strike populate → entry date advances to firstObserved → clicks "Add to List" → spread appears in built-spreads table
- Journey 7: User opens builder → adds spreads to buffer → dirty indicator shows "Unsaved changes" → clicks "Save" → buffer persists to named list → dirty clears → clicks "Load" → chart updates
- Journey 8: User opens builder → makes changes without saving → clicks "Cancel" → confirm dialog prompts → confirms → dialog closes

## Integration Tests

**File:** `spread-chart-page.spec.ts`

- Page creates store and injects services correctly
- "Build Spreads" button opens builder dialog with `width: 1200px`
- Dialog close with Load triggers `store.loadSpreads()`
- Chart receives `plottedSpreads` from store
- Pagination controls update `plottedStartIndex` in store
- Underlying toggle updates `showUnderlying` in store
- Fullscreen mode set on init, reset on destroy (via `UiStateService`)

**File:** `spread-viewer-store.spec.ts`

- `setSymbol` loads contract index and underlying bars
- `addSpread` creates `Spread` with `status: PENDING` and adds to `spreads`
- `addSpread` calls `SpreadListService.addToRecent()`
- `loadSpreads` calls `SpreadService.submitSpreadRun$()` with pending definitions
- `loadSpreads` subscribes to `SpreadRunService` observables
- Job doc `SUCCESS` updates spread to `LOADED` with series data
- Job doc `PERMANENT_FAILURE` updates spread to `ERROR` with error message
- Run doc `COMPLETE` unsubscribes observables and clears `activeRunId`
- `nextPage` / `prevPage` adjust `plottedStartIndex` correctly
- `plottedSpreads` computed returns correct slice
- `allDates` computed returns union of dates across plotted spreads
- `hasPending` computed returns true when pending spreads exist
- `selectedListId`, `lastSavedSnapshot`, `chartDateRange`, `entryDate`, `strikeRange`, `selectedLengthBuckets` are initialized correctly
- `isDirty` returns true when buffer differs from `lastSavedSnapshot`
- `isDirty` returns false when buffer matches `lastSavedSnapshot`
- `availableEntryDates` returns dates from underlying bars within `chartDateRange`
- `underlyingPrice` returns close price for `entryDate`
- `advanceEntryDate('1d')` moves to next trading day in `availableEntryDates`
- `advanceEntryDate('1w')` moves 5 trading days forward
- `advanceEntryDate('1m')` moves ~21 trading days forward
- `openList` blocks when `activeRunId` is not null
- `saveCurrentList` persists buffer to selected list and updates `lastSavedSnapshot`
- `saveAsList` creates new named list and sets `selectedListId`
- `createNewList` creates empty list, clears buffer and snapshot
- `clearBuffer` removes all spreads from buffer
- `setChartDateRange`, `setStrikeRange`, `setLengthBuckets`, `setEntryDate` update state

**File:** `spread-builder.spec.ts`

- Dialog renders three-column layout with top bar, left filters, center form, right table, bottom actions
- Top bar shows named list dropdown, New/Save/Save As/Clear buttons, dirty indicator
- List dropdown populates from `store.namedLists()`
- "New" opens prompt, calls `store.createNewList()`, selects new list, clears buffer
- "Save" calls `store.saveCurrentList()` when a list is selected and dirty
- "Save As" opens prompt, calls `store.saveAsList()`
- "Clear" confirms, calls `store.clearBuffer()`
- Dirty indicator shows "Unsaved changes" when `store.isDirty()` is true
- Cancel prompts when dirty and closes dialog on confirm
- Load calls `store.loadSpreads()` and closes dialog independently of Save

### Named list controls

- `openList` populates buffer from named list and sets `lastSavedSnapshot`
- Dirty indicator shows after modifying buffer
- Save clears dirty
- Clear buffer shows confirmation and removes all rows from built-spreads table

### Catalog picker

- Chart date range pickers call `store.setChartDateRange(start, end)`
- Strike range inputs call `store.setStrikeRange(min, max)`
- Length bucket multi-select calls `store.setLengthBuckets(Set)`
- "Search Catalog" calls `OptionsContractService.queryContractCatalog$` with firstObservedGte/Lte, strikeGte/Lte, contractLengthBucket, type
- Loading state shows spinner while query in flight
- Error state displays message when query fails
- Empty state shows when no results
- Catalog table sorted by `firstObserved` ascending
- Catalog table columns: Type, Strike, Expiration, Length bucket, First Observed, Observation count
- Clicking catalog row sets `selectedExpiration`, `selectedOptionType`, primary strike, and `store.entryDate`

### Parametric form

- Entry date picker has `[matDatepickerFilter]` disabling dates not in `availableEntryDates`
- Underlying price display shows `store.underlyingPrice()` for selected entry date
- Spread type selector updates `selectedType` and resets strike fields
- Option type selector shows only for vertical spread type
- Expiration dropdown populates from contract index
- Strike distance input appears for vertical, strangle, iron condor; hidden for straddle and custom
- Strike distance auto-computes secondary strikes from primary strike:
  - Vertical: [primary, primary + distance]
  - Strangle: [primary - distance, primary + distance]
  - Iron Condor: [primary - 2*distance, primary - distance, primary + distance, primary + 2*distance]
- Straddle: single strike field (no distance input)
- Custom: manual leg table (no distance input)
- Strike selectors validate against `availableStrikes()`
- "Advance 1D" calls `store.advanceEntryDate('1d')` and updates underlying price
- "Advance 1W" calls `store.advanceEntryDate('1w')`
- "Advance 1M" calls `store.advanceEntryDate('1m')`
- Catalog row click auto-scrolls table to contract closest to computed secondary strike
- Debit/credit badge updates live from leg arrangement
- "Add to List" creates `SpreadDefinition` with `entryDate` and calls `store.addSpread()`
- "Add to List" resets strikes but keeps symbol and expiration

### Built-spreads table

- Table renders `store.spreads()` reactively
- Columns: Type, Expiration, Legs, Entry date, DTE, Debit/Credit, Status
- Empty state shows when buffer is empty
- Clone action loads spread into form fields
- Delete action removes spread from buffer
- Row count matches `store.spreads().length`

**File:** `spread-chart.spec.ts`

- Chart renders one line series per spread in `plottedSpreads`
- Category axis labels show dates from `allDates`
- X-axis extent snaps to first date of first spread and last date of last spread
- Underlying overlay renders on secondary Y-axis when `showUnderlying` is true
- Underlying overlay hidden when `showUnderlying` is false
- Color palette repeats every 5-6 series
- Series labels formatted as `{spreadType} {optionType} {debit|credit} {expiration} {longStrike}/{shortStrike}`
- Crosshair tooltip shows on hover
- Empty `plottedSpreads` renders blank chart without errors

## Unit Tests

**File:** `spread-builder-dialog.component.spec.ts`

- Component creates with mocked store, services, and MatDialogRef
- Spread type config maps to correct `strikeDistanceApplies` values
- `formatLegs` returns compact leg string (e.g. "C 450 / C 455")
- `formatDte` returns days between `entryDate` and first leg expiration
- `formatStatus` returns uppercase status string
- `computeStrikesFromDistance` updates `selectedStrikes` per spread type
- `onCatalogRowClick` sets form fields from catalog entry
- `onSearchCatalog` builds request from store filters and updates `catalogResults`
- `onAddToList` builds `SpreadDefinition` and calls `store.addSpread()`

**File:** `spread-viewer-store.spec.ts`

- `cloneSpreadDefinition` strips undefined fields and deep-clones values
- `isDirty` uses shallow length check before JSON.stringify

## Test Seams

- **Highest seam:** Page component test harness — renders page with mocked services, simulates user interactions
- **Mid seam:** Store test — injects mocked services, verifies state transitions and method calls
- **Lower seams:** Service tests with mocked `httpsCallable` / `Firestore` / `Auth`
- **Lowest seam:** Builder component test with mocked `OptionsCommonService` for dropdown data

## Existing Test Coverage

- 36 existing `.spec.ts` files in `src/` as pattern reference
- `OptionsContractViewerStore` tests as store pattern reference
- `OptionsContractChartComponent` tests as chart pattern reference
- `OptionChartComponent` tests as page pattern reference

## Edge Cases

- **Empty state:** No spreads loaded — chart area shows placeholder, pagination disabled
- **Loading state:** Spreads with `status: LOADING` — show spinner in list, not rendered on chart
- **Error state:** Spreads with `status: ERROR` — show error icon and message in list
- **Partial failure:** Some spreads loaded, some errored — chart renders loaded ones, error indicators for others
- **Single spread:** Only 1 spread loaded — chart renders 1 line, pagination shows "1 of 1"
- **More than page length:** 25 spreads, page length 20 — page 1 shows 20, page 2 shows 5
- **No underlying data:** `underlyingStatus: 'error'` — overlay toggle disabled with error tooltip
- **Contract index loading:** Builder dropdowns disabled while `contractIndexStatus: 'loading'`
- **Contract index error:** Builder shows error message, dropdowns empty
- **Dialog reopen:** User closes dialog, reopens — previously added spreads still in store
- **Rapid page navigation:** Clicking next/prev quickly — no render glitches
- **Unsaved changes on close:** Cancel prompts user, cancel keeps dialog open, confirm closes
- **Open list during run:** `openList` blocks and warns when a run is in progress
- **Empty named list:** New list starts empty, dirty false, Save disabled

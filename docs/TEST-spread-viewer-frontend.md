**Topic:** Spread Time Series Viewer  
**Issue:** #77  
**Domain:** SPREAD-VIEWER  
**Type:** Test Plan  
**Status:** Draft  
**Created:** 2026-08-05  
**Last Updated:** 2026-08-05  

# Test Plan: Spread Time Series Viewer — FRONTEND

## E2E User Journeys

- Journey 1: User enters symbol → opens builder → selects "vertical" → picks call, expiration, 2 strikes → sees debit badge → clicks "Add to List" → count shows "1 spread" → clicks "Load" → dialog closes → chart shows loading → series populates → underlying overlay visible
- Journey 2: User builds 5 spreads → clicks "Load" → chart shows page 1 (spreads 1-20, but only 5 loaded) → pagination shows "1 of 1" → all 5 spreads rendered with different colors
- Journey 3: User builds 25 spreads → clicks "Load" → chart shows page 1 (spreads 1-20) → clicks "next" → chart shows page 2 (spreads 21-25) → clicks "prev" → back to page 1
- Journey 4: User toggles underlying overlay off → overlay disappears → toggles on → overlay reappears
- Journey 5: User loads spreads → one spread fails (SA error) → error indicator shown for that spread → other spreads render normally

## Integration Tests

**File:** `spread-chart-page.spec.ts`

- Page creates store and injects services correctly
- "Build Spreads" button opens builder dialog
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

**File:** `spread-run.service.spec.ts`

- `watchRun$` emits run doc data on snapshot update
- `watchRunJobs$` emits job docs array on snapshot update
- Subscriptions are cleaned up on unsubscribe
- Service does not leak Firestore listeners

**File:** `spread.service.spec.ts`

- `submitSpreadRun$` calls `httpsCallable` with correct callable name
- `submitSpreadRun$` maps response to `{ runId }` shape
- Error from callable propagates as RxJS error

## Unit Tests

**File:** `spread-builder.spec.ts`

- Vertical form: selecting call locks optionType, expiration dropdown populates, 2 strike dropdowns populate filtered by expiration
- Vertical form: debit badge shows "Debit" for long lower strike call, "Credit" for short lower strike call
- Straddle form: single strike dropdown, both legs auto-created (long call + long put)
- Straddle form: debit badge shows "Debit" (long both legs)
- Strangle form: put strike + call strike dropdowns, put strike < call strike validation
- Iron condor form: 4 strike dropdowns, ordered validation (put_long < put_short < call_short < call_long)
- Iron condor form: debit badge shows "Credit" (always credit structure)
- Custom mode: leg table with add/remove rows, each row has optionType/strike/expiration/side
- Custom mode: adding a leg that doesn't match a known type keeps type as "custom"
- "Add to List" creates `SpreadDefinition` from form values and calls `store.addSpread()`
- "Add to List" resets form but keeps symbol and expiration
- "Load" calls `store.loadSpreads()` and closes dialog
- Running count displays correct number of added spreads
- Date range fields are optional, default to undefined (full life)

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

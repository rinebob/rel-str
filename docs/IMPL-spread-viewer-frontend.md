**Topic:** Spread Time Series Viewer  
**Issue:** #77  
**Domain:** SPREAD-VIEWER  
**Type:** Implementation Plan  
**Status:** Draft (refined 2026-08-07 — spread builder dialog redesign, see ADR-004)  
**Created:** 2026-08-05  
**Last Updated:** 2026-08-07  

# Implementation Plan: Spread Time Series Viewer — FRONTEND

## Overview

Angular frontend for the Spread Time Series Viewer: services, store, builder dialog, chart component, and page. Follows existing rh-agent feature patterns.

## Components

### 1. `src/app/features/rh-agent/services/options-common.service.ts` (new)

Shared service holding `getContractIndex$` — extracted from `OptionsContractService` for use by both the contract viewer and spread viewer.

```typescript
@Injectable({ providedIn: 'root' })
export class OptionsCommonService {
  private functions = inject(Functions);

  getContractIndex$(symbol: string): Observable<ExpirationStrikeIndex> {
    return httpsCallable(this.functions, CallableName.GET_OPTIONS_CONTRACT_INDEX)
      ({ symbol })
      .pipe(map(result => result as ExpirationStrikeIndex));
  }
}
```

**Note:** `OptionsContractService` retains its `getContractIndex$` method for now (cleanup task to remove later and delegate to `OptionsCommonService`).

### 2. `src/app/features/rh-agent/services/spread.service.ts` (new)

Thin wrapper around the `submitSpreadRun` callable.

```typescript
@Injectable({ providedIn: 'root' })
export class SpreadService {
  private functions = inject(Functions);

  submitSpreadRun$(spreads: SpreadDefinition[]): Observable<{ runId: string }> {
    return httpsCallable(this.functions, CallableName.SUBMIT_SPREAD_RUN)
      ({ spreads })
      .pipe(map(result => result as { runId: string }));
  }
}
```

### 3. `src/app/features/rh-agent/services/spread-run.service.ts` (new)

Manages `onSnapshot` subscriptions on `spread-runs/{runId}` and `spread-runs/{runId}/jobs` subcollection. Emits RxJS observables to the store.

```typescript
@Injectable({ providedIn: 'root' })
export class SpreadRunService {
  private firestore = inject(Firestore);

  // Emits run progress (counts + status)
  watchRun$(runId: string): Observable<SpreadRunDoc> {
    const ref = doc(this.firestore, `${Collection.SPREAD_RUNS}/${runId}`);
    return from(docSnapshots(ref)).pipe(
      map(snap => snap.data() as SpreadRunDoc),
      takeUntil(/* completed signal from store */),
    );
  }

  // Emits per-spread job results as they arrive
  watchRunJobs$(runId: string): Observable<SpreadJobDoc[]> {
    const ref = collection(this.firestore, `${Collection.SPREAD_RUNS}/${runId}/jobs`);
    return from(collectionSnapshots(ref)).pipe(
      map(snaps => snaps.map(s => s.data() as SpreadJobDoc)),
    );
  }
}
```

**Cleanup:** Store manages subscription lifecycle — calls `unsubscribe()` when run is complete or on component destroy.

### 4. `src/app/features/rh-agent/services/spread-list.service.ts` (new)

Firestore CRUD for spread list persistence. Reads/writes `spread-lists/{listId}` directly.

```typescript
@Injectable({ providedIn: 'root' })
export class SpreadListService {
  private firestore = inject(Firestore);
  private auth = inject(Auth);

  private get userId(): string {
    return this.auth.currentUser?.uid ?? '';
  }

  loadNamedLists$(): Observable<SpreadListDoc[]> { /* query user's named lists */ }
  loadRecentList$(): Observable<SpreadDefinition[]> { /* read doc id 'recent' */ }
  saveList(name: string, spreads: SpreadDefinition[]): Promise<void> { /* create/update */ }
  addToRecent(spread: SpreadDefinition): Promise<void> { /* upsert, evict oldest beyond 10 */ }
  deleteList(listId: string): Promise<void> { /* delete doc */ }
}
```

### 5. `src/app/features/rh-agent/stores/spread-viewer.store.ts` (new)

NgRx SignalStore managing all spread viewer state.

**State:**

```typescript
interface SpreadViewerState {
  symbol: string | null;
  startDate: string | null;
  endDate: string | null;
  contractIndex: ExpirationStrikeIndex | null;
  contractIndexStatus: 'idle' | 'loading' | 'loaded' | 'error';
  spreads: Spread[];
  underlyingBars: OHLCDatum[];
  underlyingStatus: 'idle' | 'loading' | 'loaded' | 'error';
  activeRunId: string | null;
  runProgress: { total: number; succeeded: number; failed: number } | null;
  plottedStartIndex: number;
  plottedPageLength: number;   // default 20
  showUnderlying: boolean;
  chartMode: 'absolute' | 'normalized';
}
```

**Computed signals:**
- `pendingSpreads` — `spreads.filter(s => s.status === SpreadStatus.PENDING)`
- `loadedSpreads` — `spreads.filter(s => s.status === SpreadStatus.LOADED)`
- `plottedSpreads` — `loadedSpreads.slice(plottedStartIndex, plottedStartIndex + plottedPageLength)`
- `allDates` — union of dates across `plottedSpreads`
- `hasPending` — `pendingSpreads.length > 0`

**Methods:**
- `setSymbol(symbol)` — sets symbol, loads contract index + underlying bars
- `addSpread(definition: SpreadDefinition)` — creates `Spread` with `status: PENDING`, adds to `spreads`, calls `SpreadListService.addToRecent()`
- `loadSpreads()` — calls `SpreadService.submitSpreadRun$()` with all pending definitions, sets `activeRunId`, subscribes to `SpreadRunService` observables, updates spreads as job results arrive
- `nextPage()` / `prevPage()` — adjust `plottedStartIndex`
- `toggleUnderlying()` — flips `showUnderlying`
- `setChartMode(mode)` — sets `chartMode`

**Run observation flow:**
1. `loadSpreads()` sets all pending spreads to `status: LOADING`
2. Subscribes to `watchRun$(runId)` — updates `runProgress`
3. Subscribes to `watchRunJobs$(runId)` — for each job doc:
   - If `status === SUCCESS`: find spread by index, set `status: LOADED`, populate `series`, `debitOrCredit`, `gaps`, `legMetadata`
   - If `status === PERMANENT_FAILURE`: find spread by index, set `status: ERROR`, populate `error`
4. When run doc `status === COMPLETE || PARTIAL`: unsubscribe both, clear `activeRunId`

### 6. `src/app/features/rh-agent/components/spread-builder-dialog/` (redesigned 2026-08-07, ADR-004)

Material dialog component for constructing spreads. **Three-column wide dialog** (~1200px+) with dialog-scoped density styling.

**Files:**
- `spread-builder-dialog.component.ts`
- `spread-builder-dialog.component.html`
- `spread-builder-dialog.component.scss`

**Layout (three columns + top bar + bottom bar):**

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ Top Bar: [List dropdown ▼] [New List] [Save] [Save As] [Clear]  ● Unsaved  │
├──────────────────┬──────────────────────┬───────────────────────────────────┤
│ Left Column      │ Center Column        │ Right Column                      │
│                  │                      │                                   │
│ Filters:         │ Spread Form:         │ Built-Spreads Table:              │
│ - Chart date     │ - Spread type        │ ┌──┬──────┬─────┬──────┬───────┐ │
│   range (pickers)│ - Option type        │ │T │ Exp  │Legs │Entry │D/D-C/S│ │
│ - Strike range   │ - Entry date (picker)│ ├──┼──────┼─────┼──────┼───────┤ │
│   (min/max)      │ - Underlying price  │ │  │      │     │      │       │ │
│ - Length bucket  │   (display)          │ │  │      │     │      │       │ │
│   dropdown       │ - Strike distance   │ │  │      │     │      │       │ │
│                  │ - Strikes (autocomplete)│  │      │     │      │       │ │
│ Catalog Table:   │ - Expiration (auto)  │ └──┴──────┴─────┴──────┴───────┘ │
│ ┌──┬──────┬─────┐│ - Debit/credit badge │ Row actions: [Clone] [Delete]     │
│ │T │Strike│ Exp ││                      │                                   │
│ ├──┼──────┼─────┤│ [Add to List]        │                                   │
│ │  │      │     ││ [Adv 1D][Adv 1W][Adv 1M]│                              │
│ └──┴──────┴─────┘│                      │                                   │
│ + Len, FirstObs, │                      │                                   │
│   Obs columns    │                      │                                   │
├──────────────────┴──────────────────────┴───────────────────────────────────┤
│ Bottom Bar: [Cancel] [Load]                                                 │
└─────────────────────────────────────────────────────────────────────────────┘
```

**Left Column — Filters + Catalog Table:**
- Chart date range: two Material date pickers (start/end). Filters underlying bars client-side and drives entry date picker's available dates.
- Strike range: min/max number inputs. Filters catalog query (`strikeGte`/`strikeLte`).
- Length bucket dropdown: multi-select grouped Short/Medium/Long (reuses `contract-length.utils.ts` pattern from option-chart). Filters catalog query (`contractLengthBucket`).
- "Search Catalog" button: queries `queryContractCatalog` callable with all filters.
- Catalog table columns: Type, Strike, Expiration, Length bucket, **First Observed** (new display column — data already in `ContractCatalogEntry`), Observation count.
- Clicking a catalog row populates the form's expiration + strike fields.
- Table sorted by first-observed date.

**Center Column — Spread Form (Parametric Template):**
- Spread type selector (vertical, straddle, strangle, iron_condor, custom)
- Option type selector (vertical only)
- Entry date: Material date picker with `matDatepickerFilter` disabling non-trading days (dates not in underlying bars within chart date range)
- Underlying price: read-only display, looked up from underlying bars for the selected entry date
- Strike distance: number input. Auto-computes secondary strikes from primary. Type-specific:
  - Vertical: long strike + distance → short strike
  - Straddle: no distance field (single strike)
  - Strangle: ATM ± distance (symmetric)
  - Iron Condor: ATM ± distance, ± 2×distance (symmetric wings)
  - Custom: no distance field (manual legs)
- Strikes: `mat-autocomplete` inputs (typeahead) instead of `mat-select` dropdowns. Validates against available strikes from contract index.
- Expiration: auto-filled from catalog row click, or `mat-autocomplete` input. Validates against available expirations.
- Debit/credit badge: read-only, computed structurally from leg arrangement, updates live
- "Add to List" button: appends `SpreadDefinition` to working buffer (store). Form values stay populated (user can tweak for next spread).
- "Advance 1 Day / 1 Week / 1 Month" buttons: move entry date forward by offset, update underlying price display, scroll catalog table to contract closest to new entry date + underlying price. Does NOT add to list — user reviews then clicks "Add to List".
- Strike distance auto-scroll: when user picks long leg from catalog, table auto-scrolls to row at `long strike + distance` (or `− distance`).

**Right Column — Built-Spreads Table (Working Buffer):**
- Table columns: Type, Expiration, Legs (compact, e.g., "C 450/455"), Entry date, DTE (derived: `expiration − entryDate`), Debit/Credit, Status (PENDING/LOADED/ERROR)
- Row actions: Clone (loads spread into form for editing), Delete (removes from buffer)
- Clone → form → "Add to List" always inserts as a new row (no in-place overwrite)

**Top Bar — Named List Controls:**
- List dropdown: select from user's named lists (`SpreadListService.loadNamedLists$`)
- "New List" button: creates a new named list, sets as `selectedListId`, clears `lastSavedSnapshot`
- "Save" button: persists working buffer to selected named list (`SpreadListService.saveList`), updates `lastSavedSnapshot`, clears dirty
- "Save As" button: prompts for name, creates new named list, persists buffer, sets as `selectedListId`
- "Clear" button: clears working buffer (with confirmation)
- Dirty indicator: "● Unsaved changes" when buffer ≠ `lastSavedSnapshot`. Computed via `JSON.stringify` comparison.

**Bottom Bar — Actions:**
- "Cancel" button: closes dialog. If dirty, prompts "You have unsaved changes. Close anyway?"
- "Load" button: calls `store.loadSpreads()` with working buffer, closes dialog. Independent of Save.

**Density Styling (dialog-scoped):**
- `.spread-builder-dialog` wrapper class on dialog content
- SCSS overrides Material component sizing variables within scope:
  - `--mat-form-field-container-vertical-padding` — reduced
  - `--mat-form-field-container-height` — shorter
  - `.mat-mdc-form-field-subscript-wrapper` — hidden (no hints in this dialog)
  - Font sizes on labels, inputs, select triggers — smaller
  - Button height/padding — reduced
  - Table row height and cell padding — compact
- No global theme change. Full design system deferred to future topic.

**Store changes (`SpreadViewerState`):**
- Add: `selectedListId: string | null`, `lastSavedSnapshot: SpreadDefinition[] | null`, `chartDateRange: { start: string | null, end: string | null }`, `entryDate: string | null`, `strikeRange: { min: number | null, max: number | null }`, `selectedLengthBuckets: Set<string>`
- Change: `underlyingBars` fetched as full dataset (remove hardcoded 730-day window), filtered client-side to `chartDateRange`
- Computed: `isDirty` (buffer ≠ snapshot), `availableEntryDates` (from underlying bars within chart date range), `underlyingPrice` (close on `entryDate`)
- Methods: `openList(listId)`, `saveCurrentList()`, `saveAsList(name)`, `clearBuffer()`, `setChartDateRange(start, end)`, `setStrikeRange(min, max)`, `setLengthBuckets(set)`, `setEntryDate(date)`, `advanceEntryDate(offset)`, `cloneSpreadToForm(spreadId)`, `deleteSpreadFromBuffer(spreadId)`

**Spread type leg config (config-driven, updated):**

```typescript
interface SpreadTypeConfig {
  type: SpreadType;
  legCount: number;
  optionTypeConstraint: 'single' | 'both' | 'none';
  expirationConstraint: 'same' | 'none';
  strikeConstraint: 'distinct' | 'same' | 'distinct_ordered' | 'none';
  autoAssignSides: boolean;
  strikeDistanceApplies: boolean;  // new — whether strike distance field is shown
  computeStrikes: (primaryStrike: number, distance: number, optionType: OptionType) => SpreadLeg[];  // new
}
```

### 7. `src/app/features/rh-agent/components/spread-chart/` (new)

Multi-series chart component using Syncfusion EJ2.

**Files:**
- `spread-chart.component.ts`
- `spread-chart.component.html`
- `spread-chart.component.scss`

**Behavior:**
- Receives `plottedSpreads: Spread[]` and `allDates: string[]` as inputs
- Renders one line series per spread
- **Category axis** (not date axis) with dates as category labels — sequential plotting to avoid weekend/holiday gaps
- X-axis extent: first date of first spread to last date of last spread (union)
- Underlying overlay on secondary Y-axis (toggleable via `showUnderlying` input)
- 5-6 color repeating palette: `COLORS[index % COLORS.length]`
- Series labels: `{spreadType} {optionType} {debit|credit} {expiration} {longStrike}/{shortStrike}`
- Crosshair tooltip on hover
- `onAxisLabelRender` for date formatting

### 8. `src/app/features/rh-agent/pages/spread-chart/` (new)

Page component hosting the builder dialog and chart.

**Files:**
- `spread-chart.component.ts`
- `spread-chart.component.html`
- `spread-chart.component.scss`

**Behavior:**
- Symbol input field (sets store symbol)
- "Build Spreads" button — opens builder dialog
- Chart area — renders `spread-chart` component with store signals
- Pagination controls — prev/next buttons, page indicator
- Underlying toggle
- Chart mode toggle (absolute/normalized)
- Loading indicators for spreads with `status: LOADING`
- Error display for spreads with `status: ERROR`
- Fullscreen mode (via `UiStateService`, same as `OptionChartComponent`)

### 9. `src/app/core/core-routes.ts` (modified)

Add spread chart route:

```typescript
{
  path: AppRoutes.SPREAD_CHART,
  loadComponent: () => import('./features/rh-agent/pages/spread-chart/spread-chart.component')
    .then(m => m.SpreadChartComponent),
  canActivate: [authGuard],
  title: 'Spread Chart',
},
```

### 10. `src/app/features/rh-agent/index.ts` (modified)

Export the spread chart page component.

## Dependencies

- `@options/common` and `@spread/contracts` (from SHARED area)
- `submitSpreadRun` callable (from BE area)
- `spread-runs` Firestore collection (from BE area)
- `RhAgentChartService` (existing — underlying bars)
- `OptionsCommonService` (new — contract index)
- `UiStateService` (existing — fullscreen)
- Syncfusion EJ2 Angular Charts (existing dependency)
- Angular Material (existing dependency — dialog, form fields, buttons)

## Cross-Area Boundaries

- Calls `submitSpreadRun` callable via `SpreadService`
- Observes `spread-runs` Firestore collection via `SpreadRunService`
- Reads/writes `spread-lists` Firestore collection via `SpreadListService`
- Reads `symbol-data` Firestore collection via `RhAgentChartService`
- Calls existing `GET_OPTIONS_CONTRACT_INDEX` callable via `OptionsCommonService`

## Risks

- **onSnapshot listener management:** Must properly unsubscribe when run completes or component destroys. Leaked listeners will cause memory leaks and unnecessary Firestore reads.
- **Chart performance with 20 series:** Syncfusion may struggle with 20 line series × 500+ data points each. May need to enable `enableAnimation: false` and `enableRtlSupport` for performance.
- **Builder dialog complexity:** 4 spread type forms + custom mode is a lot of UI logic. Config-driven approach mitigates this, but the custom mode leg table needs careful validation.

## Implementation Order

1. Create `OptionsCommonService` with `getContractIndex$`
2. Create `SpreadService` with `submitSpreadRun$`
3. Create `SpreadRunService` with `onSnapshot` observables
4. Create `SpreadListService` with Firestore CRUD
5. Create `SpreadViewerStore` with state, computed signals, and methods
6. Add route for spread chart page
7. Create spread chart component (chart rendering)
8. Create spread builder dialog (form + validation + debit/credit badge)
9. Create spread chart page (host dialog + chart + pagination controls)
10. Wire up fullscreen mode via `UiStateService`

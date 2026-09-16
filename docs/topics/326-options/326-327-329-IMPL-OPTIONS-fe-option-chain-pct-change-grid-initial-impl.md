**Topic:** Option chain percent change grid  
**Topic Slug:** option-chain-pct-change-grid<br>
**Thread:** Option chain percent change grid
**Thread Slug:** initial-impl<br>
**Issue:** #329  
**Thread Parent:** #327
**Topic Parent:** #326  
**Domain:** OPTIONS  
**Type:** Implementation Plan  
**Area:** FE  
**Status:** Draft  
**Created:** 2026-09-15  
**Last Updated:** 2026-09-15  

---

## Scope

The FE area covers the service method, NgRx signal store, pure
computation utilities, grid component, page component, and routing.
This is the bulk of the feature work.

## Modules

### 1. FE service method

Add to `src/app/features/savant-trader/services/options-contract.service.ts`:

```ts
/** Fetch the full historical options chain snapshot for a symbol+date. */
getHistoricalOptionsChain$(symbol: string, date: string): Observable<GetHistoricalOptionsChainResponse> {
  const sym = symbol.trim().toUpperCase();
  const dt = date.trim();
  if (!sym || !dt) return throwError(() => new Error('symbol and date are required'));
  const callable = httpsCallable(this.functions, CallableName.GET_HISTORICAL_OPTIONS_CHAIN);
  return defer(() => from(callable({ symbol: sym, date: dt }) as Promise<{ data: GetHistoricalOptionsChainResponse }>)
    .then(r => r.data));
}
```

Follows the existing `defer` + `from` + `httpsCallable` + `map` pattern
used by `getHistoricalOptionsContract$()`.

### 2. Pure computation utilities

Location: `src/app/features/savant-trader/pages/option-chain-pct-change/utils/`

Co-located with the feature that uses them, matching the existing
pattern (`heatmap-chart-alignment.util.ts` lives inside `heatmap-chart/`).

#### 2a. `pct-change.utils.ts` — primary business-logic seam

```ts
export interface PctChangeCell {
  contractID: string;
  strike: number;
  expiration: string;
  delta: number;
  startPrice: number;
  targetPrice: number;
  pctChange: number;
}

export interface PctChangeGrid {
  targetDate: string;
  durationDays: number;
  strikes: number[];      // sorted ascending
  expirations: string[];  // sorted ascending
  cells: Map<string, PctChangeCell>; // key = `${strike}-${expiration}`
  p5: number;  // 5th percentile of pctChange
  p95: number; // 95th percentile of pctChange
}

export interface PctChangeFilter {
  type: 'call' | 'put';
  durationGteDays?: number;
  durationLteDays?: number;
  strikeGte?: number;
  strikeLte?: number;
  deltaGte?: number;
  deltaLte?: number;
}

export function computePctChange(
  startChain: HistoricalOptionContract[],
  targetChain: HistoricalOptionContract[],
  startDate: string,
  targetDate: string,
  filter: PctChangeFilter,
): PctChangeGrid
```

Logic:
1. Index start chain by `contractID` → `Map<contractID, HistoricalOptionContract>`
2. Index target chain by `contractID` → `Map<contractID, HistoricalOptionContract>`
3. For each contractID present in BOTH:
   - Read `mark` from both (skip if missing or non-numeric)
   - Compute `pctChange = (targetMark - startMark) / startMark * 100`
   - Read `strike`, `expiration`, `delta` from the start snapshot
   - Apply filters (type, duration, strike, delta)
   - Build `PctChangeCell`
4. Collect unique strikes (sorted ascending) and expirations (sorted ascending)
5. Compute p5/p95 percentiles of the pctChange distribution
6. Return `PctChangeGrid`

**Duration filter:** Duration = days from start date to expiration.
Filter by `durationGteDays` / `durationLteDays`. Contracts with
expirations outside the range are excluded.

**Delta filter:** Delta read from start-date snapshot. Filter by
`deltaGte` / `deltaLte` on the absolute value of delta.

#### 2b. `color-mapping.utils.ts` — secondary seam

```ts
export function pctChangeToColor(pctChange: number, p5: number, p95: number): string
```

Logic:
- Clip `pctChange` to `[p5, p95]`
- Map to diverging scale: p5 → max red, 0 → neutral, p95 → max green
- Interpolate linearly between
- Return CSS color string (e.g., `rgb(r, g, b)`)

### 3. NgRx signal store

Location: `src/app/features/savant-trader/pages/option-chain-pct-change/option-chain-pct-change.store.ts`

Follows the existing `options-contract-viewer.store.ts` pattern.

**State:**
```ts
interface OptionChainPctChangeState {
  // Inputs
  symbol: string;
  startDate: string;
  targetDates: string[];      // user-entered, 1..N
  type: 'call' | 'put';
  filter: PctChangeFilter;

  // Fetch state
  loading: boolean;
  error: string | null;

  // Cached snapshots (keyed by date) — kept in-memory for filter recompute
  startSnapshot: HistoricalOptionContract[] | null;
  targetSnapshots: Map<string, HistoricalOptionContract[]>;

  // Computed grids (keyed by target date)
  grids: PctChangeGrid[];
}
```

**Decision: cache snapshots in-memory.** Chain snapshots are expensive
to fetch (live AV call, ~10-30s each). If the user changes filters
(strike range, delta range) without changing dates, the store recomputes
grids from the cached snapshots without re-fetching. This is critical
for interactive iteration (user story 16).

**Methods:**
- `runAnalysis()` — fetches N+1 snapshots in parallel (forkJoin),
  caches them, computes grids
- `recomputeGrids()` — recomputes grids from cached snapshots with
  current filters (no fetch)
- `setSymbol()`, `setStartDate()`, `addTargetDate()`, `removeTargetDate()`,
  `setType()`, `setFilter()` — input setters
- `reset()` — clear all state

**Computed signals:**
- `hasResults` — grids.length > 0
- `canRun` — symbol, startDate, targetDates all non-empty

### 4. Grid component

Location: `src/app/features/savant-trader/pages/option-chain-pct-change/components/pct-change-grid.component.ts`

Custom CSS grid — standalone Angular component using CSS grid/flexbox.
No charting dependency. Follows the existing
`heatmap-chart-heatmap.component` pattern (divs with
`[style.background-color]`).

**Inputs:**
```ts
@Input() grid: PctChangeGrid;
```

**Template structure:**
```html
<div class="grid-header">
  {{ grid.targetDate }} ({{ grid.durationDays }}d from start)
</div>
<div class="grid-body" [style.grid-template-columns]="'auto repeat(' + grid.expirations.length + ', 1fr)'">
  <!-- Header row: expiration columns -->
  <!-- Body rows: one per strike -->
  <!-- Each cell: div with [style.background-color] + start/target/pct text -->
</div>
```

Each cell displays:
- Starting price
- Target price
- Percentage change
- Background color from `pctChangeToColor(pctChange, p5, p95)`

Hover tooltip shows full contract details (contractID, strike,
expiration, delta, start price, target price, % change).

### 5. Page component

Location: `src/app/features/savant-trader/pages/option-chain-pct-change/option-chain-pct-change.component.ts`

**Layout:**
- Left panel: input form (symbol, start date, target dates, type, filters)
- Right panel: stacked grids (one per target date), loading/error states

**Template:**
```html
<div class="pct-change-page">
  <div class="input-panel">
    <!-- Symbol input -->
    <!-- Start date picker -->
    <!-- Target dates (add/remove) -->
    <!-- Type toggle (calls/puts) -->
    <!-- Filter inputs (duration range, strike range, delta range) -->
    <!-- Run button -->
  </div>
  <div class="results-panel">
    @if (loading()) { <mat-spinner /> }
    @else if (error()) { <div class="error">{{ error() }}</div> }
    @else {
      @for (grid of store.grids(); track grid.targetDate) {
        <app-pct-change-grid [grid]="grid" />
      }
    }
  </div>
</div>
```

### 6. Routing

Add to `src/app/core/common/interfaces.ts`:
```ts
OPTION_CHAIN_PCT_CHANGE = 'option-chain-pct-change',
```

Add to `core-routes.ts`:
```ts
{
  path: AppRoutes.OPTION_CHAIN_PCT_CHANGE,
  canActivate: [authGuard],
  loadComponent: () => import('./features/savant-trader/pages/option-chain-pct-change/option-chain-pct-change.component')
    .then(m => m.OptionChainPctChangeComponent),
},
```

Add to navigation menu (alongside other options views).

## Dependencies

- SHARED area must be complete first (types, CallableName enum)
- BE callable must be deployed for integration testing (unit tests can
  mock the service)

## Verification

- Angular build passes
- Unit tests for `computePctChange` and `pctChangeToColor` pass
- Component renders correct grid from synthetic data
- Navigation reaches the page
- End-to-end: enter QQQ + dates → grids render with correct cells

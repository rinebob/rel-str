# RH Agent Strategy Backtest UI — As-Built

This document describes the RH Agent strategy backtesting Angular UI exactly as it is implemented today. It is split into three parts:

1. **Plain-English process description** — what happens, in order, with no code.
2. **Same description annotated with code paths** — the files and functions that carry out each step.
3. **Implementation reference** — enough detail for another developer to reproduce the same UI in a different app.

> Scope note: this is the Angular UI only, covering Phases 1–3 (run list, filters, run summary, permutation inspection). The backtest report page, equity-curve component, and new-run/clone/archive flows are Phase 4/5 work and are out of scope.

---

## Part 1 — What happens (plain English)

### 1. The moving pieces

- **`BacktestDashboardComponent`** — the root page. Owns no local state; injects `BacktestRunStore` and `BacktestUiStore` and starts listeners on construction.
- **`BacktestRunControlComponent`** — the filter and sort strip. Emits filter/sort changes; several actions (`New Backtest`, `Refresh`) are disabled placeholders for Phase 5.
- **`BacktestRunListComponent`** — a table of backtest runs. Displays status, PT-derived ID, created timestamp, strategy, symbols, progress, and quality. Row click selects a run.
- **`BacktestRunSummaryComponent`** — the upper half of the detail panel. Shows run-level aggregate metrics and a sortable list of permutations.
- **`BacktestPermutationDetailComponent`** — the lower half of the detail panel. Shows symbol, config, metrics, notes, errors, and a mini equity-curve sparkline.
- **`BacktestRunStore`** — NgRx SignalStore that owns run data, strategy metadata, selected run, and realtime permutation streaming.
- **`BacktestUiStore`** — NgRx SignalStore that owns filters, sorting, and the selected permutation projection.
- **`BacktestRunService`** — wraps the `rhAgentBacktestStrategies` callable and the `backtest-runs` / `backtest-permutations` Firestore listeners.
- **`BacktestFirestoreConverter`** — pure helper that maps Firestore snapshots into UI-facing `BacktestRunUi` / `BacktestPermutationUi` shapes.
- **`backtest.utils.ts`** — display helpers: status→color/icon mapping, PT timestamp/runId formatting, duration formatting, PT date extraction.
- **`backtest-aggregate.utils.ts`** — pure helper `computeRunAggregates()` used by the run summary.

### 2. Dashboard bootstrap

A user navigates to the backtest route.

1. The route lazy-loads `BacktestDashboardComponent`.
2. The dashboard constructor calls `runStore.loadRuns()` and `runStore.loadStrategies()`.
3. `loadRuns()` opens a realtime Firestore listener on `backtest-runs`, ordered by `createdAt` descending and limited to 50 documents.
4. `loadStrategies()` calls the `rhAgentBacktestStrategies` HTTPS callable once and stores the result.
5. As run snapshots arrive, `BacktestRunStore.runs` updates; the dashboard is otherwise passive.

### 3. Run list rendering and filtering

1. `BacktestUiStore.filteredRuns()` reads `BacktestRunStore.runs()` and applies every active filter, then sorts.
2. The dashboard binds `uiStore.filteredRuns()` to the `BacktestRunListComponent` `[runs]` input.
3. `BacktestRunListComponent` computes a `BacktestRunListRow` view model for each run: formatted run ID, formatted created timestamp, duration, status color/icon, and progress-bar percentages.
4. The user changes a filter or sort in `BacktestRunControlComponent`; the component emits an output, the dashboard forwards it to a `BacktestUiStore` setter, and `filteredRuns()` recomputes.
5. The user clicks a run row; `BacktestRunListComponent` emits `selectRun`, and the dashboard calls `runStore.selectRun(runId)`.

### 4. Run selection and permutation streaming

1. `runStore.selectRun(runId)` sets `BacktestRunStore.selectedRunId` and calls `runStore.loadPermutations(runId)`.
2. `loadPermutations` unsubscribes any existing permutation listener and, if `runId` is non-null, opens a realtime Firestore query on `backtest-permutations` where `runId == selectedRunId`, ordered by `completedAt` descending.
3. As permutation snapshots arrive, `BacktestRunStore.permutations` updates.
4. `BacktestUiStore.selectedPermutation()` reads `selectedPermutationId` and `BacktestRunStore.permutations()` and returns the matching permutation (or null).

### 5. Run summary panel

1. When a run is selected, the dashboard conditionally renders a 420px detail panel with `BacktestRunSummaryComponent` and `BacktestPermutationDetailComponent` side-by-side stacked vertically.
2. `BacktestRunSummaryComponent` receives the selected run, the streamed permutations, the selected permutation id, and the `permutationsStreaming` loading flag.
3. It computes `RunAggregateMetrics` by calling `computeRunAggregates(permutations)`.
4. It computes `viewPermutations` by mapping each permutation to a `SummaryPermutationRow` (adding status color/icon) and sorting by the active `sortBy`/`sortDirection`.
5. The user clicks a permutation row; the component emits `selectPermutation`, and the dashboard calls `uiStore.setSelectedPermutationId(id)`.
6. The user clicks a column header; `onSort` toggles `sortBy` and `sortDirection`.

### 6. Permutation detail panel

1. `BacktestPermutationDetailComponent` receives `uiStore.selectedPermutation()` as its `permutation` input.
2. It computes `chartData` by converting `equityCurve` points into `{ date, equity }` objects for Syncfusion `ejs-chart`.
3. It computes `configEntries` by serializing the permutation `config` object into `{ key, value }` pairs (objects are JSON-stringified; primitives are stringified).
4. It renders symbol, status badge, config list, metrics grid, notes, errors, a mini equity curve, and a disabled "Open full report" placeholder for Phase 4.

---

## Part 2 — Same flow, annotated with code paths

### Routing and page entry

- The backtest route is registered in `src/app/core/core-routes.ts` as a lazy-loaded path under `AppRoutes.RH_AGENT_BACKTEST` (defined in `src/app/core/common/interfaces.ts`).
- `src/app/features/rh-agent/backtest/pages/backtest-dashboard/backtest-dashboard.component.ts` is the routed component.
- `BacktestDashboardComponent` constructor: `this.runStore.loadRuns(); this.runStore.loadStrategies();`.

### Service and converter layer

- `src/app/features/rh-agent/backtest/services/backtest-run.service.ts`
  - `listStrategies()` calls the `rhAgentBacktestStrategies` callable and maps `result.data.strategies`.
  - `watchRuns(count)` creates a Firestore `collectionData` query on `backtest-runs` ordered by `createdAt` descending with `limit(count)`.
  - `watchPermutations(runId)` creates a Firestore `collectionData` query on `backtest-permutations` with `where('runId', '==', runId)` and `orderBy('completedAt', 'desc')`.
- `src/app/features/rh-agent/backtest/services/backtest-firestore-converter.ts`
  - `convertBacktestRunDoc(id, data)` maps raw Firestore data to `BacktestRunUi`, normalizing timestamps, booleans, and arrays.
  - `convertBacktestPermutationDoc(id, data)` maps raw data to `BacktestPermutationUi`, including `metrics`, `equityCurve`, `trades`, and nested trade legs.
  - `convertBacktestTrade` / `convertBacktestTradeLeg` recursively map trade and leg shapes.

### Stores

- `src/app/features/rh-agent/backtest/stores/backtest-run.store.ts`
  - State: `runs`, `strategies`, `selectedRunId`, `permutations`, `isLoading`, `runsStreaming`, `permutationsStreaming`.
  - Computed: `selectedRun` (from `runs` + `selectedRunId`), `latestRun`, `strategyOptions`.
  - `loadStrategies()` subscribes once to `runService.listStrategies()`.
  - `loadRuns()` is idempotent (guards against an existing `runsSubscription`) and calls the private `watchStream()` helper for `backtest-runs`.
  - `selectRun(runId)` patches `selectedRunId` and calls `loadPermutations(runId)`.
  - `loadPermutations(runId)` unsubscribes existing listener, resets `permutations` if `runId` is null, and calls `watchStream()` for `backtest-permutations`.
  - `watchStream()` centralizes the `catchError` → `takeUntilDestroyed` → `subscribe` lifecycle and applies start/stop state patches.
- `src/app/features/rh-agent/backtest/stores/backtest-ui.store.ts`
  - State: `statusFilter`, `dateFilter`, `strategyFilter`, `symbolSearch`, `configSearch`, `sortBy`, `sortDirection`, `includeArchived`, `selectedPermutationId`.
  - Computed:
    - `filteredRuns()` pulls `dataStore.runs()` and filters by status, PT date range, strategy, symbol/config search, archived, then sorts by `createdAt` or `status`.
    - `hasActiveFilters()` is true when any non-default filter is set.
    - `selectedPermutation()` reads `dataStore.permutations()` and `selectedPermutationId`.
  - `withMethods` exposes one setter per filter/sort property plus `resetFilters()` and `setSelectedPermutationId()`.

### Components

- `src/app/features/rh-agent/backtest/components/backtest-run-control/backtest-run-control.component.ts` / `.html`
  - Inputs mirror `BacktestUiState` values; outputs mirror the UI store setters.
  - `New Backtest` and `Refresh` buttons are disabled with Phase 5 tooltips.
  - Status, date, strategy, symbol, config, sort, and include-archived controls emit changes through outputs.
- `src/app/features/rh-agent/backtest/components/backtest-run-list/backtest-run-list.component.ts` / `.html`
  - Inputs: `runs`, `selectedRunId`, `hasActiveFilters`.
  - Output: `selectRun`.
  - `viewRuns` computed builds `BacktestRunListRow` objects with formatted display values and status visuals.
  - `buildProgressText`, `buildProgressCompletedPercent`, and `buildProgressFailedPercent` derive progress display from `totalPermutations` / `completedPermutations` / `failedPermutations`.
- `src/app/features/rh-agent/backtest/components/backtest-run-summary/backtest-run-summary.component.ts` / `.html` / `.scss`
  - Inputs: `run`, `permutations`, `selectedPermutationId`, `isLoadingPermutations`.
  - Outputs: `selectPermutation`, `cloneRun`, `archiveRun`, `cancelRun` (clone/archive/cancel are disabled Phase 5 placeholders).
  - `aggregates` computed calls `computeRunAggregates(permutations)`.
  - `viewPermutations` computed maps status color/icon and sorts by `symbol`, `status`, `totalReturnPct`, or `tradeCount`.
  - `formattedRunId` computed formats the PT-derived `runId`.
- `src/app/features/rh-agent/backtest/components/backtest-permutation-detail/backtest-permutation-detail.component.ts` / `.html` / `.scss`
  - Input: `permutation`.
  - Defines Syncfusion chart configuration (`primaryXAxis`, `primaryYAxis`, `tooltip`, `legendSettings`, `animation`).
  - `chartData` computed transforms `equityCurve` into `Date`/`equity` points.
  - `configEntries` computed converts `config` into `{ key, value }` strings.
  - HTML renders header status badge, metrics grid, config list, notes, error, chart, and disabled full-report link.

### Utilities

- `src/app/features/rh-agent/backtest/utils/backtest.utils.ts`
  - `getBacktestStatusVisuals(status)` returns `{ color, icon }` for a run or permutation status.
  - `formatBacktestTimestamp`, `toBacktestPtDate`, `formatBacktestRunId`, `formatBacktestDuration` handle display formatting.
- `src/app/features/rh-agent/backtest/utils/backtest-aggregate.utils.ts`
  - `computeRunAggregates(permutations)` returns `RunAggregateMetrics`.
  - Averages return/Calmar/Sharpe/max-drawdown only from `success` permutations.
  - Status counts include `success`, `failed`, `running`, and `pending`.
  - `exitReasonCounts` aggregates `trade.exitReason` across all permutations.
  - `safeNumber` and `mean` guard against `NaN` and empty arrays.

---

## Part 3 — Implementation reference

### State shapes

`BacktestRunState` in `backtest-run.store.ts`:

- `runs: BacktestRunUi[]`
- `strategies: BacktestStrategyMetadata[]`
- `selectedRunId: string | null`
- `permutations: BacktestPermutationUi[]`
- `isLoading: boolean`
- `runsStreaming: boolean`
- `permutationsStreaming: boolean`

`BacktestUiState` in `backtest-ui.store.ts`:

- `statusFilter: BacktestStatusFilter` (`'all' | BacktestRunStatus`)
- `dateFilter: BacktestDateFilter` (`'all' | 'today' | '7d' | '30d'`)
- `strategyFilter: string`
- `symbolSearch: string`
- `configSearch: string`
- `sortBy: BacktestSortBy` (`'createdAt' | 'status'`)
- `sortDirection: BacktestSortDirection` (`'asc' | 'desc'`)
- `includeArchived: boolean`
- `selectedPermutationId: string | null`

### Key signals / computed

- `BacktestRunStore.runs` — raw run list from Firestore.
- `BacktestRunStore.permutations` — raw permutation list for the selected run.
- `BacktestRunStore.selectedRun` — run object matching `selectedRunId`.
- `BacktestRunStore.strategyOptions` — `{ id, name }` dropdown options.
- `BacktestUiStore.filteredRuns` — filtered, sorted runs.
- `BacktestUiStore.hasActiveFilters` — true when any filter deviates from defaults.
- `BacktestUiStore.selectedPermutation` — permutation matching `selectedPermutationId`.

### Component inputs and outputs

| Component | Inputs | Outputs |
|---|---|---|
| `BacktestRunControlComponent` | `isLoading`, `statusFilter`, `dateFilter`, `strategyFilter`, `strategyOptions`, `symbolSearch`, `configSearch`, `sortBy`, `sortDirection`, `includeArchived` | `newRun`, `refresh`, `statusFilterChange`, `dateFilterChange`, `strategyFilterChange`, `symbolSearchChange`, `configSearchChange`, `sortByChange`, `sortDirectionChange`, `includeArchivedChange` |
| `BacktestRunListComponent` | `runs`, `selectedRunId`, `hasActiveFilters` | `selectRun` |
| `BacktestRunSummaryComponent` | `run`, `permutations`, `selectedPermutationId`, `isLoadingPermutations` | `selectPermutation`, `cloneRun`, `archiveRun`, `cancelRun` |
| `BacktestPermutationDetailComponent` | `permutation` | — |

### Realtime listener lifecycle

- `loadRuns()` is idempotent: it returns immediately if `runsSubscription` is already set.
- `selectRun()` always triggers `loadPermutations(runId)`, which unsubscribes the prior permutation listener before creating a new one.
- `watchStream()` unsubscribes the existing subscription, applies a `startPatch` (loading/streaming flags), subscribes with `catchError` and `takeUntilDestroyed(destroyRef)`, and applies a `stopPatch` on `next`, `error`, or `complete`.
- On `DestroyRef` (root injector for the store), `takeUntilDestroyed` cleans up active subscriptions.

### Aggregate metrics

`computeRunAggregates` produces:

- `meanTotalReturnPct`, `minTotalReturnPct`, `maxTotalReturnPct` from `success` permutations.
- `meanCalmarRatio`, `meanSharpeRatio`, `meanMaxDrawdownPct` from `success` permutation metrics.
- `totalTradeCount` from `success` + `failed` permutations.
- `successCount`, `failedCount`, `runningCount`, `pendingCount` across all permutations.
- `exitReasonCounts: Record<string, number>` from `permutation.trades` across all permutations.

`safeNumber(value)` converts values to `Number` and falls back to `0` for `NaN` / non-finite results, preventing `NaN` from failed permutations from polluting averages.

### Status and icon mapping

`STATUS_VISUALS` in `backtest.utils.ts` maps both `BacktestRunStatus` and `BacktestPermutationStatus` values to:

- `completed` / `success` → `var(--mat-sys-success)` + `check_circle`
- `failed` → `var(--mat-sys-error)` + `error`
- `running` → `var(--mat-sys-primary)` + `pending`
- `cancelled` → `var(--mat-sys-warning)` + `cancel`
- `pending` → empty color + `schedule`

`getBacktestStatusVisuals(status)` returns the entry or a `pending` fallback.

### Type contracts

The canonical UI types live in `src/app/features/rh-agent/backtest/common/backtest.types.ts`:

- `BacktestRunUi`
- `BacktestPermutationUi`
- `BacktestTradeUi`
- `BacktestTradeLegUi`
- `BacktestEquityPoint`
- `BacktestMetrics`
- `BacktestStrategyMetadata`
- `StartBacktestRequest` / `StartBacktestResponse`

These are UI-facing mirrors of the backend `BacktestRun` / `BacktestPermutationSummary` types in `functions/src/rh-agent-cloud-function/backtest/backtest-types.ts`.

### Test coverage

- `src/app/features/rh-agent/backtest/utils/backtest-aggregate.utils.spec.ts` covers `computeRunAggregates()` for empty input, NaN values, all-failed permutations, exit-reason aggregation, and status counts.
- `tsconfig.backtest.spec.json` scopes the test compilation for this suite.

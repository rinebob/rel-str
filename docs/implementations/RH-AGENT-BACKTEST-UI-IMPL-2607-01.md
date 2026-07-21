# RH Agent Strategy Backtest Run Management UI — Implementation Plan

**Date:** 2026-07-21  
**Status:** Draft — pending review  
**Related docs:**
- `docs/implementations/RH-AGENT-BACKTEST-UI-PRD-2607-01.md`
- `docs/implementations/RH-AGENT-BACKTEST-BACKEND-AS-BUILT-2607-01.md`
- `functions/src/rh-agent-cloud-function/backtest/backtest-types.ts`
- `functions/src/rh-agent-cloud-function/backtest/backtest-orchestrator.ts`

---

## 1. Overview

This document is the build plan for the Angular UI described in the PRD. It reuses existing RH Agent patterns: NgRx Signal stores, AngularFire realtime listeners, `httpsCallable` invocations, compact pill filters, and Syncfusion charts. The work is split into five implementation phases so each piece can be validated before the next.

---

## 2. Architecture principles

- **Reuse before invent.** Use `run-control-card`, `run-history-panel`, and `signal-filter-pills` visual patterns. Use `RhAgentRunService` as the model for callable + Firestore listener services.
- **Sub-feature isolation.** Co-locate all backtest UI code under `src/app/features/rh-agent/backtest/` so the `rh-agent` root does not accumulate new directories. The sub-feature has its own `common/`, `services/`, `stores/`, `utils/`, `components/`, `pages/`, and `index.ts` barrel.
- **Store split.** Keep a data store (`BacktestRunStore`) for Firestore/callable state and a UI store (`BacktestUiStore`) for filters, selection, and dialog visibility — matching the `RhAgentStore` / `RhAgentDashboardStore` split.
- **PT display, UTC storage.** Convert Firestore `Timestamp` and backend `runId` to PT only at the presentation layer, using the existing `rh-agent.utils` helpers.
- **Realtime by default.** `backtest-runs` and `backtest-permutations` are listened to with `collectionData`; no manual refresh is required.
- **Report tier-aware.** The UI must not crash when `reportTier === 'summary'` and `trades` are absent.

---

## 3. Backend additions required

The UI needs a lightweight way to discover strategies and their schemas. Add one callable:

### 3.1 `rhAgentBacktestStrategies`

- File: `functions/src/rh-agent-cloud-function/backtest/backtest-strategies-callable.ts`
- Returns the list of registered strategies from `strategyRegistry.list()`:
  - `id`, `name`, `description`, `category`, `defaultConfig`, `configSchema`, `minBarsRequired`, `supportedTimeframes`
- No auth beyond the existing `onCall` public invoker (auth is enforced by Firebase Auth via AngularFire).
- Update `functions/src/index.ts` to export the new function.

This is the only backend change; the rest of the work is Angular.

---

## 4. Data model mapping

### 4.1 Firestore to Angular types

Create `src/app/features/rh-agent/backtest/common/backtest.types.ts` with UI-facing types:

```ts
export type BacktestRunStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
export type BacktestPermutationStatus = 'pending' | 'running' | 'success' | 'failed';
export type BacktestReportTier = 'summary' | 'full';
export type BacktestRunType = 'allData' | 'expandingWindow';

export interface BacktestRunUi {
  runId: string;
  status: BacktestRunStatus;
  symbols: string[];
  strategyId: string;
  runType: BacktestRunType;
  initialCash: number;
  reportTier: BacktestReportTier;
  totalPermutations: number;
  completedPermutations: number;
  failedPermutations: number;
  qualityDesignation?: string;
  archived?: boolean;
  createdAtIso: string;      // converted from Timestamp
  updatedAtIso?: string;
  startedAtIso?: string;
  completedAtIso?: string;
}

export interface BacktestPermutationUi {
  permutationId: string;
  runId: string;
  symbol: string;
  strategyId: string;
  config: Record<string, unknown>;
  status: BacktestPermutationStatus;
  runType: BacktestRunType;
  initialCash: number;
  finalEquity: number;
  totalReturnPct: number;
  metrics: BacktestMetrics;
  equityCurve: BacktestEquityPoint[];
  tradeCount: number;
  notes?: string[];
  error?: string;
  startedAtIso?: string;
  completedAtIso?: string;
  // Only present when reportTier === 'full'
  trades?: BacktestTradeUi[];
}

export interface BacktestTradeUi {
  entryDate: string;
  exitDate: string;
  symbol: string;
  side: 'long' | 'short';
  quantity: number;
  entryUnderlying: number;
  exitUnderlying: number;
  entryMark: number;
  exitMark: number;
  pnl: number;
  returnPct: number;
  exitReason: string;
  daysHeld: number;
  isUnderlying?: boolean;
  optionType?: string;
  strike?: string;
  expiration?: string;
  contractId?: string;
  legs?: BacktestTradeLegUi[];
  notes?: string[];
}

export interface BacktestTradeLegUi {
  kind: 'option' | 'underlying';
  side: 'long' | 'short';
  quantity: number;
  multiplier: number;
  entryMark: number;
  exitMark: number;
  pnl: number;
  optionType?: string;
  strike?: string;
  expiration?: string;
}

export interface BacktestEquityPoint {
  date: string;
  cash: number;
  equity: number;
  openPositions: number;
}

export interface BacktestMetrics {
  totalNetProfit: number;
  grossProfit: number;
  grossLoss: number;
  profitFactor: number;
  percentProfitable: number;
  winLossRatio: number;
  averageTrade: number;
  averageWin: number;
  averageLoss: number;
  maxDrawdown: number;
  maxDrawdownPct: number;
  sharpeRatio: number;
  calmarRatio: number;
  tradeCount: number;
  winCount: number;
  lossCount: number;
}

export interface BacktestStrategyMetadata {
  id: string;
  name: string;
  description: string;
  category: string;
  defaultConfig: Record<string, unknown>;
  configSchema: Record<string, {
    type: 'integer' | 'number' | 'string' | 'boolean';
    min?: number;
    max?: number;
    step?: number;
    enum?: unknown[];
    description?: string;
  }>;
  minBarsRequired: number;
  supportedTimeframes: string[];
}
```

---

## 5. Routes and navigation

### 5.1 App routes

Update `src/app/core/common/interfaces.ts`:

```ts
export enum AppRoutes {
  // ... existing entries
  RH_AGENT_BACKTEST = 'rh-agent-backtest',
}
```

Update `src/app/core/core-routes.ts`:

```ts
{path: AppRoutes.RH_AGENT_BACKTEST,
    loadComponent: () => import('../features/rh-agent/backtest/pages/backtest-dashboard/backtest-dashboard.component')
    .then(mod => mod.BacktestDashboardComponent),
    canActivate: [authGuard],
},
```

### 5.2 Optional child route for report view

For direct linking:

```ts
{path: 'rh-agent-backtest/:runId/:permutationId',
    loadComponent: () => import('../features/rh-agent/backtest/pages/backtest-report/backtest-report.component')
    .then(mod => mod.BacktestReportComponent),
    canActivate: [authGuard],
},
```

This is optional for Phase 1; the report can open in a side panel first.

### 5.3 Feature index

Create `src/app/features/rh-agent/backtest/index.ts` as the sub-feature barrel. It exports `BacktestDashboardComponent`, `BacktestReportComponent`, and any public services/types that the rest of RH Agent needs.

Update `src/app/features/rh-agent/index.ts` to re-export from the barrel:

```ts
export * from './backtest';
```

---

## 6. Services

### 6.1 `BacktestRunService`

Location: `src/app/features/rh-agent/backtest/services/backtest-run.service.ts`

Responsibilities:

- `listStrategies(): Observable<BacktestStrategyMetadata[]>` — call `rhAgentBacktestStrategies`.
- `startRun(request: StartBacktestRequest): Observable<StartBacktestResponse>` — call `rhAgentBacktestStart`.
- `watchRuns(limitCount = 50, includeArchived = false): Observable<BacktestRunUi[]>` — Firestore listener on `backtest-runs` ordered by `createdAt desc`, with optional `archived` filter.
- `watchRun(runId: string): Observable<BacktestRunUi>` — single run listener.
- `watchPermutations(runId: string): Observable<BacktestPermutationUi[]>` — listener on `backtest-permutations` with `where('runId', '==', runId)`.
- `archiveRun(runId: string, archived: boolean): Observable<void>` — write `archived` to the run doc.
- `setQualityDesignation(runId: string, label: string | null): Observable<void>` — write `qualityDesignation`.

Use `runInInjectionContext` around `httpsCallable` calls, as in `rh-agent-run.service.ts`. Convert Firestore `Timestamp` fields with `.toDate().toISOString()`.

### 6.2 `BacktestFirestoreConverter`

A small pure helper in `src/app/features/rh-agent/backtest/services/backtest-firestore-converter.ts` to convert `DocumentData` into the UI types and handle missing fields.

---

## 7. Stores

### 7.1 `BacktestRunStore`

Location: `src/app/features/rh-agent/backtest/stores/backtest-run.store.ts`

State:

```ts
interface BacktestRunState {
  runs: BacktestRunUi[];
  selectedRunId: string | null;
  permutations: BacktestPermutationUi[];
  strategies: BacktestStrategyMetadata[];
  isLoading: boolean;
  error: string | null;
}
```

Methods:

- `loadRuns()` — start the `backtest-runs` listener.
- `selectRun(runId: string | null)` — update selection and start `backtest-permutations` listener for that run.
- `loadStrategies()` — fetch strategy metadata once.
- `startRun(request)` — call service and show snackbar.
- `archiveRun(runId, archived)` — call service.
- `setQualityDesignation(runId, label)` — call service.
- `cloneAndEdit(sourceRun)` — open the new-run dialog pre-filled (handled by UI store).

### 7.2 `BacktestUiStore`

Location: `src/app/features/rh-agent/backtest/stores/backtest-ui.store.ts`

State:

```ts
interface BacktestUiState {
  statusFilter: BacktestStatusFilter;
  dateFilter: BacktestDateFilter;
  strategyFilter: string;           // 'all' | strategyId
  symbolSearch: string;
  configSearch: string;
  sortBy: BacktestSortBy;
  sortDirection: 'asc' | 'desc';
  selectedPermutationId: string | null;
  newRunDialogOpen: boolean;
  cloneSourceRunId: string | null;
  includeArchived: boolean;
}
```

Computed:

- `filteredRuns` — applies all filters to `BacktestRunStore.runs()`.
- `selectedRun` — lookup.
- `selectedPermutation` — lookup.

Methods: filter setters, dialog open/close, sort toggle.

---

## 8. Components

### 8.1 Page: `BacktestDashboardComponent`

Location: `src/app/features/rh-agent/backtest/pages/backtest-dashboard/`

Files:
- `backtest-dashboard.component.ts`
- `backtest-dashboard.component.html`
- `backtest-dashboard.component.scss`

Responsibilities:
- Injects `BacktestRunStore`, `BacktestUiStore`, and `MatSnackBar`.
- Calls `store.loadRuns()` and `store.loadStrategies()` in the constructor.
- Layout: control strip, run list, summary/permutation panel.

### 8.2 `BacktestRunControlComponent`

Location: `src/app/features/rh-agent/backtest/components/backtest-run-control/`

- Reuses the pill-group style from `run-control-card.component.scss`.
- Inputs: `isRunning`, `statusFilter`, `dateFilter`, `strategyFilter`, `strategyOptions`, `symbolSearch`, `configSearch`, `sortBy`, `includeArchived`.
- Outputs: `newRun`, `refresh`, `statusFilterChange`, `dateFilterChange`, `strategyFilterChange`, `symbolSearchChange`, `configSearchChange`, `sortByChange`, `includeArchivedChange`.

### 8.3 `BacktestRunListComponent`

Location: `src/app/features/rh-agent/backtest/components/backtest-run-list/`

- Table similar to `run-history-panel.component.html`.
- Columns: status icon, PT `runId`, PT `createdAt`, strategy, progress, aggregate Calmar/return, report tier badge, quality designation, actions (clone, archive, cancel).
- Row click selects the run; action buttons stop propagation.

### 8.4 `BacktestRunSummaryComponent`

Location: `src/app/features/rh-agent/backtest/components/backtest-run-summary/`

- Displays run-level aggregate metrics computed from permutations.
- Shows the list of permutations with sortable columns.
- Emits `selectPermutation`, `cloneRun`, `archiveRun`, `setQualityDesignation`, `cancelRun`.

### 8.5 `BacktestPermutationDetailComponent`

Location: `src/app/features/rh-agent/backtest/components/backtest-permutation-detail/`

- Shows `symbol`, `config` (JSON or key-value table), `metrics`, `tradeCount`, `notes`, `error`.
- Mini equity-curve sparkline.
- Link to full report.

### 8.6 `BacktestReportComponent`

Location: `src/app/features/rh-agent/backtest/pages/backtest-report/`

- Full TradeStation-style report view.
- Header metrics.
- Equity curve chart (Syncfusion `ejs-chart` with `LineSeries` and `DateTime` x-axis).
- Trade list table with expandable leg detail.
- If `reportTier === 'summary'`, show the explanation and a "Clone with full report" action.

### 8.7 `BacktestEquityCurveComponent`

Location: `src/app/features/rh-agent/backtest/components/backtest-equity-curve/`

- Reusable line chart for `BacktestEquityPoint[]`.
- Uses `ejs-chart` with `LineSeries`, `DateTimeService`, `LegendService`, `TooltipService`.
- Y-axis = `equity`; secondary series = `cash` and `openPositions` (on separate y-axis or omitted).

### 8.8 `BacktestConfigFormComponent`

Location: `src/app/features/rh-agent/backtest/components/backtest-config-form/`

- Two-step dialog:
  1. Symbol list textarea / picker.
  2. Strategy selector + dynamic config form generated from `configSchema`.
  3. Initial cash, report tier, run type.
- Supports both "New run" and "Clone" modes.
- Validates numeric min/max, integer step, string enums, booleans.

---

## 9. Aggregate metrics computation

Create `src/app/features/rh-agent/backtest/utils/backtest-aggregate.utils.ts` with pure functions:

```ts
export interface RunAggregateMetrics {
  meanTotalReturnPct: number;
  minTotalReturnPct: number;
  maxTotalReturnPct: number;
  meanCalmarRatio: number;
  meanSharpeRatio: number;
  meanMaxDrawdownPct: number;
  totalTradeCount: number;
  successCount: number;
  failedCount: number;
  runningCount: number;
  exitReasonCounts: Record<string, number>;
}

export function computeRunAggregates(permutations: BacktestPermutationUi[]): RunAggregateMetrics;
```

Guard against empty arrays and `NaN` values from failed permutations.

---

## 10. Phases

### Phase 1 — Types, routes, service, and strategy list

- Add `Backtest*` types in `backtest/common/backtest.types.ts`.
- Add `rhAgentBacktestStrategies` callable on the backend.
- Add `BacktestRunService` and converter.
- Add `AppRoutes.RH_AGENT_BACKTEST` and route.
- Build `BacktestDashboardComponent` shell with "coming soon" placeholders.
- **Verification:** `npm --prefix functions run typecheck && npm --prefix functions run build` and `ng build --configuration development` pass.

### Phase 2 — Run list and filters

- Build `BacktestRunStore` and `BacktestUiStore`.
- Build `BacktestRunControlComponent` and `BacktestRunListComponent`.
- Wire realtime `backtest-runs` listener.
- Implement status/date/strategy/symbol/config filters and sorting.
- **Verification:** Owner can open the page, see runs, and filter/sort.

### Phase 3 — Run summary and permutation inspect

- Build `BacktestRunSummaryComponent` and `BacktestPermutationDetailComponent`.
- Wire `backtest-permutations` listener per selected run.
- Implement aggregate metrics using `backtest-aggregate.utils.ts`.
- Show errors and notes for failed permutations.
- **Verification:** Selecting a run shows permutations and aggregate metrics.

### Phase 4 — Full TradeStation-style report

- Build `BacktestReportComponent` and `BacktestEquityCurveComponent`.
- Render metrics header, equity curve, and trade list.
- Handle `reportTier === 'summary'` gracefully.
- **Verification:** A `full` run displays its equity curve and trades.

### Phase 5 — New run, clone, archive, quality designation

- Build `BacktestConfigFormComponent` with dynamic schema rendering.
- Implement start run callable call.
- Implement clone (pre-fill from existing run).
- Implement archive toggle and quality designation inline edit.
- Implement cancel button (local `cancelling` state + write `cancelled` if backend supports it).
- **Verification:** End-to-end new run starts and appears; clone/edit works; archive and quality designation persist.

---

## 11. File structure

```text
functions/src/
  rh-agent-cloud-function/backtest/
    backtest-strategies-callable.ts   (new backend callable)
  index.ts                            (export new callable)

src/app/features/rh-agent/
  backtest/                           (new sub-feature)
    common/
      backtest.types.ts
    services/
      backtest-run.service.ts
      backtest-firestore-converter.ts
    stores/
      backtest-run.store.ts
      backtest-ui.store.ts
    utils/
      backtest-aggregate.utils.ts
    components/
      backtest-run-control/
        backtest-run-control.component.ts
        backtest-run-control.component.html
        backtest-run-control.component.scss
      backtest-run-list/
        backtest-run-list.component.ts
        backtest-run-list.component.html
        backtest-run-list.component.scss
      backtest-run-summary/
        backtest-run-summary.component.ts
        backtest-run-summary.component.html
        backtest-run-summary.component.scss
      backtest-permutation-detail/
        backtest-permutation-detail.component.ts
        backtest-permutation-detail.component.html
        backtest-permutation-detail.component.scss
      backtest-equity-curve/
        backtest-equity-curve.component.ts
        backtest-equity-curve.component.html
        backtest-equity-curve.component.scss
      backtest-config-form/
        backtest-config-form.component.ts
        backtest-config-form.component.html
        backtest-config-form.component.scss
    pages/
      backtest-dashboard/
        backtest-dashboard.component.ts
        backtest-dashboard.component.html
        backtest-dashboard.component.scss
      backtest-report/
        backtest-report.component.ts
        backtest-report.component.html
        backtest-report.component.scss
    index.ts                          (sub-feature barrel: export public pages/services)
  # existing rh-agent root dirs remain unchanged

src/app/core/
  common/interfaces.ts                 (add RH_AGENT_BACKTEST route)
  core-routes.ts                       (add lazy-loaded route)
```

---

## 12. Testing strategy

- **Unit tests:**
  - `backtest-firestore-converter.ts` handles missing fields and Timestamp conversion.
  - `backtest-aggregate.utils.ts` handles empty, NaN, and partial permutation arrays.
  - `BacktestUiStore` filter/sort logic.
- **Component tests:**
  - `BacktestRunListComponent` renders rows and emits selection.
  - `BacktestConfigFormComponent` validates dynamic schema fields and emits valid start requests.
  - `BacktestEquityCurveComponent` renders with an empty and populated `equityCurve`.
- **Service tests:**
  - `BacktestRunService` maps callable responses and Firestore snapshots.
- **End-to-end:**
  - Start a `leap-drop` backtest for `SPY` with `reportTier: 'summary'`, wait for completion, and verify the run appears.
  - Clone the run with `reportTier: 'full'`, wait, and verify the full report view.

---

## 13. Build and verification commands

From the repo root:

```powershell
# Backend
npm --prefix functions run typecheck
npm --prefix functions run build

# Angular
npm run build -- --configuration development --no-progress

# Optional smoke test
npx tsx functions/scripts/backtest-qqq-underlying.ts --help
```

---

## 14. Acceptance criteria mapping

| PRD criterion | Implemented in |
|---|---|
| List runs | Phase 2 — `BacktestRunStore` + `BacktestRunListComponent` |
| Filter/sort | Phase 2 — `BacktestUiStore` + `BacktestRunControlComponent` |
| Run summary | Phase 3 — `BacktestRunSummaryComponent` |
| Inspect permutation | Phase 3 — `BacktestPermutationDetailComponent` |
| Full TradeStation-style report | Phase 4 — `BacktestReportComponent` + `BacktestEquityCurveComponent` |
| Start new run | Phase 5 — `BacktestConfigFormComponent` |
| Clone / rerun | Phase 5 — `BacktestConfigFormComponent` clone mode |
| Archive | Phase 5 — `BacktestRunService.archiveRun` + list filter |
| Quality Designation | Phase 5 — inline edit + `BacktestRunService.setQualityDesignation` |
| PT dates and IDs | All phases — use `rh-agent.utils` PT helpers |

---

## 15. Notes and risks

- **Strategy schema drift.** The UI renders config forms from `configSchema`. If a strategy changes its schema, existing runs with old configs will still display correctly because `config` is stored on each permutation.
- **Large report docs.** A `full` run on a symbol with many trades can produce a large `backtest-permutations` document. Keep the report view lazy: load the permutation doc only when the user opens the report.
- **Firestore composite index.** `backtest-permutations` will be queried by `runId` and ordered by `completedAt`. Verify the index exists or is created automatically; if not, add it to `firestore.indexes.json`.
- **Cancel semantics.** Cloud Tasks cannot be revoked. If no backend cancel is added, the cancel button must be disabled with an explanatory tooltip.

# RH Agent Refactor Action Plan

## Goal

Simplify the `rh-agent` feature by extracting inline Angular UI into child components, removing dead code, consolidating duplicated backend logic, and aligning the documentation with the current implementation.

## Scope / Not in Scope

**In scope:**

- Frontend Angular components, stores, and services under `src/app/features/rh-agent`.
- Backend Cloud Functions under `functions/src/rh-agent-cloud-function`.
- Implementation docs in `docs/implementations` and `docs/dev-notes`.

**Not in scope:**

- Tailwind CSS (continue with existing SCSS / Material).
- New unit tests.
- Changing signal/indicator math or trading behavior.
- Enabling Firebase Auth on currently public callables until App Check is fixed (see below).

## Guiding Principles

- Apply the `angular-developer` and `thermo-nuclear-code-review` skills: prefer deleting complexity over moving it around, keep files under 1k lines, use signal-based child components with `input()`/`output()`, and avoid function calls in templates.
- Move logic into the canonical layer: list management belongs in a list store, chart configuration belongs in a shared builder, trigger orchestration belongs in shared helpers.

---

## Phase 0 — Backend Cleanup (foundation work)

### 0.1 Consolidate duplicate dashboard callables

The `rh-agent-dashboard-callables.ts` file still contains `rhAgentGetStatus` and `rhAgentGetRunHistory`, but the frontend now calls the versions in `rh-agent-callables.ts`.

- Delete the dead `rhAgentGetStatus` and `rhAgentGetRunHistory` functions from `rh-agent-dashboard-callables.ts`.
- Keep the still-used functions in that file: `rhAgentGetSymbolsWithSignals`, `rhAgentGetSymbolSignalHistory`, and `rhAgentOverviewSyncAdmin`.
- Optional: move those remaining functions into `rh-agent-callables.ts` and delete `rh-agent-dashboard-callables.ts` entirely, or rename it to `rh-agent-data-callables.ts`.
- **Auth note:** do not change `invoker: 'public'` on the remaining functions yet. Firebase Auth / App Check was not working reliably, so keep the public invoker until that is resolved and migrate all callables to auth in one pass.

### 0.2 Rename the opportunities counter to `signalsGenerated`

The old `rh-agent-opportunities` UI was removed, but the worker and run documents still use `opportunitiesFound`, `opportunitiesApproved`, `opportunitiesRejected`, and `opportunitiesExecuted`.

- Align on a single counter named `signalsGenerated`.
- Update the worker (`rh-agent-worker.ts`) to increment `signalsGenerated` instead of `opportunitiesFound`.
- Remove `opportunitiesFound`, `opportunitiesApproved`, `opportunitiesRejected`, and `opportunitiesExecuted` from `RhAgentRun` in `rh-agent-config.ts`, from run creation, and from the dashboard template.
- When a run completes, update `totalSignalsGenerated` on the `rh-agent-status` doc so the dashboard metric is no longer stale.

### 0.3 Extract symbol-list management into `RhAgentSymbolListStore`

`RhAgentGroupStore` currently owns list loading, toggling, adding, and removing in addition to grouping and signal history. That is too many responsibilities.

- Create a new `RhAgentSymbolListStore` in `src/app/features/rh-agent/stores/rh-agent-symbol-list.store.ts` (after the directory restructure).
- Move these responsibilities from `RhAgentGroupStore` into it:
  - `symbolLists`
  - `symbolListsLoading`
  - `activeListFilter`
  - `loadSymbolLists()`
  - `toggleSymbolInList()`
  - `addSymbolToList()`
  - `removeSymbolFromList()`
  - `setActiveListFilter()`
- `RhAgentGroupStore` should inject `RhAgentSymbolListStore` and read list state from it.
- Keep `RhAgentSymbolListService` as the Firestore persistence layer; the store only manages local reactive state.

### 0.4 Reorganize the `rh-agent` frontend directory structure

The current feature directory is mostly flat, which makes it hard to scan. Move page-level components, shared components, stores, and services into their own directories.

Recommended layout:

```
src/app/features/rh-agent/
  pages/
    agent-dashboard/
    agent-grouped-review/
    agent-order/
    agent-review/
    agent-triage-report/
    signal-history/
  components/
    signal-list/
    signal-detail/
    quick-charts/
    execution-panel/
    grouped-review-header/
    group-panel/
    symbol-row/
    symbol-signal-history/
    symbol-acr-actions/
    symbol-list-actions/
    chart-toolbar/
    indicator-menu/
    trade-row/
    signal-table/
    run-history-panel/
    agent-status-bar/
  stores/
    rh-agent.store.ts
    rh-agent-dashboard.store.ts
    rh-agent-group.store.ts
    rh-agent-triage.store.ts
    rh-agent-symbol-list.store.ts
    rh-agent-symbol-history.store.ts (optional)
  services/
    rh-agent.service.ts
    rh-agent-triage.service.ts
    rh-agent-symbol-list.service.ts
    rh-agent-symbol-meta.service.ts
  common/
    rh-agent.constants.ts
  utils/
    rh-agent.utils.ts
```

- Move existing page components into `pages/`.
- Move existing child components into `components/`.
- Move existing stores into `stores/` and services into `services/`.
- Update the barrel `index.ts` and all import paths.
- If you prefer page components under `components/`, use `components/pages/` instead.

---

## Phase 1 — Shared Chart Indicator Builder

`signal-detail.component.ts` and `quick-charts.component.ts` both rebuild the same ST indicator configurations, HTF zone-window dot logic, and signal-dot logic. Extract that into a single helper.

- Create `StIndicatorConfigBuilder` (or `RhAgentChartIndicators`) in a new file under `src/app/features/rh-agent/components/` or `src/app/features/rh-agent/utils/`.
- It should expose functions such as:
  - `buildBaseIndicators(timeframe)`
  - `addSignalDots(indicators, signals)`
  - `addHtfZoneWindow(indicators, weeklyBars, ...)`
- Refactor `signal-detail.component.ts` to consume the builder.
- Refactor `quick-charts.component.ts` to consume the builder.
- Remove duplicated color constants and indicator config objects from both components.

---

## Phase 2 — Grouped Review Child Components

`rh-agent-grouped-review.component.html` currently contains the header, status chips, pipeline pills, group panels, symbol rows, ACR buttons, list toggles, and the quick-charts panel all inline. Extract focused child components.

### 2.1 Extract child components

- `GroupedReviewHeaderComponent` — back button, title, signal counts, direction counts, status summary chips, pipeline pills, dimension/list selectors, prev/next, expand-all, refresh, fullscreen.
- `StatusSummaryChipsComponent` — reusable status chips so the same rendering can be used in the header and group headers.
- `GroupPanelComponent` — a single `mat-expansion-panel` for a group, including its header and the symbol list body.
- `SymbolRowComponent` — the `mat-expansion-panel` for a symbol, including ticker, signal badges, company meta, and action slots.
- `SymbolSignalHistoryComponent` — the body that shows the spinner / empty state / signal history rows.
- `SymbolAcrActionsComponent` — the review / accept / consider / reject / reset buttons.
- `SymbolListActionsComponent` — primary / secondary / neutral / avoid / hide / past-signals toggle buttons.
- `QuickChartsPanelComponent` — thin wrapper around `app-quick-charts` with the close button and placeholder.

### 2.2 Move template logic into computed signals

- Replace `visibleRows(group)`, `signalCount(group)`, and `latestSignals(row)` method calls in the template with computed signals in `RhAgentGroupStore` or the new child components.
- Move `tierLabel`, `signalDirections`, and local date formatting into a shared `rh-agent.utils.ts` utility file.

---

## Phase 3 — Dashboard / Review / Order / Detail Small Extractions

### 3.1 Dashboard

- Prune `rh-agent-dashboard.component.scss` (currently 1,259 lines with stale CSS for old filter panels and master-detail layouts).
- Extract `RunHistoryPanelComponent` and `AgentStatusBarComponent`.
- Remove `console.log` / `console.error` noise from `rh-agent.store.ts`.
- Refactor `RhAgentStore.loadData()` to use `forkJoin` instead of the manual `completedCalls` / `finalize` pattern.
- Move pure helpers (`getScheduleDescription`, `getRunStatusColor`, `getRunStatusIcon`) out of `RhAgentDashboardStore` into a utility or pipe.
- Convert `RhAgentDashboardComponent.isSyncingOverview` from a plain boolean to a signal.

### 3.2 Review page

- Extract `ReviewHeaderComponent` for the selected-symbol block, ACR buttons, and manual-symbol input.
- Make `SignalListComponent` load signal history on demand instead of eagerly loading every review symbol via an `effect()`.

### 3.3 Signal detail

- Extract `ChartToolbarComponent` (indicators menu, D/W/M toggle, range toggle, layout/fullscreen).
- Extract `IndicatorMenuComponent`.

### 3.4 Order page

- Extract `TradeRowComponent` for each row and simplify the manual `patchRow` updates.
- Avoid loading all accepted symbol histories upfront with `forkJoin`; prefer per-row `resource()` or a single batched callable.

### 3.5 Signal history

- Replace `mat-chip-listbox` filters with the existing compact pill-style toggle pattern.
- Extract `SignalTableComponent`.

---

## Phase 4 — Backend Orchestration & Worker Write Path

### 4.1 Remove duplicate trigger helpers

`rh-agent-trigger.ts` re-implements `getMarketDate`, `getDeadlineISO`, `loadEnabledSymbols`, `createDailyRun`, and `createJobAndEnqueue` even though `rh-agent-shared.ts` already provides them.

- Delete the local helper copies in `rh-agent-trigger.ts`.
- Route `rhAgentTriggerDaily` through `startRhAgentRun` so it behaves like the PDR trigger and passes intraday context correctly.
- Unify `getDeadlineISO` — remove the duplicate UTC-20:30 implementation in `rh-agent-trigger.ts` and use the shared helper from `rh-agent-shared.ts`.

### 4.2 Parallelize the worker write path

`rh-agent-worker.ts` currently writes each signal-date doc and updates each symbol gate date sequentially inside nested loops. These writes are independent.

- Extract a `SignalDateWriter` helper that encapsulates `writeSignalDateDoc`, `updateSymbolGateDate`, and `clearStaleInterimSignals`.
- Run independent writes within a single `barDate` in parallel (and across bar dates where order does not matter).
- Split the ~300-line `processSymbol` function into `loadData`, `executeStrategy`, `persistSignals`, and `clearStaleSignals` helpers.
- Batch `markJobComplete` and the run-level `signalsGenerated` increment together when possible.

### 4.3 Callable and type cleanup

- Filter or drop the unused `days` parameter in `rhAgentGetSymbolSignalHistory` (currently it loads the entire subcollection).
- Move a single `SymbolProfile` / `RhAgentSymbolProfile` type to a shared location instead of duplicating it in `rh-agent-dashboard-callables.ts`.
- Remove or wire `ManualRunRequest.strategy` — either pass the selected strategy through to the worker or delete the field.
- Remove deprecated `RH_AGENT_SIGNALS_SUBCOLLECTION` and the dead `RhAgentSignalDoc` interface from `rh-agent-config.ts`.
- Reconcile the overlapping `RhAgentRun` / `RhAgentDailyRun` interfaces and unify the `triggeredBy` type to `'manual' | 'pdr' | 'nightly'`.
- Move the `detectLastBarSignals` state machine from `st-zone-uptick.strategy.ts` into a shared `signal-detection.ts` utility so future strategies can reuse it.
- Clean up the `as unknown as StrategyAdapter` / `as any` casts in `strategy-registry.ts` by exporting a proper adapter object from the strategy file.

### 4.4 Split overview sync

`rh-agent-overview-sync.ts` currently mixes the scheduler, admin callable, and task worker.

- Split into `rh-agent-overview-sync-orchestrator.ts` (scheduler + admin callable) and `rh-agent-overview-sync-worker.ts` (task worker).
- Unify logger imports: switch `rh-agent-overview-sync.ts` to `firebase-functions/v2` logger.
- Move the hardcoded `TOP_20_SYMBOLS` list in `rh-agent-seed-admin.ts` to config.

### 4.5 Trade executor hardening

- Move hardcoded `MCP_SERVER_URL` and `AGENTIC_ACCOUNT_NUMBER` in `rh-agent-executor.ts` to environment config.
- Guard `JSON.parse(placeContent)` in the executor so a bad MCP response does not crash the function.

---

## Phase 5 — Store & Type Cleanup

- Move `getGroupKey`, `shouldShowInListFilter`, `tierLabel`, `formatLocalDate`, and the PT date helpers into `src/app/features/rh-agent/utils/rh-agent.utils.ts`.
- Move signal-history loading/caching from `RhAgentGroupStore` into a dedicated `RhAgentSymbolHistoryStore` or `resource()`-based helper.
- Align `StrategyOutput.action` with the `StSignalDirection` enum instead of relying on string values.
- Tighten `any` types in `rh-agent-group.store.ts`, `rh-agent.service.ts`, `rh-agent-symbol-list.service.ts`, `rh-agent-symbol-meta.service.ts`, and `rh-agent-triage.service.ts`.
- Use the PT date helper for `latestSignals()` in `rh-agent-grouped-review.component.ts` instead of `new Date()` in local time.
- Remove unused V1 values from `StSignalType` and remove unused `StrategyAction` from `base-strategy.ts`.
- Remove unnecessary `any` casts in the frontend service and backend worker.

---

## Phase 6 — Documentation

- Update `functions/src/rh-agent-cloud-function/README.md`: it still references the old RSI strategy, the removed `rh-agent-opportunities` collection, and endpoints that no longer exist.
- Update `docs/implementations/RH-AGENT-SIGNAL-GROUPING-PLAN.md`: mark completed phases and close open questions.
- Update `docs/implementations/RH-AGENT-PACR-PERSISTENCE-PLAN.md`: reflect the already-implemented store/service wiring and list remaining decisions.
- Archive or add a prominent "superseded" banner to `docs/dev-notes/RH-AGENT-DASHBOARD-UX-PLAN.md`.
- Add brief code-level comments to the refactored complex components (group store, signal detail) after the work is done.

---

## Implementation Order

- [x] **Phase 0** — backend cleanup, symbol-list store, opportunities counter rename, and directory restructure.
- [ ] **Phase 1** — shared chart indicator builder.
- [ ] **Phase 2** — grouped review child components.
- [ ] **Phase 3** — dashboard / review / order / detail small extractions.
- [ ] **Phase 4** — backend orchestration and worker write path.
- [ ] **Phase 5** — store/type cleanup.
- [ ] **Phase 6** — documentation.

Each phase should be a focused, reviewable change. Run `ng build` after frontend phases and run the Cloud Functions build / lint after backend phases.

## Current Phase

**Phase 1** — extract a shared chart indicator builder from `signal-detail.component.ts` and `quick-charts.component.ts`.

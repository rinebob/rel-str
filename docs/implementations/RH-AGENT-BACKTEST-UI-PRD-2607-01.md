# RH Agent Strategy Backtest Run Management UI — PRD

**Date:** 2026-07-21  
**Status:** Draft — pending review  
**Related docs:**
- `docs/implementations/RH-AGENT-BACKTEST-BACKEND-AS-BUILT-2607-01.md`
- `docs/ADR-001_strategy-backtest-system.md`
- `CONTEXT.md`
- `functions/src/rh-agent-cloud-function/backtest/backtest-types.ts`

**Depends on:** Backend `rhAgentBacktestStart` callable and `backtest-runs` / `backtest-permutations` collections already deployed.

---

## 1. Goal

Provide a single Angular page inside the RH Agent feature where the owner can manage, inspect, and rerun strategy backtest runs. The page must reuse existing RH Agent dashboard patterns (pill filters, run list cards, NgRx Signal stores, Firestore realtime listeners, Syncfusion charts) and expose the backend `backtest-runs` / `backtest-permutations` data model in a human-readable form.

---

## 2. Context

The backend persists:

- `backtest-runs/{runId}` — one job document with `status`, `symbols`, `strategyId`, `runType`, `initialCash`, `reportTier`, `totalPermutations`, `completedPermutations`, `failedPermutations`, and PT-derived `runId`.
- `backtest-permutations/{permutationId}` — one result document per `symbol + strategy + config` with `status`, `metrics`, `equityCurve`, `tradeCount`, `notes`, and optional `trades` when `reportTier === 'full'`.

The UI must surface this model so a user can answer the question: *"How did this strategy/config perform for these symbols, and should I run it again with changes?"*

---

## 3. Glossary (from `CONTEXT.md`)

| Term | Meaning |
|---|---|
| **Strategy Backtest Run** | A UI-triggered, parameterized simulation of one or more strategies against historical data for one or more symbols. |
| **Parameter Sweep** | A set of strategy configurations produced by varying numeric parameters across min/max/step ranges. Each permutation is a separate backtest task. *(Backend support is partial — out of UI scope for Phase 1.)* |
| **TradeStation-Style Report** | A full backtest report containing equity curve, trade list, and performance metrics. |
| **Quality Designation** | A user-assigned label on a backtest run that supplements the computed Calmar-based quality score. |
| **Walk-Forward Window** | An expanding-window partition of historical data into in-sample and out-of-sample segments. *(Backend support is partial — out of UI scope for Phase 1.)* |

---

## 4. User stories

- **As an owner**, I want to see all backtest runs in one list so I know what has been tested and when.
- **As an owner**, I want to filter and sort by date, symbol, strategy, and config so I can find a specific experiment quickly.
- **As an owner**, I want to see run-level progress and aggregate metrics so I know whether a run is still computing or has finished.
- **As an owner**, I want to inspect any symbol+strategy permutation so I can see its metrics, status, notes, and errors.
- **As an owner**, I want to view the full TradeStation-style report for a permutation, including equity curve and trade list, when `reportTier` is `full`.
- **As an owner**, I want to start a new backtest run with a symbol list, strategy, config, initial cash, and report tier.
- **As an owner**, I want to clone an existing run and edit its config before rerunning so I can iterate quickly.
- **As an owner**, I want to archive old runs so the default list stays focused on active work.
- **As an owner**, I want to assign a Quality Designation to a run so I can mark promising results.
- **As an owner**, I want to cancel a running run so I do not waste compute on an obsolete experiment.

---

## 5. Functional requirements

### 5.1 List runs

- Display a realtime stream of `backtest-runs` documents, sorted by `createdAt` descending.
- Each row shows:
  - `runId` (displayed in PT; keep the underlying ID as the storage key)
  - `createdAt` timestamp in PT
  - `status` icon/color
  - `strategyId`
  - symbol count
  - progress (`completedPermutations` / `totalPermutations`, plus `failedPermutations`)
  - computed Calmar ratio or aggregate return when the run is completed
  - `reportTier` badge
  - `Quality Designation` badge (if set)
- Support pagination or a "Load more" button; default to the most recent 50 runs.

### 5.2 Filter and sort

- **Status filter:** All / Pending / Running / Completed / Failed — implemented as compact pill buttons.
- **Date filter:** Today / 7 Days / 30 Days / All — implemented as compact pill buttons.
- **Strategy filter:** All / `<strategyId>` — populated from a backend strategy list.
- **Symbol search:** free-text filter on the `symbols` array.
- **Config search:** free-text search across config keys/values (e.g., `dropPct:0.01`).
- **Sort:** by `createdAt`, `totalReturnPct` aggregate, `calmarRatio` aggregate, `tradeCount` aggregate, `status`.

### 5.3 View run summary

- When a run is selected, show a summary panel computed from its `backtest-permutations` subcollection:
  - aggregate `totalReturnPct` (mean / min / max across successful permutations)
  - aggregate `calmarRatio`, `sharpeRatio`, `maxDrawdownPct`
  - total `tradeCount`
  - distribution of exit reasons
  - count of successful / failed / still-running permutations
  - list of symbols that failed with their error messages
- If the run is still running, show a live progress bar and poll the subcollection.

### 5.4 Inspect a permutation

- Clicking a permutation opens a side panel or detail view showing:
  - symbol, strategy, `config`
  - `status` and `error` (if failed)
  - `metrics` table
  - `tradeCount`
  - `notes`
  - mini equity-curve sparkline
  - link to the full TradeStation-style report
- A failed permutation must display its `error` and `notes` prominently.

### 5.5 View full TradeStation-style Report

- Available only when `reportTier === 'full'`.
- Contains:
  - Performance metrics header (`totalNetProfit`, `profitFactor`, `% Profitable`, `win/loss ratio`, `averageTrade`, `maxDrawdown`, `sharpeRatio`, `calmarRatio`).
  - Equity curve chart with `date` on the x-axis and `equity` on the y-axis.
  - Trade list table with columns: entry date, exit date, symbol, side, quantity, entry/exit marks, P&L, return %, days held, exit reason.
  - Trade detail panel for multi-leg option spreads showing each leg.
- If `reportTier === 'summary'`, show a clear message: *"Trades were not persisted for this run. Clone it with Report Tier = Full to see the trade list."*

### 5.6 Start a new run

- A "New Backtest" button opens a config form:
  - **Symbols:** textarea or symbol picker; one symbol per line or comma-separated; uppercase and trim on submit.
  - **Strategy:** dropdown populated from the backend strategy registry.
  - **Config:** dynamic form generated from the selected strategy's `configSchema`.
  - **Initial cash:** number input; default `100000`.
  - **Report tier:** Summary / Full toggle.
  - **Run type:** All Data / Expanding Window toggle (default `allData`; note that walk-forward is not yet wired end-to-end).
- On submit, call `rhAgentBacktestStart` and show a snackbar with `runId` and enqueue count.
- After submit, the new run appears in the list automatically via the realtime listener.

### 5.7 Clone / rerun with edited config

- Any completed or failed run can be cloned.
- The clone form is pre-filled with the source run's symbols, strategy, config, initial cash, and report tier.
- The user can edit any field before submitting a new run.
- Cloning must not mutate the original run.

### 5.8 Archive and delete

- **Archive** is a soft-delete toggle. Archived runs are hidden from the default list but can be shown with an "Include archived" filter.
- **Delete** is out of scope for Phase 1; if added later it must require a confirmation and be restricted to owners.

### 5.9 Cancel a running run

- A running run shows a "Cancel" action.
- Because Cloud Tasks cannot be cleanly revoked, the UI sets a `cancelling` flag locally, stops polling, and updates the run document with `status: 'cancelled'` if a backend callable supports it.
- If no cancel backend exists, the action is disabled with a tooltip explaining that the run must finish or fail on its own.

### 5.10 Quality Designation

- The user can assign a free-text label (e.g., `Promising`, `Discard`, `Review Later`) to any run.
- The label is persisted on the `backtest-runs/{runId}` document in a `qualityDesignation` field.
- The label is shown in the run list and summary.

---

## 6. Non-functional requirements

- **Timezone:** All displayed dates and the displayed `runId` must be PT; storage and IDs remain as written by the backend. Use the existing `rh-agent.utils` PT helpers.
- **Realtime:** Runs and permutations update in real time via Firestore listeners; in-progress runs must not require manual refresh.
- **Performance:** The page must handle at least 500 runs and 500 permutations without blocking the UI; use virtualization or pagination for large lists.
- **Responsiveness:** Layout works on 1440px+ desktop; tablet fallback is acceptable; mobile is not a primary target.
- **Security:** Callable invocations use the authenticated AngularFire `Functions` provider; no API keys in the frontend.

---

## 7. UI/UX

### 7.1 Page layout

- Left sidebar (or top strip, consistent with RH Agent dashboard):
  - "New Backtest" primary button.
  - Filter pills for status, date, strategy.
  - Symbol/config search input.
  - Sort dropdown.
- Main panel:
  - Runs list/table (top 60% of the viewport).
  - Run summary + permutation list (bottom or right panel; collapsible).
- Detail/Report view:
  - Full-screen overlay or child route `/rh-agent/backtest/:runId/:permutationId`.

### 7.2 Visual style

- Reuse the compact pill-style toggle buttons defined in `src/app/features/rh-agent/components/run-control-card/run-control-card.component.scss` and `signal-filter-pills.component.scss`.
- Reuse `MatTable` or the existing `.run-table` CSS pattern from `run-history-panel.component.html`.
- Reuse `MatCard`, `MatButton`, `MatIcon`, `MatTooltip`, `MatProgressSpinner`, and `MatSnackBar`.
- Equity curve uses the existing Syncfusion `ChartModule` (registered globally by the Syncfusion license in `app.config.ts`).

### 7.3 Empty and error states

- Empty list: friendly message with a "Start your first backtest" CTA.
- Failed run row: red status icon + tooltip.
- No full report: explicit explanation and a "Clone with full report" action.

---

## 8. Acceptance criteria

- [ ] User can open `/rh-agent/backtest` and see the most recent backtest runs.
- [ ] Filter pills update the visible list immediately.
- [ ] Selecting a run shows an aggregate summary and the list of its permutations.
- [ ] Selecting a permutation shows its metrics, notes, and a link to the full report.
- [ ] Full report view renders the equity curve and trade list when `reportTier === 'full'`.
- [ ] User can start a new run from the UI and see it appear in the list with `status: pending/running`.
- [ ] User can clone an existing run, edit config, and submit a new run.
- [ ] User can archive/unarchive a run.
- [ ] User can set/edit a Quality Designation label.
- [ ] All displayed dates and run IDs are in PT.

---

## 9. Out of scope

- **Parameter sweep UI** — backend orchestrator does not expand `min/max/step` grids yet.
- **Walk-forward window UI** — `runType: 'expandingWindow'` is accepted but the simulator currently replays all data.
- **Compare runs** — useful but a separate analysis view; not part of the minimum set.
- **Export / download** of reports or trade lists.
- **Hard delete** of runs.
- **Real-time chart overlays** of buy/sell arrows on the equity curve (nice-to-have for later).

---

## 10. Open questions

1. Should the new page be a top-level route (`/rh-agent/backtest`) or a tab inside the existing `/rh-agent` dashboard?
2. Do we need a new backend callable to list strategy metadata (`rhAgentBacktestStrategies`), or can the UI import a static strategy catalog?
3. Should the Quality Designation be a free-text field, an enum, or both (preset labels + custom)?
4. Should archived runs be a separate Firestore field (`archived: boolean`) or moved to a different collection?

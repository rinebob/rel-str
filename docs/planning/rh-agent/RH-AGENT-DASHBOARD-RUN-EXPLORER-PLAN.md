# RH Agent Dashboard — Run Explorer Plan

**Status:** UI complete (Phases 1–4 done). Run-centric signal storage migration pending (see "Run-Centric Signal Model" section).  
**Created:** 2026-06-29  
**Related docs:**
- `RH-AGENT-REFACTOR-PLAN.md` (Phase 3 dashboard work is complete)
- `RH-AGENT-ECOSYSTEM-INVENTORY.md`
- `RH-AGENT-SIGNAL-GROUPING-PLAN.md`
- `RH-AGENT-PACR-PERSISTENCE-PLAN.md`

---

## Goal

Rebuild the `/rh-agent` dashboard as a **Run Explorer** — the entry point for all agent runs (scheduled PDR runs at 8/10/12 AM PT, manual runs, and nightly runs). The dashboard makes **runs the primary object**: explore history, trigger new runs, monitor live progress, and jump directly into the signals produced by a specific run.

The core mental model shift: **the user selects a run, not a date**. A run is the atomic unit of work. Grouped review, review, and order pages are all scoped to the selected `runId`. Date is an implementation detail that never surfaces in the UI.

This plan covers both the dashboard entry point **and** the backend + store changes required to make the downstream pages fully run-centric. See the "Run-Centric Signal Model" section for full scope.

---

## Current Problems

1. **Status bar reads from two sources.**
   - `lastRunAt` / `lastRunStatus` come from `rh-agent-status/current` (`store.status()`).
   - `triggeredBy` comes from the latest `rh-agent-runs` doc (`uiStore.currentRun()`).
   - The two sources can drift, and the component has to reconcile them.

2. **Run history is a basic nested accordion.**
   - No filtering, search, or grouping.
   - No progress visualization for running runs.
   - No direct link to "review signals from this run" — clicking a run does nothing useful.
   - The "previous runs" section is hidden behind a second accordion.

3. **Dashboard is not run-centric.**
   - The header mixes navigation, run trigger, date picker, overview sync, bars backfill, and refresh.
   - "Run Now" is present but not the visual hero of the page.

4. **Dead state in `RhAgentDashboardStore`.**
   - `selectedSignalId` is leftover from when the dashboard had a signal detail panel.

### Out-of-scope cleanup (separate follow-up commit)

- **Child component styles live in the parent SCSS.**
  - `run-history-panel.component.scss` and `agent-status-bar.component.scss` are empty; the styles are in `rh-agent-dashboard.component.scss` under `:host ::ng-deep`.
  - This is a leftover task from the recent refactor. It should be fixed as a separate follow-up commit to the refactor effort, not mixed into the Run Explorer feature work.

---

## Proposed Design: Run Explorer

### Page layout (proposed)

Below is a proposed layout that consolidates the controls already present in the existing dashboard. It does not add new capabilities.

```
┌─────────────────────────────────────────────────────────────┐
│  Header: RH Agent        [Enabled badge]  [Review Latest Signals]  │
├──────────────────────────────────────────────────────────────────┤
│  Run Control Card                                                │
│  [Run Now]  Manual • PDR • Nightly                               │
│  Recent  │  Last 7 days  │  All  │  [Refresh]                    │
├──────────────────────────────────────────────────────────────────┤
│  Metrics Strip (selected run or unfiltered view)                 │
│  Selected: Symbols Processed / Total │ Signals │ Duration        │
│  No selection: Recent runs │ Running │ Last Run Status │ Symbols  │
├──────────────────────────────────────────────────────────────────┤
│  Run Status Bar (single source of truth)                        │
│  Last Run: ... │ Status: ... │ Triggered By: ... │ Schedule: ... │ Next Run: ... │
├──────────────────────────────────────────────────────────────────┤
│  Run List (table)                                                │
│  Status │ Date/Time │ Trigger │ Market Date │ Progress │ Signals │ Actions │
├──────────────────────────────────────────────────────────────────┤
│  [Run detail expansion]                                          │
│  Run ID, summary, and [Review Signals] button → grouped review   │
└──────────────────────────────────────────────────────────────────┘
```

### Components / pieces

| Piece | Responsibility |
| --- | --- |
| `rh-agent-dashboard.component` | Compose the explorer, own run trigger controls. |
| `run-status-bar.component` | Single-line status summary; read from `RhAgentStore.runs()` or `status()` consistently. |
| `run-control-card.component` | Run Now button + trigger filter + quick run-list filters. No date picker — runs are always triggered for the current market date. |
| `run-metrics-strip.component` | Metric tiles for the selected run, today's runs, or current view. |
| `run-history-panel.component` | Filtered, sortable table run list with live progress and expand detail. |
| `run-detail-expansion.component` | Expanded run metadata + summary + **Review Signals** button → sets `activeRunId` and navigates to grouped review. |

### Filter enums

All filter values are enums (not raw string unions):

```typescript
export enum RhAgentRunTriggerFilter {
  ALL = 'all',
  MANUAL = 'manual',
  PDR = 'pdr',
  NIGHTLY = 'nightly',
}

export enum RhAgentRunDateFilter {
  TODAY = 'today',
  WEEK = 'week',
  ALL = 'all',
}

export enum RhAgentRunStatusFilter {
  ALL = 'all',
  RUNNING = 'running',
  SUCCESS = 'success',
  FAILED = 'failed',
  PARTIAL = 'partial',
}
```

### State changes

- Remove `selectedSignalId` from `RhAgentDashboardStore`.
- Add `runFilter` state to `RhAgentDashboardStore` using the enums above.
- Add `selectedRunId` state so the metrics strip can show per-run stats.
- Add computed signals for filtered runs and selected-run metrics.
- Use `watchRecentRunsRealtime` from `RhAgentService` for live run progress. Keep callable fetch for initial load / history deeper than the realtime limit.

### Style cleanup (done in separate follow-up commit)

- Move `run-history-panel` styles from `rh-agent-dashboard.component.scss` into `run-history-panel.component.scss`.
- Move `run-status-bar` styles from `rh-agent-dashboard.component.scss` into `run-status-bar.component.scss`.
- Remove `:host ::ng-deep` wrapping in the dashboard SCSS.
- Keep the dashboard SCSS focused on layout and composition.
- *Note: this is a leftover refactor cleanup task. It is intentionally a separate commit from the Run Explorer feature work.*

### Data flow

```
┌────────────────────────────────────────┐
│  RhAgentDashboardComponent             │
│  ┌──────────────┐  ┌────────────────┐  │
│  │ Run Control  │  │ Run Metrics    │  │
│  │ Card         │  │ Strip          │  │
│  └──────────────┘  └────────────────┘  │
│  ┌──────────────────────────────────┐  │
│  │ Run Status Bar                   │  │
│  └──────────────────────────────────┘  │
│  ┌──────────────────────────────────┐  │
│  │ Run History Panel                │  │
│  └──────────────────────────────────┘  │
└──────────────────┬─────────────────────┘
                   │
         ┌─────────┴─────────┐
         │ RhAgentStore      │  status + runs
         │ RhAgentDashboardStore │ UI filter state
         │ RhAgentService      │  callables + Firestore realtime
         └───────────────────┘
```

---

## Implementation Phases

### Phase 0 — Style Cleanup (separate follow-up commit)

1. Move `run-history-panel` styles into `run-history-panel.component.scss`.
2. Move `run-status-bar` styles into `run-status-bar.component.scss`.
3. Remove `ng-deep` child styles from `rh-agent-dashboard.component.scss`.
4. Rename `agent-status-bar` component to `run-status-bar` in code and templates.

### Phase 1 — Cleanup (foundational)

1. Remove `selectedSignalId` from `RhAgentDashboardStore`.
2. Fix run status bar to read from a single source (latest run or status doc, not both).
3. Add filter enums to `rh-agent.constants.ts` or a new `rh-agent-run.constants.ts`.

### Phase 2 — Run Control & Metrics

1. Extract `run-control-card.component` with Run Now + trigger filter. No date picker — backfilling past signal docs is not needed since chart signals are computed on-the-fly from price bars.
2. Extract `run-metrics-strip.component` with metrics based on the selected run or current filtered view:
   - Selected run: `symbolsProcessed / totalSymbols`, `signalsGenerated`, `status`, `duration`.
   - No selection: `recent runs`, `running runs`, `last run status`, `symbols monitored`.
   - Avoid lifetime aggregates (e.g., total signals ever generated) — they are not useful here.
3. Add filter state to `RhAgentDashboardStore` using the enums.
4. Add `selectedRunId` state and computed filtered/selected run signals.
5. Add next-expected-run computation to the run status bar.

### Phase 3 — Run History Explorer

1. Rewrite `run-history-panel.component` as a sortable/filterable **table**.
2. Add live progress indicator for running runs (driven by realtime updates).
3. Add expand detail with run metadata and summary.
4. Add "Review Signals" action on each run row — calls `groupStore.setActiveRun(run.id)` and navigates to grouped review. Signals are scoped to the selected `runId`; no date logic involved.

### Phase 4 — Real-time Run Streaming

1. Subscribe to `rh-agent-runs` via `watchRecentRunsRealtime` in `RhAgentStore`.
2. Keep loading state minimal during live updates.
3. Keep callable fetch as fallback for deep history beyond the realtime query limit.
4. For single-user admin dashboard, Firestore read cost is acceptable. If usage changes, revisit.

### Future ideas (not in this plan)

- **Run monitor dialog** — automatically pop up a focused dialog when a run starts, showing live worker progress, per-symbol status, and signals as they are generated. Could be expensive in terms of Firestore reads and UI complexity; defer until the basic explorer is solid.

### Phase 5 — Documentation

1. Update `RH-AGENT-ECOSYSTEM-INVENTORY.md` with new/renamed components.
2. Update `RH-AGENT-REFACTOR-PLAN.md` to reference this plan for dashboard v2.
3. Mark this plan complete.

---

## Open Questions (Resolved)

1. **Real-time vs. polled runs** — **Resolved:** Use real-time streaming from `rh-agent-runs`. Scheduled PDR and nightly runs are known; manual runs are the ones most in need of live progress. Single-user admin dashboard makes Firestore cost acceptable.
2. **Run list format** — **Resolved:** Compact table for density.
3. **Filtering dimensions** — **Resolved:** Filter by `triggeredBy` and `status`.
4. **Link to signals** — **Resolved:** Signals are now stored per `runId` (not `marketDate`). Each run has its own isolated signal set. No date ambiguity. See "Run-Centric Signal Model" section.
5. **Manual run date range** — **Resolved:** Remove the date picker entirely. Chart signals are computed on-the-fly from price bars, so backfilling stored signals for past dates has no value. Run Now always triggers for the current market date.
6. **Next expected run** — **Resolved:** Yes, compute from the cron expression in the run status bar.

---

## Run-Centric Signal Model (supersedes date-centric approach)

### Problem with the date-centric model

Signals were stored and retrieved by `marketDate`. This means:
- At midnight the date changes and yesterday's signals disappear from the review UI.
- Multiple runs on the same date (PDR at 8/10/12 AM, nightly) produce signals that overwrite or conflict under the same date key.
- The UI must constantly reconcile "what date is today" with "what run am I looking at" — two concepts that should be one.

### New mental model: the run is the unit of review

The user selects a **run**, not a date. Everything downstream — grouped review, review page, signal charts — is scoped to that `runId`. Date is an internal implementation detail that never surfaces in the UI.

### Backend changes required

**Firestore schema change:**

Replace:
```
rh-agent-symbols/{symbol}/signal-dates/{barDate}
```
With:
```
rh-agent-symbols/{symbol}/run-ids/{runId}
```

The signal doc structure is unchanged — only the path key changes from `barDate` to `runId`. `barDate` and `marketDate` remain as fields inside the doc (they are data, not the key).

**Functions to update:**
- `rh-agent-worker.ts` — write signals to `run-ids/{runId}` instead of `signal-dates/{barDate}`
- `rhAgentGetSymbolsWithSignals` callable — accept `runId` instead of `marketDate`
- `rhAgentGetSymbolSignalHistory` callable — read from `run-ids/{runId}`
- Firestore rules — add `run-ids` subcollection rule, keep `signal-dates` readable (no writes)

**Migration:**
No migration script. Existing `signal-dates` history is left in place but the UI stops reading from it. History starts fresh from the schema change. Old signals were exploratory/educational and do not need to be preserved in the new structure.

### Rollout sequence

Backend must be deployed before frontend is cut over. Do not switch frontend to `runId` while the backend still writes to `signal-dates`.

1. **Backend** — update worker to write to `run-ids/{runId}`, update callables to accept `runId`, update Firestore rules.
2. **`RhAgentService`** — add `runId`-based method signatures alongside old date-based ones. Do not delete old methods yet.
3. **`RhAgentGroupStore`** — swap `setMarketDate` → `setActiveRun`, update `loadSymbolsWithSignals` to pass `runId`. This fixes grouped review's signal symbol list (including the "show all symbols" toggle which is driven by this same store).
4. **`RhAgentTriageStore`** — replace `marketDate` state with `activeRunId`.
5. **Dashboard** — add `selectRun(run)` action + "Review Latest Signals" button.
6. **Cut over** — delete old date-based service methods once all consumers are updated.

### Features that survive unchanged

- **"Show all symbols" toggle** (`showAllSymbols` in `RhAgentGroupStore`) — filters between signal-only and full group view. Driven by the group store; works correctly once `loadSymbolsWithSignals` passes `runId` instead of `marketDate`. No additional changes needed.
- **Manual symbol input on review page** (`manualSymbol` input on `signal-detail`) — loads price bars for any arbitrary symbol via `HeatmapChartStore`. Completely independent of run/signal context. No changes needed.

### Frontend changes required

**`RhAgentGroupStore`:**
- Replace `setMarketDate(date)` with `setActiveRun(runId: string)`
- `loadSymbolsWithSignals()` passes `runId` to the backend callable instead of `marketDate`
- Remove all `marketDate` state from the store

**`RhAgentTriageStore`:**
- Replace `marketDate` state with `activeRunId: string | null`
- Remove `todayPT()` — the store never assumes a date on its own
- Triage decisions are still persisted with a date to Firestore (internal implementation detail), but this is hidden from the UI layer
- `setMarketDate()` method replaced by `setActiveRun(runId: string)` which derives the date internally from the run object when needed for persistence

**Dashboard (`rh-agent-dashboard.component`):**
- Each run row in the run list has a **"Review Signals"** action that calls `groupStore.setActiveRun(run.id)` and navigates to grouped review
- **"Review Latest Signals"** button (replaces current "Go to Grouped Review") auto-selects `store.latestRun().id`
- No date picker involvement in the review flow

**Grouped review / review pages:**
- Read `activeRunId` from store
- Pass `runId` to signal fetch callables
- Remove all date-based signal loading

### Impact on "current signal set caveat"

The caveat in the Notes section below is now resolved by this model. Since signals are stored per `runId`, there is no ambiguity about which signals belong to which run. Each run has its own isolated signal set. The user always sees exactly the signals produced by the run they selected.

---

## Notes

- The run-centric signal model above requires both backend and frontend changes — it is not presentation-layer only. See the section above for full scope.
- The grouped review, agent review, and agent order pages require updates to switch from date-based to run-based signal fetching.

### Tech debt: shared SA price bar service (`PRICE-BAR-SERVICE`)

`signal-detail.component` currently imports `HeatmapChartStore` (a heatmap-feature class) solely to fetch full OHLC history from SavantAPI for chart rendering. This is a domain boundary violation.

The correct fix is a shared `SaDataService` in `src/app/core/services/` that wraps `RsBarsService` + the daily→weekly/monthly aggregation utilities. `rh-agent` should be migrated to use it first, then `heatmap-chart` refactored to use it, and the wrapper removed from `HeatmapChartDataService`.

This is out of scope for the Run Explorer work. All three affected files are tagged with `// @techdebt PRICE-BAR-SERVICE` for greppability.

### Schedule modification (not in this plan)

Adding, editing, or deleting scheduled runs (e.g., changing the 8/10/12 PDR times or adding new scheduled triggers) is feasible but is a separate feature. It would require:
- A backend schedule config document (e.g., `rh-agent-config/schedule`).
- A Cloud Function or scheduler logic that reads the dynamic config instead of using hardcoded triggers.
- A frontend schedule editor UI.

That is **not** part of the Run Explorer dashboard work. It should be its own plan if needed later.

### Run Explorer vs. Mission Control / Pipeline-Stage View

- **Run Explorer** (this plan): focused on the runs themselves — history, trigger, progress, and the signals produced by each run. The run is the primary object.
- **Mission Control / Pipeline-Stage View** (future idea): a higher-level operational view showing the health of each stage of the workflow — runs → triage → review → order — with counts, bottlenecks, and next actions. It would answer "where is the work right now?" rather than "what happened in this run?"

If Mission Control is built later, the Run Explorer becomes the dedicated **Run History** tab or section within it.

### Current signal set caveat

**Resolved — superseded by the run-centric signal model.** Signals are stored per `runId`, not per `barDate`. Each run has its own isolated signal set at `rh-agent-symbols/{symbol}/run-ids/{runId}`. There is no ambiguity about which signals belong to which run. See the "Run-Centric Signal Model" section.

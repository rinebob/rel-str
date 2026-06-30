# RH Agent Ecosystem Inventory

**Status:** Complete (matching current implementation)  
**Updated:** 2026-06-29

A living map of every file that makes up the RH Agent feature, including the
frontend Angular code, the Firebase Cloud Functions backend, supporting scripts,
and implementation plans.

Use this doc as the first stop when onboarding, debugging, or planning changes.

> All RH-related TypeScript files now have method-level JSDoc coverage. See
> `docs/implementations/RH-AGENT-REFACTOR-PLAN.md` Phase 6 for the documentation
> task list.

## Table of Contents

1. [Frontend](#frontend)
2. [Backend](#backend)
3. [Scripts](#scripts)
4. [Documentation](#documentation)
5. [Data Flow](#data-flow)
6. [Firestore Collections](#firestore-collections)

---

## Frontend

Location: `src/app/features/rh-agent/`

The frontend is organized as a standard Angular feature module: `common`,
`components`, `pages`, `services`, `stores`, and `utils`. Public symbols are
re-exported from `index.ts`.

### Entry point

- `index.ts` — Barrel file that exports the public API of the feature
  (components, stores, services, constants, and types) for cross-feature imports.

### Common

- `common/rh-agent.constants.ts` — Shared enums, status constants, and type
  aliases (`RhReviewStatus`, `GroupDimension`, `MarketCapTier`, symbol list
  names, etc.).

### Services

- `services/rh-agent.service.ts` — Main API to the backend Cloud Functions:
  manual runs, status, run history, symbol/signal queries, bars backfill, and
  overview sync. Defines the primary shared interfaces
  (`RhAgentSymbolProfile`, `RhAgentSignalItem`, etc.).
- `services/rh-agent-symbol-list.service.ts` — CRUD for user-defined symbol
  lists / watchlists in `rh-agent-symbol-lists`.
- `services/rh-agent-symbol-meta.service.ts` — Universe management: add,
  tag, and type symbols in `rh-agent-symbol-meta`.
- `services/rh-agent-triage.service.ts` — PACR persistence: load, listen,
  and write decisions to `rh-agent-triage-decisions`.

### Stores

- `stores/rh-agent.store.ts` — Legacy dashboard-level store: agent status,
  run history, manual run trigger, and bars backfill.
- `stores/rh-agent-dashboard.store.ts` — Dashboard-specific state (runs,
  status, recent activity) for the `/rh-agent` landing page.
- `stores/rh-agent-group.store.ts` — Phase 5 grouped-review state: signal
  symbols, grouping by dimension, selected symbol, quick chart, and
  show-all-symbols toggle.
- `stores/rh-agent-symbol-history.store.ts` — Per-symbol signal history cache
  used by the group store and the detail panel.
- `stores/rh-agent-symbol-list.store.ts` — Reactive local state for symbol
  lists, including the active filter and optimistic add/remove operations.
- `stores/rh-agent-triage.store.ts` — Root PACR state shared across the review,
  grouped-review, and order pages; persists through `RhAgentTriageService`.

### Utils

- `utils/rh-agent.utils.ts` — Shared pure helpers: PT date formatting, group
  key derivation, list filtering, market-cap tier labels, and the
  `isRecentSignalDate` helper.
- `utils/rh-agent-chart-indicators.ts` — Builders and computed transforms for
  ST trend/zone/window/uptick indicators rendered in the flex chart.

### Pages

- `pages/agent-dashboard/rh-agent-dashboard.component.{ts,html,scss}` —
  Landing page: status cards, run history, and action buttons.
- `pages/agent-grouped-review/rh-agent-grouped-review.component.{ts,html,scss}` —
  Phase 5 master review page: grouped symbols, detail panel, quick charts, and
  group-level PACR actions.
- `pages/agent-review/rh-agent-review.component.{ts,html,scss}` —
  Traditional signal-by-signal review list.
- `pages/agent-order/rh-agent-order.component.{ts,html,scss}` —
  Order page for accepted symbols; hands off to the execution/MCP flow.
- `pages/agent-triage-report/rh-agent-triage-report.component.{ts,html,scss}` —
  PACR report by status and date range.
- `pages/signal-history/signal-history.component.{ts,html,scss}` —
  Standalone signal history page.

### Components

- `components/agent-status-bar/agent-status-bar.component.{ts,html,scss}` —
  Compact status bar shown on agent pages.
- `components/chart-toolbar/chart-toolbar.component.{ts,html,scss}` —
  Zoom/pan toolbar for the flex chart.
- `components/execution-panel/execution-panel.component.{ts,html,scss}` —
  Displays MCP/trade execution status and controls.
- `components/group-panel/group-panel.component.{ts,html,scss}` —
  Renders one expansion panel inside the grouped review.
- `components/grouped-review-header/grouped-review-header.component.{ts,html,scss}` —
  Header for the grouped-review page: date picker, group dimension, counts.
- `components/indicator-config-dialog/indicator-config-dialog.component.ts` —
  Dialog for configuring indicator parameters.
- `components/indicator-menu/indicator-menu.component.{ts,html,scss}` —
  Dropdown menu to toggle chart indicators.
- `components/quick-charts/quick-charts.component.{ts,html,scss}` —
  Inline chart preview for a symbol.
- `components/quick-charts-panel/quick-charts-panel.component.{ts,html,scss}` —
  Side panel hosting quick charts in the grouped review.
- `components/review-header/review-header.component.{ts,html,scss}` —
  Header for the classic review page.
- `components/run-history-panel/run-history-panel.component.{ts,html,scss}` —
  List of recent agent runs with status chips.
- `components/signal-detail/signal-detail.component.{ts,html,scss}` —
  Detail panel with single/triple D/W/M charts and indicator toggles.
- `components/signal-list/signal-list.component.{ts,html,scss}` —
  Flat list of signals for a selected symbol or date.
- `components/signal-table/signal-table.component.{ts,html,scss}` —
  Tabular view of signals.
- `components/symbol-acr-actions/symbol-acr-actions.component.{ts,html,scss}` —
  Per-symbol Accept/Consider/Reject action buttons.
- `components/symbol-list-actions/symbol-list-actions.component.{ts,html,scss}` —
  UI for adding/removing a symbol from user lists.
- `components/symbol-row/symbol-row.component.{ts,html,scss}` —
  Single symbol expansion row used by the group panel.
- `components/symbol-signal-history/symbol-signal-history.component.{ts,html,scss}` —
  Displays the signal history for one symbol row.

---

## Backend

Location: `functions/src/rh-agent-cloud-function/`

The backend is a set of Firebase Cloud Functions (v2) plus a shared strategy
registry. It reads from the `rs-bars` cache, runs the ST Zone Uptick strategy,
writes signals to `rh-agent-symbols/{symbol}/signal-dates`, and exposes
admin/trigger/status callables.

### Orchestration & triggers

- `rh-agent-trigger.ts` — Pub/Sub and scheduled entry points that start daily
  runs: fetch intraday snapshots, write partial bars, enqueue symbol jobs.
- `rh-agent-overview-sync-orchestrator.ts` — Cloud Task orchestrator that
  schedules one overview-sync worker per enabled symbol.
- `rh-agent-overview-sync-worker.ts` — Cloud Task worker that fetches and
  stores Seeking Alpha company overview data on a symbol document.
- `rh-agent-shared.ts` — Shared helpers used by the trigger and worker:
  intraday snapshot fetching, partial bar writing, and job enqueueing.

### Worker & persistence

- `rh-agent-worker.ts` — Cloud Task worker that processes one symbol per task:
  load cached bars, execute the strategy, persist signals, clear stale interim
  signals, and mark the job complete.
- `rh-agent-signal-date-writer.ts` — Encapsulates writing a signal entry to
  `rh-agent-symbols/{symbol}/signal-dates/{barDate}`.

### Callables

- `rh-agent-callables.ts` — Public/on-call functions: `rhAgentManualRun`,
  `rhAgentGetStatus`, `rhAgentGetRunHistory`, `rhAgentGetSymbolsWithSignals`,
  `rhAgentGetSymbolSignalHistory`.
- `rh-agent-dashboard-callables.ts` — Admin/dashboard callables such as
  `rhAgentOverviewSyncAdmin` and run-management helpers.
- `rh-agent-executor.ts` — MCP trade execution callable: places orders via the
  RH Agent MCP server using Firebase secrets.
- `rh-agent-seed-admin.ts` — Admin callable to seed or reset RH Agent data.

### Configuration & types

- `rh-agent-config.ts` — Central type definitions and enums: runs, jobs,
  signals, statuses, symbol metadata, intraday snapshots, and collection names.
- `README.md` — Cloud Function README: architecture, collections, setup,
  signal strategy, and local development.

### Strategies

- `strategies/base-strategy.ts` — `StrategyAdapter`, `StrategyInput`,
  `StrategyOutput`, and `StrategyId` contracts used by the worker and registry.
- `strategies/signal-detection.ts` — Pure signal-detection helpers for
  zone/uptick logic shared across timeframes.
- `strategies/strategy-registry.ts` — Registry singleton that maps strategy
  IDs to implementations and exposes metadata/config validation.
- `strategies/st-zone-uptick/st-zone-uptick.strategy.ts` — ST Zone Uptick
  strategy implementation: detects V1 and V2 long/short signals on daily and
  weekly timeframes.

### Supporting backend files

- `functions/src/rs-bars/rs-bars-sync.ts` — Bars cache types (`OhlcBar`,
  `RsBarsDoc`) and the `rsBarsSyncAdmin` callable that fetches and caches
  daily/weekly/monthly bars for symbols. Heavily used by the RH Agent worker.
- `functions/src/scheduled/sync-tracked-symbols.ts` — Scheduled job that keeps
  the tracked symbol list in sync with external data sources; feeds the RH Agent
  universe.

---

## Scripts

- `scripts/trigger-rh-agent-run.js` — Local script to trigger a manual run
  against the emulator or production.
- `scripts/test-rh-agent-callables.js` — Local script to exercise the RH Agent
  callable endpoints.
- `scripts/cleanup-rh-agent-signals.js` — Local script to remove stale signal
  documents.
- `functions/scripts/seed-rh-agent-from-prod.ts` — Admin script to seed the
  emulator Firestore from production data.

---

## Documentation

- `docs/implementations/RH-AGENT-REFACTOR-PLAN.md` — Master plan for the
  multi-phase refactor (Phases 0-6).
- `docs/implementations/RH-AGENT-SIGNAL-GROUPING-PLAN.md` — Plan for
  symbol-centric signal grouping and grouped review UI.
- `docs/implementations/RH-AGENT-PACR-PERSISTENCE-PLAN.md` — Plan for PACR
  decision persistence and universe management.
- `docs/implementations/RH-AGENT-ECOSYSTEM-INVENTORY.md` — This file: the full
  inventory of the RH Agent ecosystem.
- `docs/planning/rh-agent/RH-AGENT-ARCH.md` — Higher-level architecture and
  long-term design notes.
- `docs/dev-notes/RH-AGENT-DASHBOARD-UX-PLAN.md` — Superseded historical UX
  plan; kept for reference with a banner.
- `functions/src/rh-agent-cloud-function/README.md` — Backend README for the
  Cloud Functions subsystem.

---

## Data Flow

```
┌─────────────────────────────────────────────────────────────────┐
│  Frontend (Angular)                                               │
│  ┌─────────────┐  ┌──────────────┐  ┌──────────────────────┐  │
│  │ RhAgentStore│  │RhAgentGroupStore│  │ RhAgentTriageStore   │  │
│  └──────┬──────┘  └───────┬──────┘  └──────────┬───────────┘  │
│         │                 │                      │              │
│  ┌──────▼──────┐  ┌────────▼──────┐  ┌───────────▼──────────┐  │
│  │ RhAgentService│  │ RhAgentSymbol│  │ RhAgentTriageService │  │
│  └──────┬──────┘  │ History/List   │  └───────────┬──────────┘  │
│         │         │ Services       │              │             │
│  ┌──────▼──────┐  └───────┬───────┘  ┌───────────▼──────────┐  │
│  │ httpsCallable│         │          │ Firestore reads/writes│  │
│  └──────┬──────┘         │          └───────────┬──────────┘  │
└───────┬─────────────────┬──────────────────────┬──────────────┘
        │                 │                      │
        │                 │  ┌───────────────────┘
        │                 │  │
        │                 │  ▼
        │                 │  rh-agent-triage-decisions
        ▼                 ▼
   Cloud Functions   Firestore
   rh-agent-callables
   rh-agent-trigger
   rh-agent-worker
   rh-agent-executor
```

1. **Scheduled/PDR/manual trigger** (`rh-agent-trigger.ts`) fetches the latest
   intraday snapshot, writes partial bars to `rs-bars`, and enqueues one Cloud
   Task per enabled symbol.
2. **Worker** (`rh-agent-worker.ts`) loads cached bars from `rs-bars`, runs the
   ST Zone Uptick strategy, and writes signal entries to
   `rh-agent-symbols/{symbol}/signal-dates/{barDate}`.
3. **Frontend** reads aggregated symbol profiles and signal history through
   callables/Firestore, groups them, and persists PACR decisions to
   `rh-agent-triage-decisions`.
4. **Order page** accepted symbols are handed to `rh-agent-executor.ts` which
   calls the RH Agent MCP server to place trades.

---

## Firestore Collections

| Collection | Purpose |
| --- | --- |
| `rh-agent-symbols` | Master symbol documents with overview fields and pointers to latest signals. |
| `rh-agent-symbols/{symbol}/signal-dates/{barDate}` | Per-bar-date signal entries. |
| `rh-agent-runs` | Daily run metadata and per-symbol job status. |
| `rh-agent-status/current` | Singleton with last-run status, total runs, and total signals. |
| `rh-agent-triage-decisions` | PACR decisions keyed by `{symbol}_{date}`. |
| `rh-agent-symbol-lists` | User-defined watchlists keyed by list name. |
| `rh-agent-symbol-meta` | Symbol-level universe metadata (type, tags, score, notes). |
| `rs-bars` | Cached daily/weekly/monthly OHLCV bars used by the worker. |

---

## Maintenance notes

- Keep this inventory updated when adding, removing, or renaming files.
- Add new backend callables to both the backend `README.md` and the Data Flow
  section above.
- Add new frontend pages/stores/services to the relevant sections.

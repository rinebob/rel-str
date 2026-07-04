# RH Agent — Target Architecture

- **Status**: proposed
- **Planning doc(s)**: `RH-AGENT-ARCH.md`, `RH-AGENT-REFACTOR-PLAN.md`, `RH-AGENT-RS-BARS-CHART-MIGRATION-PLAN.md`
- **Area**: BE / FE
- **Scope**: ARCH
- **Created**: 2026-07-03
- **Last updated**: 2026-07-03

## Intent

This document describes the optimal target architecture for the RH Agent feature after the thermonuclear remediation. It is not a task list; it is the north-star design that the remediation tasks should move the codebase toward.

The current remediation plan (`RH-AGENT-THERMO-2607-01`) fixes concrete bugs, removes dead code, and decomposes monolithic files. This document explains the architectural principles behind those tasks and the end-state structure they should produce.

## Core architectural principles

1. **Single source of truth for price data**
   - `rs-bars/{symbol}` is the canonical source for daily, weekly, and monthly OHLC bars.
   - The nightly `rsBarsSyncNightly` function is the only writer of real EOD bars.
   - Intraday prices are injected only when needed, at the edges (workers, chart service), not persisted back to `rs-bars` as real bars.

2. **Backend owns all indicator math**
   - The backend callable `rhAgentGetSymbolIndicatorSeries` is the source of truth for ST indicators and signal markers.
   - The frontend should not duplicate indicator calculations. Inline calculators are a transitional state and should be removed once the callable is proven reliable.

3. **Signals are canonical + latest**
   - **Canonical history**: `rh-agent-symbols/{symbol}/signal-history/{barDate}` stores the permanent record.
   - **Latest review**: a single `latest-signals` doc per symbol (or a `run-ids` subcollection with TTL) supports the grouped review UI. The UI should not query all historical run-ids to find the latest signals.

4. **Workers are pure orchestrators**
   - A worker loads data, executes a pure strategy, persists results, and reports progress.
   - Strategy execution is side-effect-free and selected from a registry.
   - Persistence is atomic and delegated to focused persisters.

5. **Callable layer is thin and secure**
   - Entrypoints validate input, enforce auth, call domain helpers, and return responses.
   - No domain logic lives in callable handlers.
   - No public invokers, no `cors: true`, no hardcoded defaults.

6. **Frontend is layered by responsibility**
   - Services talk to backend.
   - Stores own reactive state.
   - Components own layout.
   - Utilities are pure and stateless.

7. **Types are shared across the boundary**
   - Firestore contracts, callable payloads, and shared enums live in one place.
   - The frontend imports from the same source as the backend, or from a generated types package.

## Target backend architecture

### Directory structure

```
functions/src/rh-agent-cloud-function/
  entrypoints/
    rh-agent-trigger.ts              # Pub/Sub trigger (optional/legacy)
    rh-agent-callables.ts            # Manual run + intraday snapshot
    rh-agent-dashboard-callables.ts  # Status, run history, signals query
    rh-agent-indicator-series.ts     # Chart indicator callable
    rh-agent-executor.ts             # MCP trade execution
    rh-agent-overview-sync.ts        # Overview sync orchestrator
    rh-agent-seed-admin.ts           # Admin symbol management
  domain/
    runs/
      create-run.ts                  # Run doc creation
      enqueue-jobs.ts                # Shared symbol job enqueueing
      track-progress.ts              # Run/job progress tracking
    symbols/
      load-symbols.ts                # Enabled symbol loading
      overview-sync.ts               # Company overview fetch/write
    bars/
      load-bars.ts                   # rs-bars reader + intraday injection
    signals/
      signal-detection.ts            # Pure signal detection
      signal-persister.ts            # Atomic signal writes
      signal-history.ts              # History + latest signal queries
    indicators/
      indicator-computation.ts       # Pure indicator math
      indicator-series.ts            # Callable response builder
  strategies/
    base-strategy.ts
    strategy-registry.ts
    st-trend-rider/
      st-trend-rider.strategy.ts
  contracts/
    rh-agent-types.ts                # All shared interfaces
    rh-agent-enums.ts                # All enums
    rh-agent-collections.ts          # Collection names
    rh-agent-cors.ts                 # Shared CORS allowlist
  shared/
    firestore-helpers.ts
    date-helpers.ts
```

### Data flow

```
Trigger / Manual callable
    │
    ▼
Create run doc + enqueue jobs
    │
    ▼
Cloud Tasks: rhAgentProcessSymbol (per symbol)
    │
    ├─ loadBars(symbol, marketDate)    → reads rs-bars/{symbol}, injects intraday
    ├─ strategyRegistry.execute(...)   → pure signal detection
    ├─ signalPersister.persist(...)    → atomic write to signal-history + latest-signals
    └─ runTracker.completeJob(...)     → update run/job counters
    │
    ▼
Frontend dashboard / review / charts
```

### Key design decisions

| Decision | Current state | Target state |
|----------|---------------|--------------|
| Price source | `rs-bars/{symbol}` + intraday injection | Same, but intraday injection is centralized in `loadBars` |
| Indicator source | Frontend inline + backend callable | Backend callable only |
| Signal storage | `run-ids` + `signal-history` | `signal-history` canonical + `latest-signals` per symbol |
| Strategy selection | Hardcoded `DEFAULT_STRATEGY` | Read from run doc or config |
| Worker shape | Monolithic 555-line function | Thin orchestrator calling focused helpers |
| Callable security | Public invokers, `cors: true` | Auth-enforced, explicit CORS allowlist |

## Signal strategy

### ST Trend Rider

- The only active strategy is **ST Trend Rider** (`st-trend-rider`). The old `st-zone-uptick` name is retired.
- It fires on **same-timeframe zone transitions** where the zone is already on the correct side of zero:
  - **Long**: zone value increases from one bar to the next, and the previous zone was already >= +1.
  - **Short**: zone value decreases from one bar to the next, and the previous zone was already <= -1.
- V1 uses the ±3 zone classification; V2 uses the ±4 zone classification.
- **Higher-timeframe (HTF) filters are retired.** The strategy does not gate signals by a higher-timeframe zone context, and the code/comments should not refer to HTF gating in relation to this strategy.
- **Counter-trend signals** are not implemented yet. The unused `*_CT_*` enum values will be removed and reintroduced later with a clean design when that work is prioritized.
- The strategy should be a pure function: given bars, return signals. No Firestore writes, no side effects, no HTF cross-checking.

## Target frontend architecture

### Directory structure

```
src/app/features/rh-agent/
  pages/
    agent-dashboard/
    agent-grouped-review/
    agent-review/
    agent-order/
    agent-triage-report/
  components/
    signal-detail/
    quick-charts/
    grouped-review-header/
    group-panel/
    symbol-row/
    symbol-signal-history/
    symbol-acr-actions/
    symbol-list-actions/
    chart-toolbar/
    indicator-menu/
    signal-table/
    trade-row/
    agent-status-bar/
    run-history-panel/
  services/
    rh-agent-run.service.ts        # Runs, status, manual trigger
    rh-agent-signal.service.ts     # Signal history, symbol profiles
    rh-agent-chart.service.ts      # rs-bars + indicator series callable
    rh-agent-symbol.service.ts     # Symbol lists, meta, overview sync
    rh-agent-triage.service.ts     # Triage persistence
    rh-agent-firestore-helpers.ts  # Shared auth/chunk helpers
  stores/
    rh-agent.store.ts              # Runs, status, high-level data
    rh-agent-dashboard.store.ts    # Dashboard UI state
    rh-agent-group.store.ts        # Grouped review rows
    rh-agent-triage.store.ts       # Triage statuses
    rh-agent-symbol-list.store.ts  # List membership
    rh-agent-symbol-history.store.ts # Per-symbol history
    indicator-series.store.ts      # Callable indicator cache
  common/
    rh-agent.constants.ts
    rh-agent.types.ts              # Shared frontend types (ideally imported from backend)
  utils/
    rh-agent.utils.ts
    rh-agent-chart-indicators.ts
```

### Service responsibilities

| Service | Responsibility |
|---------|----------------|
| `RhAgentRunService` | Manual run, status, run history |
| `RhAgentSignalService` | Signal queries, symbol profiles |
| `RhAgentChartService` | Read `rs-bars/{symbol}`, call `rhAgentGetSymbolIndicatorSeries` |
| `RhAgentSymbolService` | Symbol lists, meta, overview sync |
| `RhAgentTriageService` | Triage decision persistence |

### Component responsibilities

| Component | Responsibility |
|-----------|--------------|
| `SignalDetailComponent` | Layout, bind to `SignalDetailChartState` |
| `SignalDetailChartState` | Chart data loading, indicator config assembly, range selection |
| `GroupedReviewComponent` | Layout, bind to `RhAgentGroupStore` |
| `SymbolRowComponent` | Render one symbol row, emit actions |

## Target cross-boundary contracts

### Shared types

A single `types/` package or side-effect-free module should export:

- `OhlcBar`
- `ChartInterval`, `IndicatorFamily`, `StrategyFamily`
- `SymbolIndicatorSeriesResponse`, `IntervalData`, `IndicatorDataPoint`, `TrendBandsPoint`, `SignalMarker`
- `RhAgentSignalType`, `RhAgentRunStatus`, `RhAgentJobStatus`
- `RhAgentRun`, `RhAgentJob`, `RhAgentSymbolProfile`

### Callable contracts

| Callable | Purpose | Auth |
|----------|---------|------|
| `rhAgentManualRun` | Start a manual run | Auth required |
| `rhAgentGetStatus` | Read agent status | Auth required |
| `rhAgentGetRunHistory` | Read run history | Auth required |
| `rhAgentGetSymbolsWithSignals` | Query symbols for review | Auth required |
| `rhAgentGetSymbolSignalHistory` | Read per-symbol signal history | Auth required |
| `rhAgentGetSymbolIndicatorSeries` | Read pre-computed indicator series | Auth required |
| `rhAgentGetIntradaySnapshot` | Fetch single-symbol intraday price | Auth required |
| `rhAgentExecuteTrades` | Execute trades via MCP | Auth required |
| `rhAgentGetAccountSummary` | Read account summary | Auth required |
| `rhAgentOverviewSyncAdmin` | Enqueue overview sync | Auth required |
| `seedAllSymbolsFromPartner` | Admin: seed symbol universe | Auth required |
| `clearRhAgentSymbolsAdmin` | Admin: clear symbols | Auth required |

### Firestore contracts

| Collection / Doc | Purpose | Writer |
|------------------|---------|--------|
| `rs-bars/{symbol}` | Canonical D/W/M bars | `rsBarsSyncNightly` |
| `rh-agent-symbols/{symbol}` | Symbol metadata, overview, last signal | Worker, overview sync, seed admin |
| `rh-agent-symbols/{symbol}/signal-history/{barDate}` | Permanent signal record | Worker (nightly) |
| `rh-agent-symbols/{symbol}/latest-signals` | Latest signals for review | Worker (all runs) |
| `rh-agent-runs/{runId}` | Run metadata | Trigger / manual callable |
| `rh-agent-runs/{runId}/jobs/{symbol}` | Per-symbol job status | Worker, trigger |
| `rh-agent-status/current` | Singleton status | Worker / callable |
| `rh-agent-triage-decisions/{symbol}_{date}` | Daily review decisions | Frontend triage service |
| `rh-agent-symbol-meta/{symbol}` | Persistent symbol attributes | Frontend symbol meta service |
| `rh-agent-symbol-lists/{listName}` | User-defined lists | Frontend symbol list service |

## What is not in the remediation plan

The current remediation plan (`RH-AGENT-THERMO-2607-01`) does the following:

- Fixes the `computeSymbolIndicatorSeries` response shape.
- Removes dead code and unused abstractions.
- Decomposes the worker, frontend service, and chart component.
- Centralizes types and CORS.
- Improves security defaults.

What it does **not** yet include:

- Replacing `run-ids` with `latest-signals` (spike in T23).
- Removing frontend inline indicator calculators (spike in T24).
- Creating a shared types package (spike in T25).
- Full directory restructure to the `domain/` and `entrypoints/` layout shown above.

These larger structural moves are tracked as Phase 8 evaluations. After the remediation stabilizes, the next architectural step is to decide on those three evaluations and move to the target structure.

## Recommended migration path

1. **Stabilize the foundation** (Phase 1–2 of remediation plan)
   - Fix the indicator response shape.
   - Remove dead code and signal-dates.
   - Centralize CORS and `OhlcBar`.

2. **Decompose the backend** (Phase 3)
   - Split worker into loader / strategy / persister / tracker.
   - Introduce the `domain/` directory structure incrementally.

3. **Decompose the frontend** (Phase 4)
   - Split the service into domain services.
   - Extract `SignalDetailChartState`.
   - Simplify the group store.

4. **Adopt the target architecture** (Phase 8 + follow-up)
   - Decide on `latest-signals` vs. TTL.
   - Decide on exclusive backend indicator callable.
   - Decide on shared types package.
   - Restructure backend directories to `entrypoints/` + `domain/` + `contracts/`.

## Open questions

- Should `latest-signals` replace `run-ids` entirely, or should `run-ids` persist with a TTL for historical debugging?
- Should the frontend remove inline calculators immediately, or keep a fallback for offline/emulator scenarios?
- Should the shared types package be a true npm workspace package, or a simpler build-time copy from `functions/src/types/`?
- Is the PDR trigger still strategically valuable, or should the feature move to a purely manual + nightly-run model?

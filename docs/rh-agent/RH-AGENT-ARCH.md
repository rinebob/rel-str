# Robinhood AI Trading Agent — Architecture Overview

## What It Does

A daily automated trading signal system that:
1. Runs at **12:00 PM PT, Monday–Friday** via a Firebase scheduled Cloud Function
2. Loads ~700 monitored symbols from Firestore (`rh-agent-symbols`)
3. Enqueues a Cloud Tasks job per symbol for parallel analysis
4. Each worker reads **pre-cached daily OHLCV bars** from `rs-symbol-cache/{marketDate}/symbols/{symbol}` (internal Firestore cache populated separately — see Data Source below), computes RSI and price change, and writes trade opportunities to Firestore if signals trigger
5. An Angular dashboard lets the user view signals, filter by symbol/type, and approve or reject trade opportunities
6. The user can also trigger a **manual run** via the dashboard's "Run Now" button — uses the same Cloud Tasks processing as the scheduled run, just with `triggeredBy: 'manual'`

---

## Firebase Project

- **Project ID**: `rel-str`
- **Hosting**: `rel-str.web.app` / `savanttrader.com`
- **Functions region**: `us-central1`

---

## Backend — Cloud Functions

All backend code lives in `functions/src/rh-agent-cloud-function/`.

### Deployed Functions

| Function | Type | Purpose |
|----------|------|---------|
| `rhAgentDailyScheduler` | Scheduled | Runs at `0 20 * * 1-5` (8 PM UTC = 12 PM PT, Mon–Fri). Loads symbols, creates a run doc, enqueues Cloud Tasks jobs. |
| `rhAgentProcessSymbol` | Cloud Tasks worker | Processes a single symbol. Reads cached OHLCV bars from `rs-symbol-cache`, computes RSI(14) + price change, writes a trade opportunity to `rh-agent-opportunities` if signal triggers. Used by both scheduler and manual run. |
| `rhAgentManualRun` | HTTPS Callable | Triggered by the dashboard "Run Now" button. Loads symbols, creates run doc with `triggeredBy: 'manual'`, enqueues Cloud Tasks to `rhAgentProcessSymbol`. Same processing as scheduled run. |
| `rhAgentGetStatus` | HTTPS Callable | Returns agent status doc from Firestore. |
| `rhAgentGetRunHistory` | HTTPS Callable | Returns recent run documents. |
| `rhAgentGetSignalHistory` | HTTPS Callable | Returns recent signal documents. |
| `rhAgentGetOpportunities` | HTTPS Callable | Returns trade opportunities pending user approval. |
| `rhAgentTriggerDaily` | HTTP Admin | Manual trigger for the daily scheduler (admin use). |
| `seedRhAgentSymbolsAdmin` | HTTP Admin | Seeds the `rh-agent-symbols` collection. |
| `clearRhAgentSymbolsAdmin` | HTTP Admin | Clears the `rh-agent-symbols` collection. |

### Schedule
- Cron: `0 20 * * 1-5` (UTC), `timeZone: 'Etc/UTC'`
- Equivalent: **12:00 PM Pacific Time, Monday–Friday**
- ⚠️ If this changes, also update `RH_AGENT_SCHEDULE_CRON` in `src/app/features/rh-agent/rh-agent.service.ts`

### Secrets
- `ANTHROPIC_API_KEY` — stored in Firebase Secret Manager, used by worker and manual run functions

### Key Backend Files

| File | Purpose |
|------|---------|
| `rh-agent-config.ts` | All shared interfaces (`RhAgentRun`, `RhAgentDailyRun`, `RhTradeSignal`, `RhAgentStatus`, etc.) and enums (`RhAgentRunStatus`, `RhSignalStatus`, `RhTradeAction`). Single source of truth for Firestore data shapes. |
| `rh-agent-scheduler.ts` | `rhAgentDailyScheduler` — creates run doc, loads symbols, enqueues Cloud Tasks. Writes `triggeredBy: 'schedule'` on the run. |
| `rh-agent-worker.ts` | `rhAgentProcessSymbol` — Cloud Tasks handler. Reads `rs-symbol-cache/{marketDate}/symbols/{symbol}` for daily bars. Computes RSI(14) and 1-day price change. Writes to `rh-agent-opportunities` if RSI < 30 AND price drop > 2%. No Claude during scanning — Claude is reserved for post-scan approval flow. Used by both scheduler and manual run. |
| `rh-agent-callables.ts` | `rhAgentManualRun` — HTTPS callable for manual runs. Loads symbols, creates run doc with `triggeredBy: 'manual'`, enqueues Cloud Tasks to `rhAgentProcessSymbol`. Same processing as scheduled run, just triggered manually. Also contains status/history callables. |
| `rh-agent-dashboard-callables.ts` | Status, run history, signal history, and opportunities callables used by the Angular dashboard. |
| `rh-agent-firestore.ts` | All Firestore write helpers for the dashboard callables. |
| `rh-agent-trigger.ts` | `rhAgentTriggerDaily` — HTTP endpoint to manually trigger the scheduler. |
| `rh-agent-seed-admin.ts` | Admin utilities to seed/clear the symbols collection. |
| `rh-agent-secrets.ts` | Secret bindings for Cloud Functions. |

---

## Firestore Collections

| Collection | Purpose |
|-----------|---------|
| `rh-agent-runs` | One doc per run. Fields: `id`, `status`, `startedAt`, `completedAt`, `triggeredBy`, `type`, `marketDate`, `totalSymbols`, `processedCount`, `signalsGenerated`, `errors`, `logs`. |
| `rh-agent-runs/{runId}/jobs` | One doc per symbol job within a run. |
| `rh-agent-signals` | One doc per trade signal (legacy/manual runs). Fields: `id`, `runId`, `symbol`, `action`, `status`, `signalType`, `tradeDirection`, `reason`, `indicators`, `confidence`, `dryRun`, `createdAt`. |
| `rh-agent-status/current` | Singleton status doc. Fields: `isEnabled`, `lastRunAt`, `lastRunStatus`, `totalRuns`, `totalSignalsGenerated`, `symbolsMonitored`, `schedule`. Note: `totalRuns` and `totalSignalsGenerated` may be stale — the dashboard derives these live from loaded data instead. |
| `rh-agent-symbols` | One doc per monitored symbol with `enabled` flag. Loaded by the scheduler. |
| `rh-agent-opportunities` | Trade opportunities pending user approval. |

---

## Frontend — Angular Dashboard

**Component**: `RhAgentDashboardComponent`
**Route**: `/rh-agent` (or similar)

### Store Architecture

Two NgRx Signal stores:

**`RhAgentStore`** (`rh-agent.store.ts`) — data layer
- Holds: `runs`, `signals`, `status`, `isLoading`
- Methods: `loadData()`, `getSignalsForRun(runId)`, `generateShimSignals()`
- Computed: `latestRun`, `symbolCount`, `hasData`

**`RhAgentDashboardStore`** (`rh-agent-dashboard.store.ts`) — UI state layer
- Holds: `selectedSymbols: Set<string>`, `selectedSignalTypes: Set<string>`, `filterPanelsOpen`, `symbolSearch`, `currentRunOpen`, `acceptedPanelOpen`, `consideredPanelOpen`, `rejectedPanelOpen`, `showAllRuns`
- Computed: `signalTypes`, `hasActiveFilters`, `currentRun`, `previousRuns`, `totalRunsLive`, `currentRunSignalCount`
- Methods: `toggleSymbolFilter`, `deselectSymbol`, `clearSymbolFilters`, `clearFilters`, `toggleSignalTypeFilter`, `deselectSignalType`, `toggleFilterPanels`, `toggleCurrentRun`, `getFilteredSignals(runId)`, `getFilteredSymbols()`, `getRunSignalStats(runId)`, `getScheduleDescription()`, `getSignalStatus(signalId)`

### Status Bar (top of dashboard)
Four chips displayed when status is loaded:
1. **Last Run** — date + SUCCESS/FAILED badge from `status.lastRunAt`
2. **Triggered By** — `manual` or `schedule` from `currentRun().triggeredBy`. Shows `—` for runs before this field was added.
3. **Current Signals** — live count of signals for the most recent run (`currentRunSignalCount`)
4. **Schedule** — always reads from `RH_AGENT_SCHEDULE_CRON` constant in `rh-agent.service.ts`, parsed to human-readable PT time by `getScheduleDescription()`

### Filter Panels (side by side)
Two `mat-expansion-panel`s that open/close together via `filterPanelsOpen` state.

**Symbols panel** header layout (left → right):
- Eye icon + "Symbols" label
- Filter text input (`symbolSearch`)
- SELECTED count (shows total when nothing selected, otherwise count of selected)
- TOTAL count
- "Clear All" button (only shown when selections active, calls `clearSymbolFilters()`)
- Chevron icon (rightmost)

Chips: `mat-chip-listbox multiple`. Each chip shows symbol name. Selected chips get an X (`matChipRemove`) button. No checkmark icons (suppressed globally via `::ng-deep .mat-mdc-chip .mat-pseudo-checkbox { display: none }`).

**Signal Types panel** header layout:
- Signal icon + "Signal Types" label
- Count of types
- Chevron icon

Chips: same pattern as symbols, no checkmarks, X button on selected.

### Runs Section

**Current Run** — plain `div.current-run` (not `mat-expansion-panel`).
- Header: CURRENT badge + date + live stats (`x symbols, y signals` from `getRunSignalStats()`) + chevron
- Body: controlled by `currentRunOpen` boolean via `@if`. When closed takes zero extra space (`flex: 0 0 auto`).
- Inside: Pending signals list (filtered by selected symbols/types), Accepted panel, Considered panel, Rejected panel — each collapsible.

**Previous Runs** — `mat-accordion` of `mat-expansion-panel`s, one per previous run.

### Key Service Constants

```typescript
// rh-agent.service.ts
// ⚠️ Must stay in sync with schedule field in rh-agent-scheduler.ts → rhAgentDailyScheduler
export const RH_AGENT_SCHEDULE_CRON = '0 20 * * 1-5'; // 8 PM UTC = 12 PM PT, Mon-Fri
```

---

## Firebase Hosting

```json
"headers": [
  { "source": "/**",  "Cache-Control": "no-cache, no-store, must-revalidate, proxy-revalidate, s-maxage=0" },
  { "source": "**/*.@(js|css|woff2)", "Cache-Control": "public, max-age=31536000, immutable" }
]
```
- `/**` with `s-maxage=0` prevents Firebase's CDN edge from caching HTML — fixes the hard-refresh-required-after-deploy issue.
- Hashed JS/CSS/font assets are cached forever (safe because filenames change on every build).

---

## Run Flow (Manual via Dashboard)

1. User clicks **Run Now**
2. Angular calls `rhAgentManualRun` HTTPS callable
3. Function loads all enabled symbols from `rh-agent-symbols` (or filters to requested symbols)
4. Creates run doc in `rh-agent-runs` with `triggeredBy: 'manual'`, `status: RUNNING`, `type: 'daily-scan'`
5. For each symbol: creates job doc in `rh-agent-runs/{runId}/jobs/{symbol}` and enqueues Cloud Task to `rhAgentProcessSymbol`
6. Returns immediately with `{ runId, status: 'RUNNING', enqueued: N, totalSymbols: N }` — processing happens asynchronously
7. Workers process in parallel (max 20 concurrent, 10/sec) just like scheduled runs
8. Dashboard reloads after 2 seconds to show the run and job progress

## Run Flow (Scheduled)

1. `rhAgentDailyScheduler` fires at 12 PM PT
2. Loads all enabled symbols from `rh-agent-symbols`
3. Creates run doc with `triggeredBy: 'schedule'`
4. Enqueues one Cloud Tasks job per symbol → `rhAgentProcessSymbol` (max 20 concurrent, 10/sec)
5. Each worker:
   - Reads `rs-symbol-cache/{marketDate}/symbols/{symbol}` for cached daily OHLCV bars
   - If < 15 bars found → skips (no opportunity)
   - Computes RSI(14) from closing prices
   - Computes 1-day price change
   - If RSI < 30 AND price drop > 2% → creates a `PENDING` opportunity in `rh-agent-opportunities`
   - Increments run `processedCount`, `successCount`/`failureCount`, `opportunitiesFound`
6. When all jobs complete → run status set to `SUCCESS` or `PARTIAL`

---

## Data Source

The worker reads from `rs-symbol-cache/{marketDate}/symbols/{symbol}` — an internal Firestore collection populated by a **separate process** (`rs-time-series-jobs.worker.ts`). Each document contains a `dailyBars` array of OHLCV objects (fields: `close`/`c`, `date`/`t`).

- This cache must be populated before 12 PM PT on each market day for the run to find data
- `REQUIRE_FRESH_DATA` flag in `rh-agent-worker.ts` (currently `false`) can be set to `true` in production to enforce that bars are from today
- The Robinhood API / MCP server is **not used** for price data — only the internal cache

---

## MCP / Live Trading Status

- Robinhood MCP connection (`https://agent.robinhood.com/mcp/trading`) is **disabled**.
- All runs are **dry-run only** — no real orders placed.
- The `createMcpClient()` function exists in callables and scheduled files but is not called.
- Live trading requires resolving Robinhood OAuth and re-enabling the MCP client calls.

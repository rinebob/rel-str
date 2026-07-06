# Robinhood AI Trading Agent — Architecture Overview

## What It Does

A daily automated trading signal system that:
1. Triggers automatically when SavantAPI publishes a `partner-data-ready` Pub/Sub message with `runType = "intraday-snapshot"` (PDR windows: ~8:20, ~10:20, ~12:20 PM PT, Mon–Fri — SA takes ~20 min per run)
2. Fetches a bulk intraday snapshot from `callPartnerIntradaySnapshotV2` (one POST for all ~761 symbols)
3. Enqueues a Cloud Tasks job per symbol for parallel analysis, embedding each symbol's intraday snapshot in its own task payload
4. Each worker reads **historical OHLCV bars** from `symbol-data/{symbol}` subcollections (populated nightly by `symbolDataSyncNightly`), injects today's intraday price as a partial bar, runs the ST-Zone-Uptick strategy, and writes signals to `rh-agent-symbols/{symbol}/signal-dates/{barDate}`
5. Nightly after market close, `symbolDataSyncNightly` syncs real EOD bars for all symbols and auto-triggers a nightly agent run for confirmed signals
6. An Angular dashboard lets the user view runs, signals, and triage opportunities

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
| `rhAgentPdrTrigger` | Pub/Sub | Listens to `partner-data-ready` topic. Fires when `runType = "intraday-snapshot"` and `runStatus = "completed"`/`"completed_with_errors"`. Fetches intraday snapshot, loads symbols, creates run doc, enqueues Cloud Tasks. |
| `rhAgentProcessSymbol` | Cloud Tasks worker | Processes a single symbol. Reads cached OHLCV bars from `rs-symbol-cache`, appends intraday price from payload, computes RSI(14) + price change, writes a trade opportunity to `rh-agent-opportunities` if signal triggers. Used by all trigger types. |
| `rhAgentManualRun` | HTTPS Callable | Triggered by the dashboard "Run Now" button. Loads symbols, creates run doc with `triggeredBy: 'manual'` (run ID: `{marketDate}_manual_{timestamp}`), enqueues Cloud Tasks to `rhAgentProcessSymbol`. Same processing as PDR-triggered run. |
| `rhAgentGetStatus` | HTTPS Callable | Returns agent status doc from Firestore. |
| `rhAgentGetRunHistory` | HTTPS Callable | Returns recent run documents. |
| `rhAgentGetSignalHistory` | HTTPS Callable | Returns recent signal documents. |
| `rhAgentGetOpportunities` | HTTPS Callable | Returns trade opportunities pending user approval. |
| `rhAgentTriggerDaily` | HTTP Admin | Manual HTTP trigger for testing. Accepts `?date=YYYY-MM-DD` override. |
| `seedRhAgentSymbolsAdmin` | HTTP Admin | Seeds `rh-agent-symbols` with top-20 market cap symbols. |
| `clearRhAgentSymbolsAdmin` | HTTP Admin | Clears all docs from `rh-agent-symbols`. |
| `seedAllSymbolsFromPartner` | HTTP Admin | Fetches full active symbol universe from SavantAPI (`callPartnerTrackedSymbols`) and seeds `rh-agent-symbols`. |

### Trigger
- **Primary:** Pub/Sub `partner-data-ready` topic, `runType = "intraday-snapshot"`
- **Manual (dashboard):** `rhAgentManualRun` HTTPS callable → uses today's `marketDate`, `triggeredBy: 'manual'`
- **Manual (HTTP admin):** `rhAgentTriggerDaily` → `?date=YYYY-MM-DD` override supported
- ⚠️ If the scheduled cron ever replaces the PDR trigger, also update `RH_AGENT_SCHEDULE_CRON` in `src/app/features/rh-agent/rh-agent.service.ts`

### Secrets
- `ANTHROPIC_API_KEY` — stored in Firebase Secret Manager, used by worker and manual run functions

### Key Backend Files

| File | Purpose |
|------|---------|
| `rh-agent-config.ts` | All shared interfaces (`RhAgentRun`, `RhAgentDailyRun`, `RhTradeSignal`, `RhAgentStatus`, `RhTradeOpportunity`, `IntradaySnapshot`, `SymbolJobPayload`, etc.) and enums (`RhAgentRunStatus`, `RhAgentJobStatus`, `RhOpportunityStatus`, `RhOpportunityAction`). Single source of truth for Firestore data shapes. |
| `rh-agent-shared.ts` | Shared helpers used by both the PDR trigger and the manual callable: `getMarketDate()`, `getDeadlineISO()`, `loadEnabledSymbols()`, `createDailyRun()`, `createJobAndEnqueue()`. Run IDs: PDR runs use `marketDate` (e.g., `"2026-06-16"`); manual runs use `"{marketDate}_manual_{timestamp}"`. |
| `rh-agent-trigger.ts` | `rhAgentPdrTrigger` — Pub/Sub trigger on `partner-data-ready`. Filters to `runType="intraday-snapshot"`, `status="end"`, `runStatus="completed"`/`"completed_with_errors"`. Fetches bulk intraday snapshot via `callPartnerIntradaySnapshotV2`, then calls `startRhAgentRun`. Also exports `rhAgentTriggerDaily` (HTTP admin trigger with `?date` override). |
| `rh-agent-worker.ts` | `rhAgentProcessSymbol` — Cloud Tasks handler. Reads `rs-symbol-cache/{marketDate}/symbols/{symbol}` for historical daily bars. Appends intraday price from job payload (`intraday?.ip`). Computes RSI(14) and 1-day price change. Writes to `rh-agent-opportunities` if RSI < 30 AND price drop > 2%. No Claude during scanning — Claude is reserved for post-scan approval flow. |
| `rh-agent-callables.ts` | `rhAgentManualRun` — HTTPS callable for manual runs. Uses shared helpers from `rh-agent-shared.ts`. Creates run doc with `triggeredBy: 'manual'`, enqueues Cloud Tasks to `rhAgentProcessSymbol`. |
| `rh-agent-dashboard-callables.ts` | Status, run history, signal history, and opportunities callables used by the Angular dashboard. |
| `rh-agent-firestore.ts` | Firestore write helpers for the legacy `rh-agent-signals` path. |
| `rh-agent-seed-admin.ts` | Admin HTTP functions: `seedRhAgentSymbolsAdmin` (top-20 hardcoded symbols), `clearRhAgentSymbolsAdmin`, `seedAllSymbolsFromPartner` (fetches full universe via `callPartnerTrackedSymbols`). |
| `rh-agent-secrets.ts` | Secret bindings for Cloud Functions. |
| `rh-agent-scheduled.ts` | Legacy MCP-based scheduled function (`rhAgentScheduled`). **Not exported from `index.ts`** — superseded by the PDR-triggered architecture. Kept for reference. |

---

## Firestore Collections

| Collection | Purpose |
|-----------|----------|
| `rh-agent-runs` | One doc per run. PDR runs: doc ID = `marketDate` (e.g., `"2026-06-16"`). Manual runs: doc ID = `"{marketDate}_manual_{timestamp}"`. Fields: `id`, `type`, `status`, `marketDate`, `triggeredBy`, `totalSymbols`, `processedCount`, `successCount`, `failureCount`, `opportunitiesFound`, `opportunitiesApproved`, `opportunitiesRejected`, `opportunitiesExecuted`, `startedAt`, `completedAt`, `deadlineAt`, `errors`, `logs`. |
| `rh-agent-runs/{runId}/jobs` | One doc per symbol job within a run. Doc ID = symbol. Fields: `id`, `symbol`, `status` (`PENDING`/`IN_PROGRESS`/`SUCCESS`/`FAILED`), `attempts`, `lastError`, `createdAt`, `startedAt`, `completedAt`, `createdOpportunity`. |
| `rh-agent-opportunities` | One doc per trade opportunity. Doc ID format: `"{marketDate}_{dayOfWeek}_{symbol}_{action}_{signalType}"` (e.g., `"2026-06-16_mon_AAPL_BUY_RSI_OVERSOLD"`). Fields: `id`, `runId`, `marketDate`, `symbol`, `action`, `signalType`, `strategy`, `confidence`, `reason`, `indicators` (`rsi`, `priceChange`, `currentPrice`), `suggestedAmount`, `orderType`, `status` (`PENDING`/`APPROVED`/`REJECTED`/`EXECUTED`/`FAILED`), `createdAt`, `updatedAt`, plus optional approval/rejection/execution fields. |
| `rh-agent-signals` | Legacy trade signals from MCP-based runs. Not written by the current PDR architecture. |
| `rh-agent-status/current` | Singleton status doc. Fields: `isEnabled`, `lastRunAt`, `lastRunStatus`, `totalRuns`, `totalSignalsGenerated`, `symbolsMonitored`, `schedule`. Note: `totalRuns` and `totalSignalsGenerated` may be stale — the dashboard derives these live from loaded data instead. |
| `rh-agent-symbols` | One doc per monitored symbol. Doc ID = symbol. Fields: `symbol`, `enabled`, `priority`, `createdAt`, optionally `source` (`"partner-universe"` when seeded via `seedAllSymbolsFromPartner`). |

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
3. Function uses `loadEnabledSymbols()` from `rh-agent-shared.ts` to get all enabled symbols (or filters to requested symbols)
4. Creates run doc via `createDailyRun()` with `triggeredBy: 'manual'`, run ID = `"{marketDate}_manual_{timestamp}"`
5. For each symbol: creates job doc in `rh-agent-runs/{runId}/jobs/{symbol}` and enqueues Cloud Task to `rhAgentProcessSymbol` via `createJobAndEnqueue()`
6. Returns immediately with `{ runId, status: 'RUNNING', enqueued: N, totalSymbols: N }` — processing happens asynchronously
7. Workers process in parallel (max 20 concurrent, 10/sec)
8. Dashboard reloads after 2 seconds to show the run and job progress

## Run Flow (PDR-Triggered)

1. SavantAPI publishes Pub/Sub message on `partner-data-ready` with `runType: "intraday-snapshot"`, `status: "end"`, `runStatus: "completed"`/`"completed_with_errors"`
2. `rhAgentPdrTrigger` validates fields and applies time gate (7:55am–6:30pm PT) to reject spurious SA overnight cleanup messages
3. Fetches bulk intraday snapshot via `callPartnerIntradaySnapshotV2(symbols)` — one POST for all ~761 symbols
4. Calls `startRhAgentRun(marketDate, 'pdr', intradaySnapshots)` — loads symbols, creates run doc (ID = `marketDate`), enqueues one Cloud Task per symbol with **only that symbol's** intraday snapshot in the payload
5. Each worker (`rhAgentProcessSymbol`):
   - Reads `symbol-data/{symbol}` subcollections for historical D/W/M OHLCV bars (populated nightly)
   - Injects `intraday.ip` from payload as a partial bar for today (replace-or-append)
   - Runs ST-Zone-Uptick strategy against D/W/M bars
   - Writes signals to `rh-agent-symbols/{symbol}/signal-dates/{barDate}` with status `INTERIM`
   - Increments run counters; last worker to complete updates run status to `SUCCESS`/`PARTIAL`

## Run Flow (Nightly)

1. Cloud Scheduler triggers `symbolDataSyncNightly` after market close (~6 PM PT)
2. Creates tracking doc in `symbol-data-sync-runs/{syncRunId}`; enqueues one Cloud Task per symbol to `symbolDataSyncSymbol`
3. Each `symbolDataSyncSymbol` task syncs real EOD D/W/M bars from SA into `symbol-data/{symbol}` subcollections, increments `processedCount`
4. When `processedCount >= totalSymbols` → auto-calls `startRhAgentRun(marketDate, 'nightly')`
5. Workers run same strategy; signals written with status `CONFIRMED` (daily) or `INTERIM`→`CONFIRMED` (weekly, after 7 days)

---

## Data Source

Workers read from `symbol-data/{symbol}` subcollections — year-sharded daily bars under `daily/{YYYY}`, flat weekly bars at `weekly/all`, flat monthly bars at `monthly/all`. Populated nightly by `symbolDataSyncNightly`.

- `daily` array contains ~500 EOD bars (the `d` field is `YYYY-MM-DD`)
- Today's intraday price (`intraday.ip`) comes from the **job payload** and is injected as a partial bar inside the worker — workers make no external API calls
- `REQUIRE_FRESH_DATA` flag in `rh-agent-worker.ts` (currently `false`) — set to `true` to enforce that the last bar date matches `marketDate`
- The Robinhood API / MCP server is **not used** for price data

### Intraday Bar Injection (worker responsibility)

The worker receives `intraday: IntradaySnapshot` in its Cloud Task payload and injects it as today's partial bar into the `daily` array before running strategy:

```
partialBar = { d: marketDate, o: ip, h: ip, l: ip, c: ip }
if daily.last.d === marketDate → replace last bar
else → append
```

This keeps the trigger stateless with respect to `symbol-data` — it never reads or writes Firestore docs during the intraday fetch phase, eliminating the ~761 concurrent Firestore reads that caused OOM crashes at 1GiB.

> **Historical note:** Prior to this refactor, `rhAgentPdrTrigger` called `writeIntradayBarsToRsBars()` to pre-write all 761 partial bars to Firestore before enqueueing workers. This required reading each symbol's full `daily` array (~64KB) to perform the replace-or-append check, causing the trigger function to exceed its 1GiB memory limit. The fix moves the bar injection into each worker, which already has the intraday snapshot in its payload.

---

## Pending Work (cross-plan summary)

### 1. Frontend chart → symbol-data (Layer 3 migration) ✅ Complete (2026-07-01)
`signal-detail.component` now reads `symbol-data/{symbol}` subcollections directly via `RhAgentChartService`. `HeatmapChartStore` is no longer imported. The 1–3s SA round-trip per chart open is eliminated.

- **`RhAgentChartService`** (`src/app/features/rh-agent/services/rh-agent-chart.service.ts`) reads Firestore, checks `lastEodSyncAt`, calls `rhAgentGetIntradaySnapshot` when today’s bar is missing, synthesizes D/W/M partial bars client-side.
- **`rhAgentGetIntradaySnapshot`** callable added to `rh-agent-callables.ts`; wraps `callPartnerIntradaySnapshotV2([symbol])`.
- ~~**`lastEodSyncAt`** added to `RsBarsDoc`~~ — written only by `symbolDataSyncNightly`, used by frontend as the EOD sync sentinel.
- **Plan doc:** `RH-AGENT-RS-BARS-CHART-MIGRATION-PLAN.md`

### 2. Run-centric signal storage migration ✅ Complete
`SignalDateWriter` writes signals to `rh-agent-symbols/{symbol}/run-ids/{runId}`. Frontend `getSymbolsWithSignals(runId, timeframe)` passes `runId` to the callable. `RhAgentGroupStore.setActiveRun` and `loadSymbolsWithSignals` are fully wired.

### 3. Signal history canonicalization ✅ Complete
`SignalDateWriter.writeSignalHistoryDoc` writes confirmed signals to `signal-history/{date}` for nightly runs (`triggeredBy === 'nightly'`). Both `RH_AGENT_RUN_IDS_SUBCOLLECTION` and `RH_AGENT_SIGNAL_HISTORY_SUBCOLLECTION` constants are defined in `rh-agent-config.ts`.

### 4. Nightly run resilience ⏳ On standby
`RH-AGENT-NIGHTLY-RESILIENCE-PLAN.md` defines three mitigations. Implement only if nightly failures are observed.

- **2B** (fallback scheduler at 3 AM UTC) — 30 lines, implement first if needed
- **1A** (gap fill validator at 4:30 AM UTC) — implement if partial failures observed
- **4A** (strategy version field) — low effort, implement alongside 1A

### 5. PACR persistence — remaining items ⏳ Partial
From `RH-AGENT-PACR-PERSISTENCE-PLAN.md`:
- ⏳ **Phase 4:** worker filtering of `EXCLUDED` symbols not yet implemented
- ⏳ **Phase 5:** `/rh-agent-universe` page, CSV import, export not built
- ⏳ **Firestore rules/indexes** for `rh-agent-triage-decisions` and `rh-agent-symbol-meta` not added

### 6. Signal grouping plan — remaining items ⏳ Partial
From `RH-AGENT-SIGNAL-GROUPING-PLAN.md`:
- ⏳ Firestore composite indexes not added (blocked on query patterns stabilizing with run-centric model)

---

## MCP / Live Trading Status

- Robinhood MCP connection (`https://agent.robinhood.com/mcp/trading`) is **disabled**.
- All runs are **dry-run only** — no real orders placed.
- The `createMcpClient()` function exists in callables and scheduled files but is not called.
- Live trading requires resolving Robinhood OAuth and re-enabling the MCP client calls.

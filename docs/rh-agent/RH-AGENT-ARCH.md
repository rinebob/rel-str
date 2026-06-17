# Robinhood AI Trading Agent — Architecture Overview

## What It Does

A daily automated trading signal system that:
1. Triggers automatically when SavantAPI publishes a `partner-data-ready` Pub/Sub message with `runType = "intraday-snapshot"` (typically 7 AM–12 PM PT, Mon–Fri)
2. Fetches a bulk intraday snapshot from `callPartnerIntradaySnapshotV2` (one POST call for all symbols)
3. Loads monitored symbols from Firestore (`rh-agent-symbols`; currently 20 test symbols, full ~700-symbol universe available via `seedAllSymbolsFromPartner`)
4. Enqueues a Cloud Tasks job per symbol for parallel analysis, embedding the intraday snapshot in each job payload
5. Each worker reads **pre-cached daily OHLCV bars** from `rs-symbol-cache/{marketDate}/symbols/{symbol}` (internal Firestore cache populated separately — see Data Source below), appends the intraday price, computes RSI(14) and price change, and writes trade opportunities to Firestore if signals trigger
6. An Angular dashboard lets the user view signals, filter by symbol/type, and approve or reject trade opportunities
7. The user can also trigger a **manual run** via the dashboard's "Run Now" button — uses the same Cloud Tasks processing as the PDR-triggered run, just with `triggeredBy: 'manual'`

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

1. SavantAPI publishes Pub/Sub message on `partner-data-ready` with `runType: "intraday-snapshot"`, `status: "end"`, `runStatus: "completed"`
2. `rhAgentPdrTrigger` receives the message and validates fields
3. Calls `callPartnerIntradaySnapshotV2(symbols)` — one bulk POST to SavantAPI for all enabled symbols
4. Calls `startRhAgentRun(marketDate, 'pdr', intradaySnapshots)`
5. `startRhAgentRun` loads symbols, creates run doc via `createDailyRun()` (run ID = `marketDate`), enqueues one Cloud Task per symbol with intraday snapshot in payload
6. Each worker (`rhAgentProcessSymbol`):
   - Reads `rs-symbol-cache/{marketDate}/symbols/{symbol}` for cached daily OHLCV bars (requires ≥ 14 bars)
   - Uses `intraday?.ip` from payload as today's price (falls back to last historical close if missing)
   - Computes RSI(14) from `[...historicalCloses.slice(0, 14), currentPrice]`
   - Computes 1-day price change: `(currentPrice - previousClose) / previousClose`
   - If RSI < 30 AND price drop > 2% → creates a `PENDING` opportunity in `rh-agent-opportunities`
   - Increments run `processedCount`, `successCount`/`failureCount`, `opportunitiesFound`
7. When all jobs complete → run status set to `SUCCESS` or `PARTIAL`

---

## Data Source

The worker reads from `rs-symbol-cache/{marketDate}/symbols/{symbol}` — an internal Firestore collection populated by a **separate process** (`rs-time-series-jobs.worker.ts`). Each document contains a `dailyBars` array of OHLCV objects (fields: `close`/`c`, `date`/`t`).

- This cache must be populated before the PDR intraday-snapshot trigger fires for the run to find historical data
- Today's intraday price comes from the **job payload** (`intraday.ip`), which was fetched in bulk by `rhAgentPdrTrigger` via `callPartnerIntradaySnapshotV2` — workers do not make any external API calls for price data
- `REQUIRE_FRESH_DATA` flag in `rh-agent-worker.ts` (currently `false`) can be set to `true` in production to enforce that the most recent cached bar matches `marketDate`
- The Robinhood API / MCP server is **not used** for price data — only the internal cache and SavantAPI intraday snapshot

---

## MCP / Live Trading Status

- Robinhood MCP connection (`https://agent.robinhood.com/mcp/trading`) is **disabled**.
- All runs are **dry-run only** — no real orders placed.
- The `createMcpClient()` function exists in callables and scheduled files but is not called.
- Live trading requires resolving Robinhood OAuth and re-enabling the MCP client calls.

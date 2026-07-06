# RH Agent Cloud Function

Firebase Cloud Functions for the Robinhood AI Trading Agent.

## Overview

Event-driven daily scan that:
1. Triggers on `partner-data-ready` Pub/Sub (`runType: "intraday-snapshot"`)
2. Fetches a bulk intraday snapshot from SavantAPI for all monitored symbols
3. Enqueues one Cloud Tasks job per symbol for parallel analysis
4. Each worker reads historical OHLCV bars from `symbol-data/{symbol}` subcollections, injects the intraday snapshot as an in-memory partial bar, executes the selected ST trend-rider strategy, and persists signal entries under `rh-agent-symbols/{symbol}/run-ids` and `rh-agent-symbols/{symbol}/signal-history`
5. Signals appear in the Angular dashboard for grouped review, triage, and (when enabled) MCP trade execution

Trade execution is controlled via the `rh-agent-executor` callable using the configured MCP server and account number.

## Architecture

```
partner-data-ready Pub/Sub (runType: intraday-snapshot)
    │
    ▼
rhAgentPdrTrigger
    ├─ callPartnerIntradaySnapshotV2(symbols)  [one bulk POST]
    ├─ createDailyRun(marketDate, 'pdr')
    └─ createJobAndEnqueue(symbol, intraday)   [× N symbols]
            │
            ▼
    Cloud Tasks Queue (max 20 concurrent)
            │
            ▼
    rhAgentProcessSymbol (per symbol)
            ├─ loadSymbolBars(symbol, marketDate)  [symbol-data]
            ├─ inject intraday snapshot as partial bar  [in-memory only]
            ├─ executeStrategy('st-trend-rider')  // ST Trend Rider
            │      ├─ compute V1/V2 zone signals
            │      └─ return LONG/SHORT signals
            └─ persistSignals()  [rh-agent-symbols/{symbol}/run-ids/{runId}, rh-agent-symbols/{symbol}/signal-history/{barDate}]
                        │
                        ▼
            Angular Dashboard (grouped review / triage / MCP execution)
```

## Files

| File | Exports | Purpose |
|------|---------|---------|
| `rh-agent-collections.ts` | Collection constants, `RhAgentSymbol`, `RhAgentSymbolProfile`, `RhAgentOverviewFields` | Firestore paths and symbol document shapes |
| `rh-agent-signals.ts` | `StSignalType`, `StSignalDirection`, `RhAgentSignalEntry`, `RhAgentSignalHistoryDoc`, `RhAgentRunIdDoc` | Signal enums and signal document shapes |
| `rh-agent-runs.ts` | `RhAgentRunStatus`, `RhAgentJobStatus`, `RhAgentDailyRun`, `RhAgentJob`, `RhAgentStatus`, `RhWatchedSymbol`, `RhAgentTriggeredBy` | Run/job status and run record types |
| `rh-agent-opportunities.ts` | `RhTradeAction` | Trade action and opportunity types |
| `rh-agent-shared-types.ts` | `SymbolJobPayload`, `IntradaySnapshot` | Cross-cutting payloads and snapshots |
| `rh-agent-shared.ts` | `getMarketDate`, `getDeadlineISO`, `loadEnabledSymbols`, `createDailyRun`, `createJobAndEnqueue`, `fetchIntradaySnapshots` | Shared helpers used by triggers and manual callable |
| `rh-agent-trigger.ts` | `rhAgentPdrTrigger`, `rhAgentTriggerDaily` | PDR Pub/Sub trigger; HTTP admin trigger with `?date` override |
| `rh-agent-worker.ts` | `rhAgentProcessSymbol` | Cloud Tasks worker: reads bars, executes strategy, persists signals |
| `rh-agent-callables.ts` | `rhAgentManualRun` | HTTPS callable for dashboard "Run Now" button |
| `rh-agent-dashboard-callables.ts` | `rhAgentGetStatus`, `rhAgentGetRunHistory`, `rhAgentGetSymbolsWithSignals` | Dashboard status, run history, and grouped-review symbol query |
| `rh-agent-signal-date-writer.ts` | `SignalDateWriter` | Persists signal entries under `rh-agent-symbols/{symbol}/run-ids` and `rh-agent-symbols/{symbol}/signal-history` |
| `rh-agent-executor.ts` | `rhAgentExecuteTrades`, `rhAgentGetAccountSummary` | MCP trade executor and account summary callables |
| `rh-agent-overview-sync-orchestrator.ts` / `rh-agent-overview-sync-worker.ts` | `rhAgentOverviewSync`, `rhAgentOverviewSyncSymbol` | Enqueues company-overview backfill tasks |
| `rh-agent-seed-admin.ts` | `clearRhAgentSymbolsAdmin`, `seedAllSymbolsFromPartner` | Symbol list management |
| `strategies/` | `base-strategy`, `signal-detection`, `st-trend-rider.strategy` | Strategy adapter, signal state machine, and concrete trend-rider strategy |

## Firestore Collections

| Collection | Doc ID | Purpose |
|-----------|--------|---------|
| `rh-agent-symbols` | `{symbol}` | Monitored symbols with `enabled`, overview, and last-signal fields |
| `rh-agent-symbols/{symbol}/run-ids` | `{runId}` | Per-run signal entries keyed by signal type |
| `rh-agent-symbols/{symbol}/signal-history` | `{barDate}` | Canonical EOD signal entries keyed by signal type |
| `rh-agent-runs` | PDR: `marketDate`; manual: `{marketDate}_manual_{ts}` | Run metadata and counters |
| `rh-agent-runs/{runId}/jobs` | `{symbol}` | Per-symbol job status |
| `rh-agent-status/current` | `current` | Agent status singleton |
| `rh-agent-symbol-meta` | `{symbol}` | Symbol-level classification/tags (universe management) |
| `rh-agent-triage-decisions` | `{symbol}_{marketDate}` | Daily PACR review decisions |
| `rh-agent-symbol-lists` | `{listName}` | User-defined watchlists |

## Setup

### 1. Configure Firebase Secrets

```bash
firebase functions:secrets:set ANTHROPIC_API_KEY
firebase functions:secrets:set RH_AGENT_MCP_SERVER_URL
firebase functions:secrets:set RH_AGENT_ACCOUNT_NUMBER
```

### 2. Seed Symbol List

Clear existing symbols, then seed the full universe from SavantAPI:
```bash
curl -X POST https://<region>-rel-str.cloudfunctions.net/clearRhAgentSymbolsAdmin
curl -X POST https://<region>-rel-str.cloudfunctions.net/seedAllSymbolsFromPartner
```

### 3. Deploy Functions

```bash
cd functions
npm run build
firebase deploy --only functions
```

## Manual Testing

Trigger a run with a historical date to test against cached data:

```bash
curl "https://rhagenttriggerdaily-<hash>-uc.a.run.app?date=2026-06-13"
```

## Signal Strategy

**ST Trend Rider** — fires when the ST zone crosses into a higher (lower) zone on the same timeframe:
- **Daily** zone V1/V2 context
- **Weekly** zone V1/V2 context
- Both V1 (±3) and V2 (±4) zone classifications are computed; a signal can fire independently from each

A signal is generated when the last bar completes a zone transition:
- **LONG** uptick: same-timeframe zone rises and is already positive
- **SHORT** downtick: same-timeframe zone falls and is already negative

Signal type format: `{D|W}_ST_TREND_RIDER_{V1|V2}_{LONG|SHORT}`

## Data Contracts

### `OhlcBar`

Canonical compact OHLCV bar used by `symbol-data` storage and all indicator/signal computation. Field names are single-letter to keep Firestore documents small.

| Field | Type | Description |
|-------|------|-------------|
| `d` | `string` | Bar date in `YYYY-MM-DD` format (UTC market date) |
| `o` | `number` | Open price |
| `h` | `number` | High price |
| `l` | `number` | Low price |
| `c` | `number` | Close price |
| `v` | `number` | *(Optional)* Volume |

The nightly `symbolDataSyncNightly` function populates `symbol-data/{symbol}` subcollections with D/W/M `OhlcBar` data. Workers read these and never mutate the stored bars; intraday snapshots are injected in-memory only at worker read time.

## Security Model

| Function Type | Examples | Authentication |
|---------------|----------|----------------|
| `onCall` dashboard callables | `rhAgentGetSymbolsWithSignals`, `rhAgentGetSymbolIndicatorSeries`, `rhAgentManualRun`, `rhExecuteTrade`, `rhGetAccountSummary` | Require a signed-in Firebase Auth user. CORS is restricted to `RH_AGENT_ALLOWED_ORIGINS`. |
| `onRequest` admin endpoints | `rhAgentTriggerDaily`, `clearRhAgentSymbolsAdmin`, `seedAllSymbolsFromPartner` | HTTP endpoints intended for admin/internal use. Protect at the network layer (IP allowlist, Cloud IAM, or admin token) before exposing them. |
| Pub/Sub triggers | `rhAgentPdrTrigger` | Invoked by Google Cloud Pub/Sub; no direct external access. |
| Scheduled functions | `rhAgentOverviewSync` | Invoked by Cloud Scheduler; no direct external access. |

Secrets (`ANTHROPIC_API_KEY`, `RH_AGENT_MCP_SERVER_URL`, `RH_AGENT_ACCOUNT_NUMBER`) are managed with Firebase Secrets and injected at runtime. No API keys or account credentials are hardcoded in source.

## Local Development

```bash
# Terminal 1
npm run emulators:start

# Terminal 2
cd functions && npm run build:watch

# Terminal 3
ng serve
```

Emulator `.env.local`:
```
ANTHROPIC_API_KEY=your_key_here

# Required by rh-agent-executor. The function fails at startup if either is missing.
RH_AGENT_MCP_SERVER_URL=http://localhost:3000/sse
RH_AGENT_ACCOUNT_NUMBER=your_account_number
```

## Status

- **Robinhood MCP** — enabled via `RH_AGENT_MCP_SERVER_URL` and `RH_AGENT_ACCOUNT_NUMBER` secrets; orders are sent only when the executor callable is invoked with a non-empty allocation
- **Claude** — reserved for post-scan approval flow (not used during scanning)
- **Live trading** — controlled through the `rh-agent-executor` MCP integration; no separate OAuth2 flow is required

# RH Agent Cloud Function

Firebase Cloud Functions for the Robinhood AI Trading Agent.

## Overview

Event-driven daily scan that:
1. Triggers on `partner-data-ready` Pub/Sub (`runType: "intraday-snapshot"`)
2. Fetches a bulk intraday snapshot from SavantAPI for all monitored symbols
3. Enqueues one Cloud Tasks job per symbol for parallel analysis
4. Each worker reads historical OHLCV bars from `symbol-data/{symbol}` subcollections, injects the intraday snapshot as an in-memory partial bar, executes the selected ST trend-rider strategy, and persists signal entries under `savant-trader/data/symbols/{symbol}/run-ids` and `savant-trader/data/symbols/{symbol}/signal-history`
5. Signals appear in the Angular dashboard for grouped review and triage

The retired Claude bridge and executor prototypes are preserved in archive documents. Direct MCP execution is not yet implemented.

## Architecture

```
SDS completion (sds-consumer-dispatch.ts)
    │
    ▼
rhAgentTriggerDaily (manual) / SDS consumer dispatch (automatic)
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
            └─ persistSignals()  [savant-trader/data/symbols/{symbol}/run-ids/{runId}, savant-trader/data/symbols/{symbol}/signal-history/{barDate}]
                        │
                        ▼
            Angular Dashboard (grouped review / triage)
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
| `rh-agent-trigger.ts` | `rhAgentTriggerDaily` | HTTP admin trigger with `?date` override (PDR Pub/Sub trigger deleted — RH Agent now triggered by SDS completion via sds-consumer-dispatch.ts) |
| `rh-agent-worker.ts` | `rhAgentProcessSymbol` | Cloud Tasks worker: reads bars, executes strategy, persists signals |
| `rh-agent-callables.ts` | `rhAgentManualRun` | HTTPS callable for dashboard "Run Now" button |
| `rh-agent-dashboard-callables.ts` | `rhAgentGetStatus`, `rhAgentGetRunHistory`, `rhAgentGetSymbolsWithSignals` | Dashboard status, run history, and grouped-review symbol query |
| `rh-agent-signal-date-writer.ts` | `SignalDateWriter` | Persists signal entries under `savant-trader/data/symbols/{symbol}/run-ids` and `savant-trader/data/symbols/{symbol}/signal-history` |
| `rh-agent-overview-sync-orchestrator.ts` / `rh-agent-overview-sync-worker.ts` | `rhAgentOverviewSync`, `rhAgentOverviewSyncSymbol` | Enqueues company-overview backfill tasks |
| `rh-agent-seed-admin.ts` | `clearRhAgentSymbolsAdmin`, `seedAllSymbolsFromPartner` | Symbol list management |
| `strategies/` | `base-strategy`, `signal-detection`, `st-trend-rider.strategy` | Strategy adapter, signal state machine, and concrete trend-rider strategy |

## Firestore Collections

| Collection | Doc ID | Purpose |
|-----------|--------|---------|
| `savant-trader/data/symbols` | `{symbol}` | Monitored symbols with `enabled`, overview, and last-signal fields |
| `savant-trader/data/symbols/{symbol}/run-ids` | `{runId}` | Per-run signal entries keyed by signal type |
| `savant-trader/data/symbols/{symbol}/signal-history` | `{barDate}` | Canonical EOD signal entries keyed by signal type |
| `savant-trader/data/runs` | PDR: `marketDate`; manual: `{marketDate}_manual_{ts}` | Run metadata and counters |
| `savant-trader/data/runs/{runId}/jobs` | `{symbol}` | Per-symbol job status |
| `savant-trader/data/status/current` | `current` | Agent status singleton |
| `savant-trader/data/symbol-meta` | `{symbol}` | Symbol-level classification/tags (universe management) |
| `savant-trader/data/occurrence-decisions` | `{symbol}_{marketDate}` | Daily PACR review decisions |
| `savant-trader/data/symbol-lists` | `{listName}` | User-defined watchlists |

## Setup

### 1. Seed Symbol List

Clear existing symbols, then seed the full universe from SavantAPI:
```bash
curl -X POST https://<region>-rel-str.cloudfunctions.net/clearRhAgentSymbolsAdmin
curl -X POST https://<region>-rel-str.cloudfunctions.net/seedAllSymbolsFromPartner
```

### 2. Deploy Functions

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

The SDS pipeline (`symbolDataSync` Pub/Sub subscriber) populates `symbol-data/{symbol}` subcollections with D/W/M `OhlcBar` data. Workers read these and never mutate the stored bars; intraday snapshots are injected in-memory only at worker read time.

## Security Model

| Function Type | Examples | Authentication |
|---------------|----------|----------------|
| `onCall` dashboard callables | `rhAgentGetSymbolsWithSignals`, `rhAgentGetSymbolIndicatorSeries`, `rhAgentManualRun` | Require a signed-in Firebase Auth user. CORS is restricted to `RH_AGENT_ALLOWED_ORIGINS`. |
| `onRequest` admin endpoints | `rhAgentTriggerDaily`, `clearRhAgentSymbolsAdmin`, `seedAllSymbolsFromPartner` | HTTP endpoints intended for admin/internal use. Protect at the network layer (IP allowlist, Cloud IAM, or admin token) before exposing them. |
| Scheduled functions | `rhAgentOverviewSync` | Invoked by Cloud Scheduler; no direct external access. |

## Local Development

```bash
# Terminal 1
npm run emulators:start

# Terminal 2
cd functions && npm run build:watch

# Terminal 3
ng serve
```

## Status

- **Signal generation** — active through the event-driven Cloud Functions architecture
- **Direct Robinhood MCP authentication and execution** — planned under the Phase A workflow; not yet implemented
- **Legacy Claude bridge and executor** — executable source removed and preserved in archive documents

# RH Agent Cloud Function

Firebase Cloud Functions for the Robinhood AI Trading Agent.

## Overview

Event-driven daily scan that:
1. Triggers on `partner-data-ready` Pub/Sub (`runType: "intraday-snapshot"`)
2. Fetches a bulk intraday snapshot from SavantAPI for all monitored symbols
3. Writes today's partial bars into `rs-bars`
4. Enqueues one Cloud Tasks job per symbol for parallel analysis
5. Each worker reads historical OHLCV bars from `rs-bars`, executes the selected ST trend-rider strategy, and persists signal entries under `rh-agent-symbols/{symbol}/run-ids` and `rh-agent-symbols/{symbol}/signal-history`
6. Signals appear in the Angular dashboard for grouped review, triage, and (when enabled) MCP trade execution

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
            ├─ getCachedBars(symbol, marketDate)  [rs-bars]
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
| `rh-agent-config.ts` | interfaces, enums, constants | All Firestore data shapes and collection names |
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
RH_AGENT_MCP_SERVER_URL=http://localhost:3000/sse
RH_AGENT_ACCOUNT_NUMBER=your_account_number
```

## Status

- **Robinhood MCP** — enabled via `RH_AGENT_MCP_SERVER_URL` and `RH_AGENT_ACCOUNT_NUMBER` secrets; orders are sent only when the executor callable is invoked with a non-empty allocation
- **Claude** — reserved for post-scan approval flow (not used during scanning)
- **Live trading** — controlled through the `rh-agent-executor` MCP integration; no separate OAuth2 flow is required

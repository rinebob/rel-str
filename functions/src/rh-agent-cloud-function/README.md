# RH Agent Cloud Function

Firebase Cloud Functions for the Robinhood AI Trading Agent.

## Overview

Event-driven daily scan that:
1. Triggers on `partner-data-ready` Pub/Sub (`runType: "intraday-snapshot"`)
2. Fetches a bulk intraday snapshot from SavantAPI for all monitored symbols
3. Enqueues one Cloud Tasks job per symbol for parallel analysis
4. Each worker reads historical OHLCV bars from `rs-symbol-cache`, computes RSI(14) + price change, and writes a trade opportunity to Firestore if RSI < 30 AND price drop > 2%
5. Opportunities appear in the Angular dashboard for user review and approval

All runs are **dry-run only** — no real trades are placed until the Robinhood OAuth integration is complete.

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
            ├─ getCachedBars(symbol, marketDate)  [rs-symbol-cache]
            ├─ compute RSI(14) + priceChange
            └─ storeOpportunity()  [if RSI < 30 AND drop > 2%]
                        │
                        ▼
                rh-agent-opportunities (Firestore)
                        │
                        ▼
                Angular Dashboard (review/approve)
```

## Files

| File | Exports | Purpose |
|------|---------|---------|
| `rh-agent-config.ts` | interfaces, enums, constants | All Firestore data shapes and collection names |
| `rh-agent-shared.ts` | `getMarketDate`, `getDeadlineISO`, `loadEnabledSymbols`, `createDailyRun`, `createJobAndEnqueue` | Shared helpers used by PDR trigger and manual callable |
| `rh-agent-trigger.ts` | `rhAgentPdrTrigger`, `rhAgentTriggerDaily` | PDR Pub/Sub trigger; HTTP admin trigger with `?date` override |
| `rh-agent-worker.ts` | `rhAgentProcessSymbol` | Cloud Tasks worker: reads cache, computes indicators, writes opportunities |
| `rh-agent-callables.ts` | `rhAgentManualRun` | HTTPS callable for dashboard "Run Now" button |
| `rh-agent-dashboard-callables.ts` | `rhAgentGetStatus`, `rhAgentGetRunHistory`, `rhAgentGetSignalHistory`, `rhAgentGetOpportunities` | Dashboard data callables |
| `rh-agent-seed-admin.ts` | `seedRhAgentSymbolsAdmin`, `clearRhAgentSymbolsAdmin`, `seedAllSymbolsFromPartner` | Symbol list management |
| `rh-agent-firestore.ts` | Firestore write helpers | Legacy `rh-agent-signals` path helpers |
| `rh-agent-secrets.ts` | `rhAgentSecrets` | Firebase Secret Manager bindings |
| `rh-agent-scheduled.ts` | `rhAgentScheduled` | Legacy MCP-based scheduled function — **not exported**, kept for reference |

## Firestore Collections

| Collection | Doc ID | Purpose |
|-----------|--------|---------|
| `rh-agent-symbols` | `{symbol}` | Monitored symbols with `enabled` flag and `priority` |
| `rh-agent-runs` | PDR: `marketDate`; manual: `{marketDate}_manual_{ts}` | Run metadata and counters |
| `rh-agent-runs/{runId}/jobs` | `{symbol}` | Per-symbol job status |
| `rh-agent-opportunities` | `{date}_{dow}_{symbol}_{action}_{signalType}` | Trade opportunities pending approval |
| `rh-agent-status/current` | `current` | Agent status singleton |
| `rh-agent-signals` | auto | Legacy signal records (not written by current architecture) |

## Setup

### 1. Configure Firebase Secrets

```bash
firebase functions:secrets:set ANTHROPIC_API_KEY
```

### 2. Seed Symbol List

**Option A — 20 test symbols:**
```bash
# Call the admin HTTP endpoint (once deployed)
curl -X POST https://<region>-rel-str.cloudfunctions.net/seedRhAgentSymbolsAdmin
```

**Option B — Full ~700-symbol universe from SavantAPI:**
```bash
# Clear existing, then seed from partner
curl -X POST https://<region>-rel-str.cloudfunctions.net/clearRhAgentSymbolsAdmin
curl -X POST https://<region>-rel-str.cloudfunctions.net/seedAllSymbolsFromPartner
```

### 3. Deploy Functions

```bash
cd functions
npm run build
firebase deploy --only functions:rhAgentPdrTrigger,functions:rhAgentProcessSymbol,functions:rhAgentManualRun,functions:rhAgentGetStatus,functions:rhAgentGetRunHistory,functions:rhAgentGetOpportunities,functions:rhAgentTriggerDaily,functions:seedRhAgentSymbolsAdmin,functions:clearRhAgentSymbolsAdmin,functions:seedAllSymbolsFromPartner
```

## Manual Testing

Trigger a run with a historical date to test against cached data:

```bash
curl "https://rhagenttriggerdaily-<hash>-uc.a.run.app?date=2026-06-13"
```

## Signal Strategy (MVP)

**RSI Oversold Bounce** — fires when both conditions are true:
- RSI(14) < 30 (oversold)
- 1-day price change < −2%

Confidence = `round((30 − rsi) / 30 * 100)`, capped at 95.

Opportunity ID format: `2026-06-16_mon_AAPL_BUY_RSI_OVERSOLD`

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
```

## Status

- **Robinhood MCP** — disabled; no real orders placed
- **Claude** — reserved for post-scan approval flow (not used during scanning)
- **Live trading** — pending Robinhood OAuth2 integration (mechanism TBD)

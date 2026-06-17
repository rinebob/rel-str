# RH Agent Cloud Functions - Implementation Progress

**Last Updated:** June 16, 2026 (4:00 PM PT)
**Status:** ✅ FULL UNIVERSE OPERATIONAL - 761 symbols processing successfully via PDR trigger. Multiple runs per day enabled.

---

## ✅ COMPLETED

### 1. Architecture & Infrastructure
- **Firebase Cloud Functions (Gen 2)** with Node.js 22
- **Firestore collections** created:
  - `rh-agent-symbols` - ✅ **761 active symbols** (full SavantAPI tradeable universe seeded via `seedAllSymbolsFromPartner`)
  - `rh-agent-runs` - Per-run docs. PDR runs: ID = `marketDate`. Manual runs: ID = `{marketDate}_manual_{timestamp}`
  - `rh-agent-runs/{runId}/jobs` - Per-symbol job status
  - `rh-agent-opportunities` - Detected trade opportunities; doc ID = `{date}_{dow}_{symbol}_{action}_{signalType}`
  - `rh-agent-status` - Agent health/status singleton
- **Cloud Tasks** for parallel symbol processing (max 20 concurrent)
- **PDR Pub/Sub trigger** - `partner-data-ready` topic, `runType: "intraday-snapshot"` (primary)
  - ✅ **Deduplication removed** - Now supports 6 scheduled + unlimited manual runs per market date
  - ✅ **OIDC audience fixed** - `partnerIntradaySnapshotV2` endpoint calls successful (403 errors resolved)
  - ✅ **Full universe verified** - Runs 1808 & 1809 processed all 761 symbols, 740 intraday snapshots, 0 failures
- **Manual HTTP trigger** (`rhAgentTriggerDaily`) with `?date=YYYY-MM-DD` override for testing
- **Shared utilities** extracted to `rh-agent-shared.ts` (`getMarketDate`, `getDeadlineISO`, `loadEnabledSymbols`, `createDailyRun`, `createJobAndEnqueue`)

### 2. Core Functions Implemented

#### `rhAgentPdrTrigger` (Pub/Sub)
- Subscribes to `partner-data-ready` topic
- Filters: `runType === "intraday-snapshot"` AND `status === "end"` AND `runStatus in ["completed", "completed_with_errors"]`
- Calls `callPartnerIntradaySnapshotV2(symbols)` — bulk POST for all enabled symbols in one request
- Passes `IntradaySnapshot` data in each Cloud Tasks job payload
- Creates run document with run ID from PDR message (supports multiple runs per market date)
- Logs: market date, symbols loaded, intraday fetch result, run created, enqueue progress
- **Latest runs:**
  - `2026-06-16-TUE-INTRADAY-LIVE-1808` - 761 symbols, 740 snapshots, 48s, 0 failures
  - `2026-06-16-TUE-INTRADAY-LIVE-1809` - 761 symbols, 740 snapshots, 48s, 0 failures

#### `rhAgentProcessSymbol` (Task Queue Worker)
- Fetches 30 days of daily bars from `rs-symbol-cache/{date}/symbols/{symbol}`
- Calculates RSI(14) using Wilder's smoothing
- Calculates price change % from previous close
- Signal detection: RSI < 30 AND price drop > 2%
- Stores opportunities with custom ID: `DATE_day_SYMBOL_DIRECTION_SIGNALTYPE`
  - Example: `2026-06-13_fri_AAPL_BUY_RSI_OVERSOLD`
- Includes `marketDate` and `signalType` fields
- Data freshness check implemented (disabled for testing: `REQUIRE_FRESH_DATA = false`)

#### `rhAgentTriggerDaily` (HTTP Admin)
- Manual trigger for testing/admin use
- Query param: `?date=YYYY-MM-DD` for historical runs
- Returns: runId, marketDate, symbolCount, enqueuedCount
- Run ID format: auto-generated (does not use shared `createDailyRun`)

#### Dashboard Callables (Public Access)
- `rhAgentGetStatus` - Agent health and last run info
- `rhAgentGetRunHistory` - Recent run documents
- `rhAgentGetSignalHistory` - All signals/opportunities
- `rhAgentGetOpportunities` - Filtered opportunity list
- All have `invoker: 'public'` for testing (CORS enabled)

### 3. Admin Functions (Symbol Management)
- **`seedAllSymbolsFromPartner`** - HTTP admin function that:
  - Fetches all active tradeable symbols from `partnerListTrackedSymbolsV2` endpoint
  - Handles partner response format (objects with `symbol` property, not plain strings)
  - Validates and filters empty/invalid symbols before Firestore write
  - Batch writes to `rh-agent-symbols` with `enabled: true`, priority order, source tag
  - Successfully seeded 761 symbols on June 16, 2026

### 4. Angular Frontend Integration
- **Route:** `/rh-agent` loads `RhAgentDashboardComponent`
- **Sidenav:** Added "RH Agent" navigation link
- **Dashboard displays:**
  - Agent status
  - Recent runs with date-based IDs
  - Signal/opportunity list
  - Job completion tracking
- **CORS resolved:** Callable functions public for testing

### 5. Data Validation & Testing
- **Test run completed:** June 13, 2026 (Friday)
- **All 20 symbols processed successfully**
- **Cache hits:** All symbols found in `rs-symbol-cache/2026-06-13/symbols/`
- **RSI calculations verified:** 34.78 (AMZN), 44.05 (AAPL), etc.
- **No signals generated:** June 13 was flat day (no oversold + 2% drop combo)
- **Closest to signal:** LLY (-2.39% drop but RSI 62.67 - not oversold)

### 6. Key Design Decisions
- **Uses existing `rs-symbol-cache`** - 30 days of bars per symbol per date
- **Date-based run IDs** - One run per day: "2026-06-13"
- **Weekday-only scheduling** - Skips weekends via cron expression
- **Custom opportunity IDs** - Include day of week lowercase for readability
- **No live Robinhood API calls during scan** - Uses cached SavantAPI data
- **Signal only when BOTH conditions met:** RSI < 30 AND price drop > 2%

### 7. Files Created/Modified
- `functions/src/rh-agent-cloud-function/rh-agent-trigger.ts` - PDR Pub/Sub trigger (`rhAgentPdrTrigger`) + HTTP admin trigger (`rhAgentTriggerDaily`)
- `functions/src/rh-agent-cloud-function/rh-agent-worker.ts` - Symbol processor; reads historical bars + intraday from payload
- `functions/src/rh-agent-cloud-function/rh-agent-shared.ts` - **New** shared helpers: `getMarketDate`, `getDeadlineISO`, `loadEnabledSymbols`, `createDailyRun`, `createJobAndEnqueue`
- `functions/src/rh-agent-cloud-function/rh-agent-callables.ts` - Manual run callable; now delegates to `rh-agent-shared.ts`
- `functions/src/rh-agent-cloud-function/rh-agent-dashboard-callables.ts` - Frontend APIs
- `functions/src/rh-agent-cloud-function/rh-agent-config.ts` - Types, constants, interfaces; added `IntradaySnapshot`, `SymbolJobPayload` with optional `intraday` field
- `functions/src/rh-agent-cloud-function/rh-agent-seed-admin.ts` - Symbol seeding; added `seedAllSymbolsFromPartner` (fetches full universe via `callPartnerTrackedSymbols`)
- `functions/src/rh-agent-cloud-function/rh-agent-firestore.ts` - DB helpers (legacy signals path)
- `functions/src/partner-proxy.ts` - Added `callPartnerIntradaySnapshotV2` (bulk POST) and `callPartnerTrackedSymbols`
- `functions/src/index.ts` - Exports updated; `rhAgentPdrTrigger`, `seedAllSymbolsFromPartner` added
- `src/app/core/common/constants.ts` - Nav menu updated

---

## ✅ COMPLETED TODAY (June 16, 2026)

| Task | Status | Details |
|------|--------|---------|
| Remove deduplication logic | ✅ | Deleted one-run-per-market-date block in `rh-agent-trigger.ts` |
| Deploy updated trigger | ✅ | `rhAgentPdrTrigger` redeployed with dedup removed |
| Fix OIDC audience | ✅ | `partnerIntradaySnapshotV2` added to audience whitelist by SA |
| Verify endpoint calls | ✅ | 200 OK responses, 740 snapshots per run |
| Create `seedAllSymbolsFromPartner` | ✅ | New admin function to fetch full universe from partner |
| Deploy seed function | ✅ | Successfully fetches and seeds 761 symbols |
| Validate symbol parsing | ✅ | Fixed object-to-string extraction from partner response |
| Full universe test runs | ✅ | Runs 1808 & 1809 - 761 symbols, 0 failures |

## 📋 NEXT TASKS

### 1. Signal Detection Validation
- Monitor `rh-agent-opportunities` for actual signals on volatile market days
- Verify RSI < 30 + price drop > 2% logic generates expected opportunities
- Test edge cases: thinly traded symbols, halted stocks, after-hours data

### 2. Historical Data Backtesting
Enable analysis of past market data to identify signal frequency and test strategy effectiveness.

**Option A (Recommended):** Create `rhAgentBacktestRange` HTTP admin callable:
- Input: `startDate`, `endDate`, `symbols` (optional)
- Loop through each trading day, re-run full symbol analysis against cached bars
- Output: aggregate report (total signals, signals/day, top symbols)
- Consideration: validate `rs-symbol-cache` data exists for each date before processing

**Option B:** Loop `?date=` calls to `rhAgentTriggerDaily` via script for spot-check volatile days

### 3. Opportunity Approval UI & Robinhood Execution
- Approval/rejection callable (`rhAgentApproveTrade`)
- Robinhood OAuth2 integration (mechanism TBD — see `RH_AGENT_IMPLEMENTATION.md`)
- UI for reviewing, approving, and monitoring execution

---

## 🔧 DEPLOYED ENDPOINTS

| Function | URL | Purpose |
|----------|-----|---------|
| Manual Trigger | `https://rhagenttriggerdaily-vbos3p6z7q-uc.a.run.app?date=2026-06-13` | Test with historical date |
| Daily Scheduler | `https://us-central1-rel-str.cloudfunctions.net/rhAgentDailyScheduler` | Force run scheduled function |

---

## 📊 CURRENT DATA STATE

**Symbols (active):** ✅ **761 symbols** - Full SavantAPI tradeable universe seeded
- Source: `partnerListTrackedSymbolsV2?activeOnly=true` endpoint
- Seeded: June 16, 2026 via `seedAllSymbolsFromPartner` admin function

**Cache availability:** 2026-01-12 through present (trading days, populated by `rs-time-series-jobs.worker.ts`)

**Runs created:**
- `pKFeIgNiYv8ofNbUiKGY` (June 13, 2026 - 20 symbols, 0 signals, manual)
- `2026-06-16-TUE-INTRADAY-LIVE-1808` (June 16, 2026 - 761 symbols, 740 snapshots, 0 failures, PDR-triggered)
- `2026-06-16-TUE-INTRADAY-LIVE-1809` (June 16, 2026 - 761 symbols, 740 snapshots, 0 failures, PDR-triggered)

**Opportunities:** 0 (no RSI < 30 AND price drop > 2% conditions met on tested dates)

---

## 🎯 IMMEDIATE NEXT STEPS

1. ✅ ~~Seed full universe~~ - **DONE** - 761 symbols active
2. ✅ ~~PDR end-to-end test~~ - **DONE** - Runs 1808/1809 verified
3. **Find a volatile day** - Test historical run on a day with actual market selloff (e.g., a 2025 drawdown day) to verify signal generation
4. **Implement historical backtest** - `rhAgentBacktestRange` callable for date-range analysis
5. **Add opportunity approval flow** - `rhAgentApproveTrade` callable + UI for reviewing and approving detected signals
6. **Integrate Robinhood API** - Execute approved trades (post-MVP; OAuth mechanism TBD)

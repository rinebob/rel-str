# RH Agent Cloud Functions - Implementation Progress

**Last Updated:** June 14, 2026
**Status:** Core functions deployed and working. Ready for historical backtesting feature.

---

## ✅ COMPLETED

### 1. Architecture & Infrastructure
- **Firebase Cloud Functions (Gen 2)** with Node.js 22
- **Firestore collections** created:
  - `rh-agent-symbols` - 20 test symbols (AAPL, MSFT, NVDA, AMZN, GOOGL, META, TSLA, etc.)
  - `rh-agent-runs` - Daily run tracking with date-based IDs (e.g., "2026-06-13")
  - `rh-agent-runs/{runId}/jobs` - Per-symbol job status
  - `rh-agent-opportunities` - Detected trade opportunities
  - `rh-agent-status` - Agent health/status singleton
- **Cloud Tasks** for parallel symbol processing (max 20 concurrent)
- **Scheduled triggers** - Cron `0 20 * * 1-5` (12 PM PT, weekdays only)
- **Manual HTTP trigger** with date override for testing

### 2. Core Functions Implemented

#### `rhAgentDailyScheduler` (Scheduled)
- Runs weekdays at 12 PM PT / 8 PM UTC
- Loads enabled symbols from `rh-agent-symbols`
- Creates run document with date-based ID
- Enqueues Cloud Tasks for each symbol (max 20 concurrent)
- Logs: market date, symbols loaded, run created, enqueue progress

#### `rhAgentProcessSymbol` (Task Queue Worker)
- Fetches 30 days of daily bars from `rs-symbol-cache/{date}/symbols/{symbol}`
- Calculates RSI(14) using Wilder's smoothing
- Calculates price change % from previous close
- Signal detection: RSI < 30 AND price drop > 2%
- Stores opportunities with custom ID: `DATE_day_SYMBOL_DIRECTION_SIGNALTYPE`
  - Example: `2026-06-13_fri_AAPL_BUY_RSI_OVERSOLD`
- Includes `marketDate` and `signalType` fields
- Data freshness check implemented (disabled for testing: `REQUIRE_FRESH_DATA = false`)

#### `rhAgentTriggerDaily` (HTTP Callable)
- Manual trigger for testing
- Query param: `?date=YYYY-MM-DD` for historical runs
- Returns: runId, marketDate, symbolCount, enqueuedCount

#### Dashboard Callables (Public Access)
- `rhAgentGetStatus` - Agent health and last run info
- `rhAgentGetRunHistory` - Recent run documents
- `rhAgentGetSignalHistory` - All signals/opportunities
- `rhAgentGetOpportunities` - Filtered opportunity list
- All have `invoker: 'public'` for testing (CORS enabled)

### 3. Angular Frontend Integration
- **Route:** `/rh-agent` loads `RhAgentDashboardComponent`
- **Sidenav:** Added "RH Agent" navigation link
- **Dashboard displays:**
  - Agent status
  - Recent runs with date-based IDs
  - Signal/opportunity list
  - Job completion tracking
- **CORS resolved:** Callable functions public for testing

### 4. Data Validation & Testing
- **Test run completed:** June 13, 2026 (Friday)
- **All 20 symbols processed successfully**
- **Cache hits:** All symbols found in `rs-symbol-cache/2026-06-13/symbols/`
- **RSI calculations verified:** 34.78 (AMZN), 44.05 (AAPL), etc.
- **No signals generated:** June 13 was flat day (no oversold + 2% drop combo)
- **Closest to signal:** LLY (-2.39% drop but RSI 62.67 - not oversold)

### 5. Key Design Decisions
- **Uses existing `rs-symbol-cache`** - 30 days of bars per symbol per date
- **Date-based run IDs** - One run per day: "2026-06-13"
- **Weekday-only scheduling** - Skips weekends via cron expression
- **Custom opportunity IDs** - Include day of week lowercase for readability
- **No live Robinhood API calls during scan** - Uses cached SavantAPI data
- **Signal only when BOTH conditions met:** RSI < 30 AND price drop > 2%

### 6. Files Created/Modified
- `functions/src/rh-agent-cloud-function/rh-agent-scheduler.ts` - Daily scheduler
- `functions/src/rh-agent-cloud-function/rh-agent-worker.ts` - Symbol processor
- `functions/src/rh-agent-cloud-function/rh-agent-trigger.ts` - Manual trigger
- `functions/src/rh-agent-cloud-function/rh-agent-dashboard-callables.ts` - Frontend APIs
- `functions/src/rh-agent-cloud-function/rh-agent-config.ts` - Types, constants, interfaces
- `functions/src/rh-agent-cloud-function/rh-agent-seed-admin.ts` - Symbol seeding
- `functions/src/rh-agent-cloud-function/rh-agent-firestore.ts` - DB helpers
- `functions/src/index.ts` - Exports updated
- `src/app/core/common/constants.ts` - Nav menu updated

---

## 📋 NEXT TASK: Historical Data Backtesting

### Goal
Enable analysis of past market data to identify how often signals occurred, test strategy effectiveness, and populate historical opportunity data.

### Implementation Options

#### Option A: Batch Historical Runner (Recommended)
Create `rhAgentBacktestRange` callable:
- Input: `startDate`, `endDate`, `symbols` (optional)
- Process: Loop through each trading day, run full analysis
- Output: Aggregate report with signal frequency, win rate analysis
- Storage: Create run documents for each date (or aggregate into single backtest run)

#### Option B: Multi-Date Trigger Enhancement
- Enhance `rhAgentTriggerDaily` to accept multiple dates
- Or create script to loop through date range calling existing trigger
- Simple but creates many individual runs

#### Option C: On-Demand Single Dates
- Continue using `?date=` parameter for spot checks
- Manually test volatile days (market crashes, corrections)
- Good for ad-hoc analysis

### Technical Considerations
- Cache availability: Need `rs-symbol-cache` data for target dates
- Date range: Should validate dates exist in cache before processing
- Parallelism: Can run multiple dates in parallel (separate from symbol parallelism)
- Firestore writes: Backtest could generate many documents - consider batching or summary-only mode

### Acceptance Criteria
- [ ] Can specify date range (e.g., 2026-05-01 to 2026-06-13)
- [ ] Runs analysis for all trading days in range
- [ ] Aggregates results: total signals, signals per day, symbols with most signals
- [ ] Optional: Store all opportunities vs. summary-only mode
- [ ] Dashboard view to visualize historical signal frequency

---

## 🔧 DEPLOYED ENDPOINTS

| Function | URL | Purpose |
|----------|-----|---------|
| Manual Trigger | `https://rhagenttriggerdaily-vbos3p6z7q-uc.a.run.app?date=2026-06-13` | Test with historical date |
| Daily Scheduler | `https://us-central1-rel-str.cloudfunctions.net/rhAgentDailyScheduler` | Force run scheduled function |

---

## 📊 CURRENT DATA STATE

**Symbols:** 20 (AAPL, MSFT, NVDA, AMZN, GOOGL, META, TSLA, AVGO, BRK-B, LLY, JPM, XOM, UNH, V, MA, PG, JNJ, HD, MRK, WMT)

**Cache availability:** 2026-01-12 through 2026-06-13 (trading days only)

**Runs created:**
- `pKFeIgNiYv8ofNbUiKGY` (June 13, 2026 - 20 symbols processed, 0 signals)

**Opportunities:** 0 (no oversold + 2% drop conditions met yet)

---

## 🎯 IMMEDIATE NEXT STEPS

1. **Implement Historical Backtest** - Choose Option A or B
2. **Find a volatile day** - Test on a day with actual market selloff to verify signal generation
3. **Verify opportunity storage** - Confirm custom IDs and fields appear correctly in Firestore
4. **Add opportunity approval flow** - UI for reviewing and approving detected signals
5. **Integrate Robinhood API** - Execute approved trades (post-MVP)

# PDR-Driven Pipeline & Local Bar Store

**Date:** 2026-08-20
**Status:** Informational summary — no implementation authorized yet

---

## Pipeline Context

rel-str fetches financial data from SA (SavantAPI / av-proxy-api), which is a proxy service that sits between Alpha Vantage and client apps. SA fetches data from AV, stores it in its own Firestore, and publishes PDR (partner-data-ready) Pub/Sub messages when data runs complete.

rel-str maintains a **local bar store** in `symbol-data/{SYMBOL}` — a local copy of SA's D/W/M bar data that serves as the fast-read path for both batch processes and user-facing UI. This is not a redundant cache to be eliminated; it is the primary data source for bar data within rel-str.

The options strategy engine runs on top of this data: a selection pass picks contracts each night, each strategy invokes its own open event at its configured open time, a mark pass updates P&L during market hours, and a settlement pass closes expiring positions.

---

## SA PDR Schedule

**Authoritative reference:** `av-proxy-api/functions/docs/pdr-message-guide.md` — SA's PDR message guide with full message bodies, attributes, runId formats, and field reference.

SA publishes PDR messages to the `partner-data-ready` Pub/Sub topic when its data runs complete. All times PT. There are two categories of runs:

### POST runs (EOD bars for the current market day)

Three sequences, each emitting three PDR messages (one per interval: daily, weekly, monthly):

| Time (PT) | Sequence | runType (attr) | phase | What it signals |
|---|---|---|---|---|
| ~1:35 PM | POST A | `ts-post-all-intervals` | `post` | EOD DAILY/WEEKLY/MONTHLY bars ready (4:35 PM ET) |
| ~6 PM | POST B | `ts-post-all-intervals` | `post` | Evening retry — symbols that failed in A (9 PM ET) |
| ~4 AM | POST C | `ts-post-all-intervals` | `post` | Final straggler catch — symbols that failed in B (7 AM ET next day) |

### Intraday PRE runs (intraday snapshots during market hours)

One PDR per tick:

| Time (PT) | runType (attr) | phase | `clockPt` | What it signals |
|---|---|---|---|---|
| 8 AM | `intraday-snapshot` | `pre` | `0800` | First intraday snapshot |
| 10 AM | `intraday-snapshot` | `pre` | `1000` | Mid-morning snapshot |
| 12 PM | `intraday-snapshot` | `pre` | `1200` | Final intraday snapshot |

These are the only two categories of PDR runs. Both should support all RH Agent features.

### PDR message attributes

**Intraday (PRE) messages:**
- `runType=intraday-snapshot`
- `phase=pre`
- `clockPt=0800` / `1000` / `1200` (differentiates the three daily runs)
- `runId` pattern: `{date}-{dow}-LIVE-{clockPt}`
- `barStatusDaily` / `barStatusWeekly` / `barStatusMonthly` attrs (0 or -1)
- No `includeSymbols` / `excludeSymbols`

**POST messages (A/B/C):**
- `runType=ts-post-all-intervals` (same for all three sequences)
- `phase=post`
- `interval=daily` / `weekly` / `monthly` (one message per interval)
- `runId` pattern: `{date}-{dow}-POST-{seq}-{clockEt}-{interval}` where seq is A/B/C
- Sequence A: `excludeSymbols` (symbols that are NOT fresh — stale or failed — in this run; should not be re-fetched)
- Sequence B/C: `includeSymbols` (only symbols that became fresh in this retry pass)
- No `clockPt` attribute

**Distinguishing A from B/C:** The `runType` Pub/Sub attribute is always `ts-post-all-intervals` for all three. The A/B/C distinction is only on the Firestore run doc (`ts-post-all-intervals-initial` vs `ts-post-all-intervals-retry`) and in the `runId` pattern. A consumer filtering on Pub/Sub attributes alone cannot distinguish A from B/C — they'd need to parse the `runId` or check for `includeSymbols`/`excludeSymbols` presence.

### Separate topic: `partner-symbols-ready`

SA publishes per-symbol notifications to a separate `partner-symbols-ready` topic after each successful POST job (one message per symbol per interval). These are not sent for intraday runs. The rel-str subscriber (`processSymbolsReady`) is disabled — it was parked in favor of the run-driven `partner-data-ready` pipeline. Not relevant to this work.

### Separate topic: `partner-symbol-added`

SA publishes to `partner-symbol-added` when a new symbol is onboarded to `tracked-symbols` (full historical backfill complete). This is the topic rel-str uses to trigger full history fetch for newly added symbols. Separate from the PDR schedule above.

### The 7:55 AM gate — non-issue

`rhAgentPdrTrigger` in `functions/src/rh-agent-cloud-function/rh-agent-trigger.ts` gates at 7:55 AM PT, blocking `intraday-snapshot` PDRs before that time. The first intraday-snapshot arrives at 8 AM PT, after the gate. The ~4 AM PT morning catch-up is a POST run (`ts-post-all-intervals`), not `intraday-snapshot`, so the gate does not affect it. The gate blocks nothing. The earlier confusion was mixing up 7 AM ET (POST C) with 7 AM PT (which doesn't exist in the schedule).

---

## Redundancy Analysis

### PDR subscribers (2 active, 1 dead)

| Subscriber | runType | What it does |
|---|---|---|
| `processDataReadyRunV2` | `ts-daily-pre`, `ts-daily-post`, `ts-weekly-post`, `ts-monthly-post`, `heartbeat` | RS pair processing — fetches bars, computes relative strength |
| `rhAgentPdrTrigger` | `intraday-snapshot` only | Triggers RH Agent signal generation |
| `processSymbolsReady` | *(disabled)* | Dead — gated by `USE_SYMBOL_DRIVEN_PIPELINE=false` |

No overlap between the two active subscribers — they handle different runTypes and do different work.

### Scheduled functions — disposition

| Function | Schedule (PT) | Disposition | Reason |
|---|---|---|---|
| `syncTrackedSymbolsDaily` | Midnight | **Delete** | Redundant — `currentPrice` and selection pass move to `symbolDataSync` |
| `symbolDataSyncNightly` | 6 PM | **Convert to PDR-triggered `symbolDataSync`** | Single entry point, triggered by `ts-post-all-intervals` |
| `optionsOpenPass` | 6:45 AM | **Replace with per-strategy open events** | Each strategy has its own open time — single batch pass is wrong model |
| `optionsMarkPass` | Every 30 min 6:50 AM–1 PM | **Keep** | Uses live RH quotes, not SA data — no PDR to key off of |
| `rhAgentOverviewSyncWeekly` | Sun 11 PM | **Keep** | Weekly company overview, unrelated to PDR schedule |
| `autoDiagnoseAndFixDaily` | 8:30 PM | **Keep** | Safety net, runs independently |
| `cleanupRsBackfillRuns` | 8 PM | **Keep** | Maintenance, runs independently |

### Problems found

1. **Redundant SA fetches** — `syncTrackedSymbolsDaily` (midnight) and `symbolDataSyncNightly` (6 PM) both fetch daily bars for all 863 symbols — 1726 SA calls when 863 would suffice.

2. **Race condition** — `currentPrice` written by multiple functions can overwrite each other.

3. **Drift** — `symbolDataSyncNightly` writes bars to year shards but does NOT write `currentPrice`. So `currentPrice` (written by midnight sync) and the latest bar in the shard (written by 6 PM sync) can be out of sync.

4. **`syncTrackedSymbolsDaily` is entirely redundant** — its two jobs (write `currentPrice`, run selection pass) can be done by `symbolDataSyncNightly`'s task worker and a PDR-triggered selection pass.

5. **Fixed schedulers that should be PDR-triggered** — `symbolDataSyncNightly` guesses 6 PM, `syncTrackedSymbolsDaily` guesses midnight. Both should trigger when SA says data is ready.

6. **Dead code** — `processSymbolsReady` (disabled), `optionsSelectionPass` onSchedule (removed), `optionsSettlementPass` onSchedule (removed).

---

## SA (av-proxy-api) Architecture

### SA is the data owner

The av-proxy-api fetches from AV, stores in its own Firestore, and serves via partner proxy endpoints that **read from Firestore** (not fetch from AV on demand).

**SA's Firestore schema:**
- `symbol-data/{symbol}/sa-time-series/av-daily-adjusted/years/{YYYY}` — year-sharded daily bars
- `symbol-data/{symbol}/sa-time-series/av-weekly-adjusted/years/{YYYY}` — year-sharded weekly bars
- `symbol-data/{symbol}/sa-time-series/av-monthly-adjusted/all/data` — monthly bars (single doc, not year-sharded)
- Metadata docs with `lastUpdated`, `nextRefreshAt`, `ttlSeconds`

**SA's PDR publishing schedule (from `function-schedules.ts`):**

| Schedule | Cron | Timezone | Purpose (PT) |
|---|---|---|---|
| `TS_DAILY_INTRADAY_HOURLY_SCHEDULE` | `0 8,10,12 * * 1-5` | America/Los_Angeles | Intraday snapshots (8 AM, 10 AM, 12 PM) |
| `TS_DAILY_POST_CLOSE_SCHEDULE` | `35 16 * * 1-5` | America/New_York | POST all-intervals (~1:35 PM) |
| `TS_DAILY_POST_EVENING_RETRY_MINUTE_00` | `0 21 * * 1-5` | America/New_York | Evening retry (~6 PM) |
| `TS_DAILY_POST_MORNING_CATCHUP_0700` | `0 7 * * 1-5` | America/New_York | Morning catch-up (~4 AM) |
| `AV_REFRESH_MANAGER_SCHEDULE` | `45 13 * * 1-5` | America/New_York | Non-time-series refresh (~10:45 AM) |

---

## Local Bar Store Consumers

### Everything that reads from `symbol-data/{SYMBOL}`

#### Batch processes (backend)

| Feature | What it reads | Volume | Files |
|---|---|---|---|
| **Options engine** (selection, open, settlement, held-shares) | `currentPrice` field + daily bars for specific dates | Low — 4 symbols per pass | `options-strategy-market-data.ts`, orchestrators, passes |
| **RH Agent workers** (signal generation) | Full D/W/M bars per symbol | High — 863 parallel workers, each reads one symbol's full history | `rh-agent-data-loader.ts`, `rh-agent-worker.ts` |
| **RH Agent backtest** | Full D/W/M bars per symbol | Medium — one symbol per backtest run | `backtest-data-loader.ts` |
| **Historical signal generation script** | Full D/W/M bars | High — one-time script, all symbols | `generate-historical-signal-history.ts` |

#### User-facing UI reads (frontend)

| Feature | What it reads | Volume | Files |
|---|---|---|---|
| **RH Agent charts** (signal detail, quick charts) | Full D/W/M bars per symbol | Medium — one symbol per chart view | `rh-agent-chart.service.ts`, `rh-agent-chart.store.ts` |
| **RH Agent indicator series** | Full D/W/M bars per symbol | Medium — callable, one symbol | `rh-agent-indicator-series.ts` |
| **Trade journal** | `currentPrice` field | Low — one field per symbol in user's trades | `trade-journal.service.ts` |
| **Dashboard symbol picker** | Root doc metadata (symbol, name, company) | Medium — all symbols, metadata only | `rel-str-db-v2.service.ts`, `symbol-picker.component.ts` |

### Features that do NOT read from the local bar store

| Feature | Where it reads from | Notes |
|---|---|---|
| **Heatmap** | `pairs-data/{pairId}/archive-{year}`, `heatmap-snapshots/{docId}` for RS cells; `getPairDailyBars` callable → SA for OHLC price bars | RS data is separate pipeline; price bar overlay has same latency problem — out of scope for this topic |
| **RS processing** (`processDataReadyRunV2`) | SA via `callPartnerTimeSeries` | Reads from SA directly |
| **RS chart** | SA via `getPairDailyBars` callable → `callPartnerTimeSeries` | Same latency problem — out of scope for this topic |
| **Dashboard** | SA via `RsDataService` → `getPairDailyBars` callable → `callPartnerTimeSeries` | Same latency problem — out of scope for this topic |
| **Option chart** | SA via `getPairDailyBars` callable → `callPartnerTimeSeries` | **5-10 second load time — latency problem — in scope** |
| **Spread chart** | SA via `getPairDailyBars` callable → `callPartnerTimeSeries` | **Same latency problem — in scope** |

### The chart latency problem

The option chart and spread chart currently fetch underlying bars via `getPairDailyBars` callable, which calls `callPartnerTimeSeries` — an HTTP round trip to SA. Load time is 5-10 seconds for the underlying bars. The same data is already sitting in the local bar store (`symbol-data/{SYMBOL}`), where a read would be sub-50ms.

These charts should be migrated to read from the local bar store instead of calling SA.

### Writers to the local bar store

| Writer | What it writes | Schedule |
|---|---|---|
| `symbolDataSyncNightly` (task worker) | Full D/W/M bars + metadata | 6 PM fixed |
| `syncTrackedSymbolsDaily` | `currentPrice` + metadata | Midnight fixed |
| `partner-webhooks.ts` | `currentPrice` | PDR-triggered |
| `backfill-symbol-data-from-pairs.ts` | `currentPrice` | Admin-triggered |

---

## Unified Direction

### The local bar store is the single source of truth for bar data in rel-str

It stays. It is not a cache to be eliminated — it is the fast-read path for user-facing UI (charts) and batch processes (RH Agent, options engine). The problems to fix are:

1. **Sync should be PDR-triggered, not fixed-scheduled** — SA says data is ready, then we sync
2. **One writer, not three** — eliminate the redundant `currentPrice` writers
3. **Charts should read from the local bar store** — eliminate the 5-10 second SA round trip
4. **Selection and settlement passes trigger from sync completion** — not from separate fixed schedulers

### Proposed changes (discussion only — not yet authorized)

| Change | What |
|---|---|
| `symbolDataSyncNightly` → `symbolDataSync` | Convert from fixed scheduler to PDR-triggered (`ts-post-all-intervals`), rename, single entry point |
| Per-symbol task worker | Writes D/W/M bars AND `currentPrice` in one pass (no separate function) |
| Delete `syncTrackedSymbolsDaily` | Redundant — its work is covered by `symbolDataSync` |
| Selection pass | Triggers from sync completion |
| Settlement pass | Triggers from sync completion |
| Replace `optionsOpenPass` | Per-strategy open events — each strategy invokes its own open at its configured time |
| Remove 7:55 AM gate | In `rhAgentPdrTrigger` — dead code, blocks nothing |
| Migrate option chart + spread chart | Read from `symbol-data/{SYMBOL}` instead of `getPairDailyBars` callable → SA |
| `currentPrice` field | Stays — written once by the task worker, no more three-writer race |
| RH Agent workers | Unchanged — already read from local bar store |
| `optionsMarkPass` | Keep — uses live RH quotes, not SA data |
| `rhAgentOverviewSyncWeekly` | Keep — weekly company overview |
| `autoDiagnoseAndFixDaily` | Keep — safety net |
| `cleanupRsBackfillRuns` | Keep — maintenance |
| Heatmap, RS processing, trade journal, dashboard | All untouched |

### Open questions

1. **Open pass architecture** — each strategy has its own open time. Need a map of open times to strategy array, with a routine that runs when each open time occurs. Each strategy invokes its own open event rather than all strategies running in one batch pass. Design TBD.

2. **`getPairDailyBars` callable** — resolved. Does NOT become dead code after this topic. Still used by heatmap chart, RS chart, and dashboard. A separate future topic will capture migrating those callers and eventually killing the callable.

### Scope boundary

Changes stay within the options engine, data sync, and chart data access. RS processing, heatmap, trade journal, dashboard — all untouched.

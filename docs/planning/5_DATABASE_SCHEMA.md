# Database Schema and Management - Relative Strength Heatmap (MVP) - RS-Only (Revised)

## 1. Introduction

This document defines an RS-only Firestore schema optimized for fast reads, minimal writes, and flexible baselines. We do not persist OHLCV in our Firestore; price/volume are fetched on-demand from SavantAPI for charting/backtests. User-specific data (profiles, preferences, subscriptions) is deferred for later and not included here.

## 2. Database Choice: Firebase Cloud Firestore

* Choice: Firebase Cloud Firestore
* Type: NoSQL Cloud Database
* Description: Firestore is used to store computed Relative Strength (RS) series and derived buy/sell signals for baseline–symbol pairs, plus small mirrors for fast access and global configuration.

## 3. Collections and Documents

The RS-only model is pair-centric. A pair is identified as `${BASELINE}-${SYMBOL}` (e.g., `SPY-NVDA`).

* `pair-registry` Collection
  * Document ID: `${BASELINE}-${SYMBOL}`
  * Fields:
    * `baseline` (string)
    * `symbol` (string)
    * `createdAt` (number, epoch ms)
    * `meta` (map, optional): `{ lastRegisteredBy?:string }` (deferred; do not rely on this now)
  * Purpose: The scheduler enumerates this collection to determine which pairs to compute at pre/post-close. UI callables (e.g., from `SelectStockPanel`) add/remove entries.
* `pairs-data` Collection
  * Document ID: `${BASELINE}-${SYMBOL}` (e.g., `SPY-NVDA`)
  * Canonical shape and write semantics are defined below in “Revised Pair Storage (Authoritative WIP) — pairs-data”.

## Revised Pair Storage (Authoritative WIP) — pairs-data

This section supersedes earlier drafts for pair storage. We will update the code to match this shape.

* Collection name: `pairs-data`
* Document id: `{BASE}-{SYMBOL}` (e.g., `SPY-AAPL`)

Top-level fields

* `meta: map` — single metadata object (consolidates previous `meta` and `seriesMeta`)
  * `baseline: string` — e.g., `SPY`
  * `symbol: string` — e.g., `AAPL`
  * `interval: "DAILY"`
  * `window: number` — maximum number of recent days to keep in the `data` array mirror (e.g., 30)
* `lastUpdatedAt: timestamp` — last write time (either pre or post)
* `latest: map` — mirrors the most recent element in `data`
  * `day: string` — YYYY-MM-DD (UTC trading day)
  * `dow: string` — day-of-week label (UTC)
  * `pre?: map` — pre-close snapshot for the day
    * `time?: string` — human-readable, e.g., "15:30"
    * `t: number` — epoch ms
    * `base: { price:number, change:number, percentChange:number }`
    * `target: { price:number, change:number, percentChange:number }`
    * `rs: number`
    * `source?: "intraday"` — indicates intraday source
  * `post?: map` — post-close snapshot for the day
    * `t: number` — epoch ms
    * `base: { price:number, change:number, percentChange:number }`
    * `target: { price:number, change:number, percentChange:number }`
    * `rs: number`
    * `source?: "adjustedClose" | "close"`
* `data: array<map>` — ascending by `day`; the canonical history mirror
  * Each element mirrors `latest` fields for that `day` and contains `pre?` and `post?` blocks as above

Computation rules and write semantics

* __PRE (pre-close) run__
  * Compute pre-close snapshot using intraday prices (`ip`/`ipc`) where available.
  * Compute `change` and `percentChange` for both baseline and target against the prior day’s POST-close prices (not against intraday), so the pre snapshot is anchored to yesterday’s canonical close.
  * Write a new element for `day` into `data` with only `pre` populated, and set `latest` to that same object.
* __POST (post-close) run__
  * Clone the current `latest` (which contains the day’s `pre`) and add/overwrite the `post` block using end-of-day prices (`ac`/`cp`).
  * Update the most recent `data` element for that `day` to include the `post` block.
  * Update `latest` to the combined object. After post completes, `latest` === last(`data`).
* __Alignment & Idempotency__
  * Align by `day` and update the element for that `day` deterministically (replace or append).
  * `latest` must always exactly mirror the most recent element in `data`.

### Archive shards and selection rubric

The writer also maintains per-year archive shards under each pair document for long-term history and backfills:

* Path: `pairs-data/{BASE}-{SYMBOL}/archive-YYYY/{YYMMDD}` (e.g., `archive-2025/251023` for 2025-10-23)
* Each day doc contains a superset of the `data[]` element for that day with optional `pre` and `post` blocks.

Selection rubric for reading archive values (server and FE should align on this):

* Historical days (any day before today, in UTC): return POST only; ignore PRE even if it exists.
* Today (UTC): return POST if present; otherwise return PRE if present.

This ensures historical RS reflects canonical end-of-day values while still allowing intraday PRE display before POST is available on the current trading day.

Example (abbreviated)

```json
{
  "meta": {
    "baseline": "SPY",
    "symbol": "AAPL",
    "interval": "DAILY",
    "window": 30
  },
  "lastUpdatedAt": "<timestamp>",
  "latest": {
    "day": "2025-10-23",
    "dow": "Thu",
    "pre": {
      "time": "12:30",
      "t": 1761241800000,
      "base": { "price": 500.12, "change": 1.23, "percentChange": 0.25 },
      "target": { "price": 210.45, "change": 0.85, "percentChange": 0.41 },
      "rs": 0.4208,
      "source": "intraday"
    },
    "post": {
      "t": 1761264000000,
      "base": { "price": 502.01, "change": 2.34, "percentChange": 0.47 },
      "target": { "price": 211.10, "change": 1.50, "percentChange": 0.72 },
      "rs": 0.4206,
      "source": "adjustedClose"
    }
  },
  "data": [
    { "day": "2025-10-22", "dow": "Wed", "post": { /* ... */ } },
    { "day": "2025-10-23", "dow": "Thu", "pre": { /* ... */ }, "post": { /* ... */ } }
  ]
}
```

Notes

* PRE `change`/`percentChange` are explicitly measured against the prior day’s POST-close prices for both baseline and target.
* The historical `data` array is a short mirror (length = `meta.window`) for fast reads; full history may live elsewhere or be computed on demand.
* Future work: optional `signals` subcollection and `signalsSummary` can be layered on top of this structure without changing `latest`/`data`.

Phase entries:

* PRE: based on intraday price (ip) and ipc; change/percentChange vs prior-day POST-close (ac preferred, fallback c)
* POST: based on adjusted close (ac) or c; change/percentChange vs prior-day POST-close

## Partner Webhooks Data Model (Backend RS pipeline)

See also: [docs/partner/partner-webhooks.md](../partner/partner-webhooks.md)

### partner-events/*
Records each Pub/Sub run for observability and idempotency.

- status: `processing | completed | completed_with_errors | failed | heartbeat`
- runType: string (see `RunType` in `webhooks-config.ts`)
- runId: string
- messageId: string
- publishTime: RFC3339 string
- ptPublishTime: partitioned publish time segment (optional)
- pairsProcessed: number
- pairsFailed: number
- intervalUsed: `DAILY`
- window: number (default 30)
- errorSamples: Array<{ pair: string; message: string; status?: number; code?: string }>

Indexing considerations: typically queried by recent time or runId.

### pair-registry/*
Registry of baseline–target pairs.

- baseline: string (uppercased)
- target: string (uppercased)
- members: string[] (e.g., `uid:123/list:abc`)
- refCount: number
- createdAt: Timestamp
- updatedAt: Timestamp
- pendingDeleteAt?: ISO string (scheduled removal)

Retention: entries with refCount=0 can be cleaned up after REGISTRY_RETENTION_DAYS.

### pairs-data/{BASELINE}-{TARGET}
Unified RS storage for FE consumption with phase-aware branches.

Document shape written by writer:

```
{
  meta: { baseline: 'SPY', symbol: 'AAPL', interval: 'DAILY', window: 30 },
  lastUpdatedAt: <Timestamp>,
  latest: { day: 'YYYY-MM-DD', pre?: { ... }, post?: { ... } },
  data: [
    { day: 'YYYY-MM-DD', dow: 'Mon', pre?: { ... }, post?: { ... } },
    ...
  ]
}
```

Phase entries:
- pre: based on intraday price (ip) and ipc; change/percentChange vs prior-day post-close (ac preferred, fallback c)
- post: based on adjusted close (ac) or c; change/percentChange vs prior-day post-close

Retention: capped to `meta.window` most recent days (default 30).

### pairs-data/{BASELINE}-{TARGET}
Canonical RS store (unchanged). FE reads `latest` for ranking and `data[]` for series.

#### signals (subcollection) — RsSignalHistory positions
- Path: `pairs-data/{PAIR}/signals/{positionId}` with `positionId = {PAIR}_{YYYYMMDD}_{DOW}_{direction}`
- Fields:
  - `pair: string` — e.g., `QQQ-AAPL`
  - `baseline: string` — e.g., `QQQ`
  - `symbol: string` — e.g., `AAPL`
  - `direction: 'long' | 'short'`
  - `positionId: string` — `{PAIR}_{YYYYMMDD}_{DOW}_{direction}` (e.g., `QQQ-AAPL_20241126_Tue_long`)
  - `opened: {`
  - `  day: string` — YYYY-MM-DD (UTC)
  - `  t: number` — epoch ms
  - `  source: 'pre' | 'post'`
  - `  openPrice: number` — target security price at open
  - `  basePrice: number` — baseline price at open (for reference)
  - `  rsYesterday: number`
  - `  rsToday: number`
  - `}`
  - `closed?: {`
  - `  day: string` — YYYY-MM-DD (UTC)
  - `  t: number` — epoch ms
  - `  source: 'pre' | 'post'`
  - `  closePrice: number` — target security price at close
  - `  basePrice: number` — baseline price at close (for reference)
  - `  rsYesterday: number`
  - `  rsToday: number`
  - `  change: number` — `closePrice - opened.openPrice`
  - `  pctChange: number` — `(change / opened.openPrice) * 100`
  - `}`
  - `appPnl?: {`
  - `  openedPrice: number`
  - `  closedPrice?: number`
  - `  change?: number`
  - `  pctChange?: number`
  - `  sourceOpen: 'pre' | 'post'`
  - `  sourceClose?: 'pre' | 'post'`
  - `}`
  - `tradeMeta?: { hasUserActuals?: boolean }`
  - `status: 'open' | 'closed'`
  - `createdAt: Timestamp`
  - `updatedAt: Timestamp`

#### signals-daily (subcollection)
- Path: `pairs-data/{PAIR}/signals-daily/{YYYY-MM-DD}`
- Fields:
  - `newOpens: Array<{ positionId, direction }>`
  - `holds: Array<{ positionId, direction }>`
  - `newCloses: Array<{ positionId, direction, change, pctChange }>`
  - `pnlSummary? { long:{count,sum,sumPct}, short:{...}, total:{...} }`
  - `appPnLSummary? { long:{count,sum,sumPct}, short:{...}, total:{...} }`
  - `cumulativePnL? { long:{count,sum,sumPct}, short:{...}, total:{...} }`
  - `updatedAt`

#### positions (root collection)
- Path: `positions/{positionId}`
- Behavior:
  - A document is created on every new OPEN signal with entry metadata.
  - While the position remains open, the document is updated daily with running snapshot fields.
  - When the position is CLOSED, final exit fields are written and `status` becomes `CLOSED`.
- Fields:
  - `positionId`— canonical
  - `pair, baseline, symbol, side` (strings)
  - `status: 'OPEN' | 'CLOSED'`
  - `entryTimestamp, exitTimestamp?` (numbers)
  - `entryPrice?, exitPrice?` (numbers)
  - `entryDay, exitDay?` (YYYY-MM-DD)
  - `entryIso, exitIso?` (ISO strings)
  - Running snapshot (present/updated while OPEN):
    - `lastUpdateDay?: string` — YYYY-MM-DD of last daily refresh
    - `lastPrice?: number` — current day price snapshot (target)
    - `runningPnL?: number` — change vs entry (side-aware)
    - `runningPctReturn?: number` — percent change vs entry
  - Finalized PnL (on close):
    - `netPnL, percentReturn` (numbers)
  - `createdAt, updatedAt` (timestamps)

#### analytics (root collection)
- Path: `analytics/summary`
- Fields:
  - `totalNetPnL, totalTrades, totalWinningTrades, totalLosingTrades, avgNetPnL, lastUpdated`

#### Per-user overlays (Actuals)
- Path: `users/{uid}/trades/{positionId}` (matches canonical `positionId`)
- Fields:
  - `executed: boolean`
  - `opened? { price?, day?, dow?, t?, note? }`
  - `closed? { price?, day?, dow?, t?, note? }`
  - `actualPnl? { openedPrice?, closedPrice?, openedDay?, closedDay?, change?, pctChange? }`
  - `appSnapshot? { openedPrice?, closedPrice?, sourceOpen?, sourceClose?, takenAt? }`
  - `updatedAt`

Optional per-user aggregates:
- Path: `users/{uid}/pnlDaily/{YYYY-MM-DD}` with `actualPnLSummary?`

#### Indexes
- Collection group `signals`: by `opened.day desc`, `closed.day desc`, and filters on `status/baseline/symbol/direction`
- Collection group `signalsDaily`: by `day`, composite `(pair, day)` if needed
- Per-user overlays: direct doc lookups by `users/{uid}/trades/{positionId}`; optional per-user daily composite `(uid, day)` if building dashboards

#### Deprecation alignment
- Prefer archive shards for long history; retain `latest` and small mirrors for fast reads. `data[]` may be deprecated over time (see `RS_SIGNAL_HISTORY.md`).

## 4. Indexing

Define indexes for efficient queries on series and signals:

* `pairs-data/*/data` (subcollection): index by `day` for range queries and "last N" reads
  * Example query: `orderBy('day', 'desc').limit(30)`
* `pair-registry` top-level collection: simple listing and optional composite on `(baseline, symbol)` are sufficient; document ID already encodes both.
* Optional: If server-side threshold scanning is required for heatmaps, composite on fields in `pairs-data.latest.post.rs` (or `pre`); any symbol can act as a baseline.

## 5. Data Loading & Access Patterns

* Heatmap (baseline derived from pairs-data ids)
  1. Determine the current baseline (e.g., global default like `SPY`, or user-selected if supported later).
  2. For each visible symbol, read `pairs-data/{BASELINE}-{SYMBOL}.latest` to get current RS (pre or post) and timestamp.
  3. Query `data` with `orderBy day desc limit 30` when needed.
* Chart View
  1. Call backend `GetPairRSData(base, symbol, from, to, thresholds?)`.
  2. Read Firestore `pairs-data/{PAIR}/data` (and `signals` if/when added). Any symbol can be a baseline.
  3. If `base` is not active, compute RS on-demand (optionally hydrate `rs-cache`) and compute transient signals for provided thresholds; do not persist.
  4. Fetch OHLCV from SavantAPI on-demand to render price/volume; do not store in Firestore.
* Scheduled RS Computation
  1. For each symbol × baselines, compute RS for pre and post windows.
  2. Write/update per-day doc in `data`, update `latest`.
  3. Detect threshold crossings using `defaultThresholds` and append to `signals`; update `signalsSummary`.
* Sector baseline dropdown (TODO / not supported now):
  * Frontend requests `GetSectorConstituents({ etf })` to get members.
  * Frontend sets baseline to `{ etf }` and loads `pairs-data/{etf}-{symbol}.latest` for each member.
  * Optionally, user can save the sector as a list → bulk `RegisterPairs` for scheduler maintenance.

## 6. Partner Run Events — partner-events

Operational collection that tracks each upstream Data-Ready run and its outcome. This enables idempotency (skip already-terminal runs), observability, and quick diagnostics. It does not store RS values; it references what the pipeline did.

* Collection: `partner-events`
* Document id:
  * For normal runs: `{runType}__{runId}`
    * Examples: `ts-daily-pre__2025-10-23-pre-y0fnt3`, `ts-daily-post__2025-10-23-post-abc123`
  * For heartbeats: `heartbeat-{YYMMDD-HHMMSS}-{messageId}`

Fields (lowerCamelCase)

* `status: 'processing' | 'completed' | 'completed_with_errors' | 'failed' | 'heartbeat'`
* `runType: string` — e.g., `ts-daily-pre`, `ts-daily-post`
* `runId: string` — unique per invocation (publisher-provided)
* `phase?: 'pre' | 'post'` — if present in attributes/payload
* `isCanary?: boolean` — true for heartbeat/canary messages
* `messageId?: string` — Pub/Sub message id
* `publishTime?: string` — Pub/Sub publish time (ISO)
* `ptPublishTime?: string` — human-friendly `YYMMDD-HHMMSS` (for heartbeats)
* `intervalUsed: 'DAILY'` — fixed for MVP
* `window: number` — fixed mirror window (e.g., 30)
* `startTime?: timestamp` — set when processing begins
* `endTime?: timestamp` — set on completion or failure
* `pairsProcessed?: number` — count of successful pair writes
* `pairsFailed?: number` — count of pairs that failed
* `errorSamples?: Array<{ pair:string; message:string; status?:number; code?:string }>` — truncated sample for quick triage

Lifecycle

1. On receipt, the subscriber computes the doc id and checks status.
   * If `status` is terminal (`completed`, `failed`, `completed_with_errors`), the run is skipped for idempotency.
2. The run is marked `processing` with `startTime`, `intervalUsed`, `window`, and context.
3. The pipeline loads pairs from `pair-registry` and writes RS to `pairs-data`.
4. On completion, the doc is updated with `status`, `endTime`, `pairsProcessed`, `pairsFailed`, and `errorSamples` (if any).

Relationship to `pairs-data`

* `partner-events/*` holds execution metadata only. It does not embed RS.
* Successful runs increment `pairsProcessed` as each pair is written to `pairs-data/{BASE}-{SYMBOL}` (pre then post phases per the rules above).
* Use `partner-events` to audit which runs affected which pairs and whether any pairs failed during the run.

Example

```json
{
  "status": "completed",
  "runType": "ts-daily-pre",
  "runId": "2025-10-23-pre-y0fnt3",
  "phase": "pre",
  "isCanary": false,
  "messageId": "16812431447950939",
  "publishTime": "2025-10-23T19:26:48.155Z",
  "intervalUsed": "DAILY",
  "window": 30,
  "startTime": "<timestamp>",
  "endTime": "<timestamp>",
  "pairsProcessed": 7,
  "pairsFailed": 0,
  "errorSamples": []
}
```

## 7. Migrations

* Strategy: Update Cloud Functions to write RS-only to the new `pairs-data/*/data` shape. Backfill enumerates pairs strictly from `pair-registry/*`.

## 8. Backups

* Use Firestore export to GCS on a daily schedule.
* Keep retention aligned with cost and RPO needs (e.g., last 7 daily snapshots).

---

## 9. TODO / Optional Collections (not supported now)

These collections are not strictly needed for the MVP and are deferred. They are documented here as future options.

* `app-config`
  * `settings` doc with:
    * `defaultThresholds` (map): `{ buy:number, sell:number }`
    * `nextScheduledFetch` (number, epoch ms)
  * Purpose: centralize global toggles/schedules if needed later.

* `sectors`
  * Doc id `{ETF}` (e.g., `XLF`). Fields: `members` (string[]), `updatedAt` (number), `source` (string, optional)
  * Purpose: sector constituents cache. For now, derive baselines by enumerating `pairs-data` doc ids.

* `rs-cache`
  * Short-lived cache docs to accelerate repeated on-demand computations without persisting long-term. Only functions would write if introduced.

## Recent Changes (2025-10-27)

- Canonical data sources:
  - `tracked-symbols/*` (partner-managed): FE read-only, used for symbol universe; callable also returns the canonical list.
  - `pairs-data/*` (backend-managed): FE read-only live series for heatmap.
  - `users/{uid}/lists/{listId}` (client-owned): FE read/write only for the authenticated owner.
- Firestore Rules tightened:
  - `tracked-symbols/*` and `pairs-data/*` now require `request.auth != null` (no public reads).
  - `users/{uid}/lists/*` remains owner-only read/write.
  - Default deny for all other collections.
- Removed: client-admin `admin/supported-symbols-list` doc concept. Any admin/curation lives outside the FE; FE is read-only for partner-owned data.

## 10. Curated Baselines, Catalog, and Leaders Cache (2025-10-28)

Purpose: Provide deterministic defaults and fast "Top/Bottom" RS views without FE fan-out or on-the-fly RS computation.

### baselines/{BASE}
- tickerSymbol: string (e.g., "SPY")
- name: string (e.g., "SPDR S&P 500 ETF")
- provider: "StateStreet" | "Nasdaq" | "Custom"
- holdings: string[] (uppercase tickers)
- meta: { lastUpdatedAt: timestamp; count: number; sourceUrl?: string; version?: string }

Example
```json
{
  "tickerSymbol": "SPY",
  "name": "SPDR S&P 500 ETF",
  "provider": "StateStreet",
  "holdings": ["AAPL","MSFT","NVDA"],
  "meta": { "lastUpdatedAt": "<ts>", "count": 503 }
}
```

Security: FE read-only with auth; writes by backend only.

### baselines/{BASE}/leaders/latest (optional)
- top: Array<{ symbol: string; rs: number }>
- bottom: Array<{ symbol: string; rs: number }>
- updatedAt: timestamp
- window?: number; source?: "pre" | "post"

Keeps baseline-related cache localized and simple to fetch.

### catalogs/baselines
- items: string[] (e.g., ["SPY","QQQ","DIA","XLK","XLF"]) 
- meta?: { updatedAt: timestamp }

Drives baseline buttons in UI without scanning.

### presets/{presetId} (optional)
- type: "etf" | "theme" | "curated"
- baseline: string
- constituents: string[]
- displayName: string; description?: string; updatedAt: timestamp

Curated/demo lists users can copy into their lists.

### pairs-data/{BASE}-{SYMBOL}
Canonical RS store (unchanged). FE reads `latest` for ranking and `data[]` for series.

### Backend APIs (callables)
- getBaselineLeaders({ baseline, direction: "desc"|"asc", limit }) → { baseline, items: Array<{ symbol, rs }> }
- getBaselineHoldings({ baseline }) → { baseline, holdings: string[] }
- getPairsLatest({ pairs }) → Array<{ pair, rs }> (optional)

### Emulator seed sketch
- baselines/SPY, QQQ, DIA, XLK, XLF with 20–50 holdings each
- catalogs/baselines with ["SPY","QQQ","DIA","XLK","XLF"]
- pairs-data for a subset of pairs matching holdings (include `latest` + short `data[]`)
- baselines/SPY/leaders/latest with small top/bottom arrays

## Appendix: Rationale for Key Decisions

* The compact `pairs-data` shape (latest + data array) supports last-30 reads without a per-day `rs` subcollection. If server-side signal feeds are needed later, a separate `signals` collection can be introduced, with a small `signalsSummary` mirror on the pair doc.
* All collection and document ids use kebab-case (e.g., `pairs-data`, `pair-registry`, `SPY-AAPL`).
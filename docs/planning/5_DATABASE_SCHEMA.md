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

This section supersedes earlier drafts for pair storage. The code will be updated to match this shape. The model is **pair-centric and multi-interval** across `DAILY | WEEKLY | MONTHLY`, with a single parent document per pair and per-interval archive shards.

* Collection name: `pairs-data`
* Document id: `{BASE}-{SYMBOL}` (e.g., `SPY-AAPL`)

### Top-level fields

Each `pairs-data/{PAIR}` document acts as the canonical parent for all RS intervals:

* `meta: map` — single metadata object
  * `baseline: string` — e.g., `SPY`
  * `symbol: string` — e.g., `AAPL`
  * (No `interval` or `window` here; intervals are modeled via archives and latest mirrors.)
* `lastUpdatedAt: timestamp` — last write time across any interval.
* `latestDaily?: map` — latest finalized **daily** RS snapshot
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
    * `source?: "close"`
* `latestWeekly?: map` — latest **weekly** RS snapshot (may be intraperiod)
  * `day: string` — `YYYY-MM-DD` calendar trading day corresponding to the weekly bar
  * `dow: string`
  * `post: { ... }` — RS + prices for the current weekly bar
* `latestMonthly?: map` — latest **monthly** RS snapshot (may be intraperiod)
  * `day: string` — `YYYY-MM-DD` calendar trading day corresponding to the monthly bar
  * `dow: string`
  * `post: { ... }` — RS + prices for the current monthly bar

`latestDaily` is the primary source for heatmaps and dashboards; `latestWeekly` and `latestMonthly` are mirrors for fast access to current higher-interval RS.

### Archive shards and selection rubric

Longer history is stored under **per-interval, per-year** archive collections beneath each pair:

* **Daily (existing)**

  * Path: `pairs-data/{BASE}-{SYMBOL}/archive-YYYY/{YYMMDD}` (e.g., `archive-2025/251023` for 2025-10-23)
  * Each day doc contains:
    * `day: string` — `YYYY-MM-DD`
    * `dow: string`
    * `pre?: map` — intraday/pre-close snapshot (uses intraday price fields `ip`/`ipc` when available)
    * `post?: map` — end-of-day snapshot (uses normalized daily close per data-normalization docs)

  **Daily computation rules (PRE/POST):**

  * PRE (pre-close run)
    * Compute pre-close snapshot using intraday prices (`ip`/`ipc`) where available.
    * Compute `change` and `percentChange` for both baseline and target **vs the prior day’s POST-close prices** (not vs intraday), so the PRE snapshot is anchored to yesterday’s canonical close.
    * Write/merge `pre` into `archive-YYYY/{YYMMDD}` and `latestDaily.pre`.
  * POST (post-close run)
    * Compute end-of-day snapshot using the chosen normalized close (`c`), per data-normalization planning docs.
    * Compute `change` and `percentChange` vs the prior day’s POST-close prices.
    * Write/merge `post` into `archive-YYYY/{YYMMDD}` and `latestDaily.post`.
  * Historical read rubric:
    * For historical days (before today, UTC): return POST only; ignore PRE even if it exists.
    * For today (UTC): return POST if present; otherwise return PRE if present.

* **Weekly**

  * Path: `pairs-data/{BASE}-{SYMBOL}/archive-weekly-YYYY/{YYMMDD}`
  * Each doc reuses the same `post` structure as daily archives, but values are computed from **weekly** bars:
    * `day: string` — `YYYY-MM-DD`
    * `dow: string`
    * `post: map` — weekly end-of-interval snapshot (RS + prices)
    * `isIntervalClose: boolean` — `true` for all stored weekly archive docs.
  * **Only end-of-interval weekly bars are written to `archive-weekly-*`.** Intra-period weekly previews are modeled via `signals-activity`, not extra archive docs.

* **Monthly**

  * Path: `pairs-data/{BASE}-{SYMBOL}/archive-monthly-YYYY/{YYMMDD}`
  * Same shape as weekly archives, computed from **monthly** bars:
    * `day: string`
    * `dow: string`
    * `post: map` — monthly end-of-interval snapshot (RS + prices)
    * `isIntervalClose: boolean` — `true` for all stored monthly archive docs.
  * **Only end-of-interval monthly bars are written to `archive-monthly-*`.** Intra-period monthly previews are modeled via `signals-activity`, not extra archive docs.

* **Selection rubric for reading archive values** (server and FE should align):

* **Daily charts**: read from `archive-YYYY` ordered by `day`.
* **Weekly charts**: read from `archive-weekly-YYYY`, using the stored end-of-interval samples.
* **Monthly charts**: read from `archive-monthly-YYYY`, using the stored end-of-interval samples.

* **Final vs preview semantics**:

* Daily samples are effectively always final per trading day.
* Weekly/monthly archive samples represent only final interval-end values; intra-period previews live exclusively in `signals-activity`.

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
Canonical RS store (unchanged at the collection level). FE reads `latestDaily` (and, where needed, `latestWeekly` / `latestMonthly`) for rankings, and uses per-interval archives (`archive-*`) for RS series.

#### signals (subcollections) — canonical RS signal events

- Path (per pair, year-sharded):
  - `pairs-data/{PAIR}/signals/{YYYY}/opens/{signalId}`
  - `pairs-data/{PAIR}/signals/{YYYY}/closes/{signalId}`

- Identity:
  - `signalId` is the primary key for **signal events** (e.g., `20250106-MON-QQQ-AAPL-SHORT-O` / `...-C`).
  - `positionId` is a separate id, used as a foreign key from signals into positions.

- Open signals (`opens` collection) — `BeOpenSignalDoc`:
  - Derived from `BeSignalBase` plus `positionId`.
  - Captures event-time RS/price context at the opening decision.

- Close signals (`closes` collection) — `BeCloseSignalDoc`:
  - Mirrors the open fields and adds `positionId` and `openSignalId` linkage.

- Behavior:
  - Signal docs are immutable, POST-only, and carry event-time RS context:
    - `rsRaw` / `rsNorm` for today, and `prevRs` for yesterday, all sourced from the canonical archives.
    - No PnL or position snapshots are embedded; those live on root positions.
  - Intraday/pre-close updates for open positions are represented as `PriceDatum` entries in `BePositionDoc.updates[]`, not as additional signal docs.
  - All canonical open/close signals (backfill and live POST) are produced by the shared RS engine (`functions/src/webhooks/rs-signals-engine.ts#detectRsEvents`) and written via the shared consumer (`functions/src/webhooks/rs-events-consumer.ts#applyRsEventsForPair`). This is the single writer for per-pair signals and root positions.

#### signals-activity (per-pair and root mirrors) — Signals Activity / Whipsaw

These mirrors provide a **transaction-centric activity log** per calendar day, across all intervals.

- Per-pair path (year-sharded):
  - `pairs-data/{PAIR}/signals-activity/{YYYY}/days/{YYYY-MM-DD}`

- Root mirror path (year-sharded):
  - `signals-activity/{YYYY}/days/{YYYY-MM-DD}`

- Shared shape (`SignalsActivityDoc`):

```ts
// Conceptual; see functions/src/types/signal.types.ts for the concrete contract.
enum ActivityEventKind { OPEN = 'OPEN', HOLD = 'HOLD', CLOSE = 'CLOSE' }
enum ActivityEventState { PREVIEW = 'PREVIEW', FINAL = 'FINAL', ABANDONED = 'ABANDONED' }
// FINAL = matched to canonical signal; ABANDONED = preview that never printed.
enum Interval { DAILY = 'DAILY', WEEKLY = 'WEEKLY', MONTHLY = 'MONTHLY' }

interface ActivityEvent {
  kind: ActivityEventKind;
  interval: Interval;
  positionId: string;
  pair?: string;         // present in the root mirror, implicit in per-pair docs
  direction: RsDirection; // enum; see signal.types.ts
  rsRaw: number;         // raw RS at this point
  rsNorm: number;        // normalized RS on [0,1] internal scale
  state: ActivityEventState;
  signalId?: string;     // populated when state === FINAL
}

interface SignalsActivityDoc {
  date: string;          // YYYY-MM-DD trading day
  events: ActivityEvent[];
}
```

Behavior:

- On every POST run (realtime or backfill), for each interval (DAILY/WEEKLY/MONTHLY), the canonical engine:
  - Loads archive RS samples for that interval.
  - Uses `detectRsEvents` + thresholds to derive OPEN/CLOSE events.
  - Maps these to canonical `RsWriteEvent[]` and applies them via `applyRsEventsForPair` (signals + positions).
  - Calls the shared helper `generateActivityFromWrites` to derive `ActivityEvent[]`:
    - Groups writes by `(interval, positionId)`.
    - Derives `openDay`/`closeDay` for each position.
    - Walks RS samples between those days and emits:
      - `OPEN` on the open day.
      - `HOLD` on intermediate days where the interval has a sample.
      - `CLOSE` on the close day (if closed).
  - The same helper and rubric are used by both admin backfill and realtime POST, so Signals Activity is consistent across historical and live data.
  - All events are initially written with `state: PREVIEW`; later workflows may promote matching events to `FINAL` and attach `signalId` once linked to concrete signal docs.

Consumers:

- FE dashboards can query `signals-activity` and:
  - Filter by `interval` (D/W/M).
  - Highlight `PREVIEW` vs `FINAL` events.
  - Use `ABANDONED` entries to compute whipsaw and “false alarm” statistics.

#### positions (root collection)
- Path: `positions/{open|YYYY-closed}/items/{positionId}`
- Behavior:
  - A document is created on every new OPEN signal with an **entry price datum** and initialized position metadata.
  - While the position remains open, intraday/pre-close updates append new **update price data** snapshots (no in-place mutation of historical samples).
  - When the position is CLOSED, a final **exit price datum** is written, and `status` becomes `'closed'`.
- Canonical contract (`BePositionDoc`, see `functions/src/types/position.types.ts`):
  - Identity & routing:
    - `positionId: string` — canonical id shared across FE/BE.
    - `pair: string` — e.g., `QQQ-AAPL`.
    - `baseline: string` — e.g., `QQQ`.
    - `symbol: string` — e.g., `AAPL`.
    - `direction: 'long' | 'short'` (implemented as `RsDirectionEnum` in code).
    - `status: 'open' | 'closed'` (implemented as `RsPositionStatus` in code).
  - Price timeline (all samples share a single `PriceDatum` shape):
    - Shared `PriceDatum` fields:
      - `role: 'entry' | 'update' | 'exit'` — implemented as a `PriceDatumRole` enum in code.
      - `day: string` — `YYYY-MM-DD` trading day (ET-aligned).
      - `timestamp: number` — epoch ms of the sample (canonical time field; ISO strings can be derived where needed).
      - `price: number` — target price at this sample.
      - `rsRaw: number` — raw RS at this sample.
      - `rsNorm: number` — normalized RS at this sample.
      - `source?: 'pre' | 'post'` — implemented via `RsSourceEnum`; `pre` covers intraday/pre-close updates, `post` covers canonical EOD samples.
      - `pnl: number` — absolute PnL vs the **entry** at this moment.
      - `pct: number` — percentage return vs the **entry** at this moment.
      - `prevRsRaw?: number`, `prevRsNorm?: number` — previous-day RS values at the time of this sample.
    - Position fields:
      - `entry: PriceDatum` — the canonical opening sample; **must always** have `pnl = 0` and `pct = 0`.
      - `updates: PriceDatum[]` — zero or more intraday/pre-close or end-of-day samples (role `update`), each with its own `price`, `rsRaw`/`rsNorm`, `pnl`, and `pct` relative to the original entry.
      - `exit?: PriceDatum` — optional final sample (role `exit`) recorded when the position is closed; its `pnl`/`pct` typically become the realized net values.
  - Aggregated PnL (position-level):
    - `netPnL?: number` — final realized PnL for the position; usually equals `exit.pnl` when present.
    - `netPercentReturn?: number` — final realized percent return; usually equals `exit.pct` when present.
  - We do **not** store redundant `lastPrice`/`lastRs`/`lastTimestamp` fields; callers derive the latest state from `exit` (if present) or from the last element in `updates`.
  - The canonical contract intentionally omits `createdAt`/`updatedAt` user-facing fields; lifecycle timing is inferred from the price timeline itself. Firestore system timestamps may still exist for operational/debugging use but are not part of the schema contract.
  - Root position docs and their timelines are written from RS events by `rs-events-consumer.applyRsEventsForPair` (entry/exit) and updated over time via `positions-manager.appendOpenPositionsTimelineForPair` / `appendRootPositionTimelineUpdate` (PRE/POST `updates[]`), which keeps live and backfill paths in sync.

#### Live Production Sharding Update (Closed vs Currently-Open)
To ensure clear separation between historical (closed) positions and currently open ones, and to prevent accidental pollution of currently open positions with historical data, we are adopting the following naming and write semantics for live production runs:

- Terminology update (positions only; per-pair signals remain year-sharded with explicit `opens`/`closes` subcollections):
  - Open positions will be stored under `positions/open/items/{positionId}`.
    - Example: `positions/open/items/{positionId}` (only open positions).
  - Closed position year shard document ids will be suffixed with `-closed`.
    - Example: `positions/{YYYY}-closed/items/{positionId}` instead of `positions/{YYYY}/items/*`.
  - Per-pair signals are written under year docs with explicit opens/closes subcollections:
    - `pairs-data/{PAIR}/signals/{YYYY}/opens/{signalId}`
    - `pairs-data/{PAIR}/signals/{YYYY}/closes/{signalId}`
- Constants (shared in code under `webhooks-config.ts`):
  - `OPEN_BUCKET_ID = 'open'`
  - `CLOSED_YEAR_SUFFIX = '-closed'`
  - `ITEMS_SUBCOLLECTION = 'items'`

Implementation notes:
- Position management helpers are centralized in `functions/src/webhooks/positions-manager.ts`.
- All `items` subcollection references use the `ITEMS_SUBCOLLECTION` constant (no magic strings).

- Live-run write semantics (per-pair signals → positions):
  - Opening signal (LONG or SHORT):
    - Write a `BeOpenSignalDoc` to `pairs-data/{PAIR}/signals/{YYYY}/opens/{signalId}` (with `positionId`).
    - Create/merge the corresponding `BePositionDoc` under `positions/open/items/{positionId}`.
  - Closing signal:
    - Write a `BeCloseSignalDoc` to `pairs-data/{PAIR}/signals/{YYYY}/closes/{signalId}`.
    - Update the corresponding root position in `positions/open/items/{positionId}` with `exit` and net PnL, then move it to `positions/{YYYY}-closed/items/{positionId}` and delete the open copy.

- Migration considerations:
  - Use existing purge callables to delete legacy/non-conforming roots, and run backfill to rebuild per-pair signals and root positions into `open` and `{YYYY}-closed` structures. No rename callables are required.
  - Provide a one-time sweeper (optional) to move any lingering `positions/hot/items/*` into `positions/open/items/*` if present.

This model guarantees:
- `open` only contains open positions; closed items are immediately moved to year-closed shards.
- Year-closed shards hold immutable historical data, partitioned by year.

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
- Collection group `signals`: by `opened.day desc`, `closed.day desc`, and filters on `status/baseline/symbol/direction`.
- Per-user overlays: direct doc lookups by `users/{uid}/trades/{positionId}`; optional per-user daily composite `(uid, day)` if building dashboards

#### Deprecation alignment
- Prefer archive shards for long history; retain `latestDaily` / `latestWeekly` / `latestMonthly` mirrors for fast reads.

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

Canonical RS store (multi-interval). FE reads `latestDaily` / `latestWeekly` / `latestMonthly` for rankings and uses per-interval archives (`archive-*`) for series.

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

* The compact `pairs-data` shape (latest* mirrors + archive shards) supports fast reads without a per-day `rs` subcollection. Canonical signals live under `pairs-data/{PAIR}/signals/*`, and Signals Activity / whipsaw views live under `signals-activity` per-pair and root mirrors.
* All collection and document ids use kebab-case (e.g., `pairs-data`, `pair-registry`, `SPY-AAPL`).
# Database Schema and Management - Relative Strength Heatmap (MVP) - RS-Only (Revised)

## 1. Introduction

This document defines an RS-only Firestore schema optimized for fast reads, minimal writes, and flexible baselines. We do not persist OHLCV in our Firestore; price/volume are fetched on-demand from SavantAPI for charting/backtests. User-specific data (profiles, preferences, subscriptions) is deferred for later and not included here.

## 2. Database Choice: Firebase Cloud Firestore

* Choice: Firebase Cloud Firestore
* Type: NoSQL Cloud Database
* Description: Firestore is used to store computed Relative Strength (RS) series and derived buy/sell signals for baseline–symbol pairs, plus small mirrors for fast access and global configuration.

## 3. Collections and Documents

The RS-only model is pair-centric. A pair is identified as `${BASELINE}_${SYMBOL}` (e.g., `SPY_NVDA`).

* `appConfig` Collection
  * Document: `settings`
  * Fields:
    * `activeBaselines` (string[]): baselines we persist RS/signals for (e.g., `["SPY","QQQ"]`). Others are computed on-demand.
    * `rsLookbackDays` (number): default lookback (e.g., 252)
    * `defaultThresholds` (map): `{ buy:number, sell:number }` for canonical signal generation
    * `nextScheduledFetch` (number, epoch ms)
    * `cacheTTLSeconds` (number): TTL for optional short-lived RS cache
    * `sectorConfigs` (map, optional): static metadata for supported sector ETFs (labels, ordering)

* `sectors` Collection (optional cache)
  * Document ID: `{ETF}` (e.g., `XLF`, `XLK`, `XLY`)
  * Fields:
    * `members` (string[]): array of current constituent symbols
    * `updatedAt` (number, epoch ms)
    * `source` (string, optional): where the list was derived from
  * Purpose: cache for sector constituents. `GetSectorConstituents` can read/refresh this cache and return `{ baseline, members, updatedAt }` to the frontend.

* `pairRegistry` Collection
  * Document ID: `${BASELINE}_${SYMBOL}`
  * Fields:
    * `baseline` (string)
    * `symbol` (string)
    * `createdAt` (number, epoch ms)
    * `refCount` (number) — optional; track how many lists/users reference this pair for pruning
    * `meta` (map, optional): `{ lastRegisteredBy?:string, note?:string }`
  * Purpose: The scheduler enumerates this collection to determine which pairs to compute at pre/post-close. UI callables (e.g., from `SelectStockPanel`) add/remove entries.

* `pairs` Collection
  * Document ID: `${BASELINE}_${SYMBOL}` (e.g., `SPY_NVDA`)
  * Fields:
    * `latest` (map): fast read for the most recent RS values
      * `pre` (map?): `{ rs:number, at:number }` (optional if not yet computed today)
      * `post` (map?): `{ rs:number, at:number }`
    * `latest30` (map, optional): optional rolling 30-day window mirror for sparkline/UX
      * `pre` (array?): `Array<{ t:number, rs:number }>`
      * `post` (array?): `Array<{ t:number, rs:number }>`
    * `signalsSummary` (array, optional): last N signals for the pair
      * `Array<{ t:number, type:'buy'|'sell', rs:number, src:'pre'|'post' }>`
    * `meta` (map): `{ baseline:string, symbol:string, updatedAt:number }`

  * Subcollections:
    * `rs`
      * One document per trading day keyed by time `t` (epoch ms) or a sortable date key (e.g., `YYYYMMDD`).
      * Document shape:
        * `{ t:number, pre?:{ rs:number, at:number }, post?:{ rs:number, at:number } }`
      * Notes:
        * Combined per-day doc holds both pre and post to minimize reads and simplify daily writes.
        * Single collection (no year sharding) keeps queries simple (e.g., last 30 days).
    * `signals` (persisted only for `activeBaselines` pairs)
      * One document per signal event
      * Document shape:
        * `{ t:number, type:'buy'|'sell', src:'pre'|'post', rs:number, thresholds?:{ buy:number, sell:number } }`
      * Notes:
        * Designed for easy feeds (order by `t`), filtering by `type`, and collection-group queries if needed.

* Optional short-lived cache for non-active baselines
  * `rs-cache/{PAIR_ID}/ranges/{HASH}`
    * Fields: `{ from:number, to:number, post:{ count:number, points:Array<{t:number,rs:number}> }, pre?:{...}, computedAt:number, ttl:number }`
    * Purpose: accelerate repeated on-demand computations without persisting full series long-term.

## 4. Indexing

Define indexes for efficient queries on series and signals:

* `pairs/*/rs` (subcollection): index by `t` for range queries and "last N" reads
  * Example query: `orderBy('t', 'desc').limit(30)`
* `pairs/*/signals` (subcollection): index by `t` and composite on `(type, t)` for feeds
* `pairRegistry` top-level collection: simple listing and optional composite on `(baseline, symbol)` are sufficient; document ID already encodes both.
* Optional: If server-side threshold scanning is required for heatmaps, composite on fields in `pairs.latest.post.rs` (or `pre`), e.g., `latest.post.rs` + `meta.baseline`

## 5. Data Loading & Access Patterns

* Heatmap (baseline-aware)
  1. Determine the current baseline (e.g., global default like `SPY`, or user-selected if supported later).
  2. For each visible symbol, read `pairs/{BASELINE}_{SYMBOL}.latest` to get current RS (pre or post) and timestamp.
  3. Optionally read `latest30` for quick sparklines; otherwise, query `rs` with `orderBy t desc limit 30` when needed.

* Chart View
  1. Call backend `GetPairRSData(base, symbol, from, to, thresholds?)`.
  2. If `base` is in `activeBaselines`, read Firestore `pairs/{PAIR}/rs` (and `signals` if thresholds omitted or canonical desired).
  3. If `base` is not active, compute RS on-demand (optionally hydrate `rs-cache`) and compute transient signals for provided thresholds; do not persist.
  4. Fetch OHLCV from SavantAPI on-demand to render price/volume; do not store in Firestore.

* Scheduled RS Computation
  1. For each symbol × `activeBaselines`, compute RS for pre and post windows.
  2. Write/update per-day doc in `rs`, update `latest`, maintain `latest30` (rolling window) if enabled.
  3. Detect threshold crossings using `defaultThresholds` and append to `signals`; update `signalsSummary`.

* Sector baseline dropdown:
  * Frontend requests `GetSectorConstituents({ etf })` to get members.
  * Frontend sets baseline to `{ etf }` and loads `pairs/{etf}_{symbol}.latest` (and optional `latest30`) for each member.
  * Optionally, user can save the sector as a list → bulk `RegisterPairs` for scheduler maintenance.

## 6. Security Rules (RS-only)

Security rules should:

* Allow read of `pairs/*` (latest, latest30, rs, signals) to authenticated users (or public read if desired), but deny client writes. Writes are performed by Cloud Functions using Admin SDK.
* Allow read of `appConfig/settings` to clients; writes restricted to admins.
* Optional `rs-cache` readable by clients; writable only by functions (or disabled entirely if not used).

Example policies (high-level intent):

* `allow read: if true; allow write: if request.auth.token.admin == true;` on `appConfig`.
* `allow read: if true; allow write: if false;` on `pairs` and subcollections for client SDK; backend uses Admin SDK.

## 7. Migrations

* Strategy: Update Cloud Functions to write RS-only to the new `pairs/*/rs` shape and optionally mirror `latest30`.
* If migrating from a prior model, backfill `latest` and (optionally) `latest30` from historical `rs` documents for active baselines only.

## 8. Backups

* Use Firestore export to GCS on a daily schedule.
* Keep retention aligned with cost and RPO needs (e.g., last 7 daily snapshots).

---

## Appendix: Rationale for Key Decisions

* Combined per-day RS doc (pre + post) reduces reads/writes and keeps logic simple.
* Single `rs` collection (no year sharding) enables single-query last-30 reads; daily volume per pair is tiny.
* Separate `signals` collection provides clean, queryable feeds; `signalsSummary` mirrors small, UI-friendly slices.
* Pair-centric `pairs/{BASE}_{SYMBOL}` keeps paths, indexes, and rules straightforward, avoiding deep nesting and complex cross-baseline queries.
* RS-only storage leans on SavantAPI for OHLCV, reducing Firestore storage and write costs while preserving full backtest capability via on-demand computation.
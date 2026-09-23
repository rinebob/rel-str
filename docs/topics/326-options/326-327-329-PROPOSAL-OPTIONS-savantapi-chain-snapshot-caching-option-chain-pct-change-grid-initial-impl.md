**Topic:** Option chain percent change grid  
**Topic Slug:** option-chain-pct-change-grid<br>
**Thread:** Option chain percent change grid
**Thread Slug:** initial-impl<br>
**Issue:** #329  
**Thread Parent:** #327
**Topic Parent:** #326  
**Domain:** OPTIONS  
**Type:** PROPOSAL  
**Status:** Draft  
**Created:** 2026-09-15  
**Last Updated:** 2026-09-15  

---

# SavantAPI Chain Snapshot Caching — Proposal for SA Team

> **⚠ SUPERSEDED (2026-09-22)** — by [326-504-505-PRD-OPTIONS-option-chain-pct-change-grid-corpus-chain-data.md](326-504-505-PRD-OPTIONS-option-chain-pct-change-grid-corpus-chain-data.md) (Thread #504, Corpus-backed chain data). The corpus concept evolved: SA owns the full platform (swing files, `optionable`/`optionsEnabled` flags, pivot-triggered ingest); ST stays a pure consumer. This doc remains for history — its fetch-once-cache-forever mechanism and `source` field ask carried into the new design, but fetch-on-miss organic growth was rejected in favor of curated-universe backfill.

**Status:** Superseded — see above
**Source:** Topic #326 (Option chain percent change grid) planning
**Date:** 2026-09-15
**SA discovery doc:** `av-proxy-api/docs/partner/options-data/historical-options-discovery.md`

---

## Context

ST is building an in-app analysis tool that fetches historical option chain
snapshots for a symbol on a start date and one or more target dates, computes
percent price change per contract, and renders the results as a heatmap grid.
The feature calls SavantAPI's existing `partnerHistoricalOptionsV2` endpoint
with `{symbol, date}` and receives the full chain for that session.

### Current state (from SA discovery doc)

Per the SA discovery doc (`historical-options-discovery.md`):

- **`partnerHistoricalOptionsV2`** is a **live on-demand proxy to Alpha
  Vantage** — not a Firestore-backed reader like the time-series endpoints.
  Each accepted request results in a live call to AV. No raw response is
  persisted. No service-side cache.
- **Symbol scope:** Accepts any symbol in the `tracked_symbols` collection
  (not just QQQ/TQQQ). The QQQ/TQQQ restriction applies only to the
  per-contract time-series endpoints (`partnerHistoricalOptionsContractV2`,
  `partnerContractCatalogV2`) which read from a GCS corpus backfilled only
  for QQQ (TQQQ pending).
- **SA's own roadmap:** "A future release may use Google Cloud Storage (GCS)
  for a bounded server-side cache. This would not change the request
  contract, but it could mean a response is served from a recent cached
  object rather than a new vendor request."
- **Rate limits:** 429 from Alpha Vantage (retry with backoff), 413 for
  large responses, 502/504 for upstream failures.
- **Error semantics:** 404 when symbol not in `tracked_symbols`. A valid
  date can still have no vendor data.

### Why caching matters for this use case

**Key property:** Historical chain snapshots are immutable. A chain
snapshot for QQQ on 2024-03-15 is the same today as it will be in 10 years.
This makes cache-forever semantics safe — once a snapshot is persisted, it
never needs re-fetching.

ST's analysis tool fetches N+1 chain snapshots per run (1 start date + N
target dates). In phase 1 (manual date entry, single user), the request
volume is low and the live AV fetch is acceptable. But:

- **Phase 2** (after ZigZag is live) will batch-analyze many swings,
  dramatically increasing request volume and making repeated live AV
  fetches expensive and slow.
- **Multiple users** analyzing the same symbols/dates would each trigger
  separate live AV fetches for the same immutable data.
- **AV rate limits** (429) become a real constraint when backfilling many
  dates for a new symbol.

GCS persistence with cache-forever semantics eliminates all three concerns
and aligns with SA's own stated roadmap.

---

## Proposed mechanism: On-demand fetch with GCS persistence

Reuse the existing `partnerHistoricalOptionsV2` endpoint. No new endpoint
needed for the core fetch. Change the internal behavior to
**fetch-once-cache-forever**:

```
Request: GET partnerHistoricalOptionsV2?symbol={SYMBOL}&date={YYYY-MM-DD}

SA internal flow:
  1. Validate {SYMBOL} is in the tracked_symbols collection
     - If not tracked → 404 NOT_FOUND (existing behavior)
  2. Check GCS corpus for {SYMBOL}/{DATE} chain snapshot
     - If exists → return from GCS (fast path, ~1-2s)
     - If not exists → fetch from Alpha Vantage upstream, persist to GCS,
       return (slow path, ~10-30s)
  3. Historical snapshots are immutable — once persisted, never re-fetch
```

### Symbol scope

The raw chain endpoint already accepts any symbol in `tracked_symbols`.
This proposal does not change symbol scope — it only adds GCS persistence
behind the existing live proxy. Expanding options coverage to a new ETF
or stock means adding it to `tracked_symbols` first (existing flow).

### GCS storage layout

```
options-corpus/
  {SYMBOL}/
    metadata          ← { availableDates: string[], lastUpdated: timestamp }
    {YYYY}/
      {YYYY-MM-DD}.json   ← full chain snapshot for that date
```

Sharding by year keeps directory listings manageable for high-volume
symbols. The `metadata` doc is updated atomically when a new date is
persisted.

**Note:** The SA discovery doc notes that "Full option chains can be too
large for one Firestore document" — this is why GCS (not Firestore) is
the right storage layer for raw chain snapshots. The per-contract GCS
corpus already used by `partnerHistoricalOptionsContractV2` demonstrates
the pattern.

---

## Required response changes

### `source` field (required from the start)

Add a `source` field to the existing `PartnerHistoricalOptionsResponse`:

```json
{
  "ok": true,
  "symbol": "QQQ",
  "date": "2024-03-15",
  "source": "gcs",
  ...
}
```

- `"gcs"` — cache hit, returned from persisted snapshot (fast path)
- `"live"` — cache miss, freshly fetched from upstream (slow path)

**Why required from the start:** ST uses this field for immediate user
notification. When the user requests a chain snapshot, ST shows:
- `"gcs"` → "Loading cached snapshot..." (spinner, fast)
- `"live"` → "Fetching from source (this may take up to 30 seconds)..."
  (progress indicator, slow)

Without this field, ST cannot distinguish a fast cache hit from a slow
fresh fetch, and the user has no feedback during the slow path.

---

## Required new endpoint: Availability check

A lightweight endpoint to check what's already in the corpus without
fetching full snapshots:

```
GET partnerOptionsAvailabilityV1?symbol={SYMBOL}

Response:
{
  "ok": true,
  "symbol": "QQQ",
  "availableDates": ["2024-01-02", "2024-01-03", "2024-01-04", ...],
  "count": 252,
  "lastUpdated": "2026-09-15T14:30:00.000Z"
}
```

**Why required from the start:** ST uses this to show the user which dates
are already cached (instant) vs which will require a fresh fetch (slow),
before the user commits to an analysis run. This lets the user:

- Plan their analysis around available data
- Trigger backfills for missing dates intentionally
- See the corpus coverage for a symbol at a glance

The response should be fast — read from the `metadata` doc, not a full
GCS scan. The `availableDates` array should be sorted ascending.

### Symbol restriction for availability

Same as the fetch endpoint: limited to `tracked_symbols`. If the symbol
is not tracked, return 404 (existing pattern).

---

## Summary for the SA team

| Ask | What SA does | Priority |
|---|---|---|
| Cache chain snapshots in GCS | Check corpus before upstream fetch; persist on first fetch | Critical |
| Add `source` field to response | Indicate cache hit (`"gcs"`) vs fresh fetch (`"live"`) | Critical |
| Add `partnerOptionsAvailabilityV1` endpoint | Return cached dates for a symbol from metadata doc | Critical |

All three are critical for the phase 1 feature to work with good UX.

**Note:** The first ask aligns with SA's own stated roadmap from the
discovery doc: "A future release may use Google Cloud Storage (GCS) for a
bounded server-side cache." This proposal concretizes that roadmap item
with a specific use case and cache-forever semantics for immutable
historical snapshots.

---

## What ST does on its side

**Phase 1 (this Thread):** ST's callable keeps calling
`partnerHistoricalOptionsV2` with `{symbol, date}`. The `source` field
drives user notification in the UI. The availability endpoint drives a
"cached dates" indicator before the user runs analysis. No ST-side
caching of source snapshots — SavantAPI's GCS corpus is the cache.

**Phase 2 (after Topic #261 ZigZag is live):** ST caches the *computed
grids* (not the source snapshots) by parameter hash. Same swing → same
grid → instant. This is ST-side result caching and doesn't depend on SA.

**Future SA ask (phase 2+):** Once ZigZag is live, ST will know the exact
symbol/date pairs that correspond to swing pivots. ST may ask SA to
pre-fetch and ingest those symbol/dates into the GCS corpus ahead of
time, so the chain snapshots are available immediately when the user
runs an analysis. This would turn the slow path (live Alpha Vantage
fetch) into a background job, making phase 2 analysis runs fully
cache-hit. SA could expose a batch ingest endpoint or accept a Pub/Sub
feed of symbol/dates to pre-populate.

---

## Open questions for SA team

1. **Upstream fetch latency:** The discovery doc confirms each request is
   a live AV call. What is the typical latency for a single
   symbol+date historical options fetch from Alpha Vantage? This drives
   ST's UX for the slow-path progress indicator.

2. **Backfill tooling:** Does SA have (or plan) a batch backfill tool to
   pre-populate the GCS corpus for a symbol's full history, or should ST
   trigger per-date fetches through the endpoint? The discovery doc
   mentions 429 rate limits — backfilling many dates sequentially through
   the live endpoint could hit those limits.

3. **Metadata doc update:** When a new date is persisted to GCS, is the
   `metadata.availableDates` array updated atomically, or is there a
   separate refresh job? ST needs the availability endpoint to reflect
   newly-cached dates promptly.

4. **"No data" vs "fetch failed" error distinction:** The discovery doc
   notes "A date supported by request validation can still have no
   vendor data." How does SA distinguish this case from a transient
   upstream failure (502/504)? ST needs to show "no data for this date"
   differently from "fetch failed, retry."

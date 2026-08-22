**Topic:** Migrate RS pipeline to read from local bar store instead of fetching from SA  
**Domain:** DATA-PIPELINE  
**Type:** Idea  
**Status:** Draft  
**Created:** 2026-08-23  
**Parent Topic:** #159 (data pipeline refactor) — this is a follow-up topic  

---

## Context

Topic #159 refactored the data pipeline to create `symbolDataSync` (SDS) as a new PDR-triggered subscriber that fetches D/W/M bars from SA and writes to the local bar store (`symbol-data/{SYMBOL}`). SDS writes intraday fields (`ip`, `ipc`, `io`, `it`, `ic`) on the latest bar and preserves them on POST runs. SDS includes an extension point in its completion callback for a future RS consumer.

The RS pipeline (`processDataReadyRunV2`, PDRv2) was deliberately left untouched in #159. It continues to fetch D/W/M bars from SA independently and write RS computations to `pairs-data`. This means both SDS and PDRv2 fetch the same D/W/M bars from SA on every PDR message — duplicate SA calls.

## Problem

SDS and PDRv2 both fetch D/W/M bars from SA on all 6 PDR messages per day. For 863 tracked symbols across 6 runs, this is ~15,534 duplicate SA calls per day. PDRv2 fetches per pair (baseline + target) with an in-memory baseline cache, so the actual duplicate count is lower but still significant.

PDRv2 also fetches a 30-day window only (`RS_DAYS=30`), while SDS fetches full history (or incremental updates). The local bar store already has the data PDRv2 needs — it just needs to read from there instead of SA.

## Proposed Migration

### Phase 1: PDRv2 reads from local bar store

- PDRv2 stops calling `fetchDailyBarsRange` (which calls SA via `callPartnerTimeSeries`).
- PDRv2 reads D/W/M bars from `symbol-data/{SYMBOL}` year shards instead. For the 30-day window, PDRv2 reads the current year shard and filters to the last 30 days in memory. If the 30-day window spans a year boundary, read both year shards.
- For PRE phase computation, PDRv2 also reads the intraday doc (`symbol-data/{SYMBOL}/intraday/latest`) and merges the intraday fields (`ip`, `ipc`, `io`, `it`, `ic`) onto today's bar in memory. EOD year shard bars do NOT contain intraday fields — they are in a separate doc (implemented in #159).
- RS pair computation logic (`buildPhaseSeries`, `writeUnifiedSeries`) is unchanged — same inputs, same outputs.

### Phase 2: PDRv2 triggers from SDS completion

- PDRv2 stops subscribing to `partner-data-ready` as a PDR subscriber.
- PDRv2 plugs into the SDS completion extension point (defined in #159).
- SDS completion callback invokes PDRv2 as a downstream consumer, passing the run context (runType, phase, marketDate, excludeSymbols/includeSymbols, failed symbols).
- PDRv2 filters which pairs to process based on the run context (same logic as today, just driven by SDS completion instead of PDR message attributes).
- This eliminates the duplicate SA fetch entirely — SDS is the single SA data fetcher.

### Phase 3: Cleanup

- Remove `fetchDailyBarsRange` and `callPartnerTimeSeries` from PDRv2's code path (no longer needed).
- Remove PDRv2's Pub/Sub subscription (it's no longer a subscriber).
- Remove any PDRv2-specific SA fetch infrastructure that's no longer used.

## Key Decisions to Make

1. **Read performance:** PDRv2 currently fetches ~30 bars per symbol per interval from SA. Reading a year shard from Firestore returns ~252 bars (full year). Is the extra data transfer and in-memory filtering acceptable? Alternative: add a query/filter to read only the last N bars from the year shard.

2. **Year boundary handling:** if the 30-day window spans Dec→Jan, PDRv2 needs to read two year shards. How to handle this cleanly?

3. **Data consistency:** when PDRv2 reads from the local bar store, it's reading data that SDS just wrote. Is there a risk of partial reads (some symbols synced, others not yet) if PDRv2 starts before SDS completion fires? The SDS completion gate should prevent this, but worth verifying.

4. **Intraday field availability:** SDS writes intraday fields on intraday runs. If SDS's intraday run fails but PDRv2 still needs to run (via fallback), will the intraday fields be present in the local bar store? They would be from the previous intraday run, which may be stale.

5. **Weekly/Monthly intervals:** PDRv2 fetches weekly and monthly bars too. SDS writes these to `symbol-data/{SYMBOL}/weekly/all` and `monthly/all`. Same read pattern applies.

6. **Baseline cache:** PDRv2 has an in-memory baseline cache to avoid re-fetching the baseline symbol across pairs. When reading from the local bar store, the same cache pattern applies — read the baseline once, reuse across pairs. No change needed.

## Dependencies

- Topic #159 must be complete (SDS running, intraday fields in local bar store, extension point defined).
- SDS must be stable and writing all tracked symbols including intraday fields.

## Estimated Impact

- Eliminates ~15,534 duplicate SA calls per day (exact number depends on pair count and baseline cache hit rate).
- PDRv2 read latency drops from SA HTTP round trip (~100-500ms per symbol) to Firestore read (~50ms per symbol).
- RS processing starts after SDS completion instead of immediately on PDR receipt — slight delay but guaranteed fresh local data.

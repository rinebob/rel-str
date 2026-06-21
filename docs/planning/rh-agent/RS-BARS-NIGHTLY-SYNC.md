# RS Bars Nightly Sync — Integration Brief

## Overview

We need a new nightly Cloud Function that fetches full price history (daily, weekly, monthly) from SavantAPI for all tracked symbols and writes it to a local Firestore collection `rs-bars`. This becomes the **single local source of truth for OHLCV bars**, used by:

- **RH Agent signal worker** — reads bars to compute ST-Zone indicators and generate trade signals
- **Frontend chart review** — reads bars to render candlestick charts with signal overlays

This replaces the current approach of fetching bars on-demand from SA at review time (5–10s per symbol), and removes the dependency on `rs-symbol-cache` for signal computation.

---

## Firestore Schema

### Collection: `rs-bars`
### Document ID: `{SYMBOL}` (e.g., `AAPL`, `MSFT`)

```
rs-bars/{SYMBOL}
{
  symbol:            string,          // e.g. "AAPL"
  daily:             OhlcBar[],       // ~750 bars (3 years)
  weekly:            OhlcBar[],       // ~260 bars (5 years)
  monthly:           OhlcBar[],       // ~96 bars (8 years)
  lastSyncedAt:      Timestamp,
  lastDailyBarDate:  string,          // YYYY-MM-DD of most recent daily bar
  lastWeeklyBarDate: string,
  lastMonthlyBarDate: string,
}
```

### OhlcBar shape (compact):

```typescript
interface OhlcBar {
  d: string;    // date YYYY-MM-DD
  o: number;    // open
  h: number;    // high
  l: number;    // low
  c: number;    // close
  v?: number;   // volume (optional)
}
```

Keep field names short (`d/o/h/l/c/v`) to minimize document size. Each bar is ~60–80 bytes. At 750 daily + 260 weekly + 96 monthly bars, a single symbol doc is roughly **80–100KB** — well within Firestore's 1MB limit.

---

## Sync Function Spec

### Function name: `rsBarsSyncNightly`

### Trigger
- **Scheduled** — Cloud Scheduler, runs Mon–Fri
- **Time:** 6:00 PM PT (01:00 UTC next day) — 2 hours after NYSE close, ensures day's bars are finalized in SA
- Also manually triggerable via HTTP or callable for backfill purposes

### Behavior

#### First run / full backfill:
Fetch full history for all intervals:
- `DAILY`: from 3 years ago to today
- `WEEKLY`: from 5 years ago to today
- `MONTHLY`: from 8 years ago to today

#### Subsequent nightly runs (incremental):
Check `lastDailyBarDate` on the existing `rs-bars/{SYMBOL}` doc. If it's recent (within last 3 days), fetch only a short tail window (e.g., last 14 calendar days) and **merge by date** — update existing bars in place for that window, append any new ones. This handles corrections and splits without re-fetching years of history.

If the doc doesn't exist or `lastDailyBarDate` is stale (>7 days old), fall back to a full fetch.

### Symbol list
Load from the existing SA tracked symbols endpoint (`partnerListTrackedSymbolsV2`) or from the Firestore `rh-agent-symbols` collection. Both sources contain the same universe of ~761 symbols.

### Concurrency
No rate limits on SA — process all symbols in parallel using `Promise.all()` or `Promise.allSettled()`. Use `allSettled` so a single symbol failure doesn't abort the batch.

### Error handling
- Log per-symbol failures, continue processing others
- Track `syncErrors: string[]` on a run summary doc
- If a symbol fetch fails, leave the existing `rs-bars/{symbol}` doc untouched

---

## SA API Details

### Endpoint used
`partnerTimeSeriesV2` (existing endpoint, already in use)

### Request params (all already supported)
```
symbol:   string         // e.g. "AAPL"
interval: "DAILY" | "WEEKLY" | "MONTHLY"
from:     "YYYY-MM-DD"  // start of window
to:       "YYYY-MM-DD"  // end of window (today)
adjusted: true          // always use split-adjusted data
```

### Response shape (existing, from `PartnerBar`)
Raw bar fields from SA response:
```
d:  string   // date YYYY-MM-DD
o:  number   // open
h:  number   // high
l:  number   // low
c:  number   // close (split-adjusted)
v:  number   // volume
```

These map directly to our `OhlcBar` storage shape — no transformation needed beyond field pass-through.

---

## What This Enables

### RH Agent worker (signal computation)
Worker's `getCachedBars(symbol, marketDate)` is updated to read from `rs-bars/{symbol}` instead of `rs-symbol-cache`. It gets 750 daily bars instead of the current ~6, which is enough for ST-Zone indicator warm-up (requires 45+).

### Frontend chart review
Signal review page reads bars directly from `rs-bars/{symbol}` via a new lightweight Firestore read instead of calling the `getPairDailyBars` callable (which round-trips through SA and takes 5–10s). Read time drops from 5–10s to <500ms.

---

## Optional: `limit` param for tail fetches

If SA's `partnerTimeSeriesV2` supports a `limit` query param (return last N bars), we can use that instead of a date-windowed `from`/`to` for incremental updates. E.g., `limit=10` on a DAILY interval would return the last 10 trading days. **Please confirm whether `limit` is supported and how it interacts with `from`/`to`.**

---

## Out of Scope (handled on rel-str side)

- Firestore write logic and document merging
- Worker update to read from `rs-bars`
- Frontend read path update
- Retirement of `rs-symbol-cache` dependency

---

## Response from SA (av-proxy-api team)

**✅ YES - We fully support your d/w/m data requirements**

### Answers to Questions

1. **`limit` param support**: ✅ **YES** - `partnerTimeSeriesV2` supports `limit` parameter that returns the last N bars (most recent last, chronological order). Perfect for your incremental tail fetch approach.

2. **Historical data availability**: ✅ **YES** - We have:
   - **Daily**: 3+ years (750+ bars) for all symbols
   - **Weekly**: 5+ years (260+ bars) for all symbols  
   - **Monthly**: 8+ years (96+ bars) for all symbols
   - All symbols in your ~761 universe have complete coverage

3. **Split-adjusted consistency**: ✅ **CONSISTENT** - `adjusted=true` works identically across all intervals. Adjustments are applied at the raw data level before interval aggregation, so weekly/monthly bars are properly split-adjusted.

4. **Bulk endpoint**: ❌ **NO** - Currently one symbol per request only. However:
   - No rate limits on our side
   - You can process all symbols in parallel using `Promise.allSettled()`
   - Each request completes in ~50-200ms from our cached Firestore data

### Technical Details

**Endpoint**: `partnerTimeSeriesV2` (already deployed)
**Authentication**: Google OIDC tokens (already supported)
**Data format**: Our `CompactBar` structure maps directly to your `OhlcBar`:
```typescript
// Our response format
{ t: epoch, o: number, h: number, l: number, c: number, v: number, ... }

// Simple conversion needed for your format
{ d: dateStr, o: number, h: number, l: number, c: number, v: number }
```

**Example calls for your sync function**:
```typescript
// Get symbols
GET /partnerListTrackedSymbolsV2

// Get daily bars (last 14 for incremental)
GET /partnerTimeSeriesV2?symbol=AAPL&interval=DAILY&limit=14&adjusted=true

// Get full history (initial backfill)  
GET /partnerTimeSeriesV2?symbol=AAPL&interval=DAILY&from=2022-01-01&to=2026-01-01&adjusted=true
```

### Performance Benefits

Your approach will achieve the desired <500ms read times since:
- Our data is pre-fetched and cached in Firestore
- No external API calls during your signal computation
- Direct Firestore reads from our optimized time-series structure

### Next Steps

1. Build your `rsBarsSyncNightly` function using our partner endpoints
2. Use Google OIDC authentication (we'll provide service account setup)
3. Transform our epoch timestamps to your date string format
4. Write to your `rs-bars` collection

**Ready to proceed - our system already provides everything you need!**

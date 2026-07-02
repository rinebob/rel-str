# RH Agent — Frontend Chart Migration to rs-bars

**Status:** Complete (deployed 2026-07-01)  
**Created:** 2026-07-01  
**Related docs:**
- `RH-AGENT-ARCH.md` (Layer 3 migration, Pending Work item 1)
- `RH-AGENT-DASHBOARD-RUN-EXPLORER-PLAN.md` (PRICE-BAR-SERVICE techdebt)

---

## Goal

Replace the current SA API round-trip for chart OHLC data with a direct Firestore read from `rs-bars/{symbol}`. This eliminates a 1–3 second external network call per chart open, removes SA API rate limit pressure, and ensures the chart uses the same price data the backend workers use.

A secondary goal is to resolve the domain boundary violation where `signal-detail.component` imports `HeatmapChartStore` (a heatmap-feature class) solely for price bar fetching.

---

## Current Architecture

```
signal-detail.component
  └─ HeatmapChartStore
       └─ HeatmapChartDataService.fetchChartData$()
            └─ RsBarsService.getDailyBars$()
                 └─ getPairDailyBars (Cloud Callable)
                      └─ SavantAPI time-series endpoint  ← 1–3s external call
```

`RsBarsService.getDailyBars$` calls the `getPairDailyBars` Cloud Callable, which proxies to the SA Partner Time Series API. Daily bars are fetched live every chart open. Weekly and monthly are fetched directly from SA at nightly sync and stored in `rs-bars` as their own arrays — no aggregation.

---

## Target Architecture

```
signal-detail.component
  └─ RhAgentChartService (new, in src/app/features/rh-agent/services/)
       └─ Firestore: rs-bars/{symbol}          ← ~50–200ms local read
            + optional: rhAgentGetIntradayPrice callable (single symbol)
                 └─ callPartnerIntradaySnapshotV2([symbol])  ← only when today bar is missing
```

`rh-agent` no longer imports anything from `heatmap-chart`. Price bar fetching is self-contained.

---

## The Today Bar Problem

`rs-bars` contains EOD bars through the last nightly sync. During market hours today's bar is absent. Since the Jul 2026 refactor removed `writeIntradayBarsToRsBars`, nothing writes today's partial bar to Firestore anymore — workers inject it in-memory from their task payload.

**Rule:** Fetch the intraday price and synthesize today's bar client-side whenever `rs-bars` does not contain a bar for today's date. This is interval-independent — daily, weekly, and monthly charts all need it.

**Trigger condition:**
- Check `rs-bars` doc: if `lastEodSyncAt` date < today → nightly EOD sync has not yet run → fetch intraday price and inject partial bars
- If `lastEodSyncAt` date === today → nightly sync completed → `rs-bars` has real EOD bars, no intraday fetch needed
- **No market-hours gate.** There is a review window between market close (~4 PM ET) and nightly sync (~6 PM PT / 1 AM UTC) where bars are still missing. Users should be able to review charts in that window with the last known intraday price.

**Why `lastEodSyncAt` not `lastDailyBarDate`:**  
`lastDailyBarDate` is ambiguous — the old `writeIntradayBarsToRsBars` updated it too, making it impossible to distinguish an intraday write from an EOD write. Adding a dedicated `lastEodSyncAt` timestamp (written only by `rsBarsSyncNightly`) makes the intent unambiguous. `lastIntradayAt` (already on the doc from the old intraday write path) can be retained as an informational field.

### Intraday bar construction

```
partialBar = { d: today, o: ip, h: ip, l: ip, c: ip }
```

Replace-or-append:
- If `last(daily).d === today` → replace (defensive; nightly sync may have partially written)
- Else → append

This is the normal case for any chart viewed before the nightly sync runs. The append path executes every chart open during market hours or the post-close review window. The replace path is a defensive guard.

### Weekly and monthly interim bars

`rs-bars` stores SA-sourced weekly and monthly arrays. A single-price bar `{ o:ip, h:ip, l:ip, c:ip }` for an incomplete week or month is meaningless — e.g. a Monday open showing a flat bar for the whole week. Instead, synthesize a proper OHLC from the daily bars in the current incomplete period:

```
weekDailyBars  = daily bars where isoWeek(d) === isoWeek(today)
monthDailyBars = daily bars where month(d) === month(today)

syntheticWeeklyBar = {
  d: weekDailyBars[0].d,   // first day of current week
  o: weekDailyBars[0].o,   // open of first day
  h: max(weekDailyBars.h, ip),   // max of all highs + intraday price
  l: min(weekDailyBars.l, ip),   // min of all lows + intraday price
  c: ip                     // latest intraday price as close
}
```

Apply the same pattern for monthly. Replace-or-append the weekly/monthly arrays. This **is** an aggregation from daily bars, but it is the correct approach for incomplete periods — the SA weekly bar for an unfinished week does not yet exist or is stale. The SA weekly/monthly bars remain authoritative once the period closes and the nightly sync writes them.

---

## Backend Callable: `rhAgentGetIntradaySnapshot` (extend existing callables file)

The SA `partnerIntradaySnapshotV2` endpoint accepts a POST body `{ symbols: string[] }`, so passing a single-element array works — no separate single-symbol endpoint exists or is needed.

Add a new callable to the existing `rh-agent-callables.ts` (same file as `rhAgentManualRun`). A separate new callable file is not needed.

**Approach:** Option A — per-chart fetch. Called only when `lastDailyBarDate < today` for a symbol whose chart is being opened. At ~100–150 chart opens per day this is acceptable. Bulk write-back can be reconsidered if SA rate limits become an issue.

**Signature:**
```typescript
// Request
{ symbol: string }

// Response
{ symbol: string; ip: number; marketDate: string } | { symbol: string; ip: null; marketDate: string }
```

**Implementation:** Calls `callPartnerIntradaySnapshotV2([symbol])`, extracts the single snapshot. Returns `ip: null` gracefully if SA returns no data (outside market hours, symbol not found, endpoint error) — caller renders `rs-bars` as-is without a partial bar.

**Auth:** Firebase Auth required (same as all other rh-agent callables).

---

## Frontend Service: `RhAgentChartService` (new)

No existing service directly reads `rs-bars` from Firestore — `RsBarsService` goes through a Cloud Callable → SA, not Firestore. Extending `rh-agent.service.ts` is possible but it is already large and chart bar fetching is a distinct concern. A focused new service is the right boundary.

**Location:** `src/app/features/rh-agent/services/rh-agent-chart.service.ts`

**Responsibilities:**
1. Read `rs-bars/{symbol}` from Firestore → return `{ daily, weekly, monthly }` arrays of `OhlcBar`
2. Check `lastEodSyncAt` from the `rs-bars` doc: if its date `< today` → call `rhAgentGetIntradaySnapshot`; if `=== today` → nightly sync already ran, skip intraday fetch
3. Inject partial bar into daily array (replace-or-append)
4. Synthesize current week's bar from daily bars in the current ISO week + ip as close/h/l override; replace-or-append in weekly array
5. Synthesize current month's bar from daily bars in the current calendar month + ip as close/h/l override; replace-or-append in monthly array
6. Return `{ daily: PriceBar[], weekly: PriceBar[], monthly: PriceBar[] }` ready for `FlexChartComponent`

**`OhlcBar` → `PriceBar` mapping** (matches `heatmap-chart.types.ts`):
```typescript
{ date: b.d, x: new Date(`${b.d}T00:00:00.000Z`), open: b.o, high: b.h, low: b.l, close: b.c, volume: b.v }
```

**No market-hours gate.** The trigger condition is based solely on `lastDailyBarDate < today`. If the SA intraday endpoint returns `ip: null` (outside market hours, holiday, etc.), the service renders `rs-bars` as-is — no partial bar injected, no error shown.

---

## `signal-detail.component` Changes

- Remove `HeatmapChartStore` import and inject
- Inject `RhAgentChartService`
- On symbol change: call `chartService.loadBars$(symbol)` → set local `chartData`, `chartDataWeekly`, `chartDataMonthly` signals
- Remove `@techdebt PRICE-BAR-SERVICE` comment (resolved)

The `FlexChartComponent` interface is unchanged — it still receives `ChartDataset` objects. Only the data source changes.

---

## `HeatmapChartDataService` Changes

- Remove the `@techdebt PRICE-BAR-SERVICE` comment (resolved from this side too)
- `fetchChartData$` stays in place — the heatmap feature still needs it for the RS heatmap view

---

## `RsBarsDoc` Schema Change

Add `lastEodSyncAt` to `RsBarsDoc` in `rs-bars-sync.ts`. Written **only** by `rsBarsSyncNightly` / `rsBarsSyncAdmin` (the EOD sync path). Never touched by any intraday write.

```typescript
export interface RsBarsDoc {
  symbol: string;
  daily: OhlcBar[];
  weekly: OhlcBar[];
  monthly: OhlcBar[];
  lastSyncedAt: FirebaseFirestore.FieldValue | FirebaseFirestore.Timestamp;
  lastEodSyncAt: FirebaseFirestore.FieldValue | FirebaseFirestore.Timestamp; // NEW — EOD sync only
  lastDailyBarDate: string;
  lastWeeklyBarDate: string;
  lastMonthlyBarDate: string;
  lastIntradayAt?: FirebaseFirestore.FieldValue | FirebaseFirestore.Timestamp; // informational only
}
```

`syncSymbol()` must write `lastEodSyncAt: FieldValue.serverTimestamp()` alongside `lastSyncedAt`. The frontend reads `lastEodSyncAt` as a Firestore `Timestamp`, converts to a date string, and compares to today.

---

## Implementation Phases

### Phase 0 — Schema: add `lastEodSyncAt` to `RsBarsDoc`
1. Add `lastEodSyncAt` field to `RsBarsDoc` interface in `rs-bars-sync.ts`
2. Write it in `syncSymbol()` alongside `lastSyncedAt`
3. Deploy `rsBarsSyncSymbol` — existing docs will get the field on their next nightly sync

### Phase 1 — Backend: `rhAgentGetIntradaySnapshot` callable
1. Add callable to existing `rh-agent-callables.ts` (alongside `rhAgentManualRun`)
2. Export from `functions/src/index.ts`
3. Add to `rh-agent.service.ts` as `getIntradaySnapshot$(symbol): Observable<{ ip: number | null; marketDate: string }>`

### Phase 2 — Frontend: `RhAgentChartService`
1. Create `rh-agent-chart.service.ts`
2. Implement Firestore `rs-bars/{symbol}` reader
3. Implement today-bar injection logic (daily + weekly + monthly)

### Phase 3 — `signal-detail.component` migration
1. Replace `HeatmapChartStore` with `RhAgentChartService`
2. Wire `loadBars$` to symbol input changes
3. Verify triple-chart mode (D/W/M) still works
4. Remove `@techdebt PRICE-BAR-SERVICE` comments from both files

### Phase 4 — Cleanup
1. Remove `HeatmapChartStore` from `signal-detail` providers if it was scoped there
2. Verify `HeatmapChartStore` still works for the RS heatmap feature (no regressions)
3. Update `RH-AGENT-ARCH.md` pending work item 1 to ✅

---

## Files Affected

| File | Change |
|------|--------|
| `functions/src/rs-bars/rs-bars-sync.ts` | Add `lastEodSyncAt` to `RsBarsDoc` interface + write in `syncSymbol()` |
| `functions/src/rh-agent-cloud-function/rh-agent-callables.ts` | Add `rhAgentGetIntradaySnapshot` callable (extend existing file) |
| `functions/src/index.ts` | Export new callable |
| `src/app/features/rh-agent/services/rh-agent.service.ts` | Add `getIntradaySnapshot$(symbol)` method |
| `src/app/features/rh-agent/services/rh-agent-chart.service.ts` | **New** — Firestore rs-bars reader + bar injection |
| `src/app/features/rh-agent/components/signal-detail/signal-detail.component.ts` | Replace `HeatmapChartStore` with `RhAgentChartService` |
| `src/app/features/heatmap-chart/heatmap-chart-data.service.ts` | Remove `@techdebt` comment (resolved) |

---

## Open Questions

None.

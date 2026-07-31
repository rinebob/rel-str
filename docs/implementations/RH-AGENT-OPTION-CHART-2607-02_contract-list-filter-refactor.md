# Options Contract Viewer — Contract List Filter Refactor

## Date
2026-07-29

## Parent
[RH-AGENT-OPTION-CHART-2607-01](RH-AGENT-OPTION-CHART-2607-01_implementation-plan.md)

## Problem

The contract catalog picker in the option-chart page is unusable for high-volume symbols (e.g. QQQ with ~10,000 contracts). Page size is 200, so loading the full list requires 50 round trips. All filter controls currently feed the backend request — there is no way to further narrow the returned results client-side without re-querying. The "Filter to Chart" button helps but still re-queries the server.

## Goals

1. Increase page size to 1000 to reduce round trips.
2. Separate backend query controls from client-side display filters.
3. Add client-side multi-select filters for type, expiration, and length buckets.
4. Add "Load All" button to auto-paginate through remaining pages.
5. Always show total contract count in the pagination footer.
6. Move type filter (Call/Put/Both) from backend query to client-side display filter.
7. Keep "Filter to Chart" as a server-side re-query (sets expiration range from chart extents).

## Architecture: Two-Tier Filter Separation

### Tier 1 — Backend Query Controls (left side panel)

These controls build the `QueryContractCatalogRequest` sent to the SA partner endpoint. They determine what data is fetched from the server.

- **Symbol** — text input
- **Expiration** — single-select dropdown (sent as `expiration` param)
- **Strike** — single-select dropdown (sent as `strike` param)
- **Length bucket** — single-select dropdown (sent as `contractLengthBucket` param)
- **Search Catalog** button — fires the server query

**Type filter removed from backend**: `catalogType` always sent as `null` (no `type` param) so both calls and puts are returned in a single query. The Call/Put/Both toggle moves to the header as a client-side display filter.

### Tier 2 — Display Filters (header bar, client-side only)

These filters operate on the already-loaded `catalogRows` via the `displayedRows` computed signal. Instant, no server round trip. Located in a filter bar in the chart header area, to the right of the existing "Full History" button.

- **Type filter** — Call/Put/Both pill toggles (same compact pill style as RH Agent direction filter). Filters `displayedRows` by `row.type`.
- **Expiration multi-select** — Dropdown with checkboxes. Populated from `store.filteredExpirations()` (already loaded from contract index). Multiple selections filter `displayedRows` by `row.expiration ∈ selectedSet`. "All" = empty set = no filter.
- **Length bucket multi-select** — Dropdown with checkboxes. Populated from `catalogSummary.lengthBuckets` (already loaded). Multiple selections filter `displayedRows` by `row.contractLengthBucket ∈ selectedSet`. "All" = empty set = no filter.
- **Strike range** — Min/Max number inputs (relocated from left panel). Filters `displayedRows` by `strikeMin ≤ row.strike ≤ strikeMax`.
- **Clear All** — Resets all Tier 2 display filters.

### Filter to Chart (server-side re-query, unchanged behavior)

The "Filter to Chart" button remains a server-side action:
1. Reads chart visible extents (startDate, endDate, priceLow, priceHigh)
2. Sets `expirationGte`/`expirationLte` from chart X-axis extents
3. Sets `strikeMin`/`strikeMax` client-side from chart Y-axis price range
4. Calls `onQueryCatalog()` to re-query with the expiration range
5. The "Clear Filter" button clears both the server-side range filters and the client-side strike range

## Implementation Details

### Store Changes (`contract-catalog-feature.ts`)

1. **Page size**: `catalogPageSize` → 1000 in `initialCatalogState`
2. **Type always null**: `buildCatalogRequest` always sends `type: undefined` regardless of `catalogType` state. The `catalogType` field can remain in state for potential future use but is not sent to the server.
3. **`loadAllCatalog()` method**: Auto-paginates through all remaining pages by looping `loadMoreCatalog` until `catalogPageToken` is null. Shows progress via `catalogLoading` signal and a progress counter (e.g. "Loading page 2 of ~10...").

### Component TS Changes (`option-chart.component.ts`)

1. **New display filter signals**:
   - `displayType = signal<'all' | 'call' | 'put'>('all')`
   - `selectedExpirations = signal<Set<string>>(new Set())`
   - `selectedLengthBuckets = signal<Set<string>>(new Set())`
   - `strikeMin`, `strikeMax` — existing, relocated

2. **Updated `displayedRows` computed**: Apply all client-side filters in sequence:
   - Type filter: skip if `displayType() === 'all'`, else filter by `row.type === displayType()`
   - Expiration set: skip if set is empty, else filter by `selectedExpirations().has(row.expiration)`
   - Length bucket set: skip if set is empty, else filter by `selectedLengthBuckets().has(row.contractLengthBucket)`
   - Strike range: existing logic
   - Expiration date range (from Filter to Chart): existing `expMin`/`expMax` logic

3. **`onLoadAll()` method**: Calls `store.loadAllCatalog()`.

4. **`onClearAllDisplayFilters()` method**: Resets `displayType`, `selectedExpirations`, `selectedLengthBuckets`, `strikeMin`, `strikeMax`.

5. **`onQueryCatalog()` updated**: No longer sets `type` in `setCatalogBuilder` — always sends `type: null`.

6. **`ngOnInit` updated**: `setCatalogBuilder` no longer passes type.

7. **Expiration/length toggle helpers**: `toggleExpiration(value)`, `toggleLengthBucket(value)` — add/remove from respective Sets.

### Template Changes (`option-chart.component.html`)

1. **Remove Call/Put/Both toggle** from left panel builder section.

2. **Add display filter bar** in the header area (after "Full History" button):
   - Call/Put/Both pill toggles
   - Expiration multi-select dropdown (checkboxes)
   - Length bucket multi-select dropdown (checkboxes)
   - Strike range min/max inputs (moved from left panel)
   - "Clear All" button

3. **Remove strike range inputs** from left panel search section.

4. **Add "Load All" button** next to "Load More" in pagination footer.

5. **Fix count display**: Always show `"X shown / Y loaded / Z total"` format. Remove the conditional that hides total when count equals loaded length.

### No Backend/Function Changes

The SA partner endpoint already supports absent `type` param (returns both calls and puts). The `count` field in the catalog response already returns the total matching contract count. No callable or proxy changes needed.

## Layout Sketch

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ HEADER BAR                                                                   │
│ QQQ240719C00450000 | CALL $450 | 2026-07-19 | 1mo | 42 obs                  │
│ [Filter to Chart] [Full History]                                             │
│                                                                              │
│ DISPLAY FILTERS:                                                             │
│ [All][Call][Put]  Exp▾☑☐  Len▾☑☐  Strike [min]–[max]  [Clear]              │
│ Showing 247 / 1,000 loaded / 10,000 total                                   │
├───────────────┬──────────────────────────────────────────────────────────────┤
│ LEFT PANEL    │  CHART AREA                                                  │
│               │                                                              │
│ Symbol: QQQ   │  [Syncfusion chart]                                          │
│ Exp: [All ▾]  │                                                              │
│ Strike: [All▾]│                                                              │
│ Length: [All▾]│                                                              │
│ [Search]      │                                                              │
│               │                                                              │
│ RESULTS TABLE │                                                              │
│ ...           │                                                              │
│ [Load More]   │                                                              │
│ [Load All]    │                                                              │
└───────────────┴──────────────────────────────────────────────────────────────┘
```

## Files to Modify

- `src/app/features/rh-agent/pages/option-chart/option-chart.component.ts` — display filter signals, updated `displayedRows`, `onLoadAll`, `onClearAllDisplayFilters`, remove type from backend query
- `src/app/features/rh-agent/pages/option-chart/option-chart.component.html` — move type toggle to header, add multi-select dropdowns, move strike range, add Load All, fix count display
- `src/app/features/rh-agent/pages/option-chart/option-chart.component.scss` — style the display filter bar, pill toggles, multi-select dropdowns
- `src/app/features/rh-agent/stores/contract-catalog-feature.ts` — page size 1000, type always null, `loadAllCatalog` method

## Not Changed

- Backend callables and proxy (`options-contract.callables.ts`, `options-contract-proxy.ts`) — no changes needed
- Shared contracts (`shared/options-contract-contracts.ts`) — no changes needed
- Contract index loading, summary loading, underlying bars — unchanged
- Chart component — unchanged
- "Filter to Chart" behavior — still re-queries server with expiration range from chart extents

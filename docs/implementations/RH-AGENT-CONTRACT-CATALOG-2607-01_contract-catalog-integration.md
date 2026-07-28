# PRD + Implementation Guide: Contract Catalog Integration

**Status:** Draft
**Owner:** RS engineering
**Audience:** RS engineering
**Last updated:** 2026-07-27

---

## 1. Summary

Integrate SA's new `partnerContractCatalogV2` endpoint into RS to replace the bare contract-ID list returned by `partnerListContractsV2` with a metadata-rich, filterable, sortable contract catalog. This serves two consumers:

1. **Options Contract Viewer (option-chart page)** — interactive contract browsing with delta, IV, length bucket, observation count, and coverage ratio displayed per contract.
2. **Strategy/Backtesting** — programmatic contract selection by greeks, length, and expiration without downloading time-series files.

The existing `partnerListContractsV2` and `getContractIndex` (ts-expirations/ts-strikes) flows remain unchanged during integration. The catalog endpoint is additive — it sits between dropdown selection and time-series fetch.

---

## 2. Problem

### 2.1 Contract Picker Has No Metadata

Today, `onSearchContracts()` in `option-chart.component.ts` calls `store.searchContracts()` → `optionsContractService.listContracts$()` → `listOptionsContracts` callable → `callPartnerListContractsV2`. The response (`PartnerListContractsV2Response`) returns `ListContractsV2Contract[]` with only four fields:

```typescript
{ contractId, expiration, strike, type }
```

No delta, IV, volume, open interest, observation count, or contract length. The user must load each contract's time-series individually to see anything about it. The autocomplete dropdown shows `C $450 2026-01-16` — strike and expiration the user already selected. No new information.

### 2.2 Length Filter Is Static

The `contractLength` dropdown in the builder panel is a hardcoded list (`0DTE`, `1D`, `3D`, ... `3Y`). It doesn't reflect what's actually available for the symbol. The user has no idea how many 3-month contracts exist vs 1-week contracts until they search and count.

### 2.3 Strategy Contract Selection Is Impossible

There is no way for a strategy to say "find me a 3-month QQQ call with delta 0.40–0.50 expiring on 2026-01-16." The `build-options-contract-matrix.ts` script constructs contract IDs manually from CSV data by computing third-Friday expirations. No greeks-based selection is possible.

---

## 3. Goals

- Add a new `queryContractCatalog` callable that proxies to SA's `partnerContractCatalogV2` endpoint.
- Replace the flat autocomplete search results in option-chart with a metadata-rich contract table showing: strike, type, length bucket, observation count, coverage ratio, latest delta, latest IV, latest volume/OI.
- Add length-bucket filter buttons powered by the summary mode histogram (only buckets with count > 0 are rendered).
- Add delta and IV range filter inputs.
- Support pagination for large result sets.
- Provide a programmatic API path for strategy/backtesting code to query contracts by greeks/length/expiration.
- Keep `partnerListContractsV2` and `getContractIndex` working unchanged — parallel operation.

---

## 4. Non-Goals

- Modifying SA's `partnerContractCatalogV2` endpoint or its Firestore data model.
- Removing `partnerListContractsV2` or `getContractIndex` (deferred migration — see §9).
- Building a full options strategy engine (this doc defines the contract selection API only).
- Real-time or intraday metadata — the catalog updates on SA's daily builder cadence.
- Coverage beyond what SA supports (initial: QQQ, TQQQ).

---

## 5. SA Endpoint Reference

SA's `partnerContractCatalogV2` is a GET endpoint with two modes:

### 5.1 Summary Mode

`GET ?symbol=QQQ&summary=true`

Returns a length-bucket histogram and totals:

```json
{
  "ok": true,
  "symbol": "QQQ",
  "totalContracts": 184523,
  "expirationCount": 412,
  "lengthBuckets": { "1d": 8, "3d": 15, "3mo": 380, "1yr": 95, ... },
  "lastUpdated": "2026-07-25T16:00:00Z"
}
```

### 5.2 Catalog Mode

`GET ?symbol=QQQ&expiration=2026-01-16&sortBy=strike&pageSize=200`

Returns paginated contract metadata:

```json
{
  "ok": true,
  "symbol": "QQQ",
  "contracts": [
    {
      "contractId": "QQQ260116C00350000",
      "expiration": "2026-01-16",
      "strike": 350,
      "type": "call",
      "firstObserved": "2025-10-15",
      "lastObserved": "2026-07-25",
      "observationCount": 180,
      "expectedObservationCount": 185,
      "contractLengthDays": 93,
      "contractLengthBucket": "3mo",
      "latest": {
        "mark": "84.90", "volume": "0", "openInterest": "20",
        "iv": "0.0149", "delta": "1.00000", "gamma": "0.00000",
        "theta": "-0.00460", "vega": "0.00000", "rho": "0.03065"
      }
    }
  ],
  "count": 200,
  "nextPageToken": "eyJ..."
}
```

### 5.3 Filter Parameters

| Param | Type | Notes |
|---|---|---|
| `symbol` | string | Required. Uppercased. |
| `summary` | boolean | If true, returns histogram only. |
| `expiration` | string | `YYYY-MM-DD` exact match. |
| `contractLengthBucket` | string | `1d`, `3d`, `5d`, `7d`, `14d`, `21d`, `1mo`, `1.5mo`, `2mo`, `3mo`, `4mo`, `6mo`, `9mo`, `1yr`, `2yr`, `3yr` |
| `type` | `C` \| `P` | Option type. |
| `strike` | number | Exact strike. |
| `strikeGte` / `strikeLte` | number | Strike range. |
| `deltaGte` / `deltaLte` | number | Latest delta range. |
| `ivGte` / `ivLte` | number | Latest IV range. |
| `minObservationCount` | number | Minimum observations. |
| `sortBy` | string | `expiration` (default), `strike`, `contractLengthDays`, `observationCount`, `delta` |
| `sortOrder` | string | `asc` (default) or `desc` |
| `pageSize` | number | Default 200, max 500. |
| `pageToken` | string | Opaque cursor from previous response. |

### 5.4 Firestore Query Constraint

At most **one range field dimension** per request. Equality filters (`expiration`, `contractLengthBucket`, `type`, `strike`) combine freely. Range filters (`strikeGte/Lte`, `deltaGte/Lte`, `ivGte/Lte`, `minObservationCount`) conflict across different dimensions. `deltaGte` + `deltaLte` is allowed (same field, two bounds). The endpoint returns `400` for unsupported combinations.

---

## 6. RS Architecture Changes

### 6.1 Layer Overview

```
option-chart UI (builder + filter buttons + contract table)
    ↓
OptionsContractViewerStore (catalog state + pagination)
    ↓
OptionsContractService (Angular wrapper)
    ↓
queryContractCatalog callable (Firebase Functions onCall)
    ↓
callPartnerContractCatalogV2 (proxy function in options-contract-proxy.ts)
    ↓
SA partnerContractCatalogV2 endpoint
    ↓
SA Firestore ts-contracts/{contractId} subcollection
```

### 6.2 Existing Flows (Unchanged)

- **Dropdown population**: `getContractIndex` callable → reads `ts-expirations` and `ts-strikes` cross-project → populates expiration/strike dropdowns with cross-filtering. No change.
- **Time-series fetch**: `getHistoricalOptionsContract` callable → `callPartnerHistoricalOptionsContractV2` → returns daily observations for charting. No change.
- **Legacy contract search**: `listOptionsContracts` callable → `callPartnerListContractsV2` → returns bare contract IDs. Remains as fallback; UI migrates to catalog endpoint.

---

## 7. Implementation Plan

### Phase 1: Shared Types

**File:** `shared/options-contract-contracts.ts`

Add catalog types after the existing contract index section:

```typescript
// ==========================
// Contract Catalog (partnerContractCatalogV2)
// ==========================

/** Latest snapshot of greeks/liquidity from the most recent observation. */
export interface ContractLatestSnapshot {
  mark?: string;
  volume?: string;
  openInterest?: string;
  iv?: string;
  delta?: string;
  gamma?: string;
  theta?: string;
  vega?: string;
  rho?: string;
}

/** One contract entry in the catalog response. */
export interface ContractCatalogEntry {
  contractId: string;
  expiration: string;
  strike: number;
  type: 'call' | 'put';
  firstObserved: string;
  lastObserved: string;
  observationCount: number;
  expectedObservationCount: number;
  contractLengthDays: number | null;
  contractLengthBucket: string;
  latest?: ContractLatestSnapshot;
}

/** Response shape for catalog mode. */
export interface ContractCatalogResponse {
  ok: boolean;
  symbol: string;
  contracts: ContractCatalogEntry[];
  count: number;
  nextPageToken?: string;
}

/** Response shape for summary mode. */
export interface ContractSummaryResponse {
  ok: boolean;
  symbol: string;
  totalContracts: number;
  expirationCount: number;
  lengthBuckets: Record<string, number>;
  lastUpdated: string;
}

/** Request shape for the queryContractCatalog callable. */
export interface QueryContractCatalogRequest {
  symbol: string;
  summary?: boolean;
  expiration?: string;
  contractLengthBucket?: string;
  type?: 'C' | 'P';
  strike?: number;
  strikeGte?: number;
  strikeLte?: number;
  deltaGte?: number;
  deltaLte?: number;
  ivGte?: number;
  ivLte?: number;
  minObservationCount?: number;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
  pageSize?: number;
  pageToken?: string;
}
```

### Phase 2: Backend Proxy Function

**File:** `functions/src/options-contract-proxy.ts`

Add `callPartnerContractCatalogV2()` following the same pattern as `callPartnerListContractsV2`:

```typescript
const PARTNER_CONTRACT_CATALOG_V2_URL =
  process.env.PARTNER_CONTRACT_CATALOG_V2_URL ||
  `${PARTNER_AUDIENCE.replace(/\/$/, '')}/${PartnerEndpointPath.CONTRACT_CATALOG_V2}`;

const PARTNER_CONTRACT_CATALOG_V2_AUDIENCE =
  process.env.PARTNER_CONTRACT_CATALOG_V2_AUDIENCE || PARTNER_CONTRACT_CATALOG_V2_URL;

export async function callPartnerContractCatalogV2(params: {
  symbol: string;
  summary?: boolean;
  expiration?: string;
  contractLengthBucket?: string;
  type?: 'C' | 'P';
  strike?: number;
  strikeGte?: number;
  strikeLte?: number;
  deltaGte?: number;
  deltaLte?: number;
  ivGte?: number;
  ivLte?: number;
  minObservationCount?: number;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
  pageSize?: number;
  pageToken?: string;
}): Promise<ContractCatalogResponse | ContractSummaryResponse> {
  // Same fetch pattern as callPartnerListContractsV2:
  // 1. Generate ID token with email
  // 2. Build URLSearchParams from params
  // 3. fetchWithRetry with Bearer token
  // 4. Parse JSON, log, return
}
```

**File:** `functions/src/types/partner.ts`

Add to `PartnerEndpointPath` enum:

```typescript
CONTRACT_CATALOG_V2 = 'partnerContractCatalogV2',
```

### Phase 3: Backend Callable

**File:** `functions/src/options-contract.callables.ts`

Add `queryContractCatalog` callable:

```typescript
export const queryContractCatalog = onCall(
  { region: 'us-central1', cors: RH_AGENT_ALLOWED_ORIGINS },
  async (req): Promise<ContractCatalogResponse | ContractSummaryResponse> => {
    const { symbol, summary, ...filters } = req.data as QueryContractCatalogRequest;
    const sym = String(symbol || '').trim().toUpperCase();

    if (!sym) throw new Error('symbol is required');

    // Pass through to proxy — SA handles validation and range-conflict detection
    return callPartnerContractCatalogV2({ symbol: sym, summary, ...filters });
  },
);
```

**File:** `functions/src/index.ts`

Export the new callable.

### Phase 4: Frontend Constants + Service

**File:** `src/app/core/common/constants.ts`

Add to `CallableName` enum:

```typescript
QUERY_CONTRACT_CATALOG = 'queryContractCatalog',
```

**File:** `src/app/core/models/partner.types.ts`

Re-export the new types from `@options-contract/contracts` (or mirror them, following the existing pattern).

**File:** `src/app/features/rh-agent/services/options-contract.service.ts`

Add two methods:

```typescript
/** Fetch contract catalog summary (length-bucket histogram) for a symbol. */
getContractCatalogSummary$(symbol: string): Observable<ContractSummaryResponse> {
  // httpsCallable wrapper around QUERY_CONTRACT_CATALOG with summary=true
}

/** Query contract catalog with filters, sort, and pagination. */
queryContractCatalog$(params: QueryContractCatalogRequest): Observable<ContractCatalogResponse> {
  // httpsCallable wrapper around QUERY_CONTRACT_CATALOG
}
```

### Phase 5: Store Updates

**File:** `src/app/features/rh-agent/stores/options-contract-viewer.store.ts`

Add catalog state to `OptionsContractViewerState`:

```typescript
// Catalog state
catalogLoading: boolean;
catalogError: string | null;
catalogResults: ContractCatalogEntry[];
catalogCount: number;
catalogPageToken: string | null;
catalogPageSize: number;
catalogSummary: ContractSummaryResponse | null;
catalogSummaryLoading: boolean;
catalogFilters: {
  contractLengthBucket: string | null;
  deltaGte: number | null;
  deltaLte: number | null;
  ivGte: number | null;
  ivLte: number | null;
  minObservationCount: number | null;
  sortBy: string;
  sortOrder: 'asc' | 'desc';
};
```

Add methods:

```typescript
/** Load length-bucket histogram for the current symbol. */
loadCatalogSummary(symbol: string): void;

/** Query catalog with current filters + builder fields (expiration, strike, type). */
queryCatalog(): void;

/** Load next page of catalog results. */
loadMoreCatalog(): void;

/** Update a single catalog filter. */
setCatalogFilter(key: keyof CatalogFilters, value: any): void;

/** Clear all catalog filters. */
clearCatalogFilters(): void;

/** Clear catalog results (e.g. on symbol change). */
clearCatalog(): void;
```

The `queryCatalog()` method merges builder fields (`symbol`, `expiration`, `strike`, `type`) with catalog filters (`contractLengthBucket`, `deltaGte/Lte`, `ivGte/Lte`, `minObservationCount`, `sortBy`, `sortOrder`) into a single `QueryContractCatalogRequest` and calls `queryContractCatalog$`.

**Computed signal** for coverage ratio:

```typescript
/** Coverage ratio = observationCount / expectedObservationCount. */
coverageRatio: computed(() => { ... })
```

This is per-entry, so it's a helper function instead:

```typescript
function computeCoverage(entry: ContractCatalogEntry): number | null {
  if (!entry.expectedObservationCount) return null;
  return entry.observationCount / entry.expectedObservationCount;
}
```

### Phase 6: UI — Contract Table + Filter Buttons

**File:** `src/app/features/rh-agent/pages/option-chart/option-chart.component.ts`

Add:

```typescript
// Catalog filter signals
catalogLengthBucket = signal<string | null>(null);
deltaGte = signal<number | null>(null);
deltaLte = signal<number | null>(null);
ivGte = signal<number | null>(null);
ivLte = signal<number | null>(null);
sortBy = signal<string>('strike');
sortOrder = signal<'asc' | 'desc'>('asc');

// Computed: length bucket buttons from summary (only buckets with count > 0)
readonly lengthBucketButtons = computed(() => {
  const summary = this.store.catalogSummary();
  if (!summary?.lengthBuckets) return [];
  return Object.entries(summary.lengthBuckets)
    .filter(([_, count]) => count > 0)
    .map(([bucket, count]) => ({ bucket, count }))
    .sort((a, b) => a.bucket.localeCompare(b.bucket));
});

// Computed: parsed catalog results with numeric latest values for display
readonly catalogRows = computed(() => {
  return this.store.catalogResults().map(entry => ({
    ...entry,
    latestDelta: entry.latest?.delta ? Number(entry.latest.delta) : null,
    latestIV: entry.latest?.iv ? Number(entry.latest.iv) : null,
    latestVolume: entry.latest?.volume ? Number(entry.latest.volume) : null,
    latestOI: entry.latest?.openInterest ? Number(entry.latest.openInterest) : null,
    latestMark: entry.latest?.mark ? Number(entry.latest.mark) : null,
    coverage: computeCoverage(entry),
  }));
});
```

Add methods:

```typescript
onQueryCatalog(): void {
  // Merge builder fields + catalog filters → store.queryCatalog()
}

onLengthBucketClick(bucket: string | null): void {
  this.catalogLengthBucket.set(bucket);
  this.onQueryCatalog();
}

onSortChange(field: string): void {
  // Toggle sort order if same field, otherwise change field
  if (this.sortBy() === field) {
    this.sortOrder.set(this.sortOrder() === 'asc' ? 'desc' : 'asc');
  } else {
    this.sortBy.set(field);
    this.sortOrder.set('asc');
  }
  this.onQueryCatalog();
}

onLoadMore(): void {
  this.store.loadMoreCatalog();
}

onSelectCatalogContract(entry: ContractCatalogEntry): void {
  this.occIdInput = entry.contractId;
  this.onLoad();
}
```

**File:** `src/app/features/rh-agent/pages/option-chart/option-chart.component.html`

Replace the current search section (lines 69–127) with:

1. **Length-bucket filter button row** — pill-style buttons (matching the RH Agent direction filter pattern from memory). Each button shows `3mo (380)`. Clicking toggles the filter. "All" button clears it. Only rendered when summary is loaded.

2. **Delta/IV range inputs** — compact number inputs with labels "Delta min/max" and "IV min/max". Small inline-flex layout.

3. **"Search Catalog" button** — replaces "Search Contracts". Triggers `onQueryCatalog()`.

4. **Contract table** — replaces the autocomplete dropdown. A scrollable table with sortable columns:

| Column | Source field | Sortable |
|---|---|---|
| Type | `type` (C/P badge) | No |
| Strike | `strike` | Yes |
| Expiration | `expiration` | Yes |
| Length | `contractLengthBucket` | No |
| Obs | `observationCount` | Yes |
| Coverage | computed `coverage` | No |
| Delta | `latest.delta` | Yes |
| IV | `latest.iv` | No |
| Vol | `latest.volume` | No |
| OI | `latest.openInterest` | No |
| Mark | `latest.mark` | No |

Clicking a row calls `onSelectCatalogContract(entry)` → loads the time-series.

5. **Pagination** — "Load More" button when `catalogPageToken` is present. Shows `Showing X of Y` count.

6. **OCC ID manual input** — remains below the table for direct entry. The autocomplete is removed (the table replaces it).

7. **Prev/next navigation** — remains, but now navigates `catalogResults` instead of `searchResults`.

### Phase 7: Strategy/Backtesting API

**File:** `functions/src/options-contract-proxy.ts`

The `callPartnerContractCatalogV2` function is already callable from backend code. Strategy scripts and cloud functions can import and call it directly:

```typescript
import { callPartnerContractCatalogV2 } from './options-contract-proxy';

// Example: strategy needs a 3-month QQQ call with delta 0.40-0.50
const result = await callPartnerContractCatalogV2({
  symbol: 'QQQ',
  contractLengthBucket: '3mo',
  type: 'C',
  deltaGte: 0.40,
  deltaLte: 0.50,
  expiration: '2026-01-16',
  sortBy: 'delta',
});

// result.contracts[0].contractId → fetch time-series via callPartnerHistoricalOptionsContractV2
```

**File:** `functions/scripts/build-options-contract-matrix.ts`

Future enhancement: replace manual third-Friday computation with catalog-driven contract selection. The script can query the catalog for contracts matching criteria instead of constructing IDs from CSV data. This is deferred until options strategies are built.

### Phase 8: Option-Chart UI Enhancements

Three UI improvements that ship alongside the catalog integration. These are independent of the catalog endpoint but benefit from its data.

#### 8.1 Thin Contract Header Bar Above Chart

**Goal:** Show the loaded contract's identity at a glance without consuming chart vertical space.

**Current state:** Contract metadata (symbol, type, strike, expiration, DTE, observations) lives in the left panel's `.metadata-section` — a 2-column grid taking ~120px of panel height. The chart area has no header; the user must glance at the side panel to see what they're viewing.

**Design:**

Add a thin header bar (target: 28px tall) at the top of `.chart-content`, above the chart component and below the panel-toggle button:

```html
<!-- option-chart.component.html — inside .chart-content, before loading/error/chart sections -->
@if (store.contractData()) {
<div class="contract-header-bar">
  <span class="ch-id">{{ store.contractData()!.contractID }}</span>
  <span class="ch-sep">|</span>
  <span class="ch-type" [class.call]="store.contractData()!.type === 'call'" [class.put]="store.contractData()!.type === 'put'">
    {{ store.contractData()!.type === 'call' ? 'CALL' : 'PUT' }}
  </span>
  <span class="ch-strike">${{ store.contractData()!.strike }}</span>
  <span class="ch-sep">|</span>
  <span class="ch-exp">{{ store.contractData()!.expiration }}</span>
  <span class="ch-sep">|</span>
  <span class="ch-length">{{ contractLength() ? lengthLabel() : '—' }}</span>
  <span class="ch-sep">|</span>
  <span class="ch-obs">{{ store.observationCount() }} obs</span>
</div>
}
```

**SCSS (target dimensions):**

```scss
.contract-header-bar {
  flex: 0 0 auto;
  height: 28px;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 0 12px 0 44px; /* left padding clears the panel-toggle button */
  background: var(--mat-sys-surface-container);
  border-bottom: 1px solid var(--mat-sys-outline-variant);
  font-size: 11px;
  font-weight: 500;
  color: var(--mat-sys-on-surface);
  overflow: hidden;
  white-space: nowrap;

  .ch-id {
    font-family: monospace;
    font-size: 10px;
    color: var(--mat-sys-on-surface-variant);
  }

  .ch-sep {
    color: var(--mat-sys-outline-variant);
    font-size: 10px;
  }

  .ch-type {
    font-weight: 700;
    font-size: 10px;
    &.call { color: var(--mat-sys-primary); }
    &.put { color: var(--mat-sys-error); }
  }

  .ch-strike { font-weight: 600; }
  .ch-length, .ch-obs { color: var(--mat-sys-on-surface-variant); }
}
```

**Data source:** Uses the existing `store.contractData()` signal (from `partnerHistoricalOptionsContractV2` response) for contract ID, type, strike, expiration, and observation count. Uses `contractLength()` / `lengthLabel()` from the store for the length bucket.

**Future enhancement:** When the catalog endpoint is integrated, the header can also show latest delta and IV from the `ContractCatalogEntry.latest` snapshot if the loaded contract matches a catalog entry. This requires a lookup: after loading time-series, query the catalog with `expiration + strike + type` to find the matching entry and cache its `latest` snapshot in the store. Deferred to avoid coupling the header bar to the catalog endpoint in phase 1.

**Left panel impact:** The `.metadata-section` in the left panel can be removed or collapsed once the header bar is showing the same information. The quality flags (gaps, NaN IV, zero vol) and toggle controls remain in the panel. This frees ~120px of panel vertical space.

#### 8.2 Left Panel Compaction

**Goal:** Reduce the control panel footprint so more vertical space is available for the contract table and chart.

**Current state:** The panel uses Material form fields with `appearance="outline"` at default density. Each `mat-form-field` is ~56px tall. The `mat-button-toggle-group` for type is 56px tall. With 4 dropdowns + type toggle + search button + OCC input + load button + metadata grid + toggles + pad buttons, the panel content exceeds most viewport heights and scrolls.

**Approach:** Apply Material 3 dense styles via `density` CSS overrides rather than replacing components entirely. This keeps consistency with the rest of the app while significantly reducing height.

**SCSS changes in `option-chart.component.scss`:**

```scss
.control-panel {
  width: 260px; /* down from 290px */
  padding: 8px; /* down from 12px */
  gap: 6px; /* down from 12px */

  /* Dense Material form fields */
  ::ng-deep .mat-mdc-form-field {
    --mdc-outlined-text-field-container-shape: 4px;
    .mat-mdc-text-field-wrapper {
      min-height: 36px; /* down from ~56px default */
    }
    .mat-mdc-form-field-infix {
      min-height: 32px;
      padding-top: 4px;
      padding-bottom: 4px;
    }
    .mat-mdc-floating-label {
      font-size: 11px;
    }
    .mat-mdc-form-field-subscript-wrapper {
      display: none; /* hide hint/error text — we use chips for errors */
    }
  }

  /* Dense select panel */
  ::ng-deep .mat-mdc-select {
    font-size: 12px;
  }

  /* Dense button toggle */
  .type-toggle {
    height: 32px; /* down from 56px */

    ::ng-deep .mat-button-toggle {
      height: 32px;
      min-height: 32px;

      .mat-button-toggle-button {
        min-height: 32px;
      }

      .mat-button-toggle-label-content {
        font-size: 11px;
        padding: 0 8px;
        line-height: 30px;
      }
    }
  }

  /* Dense buttons */
  .mat-mdc-unelevated-button,
  .mat-mdc-outlined-button {
    min-height: 32px;
    font-size: 11px;
    padding: 0 10px;
  }

  /* Dense slide toggles */
  mat-slide-toggle {
    ::ng-deep .mdc-form-field {
      font-size: 11px;
    }
    ::ng-deep .mdc-switch {
      --mdc-switch-selected-track-height: 16px;
      --mdc-switch-unselected-track-height: 16px;
    }
  }
}
```

**Expected height savings:**

| Element | Current | Dense | Saved |
|---|---|---|---|
| Symbol field | ~56px | ~36px | 20px |
| Expiration field | ~56px | ~36px | 20px |
| Type toggle | 56px | 32px | 24px |
| Strike field | ~56px | ~36px | 20px |
| Length field | ~56px | ~36px | 20px |
| Search button | ~36px | 32px | 4px |
| OCC ID field | ~56px | ~36px | 20px |
| Load button | ~36px | 32px | 4px |
| Panel padding/gaps | 12px×8 | 6px×8 | 48px |
| **Total** | | | **~180px** |

This should eliminate panel scrolling on standard viewports and leave room for the catalog table.

**Alternative considered:** Replacing Material components with native HTML selects and inputs. Rejected for now because Material select provides filtering, optgroups, and consistent dropdown styling that would need to be rebuilt. The dense CSS approach gets 80% of the benefit with no structural changes. If density is still insufficient after implementation, a full component swap can be done as a follow-up.

#### 8.3 Length Selector Populated from SA Summary

**Goal:** Replace the hardcoded length dropdown options with actual available buckets from the catalog summary.

**Current state:** The `lengthGroups` computed signal in `option-chart.component.ts` returns a static list of length options grouped by category (`Short`, `Medium`, `Long`). The user sees all buckets regardless of what's available for the symbol.

**Design:**

When the catalog summary loads (via `store.loadCatalogSummary(symbol)` — already planned in Phase 5), the store caches the `ContractSummaryResponse.lengthBuckets` map. The component's `lengthGroups` computed signal switches from the static list to the summary data:

```typescript
// option-chart.component.ts

readonly lengthGroups = computed(() => {
  const summary = this.store.catalogSummary();
  if (!summary?.lengthBuckets) {
    // Fallback to static list if summary not loaded yet
    return STATIC_LENGTH_GROUPS;
  }

  // Build groups from actual available buckets
  const buckets = Object.entries(summary.lengthBuckets)
    .filter(([_, count]) => count > 0)
    .map(([bucket]) => bucket);

  return groupLengthBuckets(buckets); // groups into Short/Medium/Long categories
});
```

**Helper function** (in `option-chart.component.ts` or a utils file):

```typescript
/** Bucket name → display label mapping. */
const LENGTH_LABELS: Record<string, string> = {
  '1d': '1 Day', '3d': '3 Days', '5d': '5 Days', '7d': '7 Days',
  '14d': '14 Days', '21d': '21 Days', '1mo': '1 Month', '1.5mo': '1.5 Months',
  '2mo': '2 Months', '3mo': '3 Months', '4mo': '4 Months', '6mo': '6 Months',
  '9mo': '9 Months', '1yr': '1 Year', '2yr': '2 Years', '3yr': '3 Years',
};

/** Group buckets into Short / Medium / Long categories. */
function groupLengthBuckets(buckets: string[]): LengthGroup[] {
  const SHORT = ['1d', '3d', '5d', '7d', '14d', '21d'];
  const MEDIUM = ['1mo', '1.5mo', '2mo', '3mo', '4mo'];
  // Everything else is Long

  const groups: LengthGroup[] = [
    { name: 'Short', options: [] },
    { name: 'Medium', options: [] },
    { name: 'Long', options: [] },
  ];

  for (const bucket of buckets) {
    const label = LENGTH_LABELS[bucket] ?? bucket;
    const option = { value: bucket, label };
    if (SHORT.includes(bucket)) groups[0].options.push(option);
    else if (MEDIUM.includes(bucket)) groups[1].options.push(option);
    else groups[2].options.push(option);
  }

  return groups.filter(g => g.options.length > 0);
}
```

**Trigger flow:**

1. User enters/changes symbol → `onSymbolChange()` fires
2. `onSymbolChange()` calls `store.loadContractIndex(symbol)` (existing) AND `store.loadCatalogSummary(symbol)` (new)
3. Summary loads → `store.catalogSummary()` updates → `lengthGroups` recomputes → dropdown options update
4. If summary fails or hasn't loaded yet, the static fallback list is used (no broken UI)

**Interaction with length-bucket filter buttons (Phase 6):** The filter buttons and the length dropdown serve different purposes:
- **Length dropdown** — selects the length variant when loading a contract's time-series (passed to `getHistoricalOptionsContract$`). This is the existing behavior, now with dynamic options.
- **Length-bucket filter buttons** — filters the catalog table to show only contracts of a certain length bucket. This is new catalog UI.

Both use the same `catalogSummary` data source but feed different UI controls.

---

## 9. Migration Path

### Phase 1 (This PRD): Parallel Operation

- Build catalog callable, proxy, types, store, UI.
- `partnerListContractsV2` and `listOptionsContracts` callable remain available.
- The option-chart UI migrates from `searchContracts` (listContracts) to `queryCatalog` (catalog).
- `getContractIndex` (ts-expirations/ts-strikes) remains for dropdown population.

### Phase 2 (Future): Deprecate listOptionsContracts

- Once the catalog table is stable and confirmed working, remove the `searchContracts` method from the store and the `listContracts$` method from the service.
- The `listOptionsContracts` callable and `callPartnerListContractsV2` proxy can be removed or kept as a fallback.

### Phase 3 (Future): Deprecate getContractIndex

- SA's PRD §10 mentions that `contractIds[]` in `ts-expirations`/`ts-strikes` becomes redundant once the catalog is available. If SA stops writing those arrays, `getContractIndex` will break.
- Migration: use the catalog summary mode to populate expiration dropdowns (group by expiration from catalog results), or read `ts-expirations` for dates only and use the catalog for contract lists.
- This is deferred until SA signals the deprecation.

---

## 10. Firestore Query Constraint Handling

SA's endpoint enforces at most one range field dimension per request. The RS UI must prevent users from creating invalid filter combinations.

**UI approach:**

- Length bucket, expiration, type, and strike are **equality filters** — always allowed in combination.
- Delta range, IV range, and min observation count are **range filters** — only one dimension active at a time.
- When the user sets a delta range, the IV range and min observation count inputs are disabled (greyed out) with a tooltip: "Clear delta filter to use this filter."
- When the user sets an IV range, the delta range and min observation count inputs are disabled.
- This mirrors SA's `400` error prevention at the UI layer.

**Backend approach:**

- The callable passes all params through to SA. If SA returns `400`, the callable surfaces the error message to the frontend. The store sets `catalogError` with the message. The UI displays it.
- No server-side validation in RS — SA owns the constraint logic.

---

## 11. Edge Cases

- **`latest` absent on backfilled expired contracts:** SA's backfill skips the `latest` object for expired contracts. The UI table shows `—` for delta/IV/volume/OI/mark when `latest` is undefined. The `coverage` column still works (computed from `observationCount` / `expectedObservationCount`).
- **Zero observation contracts:** `observationCount` is 0, `contractLengthDays` is null, `contractLengthBucket` is `"—"`. The UI can filter these out by default (set `minObservationCount=1` in the initial query).
- **Large result sets:** QQQ has ~185K contracts. With `pageSize=200`, a full expiration slice may have 500+ contracts across strikes. Pagination via "Load More" handles this. The UI caps the table height with scroll.
- **Summary mode on symbol change:** When the user changes symbol, `loadCatalogSummary(newSymbol)` fires alongside `loadContractIndex(newSymbol)`. The summary populates the length-bucket buttons. If the summary fails (e.g. SA hasn't backfilled the symbol yet), the buttons are hidden and the catalog query still works without a length filter.

---

## 12. File Change Summary

### New Code

| File | Change |
|---|---|
| `shared/options-contract-contracts.ts` | Add `ContractLatestSnapshot`, `ContractCatalogEntry`, `ContractCatalogResponse`, `ContractSummaryResponse`, `QueryContractCatalogRequest` |
| `functions/src/types/partner.ts` | Add `CONTRACT_CATALOG_V2` to `PartnerEndpointPath` enum |
| `functions/src/options-contract-proxy.ts` | Add `callPartnerContractCatalogV2()` proxy function + URL/audience constants |
| `functions/src/options-contract.callables.ts` | Add `queryContractCatalog` onCall callable |
| `functions/src/index.ts` | Export `queryContractCatalog` |
| `src/app/core/common/constants.ts` | Add `QUERY_CONTRACT_CATALOG` to `CallableName` enum |
| `src/app/core/models/partner.types.ts` | Re-export catalog types |
| `src/app/features/rh-agent/services/options-contract.service.ts` | Add `getContractCatalogSummary$()` and `queryContractCatalog$()` methods |

### Modified Code

| File | Change |
|---|---|
| `src/app/features/rh-agent/stores/options-contract-viewer.store.ts` | Add catalog state, `loadCatalogSummary()`, `queryCatalog()`, `loadMoreCatalog()`, `setCatalogFilter()`, `clearCatalogFilters()`, `clearCatalog()` methods. Update `navigateContract` to use `catalogResults` instead of `searchResults`. |
| `src/app/features/rh-agent/pages/option-chart/option-chart.component.ts` | Add catalog filter signals, `lengthBucketButtons` computed, `catalogRows` computed, `onQueryCatalog()`, `onLengthBucketClick()`, `onSortChange()`, `onLoadMore()`, `onSelectCatalogContract()` methods. Remove `onSearchContracts()` (replaced by `onQueryCatalog()`). Update `lengthGroups` to use `catalogSummary` data with static fallback. Add `groupLengthBuckets()` helper and `LENGTH_LABELS` map. |
| `src/app/features/rh-agent/pages/option-chart/option-chart.component.html` | Replace search section with length-bucket filter buttons, delta/IV range inputs, catalog table, pagination. Keep OCC ID manual input + Load button. Remove autocomplete. Add thin `.contract-header-bar` above chart area showing contract ID, type, strike, expiration, length bucket, observation count. Remove `.metadata-section` from left panel (replaced by header bar). |
| `src/app/features/rh-agent/pages/option-chart/option-chart.component.scss` | Styles for filter button row, catalog table, range inputs. Add `.contract-header-bar` styles (28px height, monospace contract ID, call/put color coding). Apply dense Material overrides: reduce `mat-form-field` height to ~36px, `mat-button-toggle` to 32px, buttons to 32px, slide toggles to 16px track. Reduce panel width to 260px, padding to 8px, gap to 6px. Hide `mat-mdc-form-field-subscript-wrapper`. |

### Unchanged

| File | Reason |
|---|---|
| `functions/src/options-contract-proxy.ts` (existing functions) | `callPartnerListContractsV2` and `callPartnerHistoricalOptionsContractV2` remain unchanged. |
| `functions/src/options-contract.callables.ts` (existing callables) | `listOptionsContracts` and `getHistoricalOptionsContract` remain unchanged. |
| `getContractIndex` callable + `loadContractIndex` store method | Dropdown population via ts-expirations/ts-strikes is unchanged. |

---

## 13. Implementation Order

1. **Shared types** — `shared/options-contract-contracts.ts` + `PartnerEndpointPath` enum
2. **Backend proxy** — `callPartnerContractCatalogV2()` in `options-contract-proxy.ts`
3. **Backend callable** — `queryContractCatalog` in `options-contract.callables.ts` + export
4. **Frontend constants + types** — `CallableName` + `partner.types.ts` re-exports
5. **Frontend service** — `getContractCatalogSummary$()` + `queryContractCatalog$()`
6. **Store** — catalog state + methods
7. **UI: catalog table + filters** — filter buttons, range inputs, contract table, pagination (Phase 6)
8. **UI: contract header bar** — thin header above chart showing contract identity (Phase 8.1)
9. **UI: panel compaction** — dense Material CSS overrides, reduce panel width/padding (Phase 8.2)
10. **UI: dynamic length selector** — `lengthGroups` from `catalogSummary` with static fallback (Phase 8.3)
11. **Verify** — `npm --prefix functions run build` + `npm run build` (Angular)
12. **Test against SA** — once SA deploys the endpoint, verify with QQQ summary + catalog queries

---

## 14. Testing

### 14.1 Unit Tests

- `options-contract-proxy.test.ts` — verify `callPartnerContractCatalogV2` builds correct URL params, handles summary vs catalog mode, parses responses, handles errors.
- `options-contract.callables.test.ts` — verify `queryContractCatalog` passes params through, uppercases symbol, handles missing symbol.
- Store tests — verify `queryCatalog()` merges builder + catalog filters correctly, `loadMoreCatalog()` appends results, `clearCatalog()` resets state.

### 14.2 Integration Tests

- Call the deployed `queryContractCatalog` callable with `summary=true` for QQQ → verify histogram response.
- Call with `expiration=2026-01-16&sortBy=strike` → verify paginated contract list with metadata.
- Call with `deltaGte=0.40&deltaLte=0.50` → verify filtered results.
- Call with `deltaGte=0.40&ivGte=0.01` → verify 400 error surfaces.

### 14.3 Manual Verification

- Open option-chart page, enter QQQ → length-bucket buttons appear with counts.
- Select expiration 2026-01-16 → catalog table loads with strike, delta, IV, length, observations.
- Click "3mo" filter button → table filters to 3-month contracts only.
- Set delta range 0.40–0.50 → table filters, IV inputs grey out.
- Click a row → contract time-series loads in chart.
- Contract header bar appears above chart showing ID, type, strike, exp, length, obs count.
- Navigate prev/next → cycles through catalog results.
- Change symbol → summary + index reload, catalog clears, length dropdown updates to available buckets.
- Verify left panel fits without scrolling on a 1080p viewport.
- Verify dense controls are readable and functional (dropdowns, toggles, buttons).

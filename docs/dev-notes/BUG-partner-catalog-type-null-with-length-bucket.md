# Bug Report: Partner Catalog API 500 — `type` omitted + `contractLengthBucket` specified

**Date:** 2026-07-27  
**Severity:** High (blocks "Both" + Length filter combination)  
**Status:** Open — partner API bug  

## Summary

The Savant Partner Contract Catalog V2 endpoint returns HTTP 500 when `type` is omitted (to query both calls and puts) AND `contractLengthBucket` is specified. The endpoint handles each parameter independently, but fails on this specific combination.

## Reproduction

### Steps to Reproduce

1. Open Option Chart page
2. Enter a symbol (e.g., `QQQ`)
3. Select "Both" in the Call/Put/Both toggle
4. Select any value in the Length dropdown (e.g., "1 Month")
5. Click "Search Catalog"

### Expected Behavior

Catalog returns both call and put contracts matching the specified length bucket.

### Actual Behavior

```
POST https://us-central1-rel-str.cloudfunctions.net/queryContractCatalog 500 (Internal Server Error)
```

### Test Matrix

| # | Type | Length Bucket | Expiration | Strike | Result |
|---|------|--------------|------------|--------|--------|
| 1 | Call | — | — | — | ✅ Works |
| 2 | Put | — | — | — | ✅ Works |
| 3 | Both | — | — | — | ✅ Works |
| 4 | Call | ✅ 1m | — | — | ✅ Works |
| 5 | Put | ✅ 1m | — | — | ✅ Works |
| 6 | Both | ✅ 1m | — | — | ❌ 500 |
| 7 | Both | — | ✅ 2026-01-15 | — | ✅ Works |
| 8 | Both | — | — | ✅ 450 | ✅ Works |
| 9 | Both | ✅ 1m | ✅ 2026-01-15 | — | ❌ 500 (assumed — type omitted + bucket present) |
| 10 | Both | ✅ 1m | — | ✅ 450 | ❌ 500 (assumed — type omitted + bucket present) |
| 11 | Both | ✅ 1m | ✅ 2026-01-15 | ✅ 450 | ❌ 500 (assumed — type omitted + bucket present) |
| 12 | Call | ✅ 1m | ✅ 2026-01-15 | ✅ 450 | ✅ Works |
| 13 | Put | ✅ 1m | ✅ 2026-01-15 | ✅ 450 | ✅ Works |

**Pattern:** The 500 occurs whenever `type` is omitted AND `contractLengthBucket` is present, regardless of other parameters. Cases 9–11 are inferred from this pattern but not yet manually verified.

## Root Cause

The frontend correctly omits `type` from the request when "Both" is selected (passing `undefined`). The proxy layer (`options-contract-proxy.ts:451`) correctly skips the `type` query param when undefined:

```typescript
if (params.type) search.set('type', params.type);
```

The 500 originates upstream from the Savant Partner Contract Catalog V2 API. The partner API does not handle the case where `type` is absent but `contractLengthBucket` is present.

## Request Examples

### Fails (type omitted + length bucket)

```
GET .../contract-catalog-v2?symbol=QQQ&contractLengthBucket=1m&sortBy=strike&sortOrder=asc&pageSize=200
```
→ 500 Internal Server Error

### Works (type=C + length bucket)

```
GET .../contract-catalog-v2?symbol=QQQ&contractLengthBucket=1m&type=C&sortBy=strike&sortOrder=asc&pageSize=200
```
→ 200 OK

### Works (type omitted, no length bucket)

```
GET .../contract-catalog-v2?symbol=QQQ&sortBy=strike&sortOrder=asc&pageSize=200
```
→ 200 OK

## Affected Code

- **Frontend trigger:** `option-chart.component.ts:200` — passes `type: null` when "Both" selected
- **Store:** `contract-catalog-feature.ts:77` — converts `null` to `undefined` via `type ?? undefined`
- **Proxy:** `functions/src/options-contract-proxy.ts:451` — correctly omits `type` param when undefined
- **Partner endpoint:** Savant Contract Catalog V2 API (upstream)

## Impact

Users cannot filter by contract length when "Both" call/put types are selected. They must choose either Call or Put to use the Length filter.

## Suggested Partner Fix

The partner API should accept requests with `contractLengthBucket` specified and `type` omitted, returning contracts of both types matching the bucket. This is consistent with the behavior when `type` is omitted without a length bucket (which works correctly).

## Frontend Workaround (if needed)

If a quick partner fix is not available, the frontend can split the query into two parallel requests (`type=C` and `type=P`) and merge results client-side when "Both" + length bucket is selected.

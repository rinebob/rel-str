**Topic:** Option Contract Time-Series Viewer  
**Topic Slug:** option-contract-viewer  
**Thread:** OCC Contract String Group Generator  
**Thread Slug:** occ-string-generator  
**Issue:** #1329  
**Thread Parent:** #1325  
**Topic Parent:** #1243  
**Domain:** OPTIONS  
**Type:** TEST  
**Area:** BE  
**Status:** Draft  
**Created:** 2026-10-28  
**Last Updated:** 2026-10-28  

# Test Plan — BE: Partner Contract Availability Proxy

## E2E User Journeys

- FE requests availability for QQQ (strike range + step, expiry range, calls)
  → proxy returns SA's contract list verbatim with `truncated`/`corpusDates`.
- Request omits `symbol` or inverts a range → `400 { ok:false, code:'BAD_REQUEST' }`.
- Upstream 401/403/404/405 → proxied status + `{ ok:false }` body, not a 500.
- Upstream returns `truncated:true` (≥2000 rows) → flag survives to the FE.

## Integration Tests

- Route + OIDC token acquisition (mocked token provider) → correct
  `Authorization: Bearer` header and audience (env override honored).
- Route + upstream fetch (mocked) → query string serializes
  `ContractAvailabilityRequest` fields verbatim; `expirations[]` →
  comma-joined; omitted params are absent from the query string.
- Response passthrough: upstream JSON reaches the caller byte-equivalent —
  no reshaping/filtering of `contracts[]`.

## Unit Tests

- Param validation: missing symbol, `Gte > Lte` (expiration and strike),
  non-numeric strike params, malformed dates.
- Query-string assembly: every param combination, comma-join, type values
  (`C|c|call` pass through as sent).
- Error mapping: each upstream code → correct proxy response; network
  failure → 502-style error (match catalog handler's convention).

## Test Seams

- **Highest seam:** route-level spec with mocked `fetch`/OIDC — covers
  validation, serialization, error mapping in one place.
- **Lower seams:** shared-type shape assertions unnecessary (compile-time).

## Existing Test Coverage

- The catalog-V2 handler's spec establishes the mock-OIDC + mock-fetch
  pattern — mirror its fixture/harness shape.

## Edge Cases

- `expirations` list + range both present → both forwarded (SA defines
  list-overrides-range; proxy does not choose).
- Empty `contracts[]` with `ok:true` → passes through (valid empty result,
  not an error).
- Upstream 200 with malformed JSON → `parse_error` path (catalog precedent).
- `latest` absent on expired backfilled contracts → response untouched.

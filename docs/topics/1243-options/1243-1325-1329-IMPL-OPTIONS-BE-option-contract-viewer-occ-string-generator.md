**Topic:** Option Contract Time-Series Viewer  
**Topic Slug:** option-contract-viewer  
**Thread:** OCC Contract String Group Generator  
**Thread Slug:** occ-string-generator  
**Issue:** #1329  
**Thread Parent:** #1325  
**Topic Parent:** #1243  
**Domain:** OPTIONS  
**Type:** IMPL  
**Area:** BE  
**Status:** Complete  
**Created:** 2026-10-28  
**Last Updated:** 2026-10-31  

# Implementation Plan — BE: Partner Contract Availability Proxy

## Scope

One new proxy route exposing SA's `partnerContractAvailabilityV1` through the
existing `functions/src/options-contract-proxy.ts`, plus the shared types in
`shared/options-contract-contracts.ts` that both the proxy and the FE consume.
No Firestore, no persistence — the proxy is a thin authenticated pass-through.

## Task BE-1 — Shared contracts + availability proxy route

### Shared types (`shared/options-contract-contracts.ts`)

Add, mirroring the existing `ContractCatalogEntry` block:

```ts
// ==========================
// Contract Availability (partnerContractAvailabilityV1)
// ==========================

export interface ContractAvailabilityLatestSnapshot {
  mark?: string;
  iv?: string;
  delta?: string;
  volume?: string;
  openInterest?: string;
}

export interface ContractAvailabilityEntry {
  contractId: string;              // OCC-format id
  expiration: string;              // YYYY-MM-DD
  strike: number;
  type: 'call' | 'put';
  firstObserved: string;           // proxy for listing date
  firstObservedDow?: string;
  lastObserved: string;
  lastObservedDow?: string;
  observationCount?: number;
  expectedObservationCount?: number;
  contractLengthDays?: number;
  contractLengthBucket?: string;
  latest?: ContractAvailabilityLatestSnapshot; // absent on backfilled expired contracts
  latestDelta?: number;
  latestIv?: number;
}

export interface ContractAvailabilityRequest {
  symbol: string;                  // required, options-enabled
  expirationGte?: string;
  expirationLte?: string;
  expirations?: string[];          // overrides range server-side
  strikeGte?: number;
  strikeLte?: number;
  strikeStep?: number;
  type?: 'C' | 'P' | 'call' | 'put';
  firstObservedGte?: string;
  firstObservedLte?: string;
}

export interface ContractAvailabilityResponse {
  ok: boolean;
  symbol: string;
  count: number;
  truncated: boolean;              // hard 2000 cap, deterministic sort
  contracts: ContractAvailabilityEntry[];
  corpusDates?: string[];          // symbol-level valid x-axis domain
  corpusDateCount?: number;
}
```

### Proxy route (`functions/src/options-contract-proxy.ts`)

- Add `CONTRACT_AVAILABILITY_V1 = 'partnerContractAvailabilityV1'` to
  `PartnerEndpointPath` in `functions/src/types/partner.ts`.
- New route mirroring the catalog-V2 handler shape:
  - `PARTNER_CONTRACT_AVAILABILITY_V1_URL` / `..._AUDIENCE` env vars.
    **As-built deviation:** SA's availability function checks `aud` against
    the BASE host, not the function URL (function-URL aud → 403
    'audience mismatch'; verified live 2026-10-31). The default audience is
    therefore `PARTNER_AUDIENCE` itself — `_URL` still derives from it +
    path like catalog.
  - Same OIDC token acquisition + Bearer header as the catalog handler.
  - Query-param pass-through: accept the `ContractAvailabilityRequest`
    fields, serialize to the SA param names verbatim (`expirations` array →
    comma-joined).
  - Validation before upstream call: `symbol` required; reject inverted
    ranges (`Gte > Lte`) with the same 400 shape SA uses
    (`{ ok: false, error, code: 'BAD_REQUEST' }`).

### SA contract notes (from the deployed discovery doc)

Authoritative contract: `av-proxy-api/docs/partner/options-data/
contract-availability-discovery.md` (status: deployed, 2026-10-31).

- `expirations` accepts at most **30** dates per request — SA returns
  `BAD_REQUEST` over that. The proxy passes the list verbatim; callers
  (FE drawer) are responsible for keeping explicit lists within the cap.
- `truncated` is **dual-source**: the 2,000-contract cap OR SA's
  25,000 scanned-document read ceiling (hardening committed, deploy
  pending — expect `truncated` to increase after it ships).
- Wide unfiltered queries are the slow path (tens of seconds; SA
  function timeout is 60s) — keep ranges narrow for interactive use.
- **Doc-vs-reality on `aud`:** the discovery doc says the ID token's
  audience is "the deployed endpoint URL", but empirically the function
  URL as `aud` returns 403 while the base host succeeds (verified live
  2026-10-31). `EXPECTED_GOOGLE_AUDIENCE` is presumably configured to
  the base host. Implementation follows observed behavior.
  - Upstream non-200 → pass through status + error body (the catalog
    handler's `upstream_error` log + passthrough pattern).
  - Success → return SA's body verbatim (types above); log a
    `partnerContractAvailabilityV1_response` summary line
    (`count`, `truncated`, duration).

## Boundaries

- The proxy does **not** filter, sort, or reshape `contracts[]` — SA's
  response is the canonical contract list; all refine logic is client-side.
- No caching in v1 (results are small, per-session query tool).
- FE field-name mapping (`firstObserved` ↔ `firstTraded` vocabulary) happens
  in the FE service, not the proxy — shared types use SA's names verbatim.

## Risks

- **SA endpoint not yet live** — proxy validates against the contract above;
  integration smoke happens when SA ships. Handler is spec-testable with a
  mocked upstream.
- **Allowlist** — ST's service account must be on SA's allowlist (same as
  catalog V2); flag on QA, not code.

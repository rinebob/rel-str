**Topic:** Option chain percent change grid  
**Topic Slug:** option-chain-pct-change-grid<br>
**Thread:** Option chain percent change grid
**Thread Slug:** initial-impl<br>
**Issue:** #329  
**Thread Parent:** #327
**Topic Parent:** #326  
**Domain:** OPTIONS  
**Type:** Implementation Plan  
**Area:** SHARED  
**Status:** Draft  
**Created:** 2026-09-15  
**Last Updated:** 2026-09-15  

---

## Scope

The SHARED area covers the request/response types for the new
chain-snapshot callable, shared between BE and FE. These types must
exist before the BE callable or FE service can be written.

## Modules

### 1. Chain snapshot request/response types

Add to `shared/options-contract-contracts.ts`:

```ts
/** Request shape for the getHistoricalOptionsChain callable. */
export interface GetHistoricalOptionsChainRequest {
  symbol: string;
  date: string; // YYYY-MM-DD
}

/** Response shape for the getHistoricalOptionsChain callable.
 *  Raw pass-through of PartnerHistoricalOptionsResponse. */
export interface GetHistoricalOptionsChainResponse {
  ok: boolean;
  symbol: string;
  date: string | null;
  source: string;
  endpoint: string;
  data: {
    endpoint?: string;
    message?: string;
    data: HistoricalOptionContract[];
  };
  analysis: {
    summary: HistoricalOptionsAnalysisSummary;
    expirations: HistoricalOptionsExpirationGroup[];
    strikes: HistoricalOptionsStrikeGroup[];
  };
  timestamp: string;
  processingTimeMs: number;
}
```

**Decision: raw pass-through.** The callable returns the full
`PartnerHistoricalOptionsResponse` as-is, consistent with every existing
options callable (`getHistoricalOptionsContract`, `listOptionsContracts`,
`getOptionsContractIndex`, `queryContractCatalog`). The FE ignores the
`analysis` block. No trimming — trimming would break the existing pattern
and add a mapping layer to maintain.

**Note on `source` field:** The SA discovery doc does not currently
include a `source` field in the response. The ST proposal doc
(`326-327-329-PROPOSAL-...`) asks SA to add it. If SA adds it, the
response type should include `source: 'gcs' | 'live'`. If SA does not
add it in time for phase 1, the FE treats every fetch as a live fetch
(no UX distinction). The type should be written to accept an optional
`source?: string` so it doesn't break if the field is absent.

### 2. FE partner types mirror

Add to `src/app/core/models/partner.types.ts`:

```ts
export type { GetHistoricalOptionsChainRequest, GetHistoricalOptionsChainResponse } from '@options-contract/contracts';
```

Follows the existing re-export pattern for options contract types.

### 3. CallableName enum entry

Add to `src/app/core/common/constants.ts`:

```ts
/** Options chain pct change: fetch full chain snapshot for a symbol+date */
GET_HISTORICAL_OPTIONS_CHAIN = 'getHistoricalOptionsChain',
```

## Verification

- `cd functions && npm run build` passes
- Angular build passes
- Types are importable from both `@options-contract/contracts` (BE) and
  the FE partner types re-export

**Topic:** SA IV Data  
**Topic Slug:** sa-iv-data  
**Thread:** IV Metrics Consumer  
**Thread Slug:** iv-metrics-consumer  
**Issue:** #1744  
**Thread Parent:** #1738  
**Topic Parent:** #1737  
**Domain:** IMP-VOL  
**Type:** IMPL  
**Status:** Complete  
**Created:** 2026-11-25  
**Last Updated:** 2026-11-26  

# Implementation Plan — SHARED: IV Metrics Consumer

## Architecture overview

One shared contracts module — `shared/iv-metrics-contracts.ts`, aliased
`@iv-metrics/contracts` — carrying the request/response types for both SA
endpoints (`partnerIvMetricsV2`, `partnerIvRankV2`) so the BE proxy callers,
the callable wrappers, and future FE consumers all share one source of
truth. Pure types + field-name constants; no runtime dependencies beyond
what `shared/` already uses.

## Boundary

Covers: the contracts file, its spec, and the three alias registrations
needed for every consumer (root `tsconfig.json`, `functions/tsconfig.json`,
`jest.config.js` `moduleNameMapper`).

NOT scope: any functions code (that's the BE area), any UI, any persistence,
any SA-side change. The `PartnerEndpointPath` enum lives in
`functions/src/types/partner.ts` — BE files it, not here.

## Files

```
shared/iv-metrics-contracts.ts       — NEW: request/response/row types + field-name constants
shared/iv-metrics-contracts.spec.ts  — NEW: constant-completeness pins + row-shape guards
tsconfig.json                        — modified: "@iv-metrics/contracts" path entry
functions/tsconfig.json              — modified: same alias → ../shared/iv-metrics-contracts.ts
jest.config.js                       — modified: moduleNameMapper entry
```

## Modules

### 1. `shared/iv-metrics-contracts.ts` — new (adapted from `spread-contracts.ts` conventions)

Per-endpoint types, matching the SA discovery docs verbatim:

```ts
/** partnerIvMetricsV2 — per-symbol daily IV metric series. */
export type IvMetricField =
  | 'iv30' | 'iv30Method' | 'iv30Contracts'
  | `ivRank${IvRankWindow}` | `ivPct${IvRankWindow}` | `ivN${IvRankWindow}`;
export type IvRankWindow = 30 | 60 | 180 | 360;

export interface IvMetricsRequest {
  symbol: string;
  from: string;  // YYYY-MM-DD, inclusive
  to: string;    // YYYY-MM-DD, inclusive, span ≤ 10y
  metrics?: IvMetricField[];  // omitted → all fields
}

export interface IvMetricsRow {
  date: string;                       // always present
  iv30?: number;                      // decimal — 0.24 ≈ 24%
  iv30Method?: 'interpolated' | 'nearest';
  iv30Contracts?: number;
  ivRank30?: number; ivRank60?: number; ivRank180?: number; ivRank360?: number;
  ivPct30?: number;  ivPct60?: number;  ivPct180?: number;  ivPct360?: number;
  ivN30?: number;    ivN60?: number;    ivN180?: number;    ivN360?: number;
}

export interface IvMetricsResponse {
  ok: boolean;
  symbol: string;
  from: string;
  to: string;
  metrics?: string[];   // echo of the effective whitelist when supplied
  rows: IvMetricsRow[];
  timestamp: string;
  processingTimeMs: number;
}
```

```ts
/** partnerIvRankV2 — whole-table latest-rank screener. */
export type IvRankSortField =
  | `ivRank${IvRankWindow}` | `ivPct${IvRankWindow}` | `ivN${IvRankWindow}`;
export type IvRankDirection = 'asc' | 'desc';

export interface IvRankRequest {
  sort?: IvRankSortField;
  dir?: IvRankDirection;
  minN?: number;   // non-negative integer; floor on the sort window's ivN
}

export interface IvRankRow {
  symbol: string;
  asOfDate: string;   // trading date the snapshot computed from
  ivRank30?: number; ivRank60?: number; ivRank180?: number; ivRank360?: number;
  ivPct30?: number;  ivPct60?: number;  ivPct180?: number;  ivPct360?: number;
  ivN30: number;     ivN60: number;     ivN180: number;     ivN360: number;
  updatedAt: string | null;
}

export interface IvRankResponse {
  ok: boolean;
  count: number;
  sort?: string;
  dir?: string;
  minN?: number;
  rows: IvRankRow[];
  timestamp: string;
  processingTimeMs: number;
}
```

```ts
/** Callable request types — mirrors the helper params. */
export interface GetIvMetricsRequest extends IvMetricsRequest {}
export interface GetIvRankRequest extends IvRankRequest {}
```

Contract-shape notes that must hold in the types' doc comments:
- **Absent key = no data, never `0`** — every rank/percentile/method field is
  optional. `ivN{W}` is required on `IvRankRow` (always emitted) but optional
  on `IvMetricsRow` (emitted only when the metric exists).
- `ivRank{W}` requires `ivN{W} ≥ 2`; `ivPct{W}` requires `ivN{W} > 0`.
- Rank fields on historical rows are frozen at compute time — not "today's
  rank" (documented in a file-level comment, enforced by consumers).

## Contracts

The module IS the contract: `functions/src/types/partner.ts` (BE area)
re-exports these types the way it re-exports `@options-contract/contracts`
today, so partner-layer code keeps importing from `./types/partner`.

## Decisions

- Alias `@iv-metrics/contracts` — matches `@spread/contracts`,
  `@options-contract/contracts` naming. Alternative (fold into an existing
  contracts file) rejected: IV is its own endpoint family.
- `metrics` param typed to the `IvMetricField` union rather than `string[]` —
  typo-safe at compile time; SA's lenient unknown-field handling means the
  union is a client-side guard, not a server contract change.
- `IvRankWindow` literal union driving the field-name template-literal types —
  one definition, twelve derived names; new windows are one-line edits.

## Sequence / phases

One phase, one task — the file + spec + three alias registrations land
together (the file is unimportable until the aliases resolve).

## Prior art / regression

- `shared/spread-contracts.ts`, `shared/options-contract-contracts.ts` —
  file shape and doc-comment conventions.
- `shared/options-strategy-engine-contracts.spec.ts` — spec style for a
  contracts module.
- Alias registrations: `tsconfig.json` paths, `functions/tsconfig.json`
  paths, `jest.config.js` `moduleNameMapper` — all three required, mirrors
  `@spread/contracts` exactly.

## Verify relay

- `npx jest shared/iv-metrics-contracts.spec.ts` — spec green.
- `npx tsc --noEmit` (root) and `cd functions && npx tsc --noEmit` — alias
  resolves on both sides.
- BE task's fetch-mocked tests exercising these imports are the downstream
  proof.

## Risks / open seams

- **Forward drift:** SA adds fields → `IvMetricField`/row types must be
  updated before clients can request them (deliberate — typed over lenient).
- **`ivN{W}` on `IvMetricsRow` is optional by doc** ("emitted when the
  metric exists") — consumers must not treat it as always-present.

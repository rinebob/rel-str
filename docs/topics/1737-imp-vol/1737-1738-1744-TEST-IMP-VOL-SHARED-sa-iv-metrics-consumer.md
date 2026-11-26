**Topic:** SA IV Data  
**Topic Slug:** sa-iv-data  
**Thread:** IV Metrics Consumer  
**Thread Slug:** iv-metrics-consumer  
**Issue:** #1744  
**Thread Parent:** #1738  
**Topic Parent:** #1737  
**Domain:** IMP-VOL  
**Type:** TEST  
**Status:** Complete  
**Created:** 2026-11-25  
**Last Updated:** 2026-11-26  

# Test Plan — SHARED: IV Metrics Consumer

## Scope

`shared/iv-metrics-contracts.ts` — request/response/row types and
field-name constants for `partnerIvMetricsV2` + `partnerIvRankV2`, plus the
three alias registrations. One SHARED task.

## E2E User Journeys

- None — no user-facing surface in this area. Compile-time correctness and
  downstream import resolution are the journeys; the BE area's verify
  script exercises the types for real.

## Integration Tests

- Alias resolution is the only integration surface: the spec file itself
  imports via `@iv-metrics/contracts` (not a relative path) so jest's
  `moduleNameMapper` proves the registration, and `npx tsc --noEmit` in
  both roots proves the tsconfig paths.

## Unit Tests

`shared/iv-metrics-contracts.spec.ts`:

- **Window union completeness** — a literal array of the 12 sort-field
  names (`ivRank{30,60,180,360}`, `ivPct{…}`, `ivN{…}`) typed
  `IvRankSortField[]` compiles and round-trips; a deliberately invalid
  name fails via `@ts-expect-error`.
- **`IvMetricField` accepts every documented field** — `iv30`,
  `iv30Method`, `iv30Contracts`, all 12 window fields; `date` is NOT a
  requestable metric (`@ts-expect-error` — it's always present, not a
  whitelist member).
- **Row-shape guards** — typed fixtures matching the discovery-doc
  examples compile; a row missing `date` or a rank row missing `ivN{W}`
  fails via `@ts-expect-error`. Asserts the optionality contract
  (absent-key semantics) is expressed in types, not just comments.

## Test Seams

Type-level compile assertions (`@ts-expect-error`) inside the jest spec —
the only meaningful seam for a pure-types module. Runtime behavior has no
presence here.

## Test data / fixtures

- `IvMetricsRow` fixture mirroring the discovery doc:
  `{ date: '2026-10-30', iv30: 0.2456, ivRank360: 82.7, ivN360: 147 }`.
- `IvRankRow` fixture mirroring the QQQ row in `iv-rank-discovery.md`
  (`ivRank30/60/180 = 82.7`, `ivN360 = 147`, `updatedAt` ISO string).
- Negative fixtures: `{ symbol: 'AAPL' }` (missing `date`) as
  `IvMetricsRow`; a rank row without `ivN360`.

## Existing Test Coverage

- `shared/options-strategy-engine-contracts.spec.ts`,
  `shared/options-replay-contracts.spec.ts` — the contracts-spec style to
  imitate (shape pins, `@ts-expect-error` negatives).
- `shared/lifecycle-grouping-removed.spec.ts` — precedent for
  cross-cutting contract pins.
- Gap filled: no shared types for the IV endpoint family exist today.

## Edge Cases

- `updatedAt: null` on `IvRankRow` (doc: ISO-8601 | null).
- A metrics response carrying `metrics` echo only when requested —
  response type marks it optional.
- `IvRankRequest` fully-empty object is valid (whole-table default).

## Verify relay

- `npx jest shared/iv-metrics-contracts.spec.ts`
- `npx tsc --noEmit` (root) + `cd functions && npx tsc --noEmit`

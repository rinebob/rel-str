**Topic:** Paper Trading Infra  
**Topic Slug:** paper-trading-infra  
**Thread:** Core Infra  
**Thread Slug:** core-infra  
**Issue:** #556  
**Thread Parent:** #554  
**Topic Parent:** #553  
**Domain:** PAPER-TRADING  
**Type:** TEST  
**Status:** Draft  
**Created:** 2026-09-24  
**Last Updated:** 2026-09-24  

# Test Plan: Paper Trading Infra — SHARED (contracts)

## E2E User Journeys

- N/A — contracts are types; no user-facing behavior.

## Integration Tests

- ID builders (`trade`, `cohort`, `rq`, `stats`, `acct`) round-trip: build → parse → same components; same-day collision suffixing.
- Type guards discriminate `kind` correctly across mixed record reads.

## Unit Tests

- `generateInstanceId` / trade-id builder: format, padding, symbol uppercasing, empty-phase error.
- OCC helpers unchanged (already covered) — verify imports, no re-implementation.
- `ExitVariantParams` union serialization round-trip.

## Test Seams

- Highest seam: pure builders/parsers (no Firebase dependency) — all contract logic is pure functions + types.

## Existing Test Coverage

- `shared/options-common.ts` OCC parse/build — already tested; contracts reuse it.
- `shared/strategy-instance-id.ts` — already tested.

## Edge Cases

- Trade-id collision on same symbol+day+desc (two signal accepts same minute) → `-HHMM` suffix.
- `expression` values outside the known set → treated as opaque string, no crash.
- `marks` map: missing date → absent key, not `undefined` mark.

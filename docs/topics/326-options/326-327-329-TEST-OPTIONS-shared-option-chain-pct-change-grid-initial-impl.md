**Topic:** Option chain percent change grid  
**Topic Slug:** option-chain-pct-change-grid<br>
**Thread:** Option chain percent change grid
**Thread Slug:** initial-impl<br>
**Issue:** #329  
**Thread Parent:** #327
**Topic Parent:** #326  
**Domain:** OPTIONS  
**Type:** Test Plan  
**Area:** SHARED  
**Status:** Draft  
**Created:** 2026-09-15  
**Last Updated:** 2026-09-15  

---

# Test Plan: Option chain percent change grid — SHARED

## E2E User Journeys

None — SHARED area is types only, no user-facing behavior.

## Integration Tests

- BE can import `GetHistoricalOptionsChainRequest` and
  `GetHistoricalOptionsChainResponse` from `@options-contract/contracts`
- FE can import the same types via the re-export in `partner.types.ts`
- `CallableName.GET_HISTORICAL_OPTIONS_CHAIN` exists and has value
  `'getHistoricalOptionsChain'`

## Unit Tests

None — types compile away, no runtime behavior to test.

## Test Seams

- Highest seam: TypeScript compiler (type-checking across BE and FE)
- The build itself is the test — if the types are wrong, both builds fail

## Edge Cases

- `source` field is optional in the response type — verify the type
  compiles whether or not SA includes the field
- Empty chain (`data.data: []`) is a valid response — type should not
  require non-empty arrays

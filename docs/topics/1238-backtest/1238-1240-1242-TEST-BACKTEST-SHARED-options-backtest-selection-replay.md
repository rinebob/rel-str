**Topic:** Options Backtest  
**Topic Slug:** options-backtest  
**Thread:** Selection Replay  
**Thread Slug:** selection-replay  
**Issue:** #1242  
**Thread Parent:** #1240  
**Topic Parent:** #1238  
**Domain:** BACKTEST  
**Type:** TEST  
**Status:** Draft  
**Created:** 2026-10-25  
**Last Updated:** 2026-10-25  

# Test Plan — SHARED: Selection Replay

## E2E User Journeys

- (Covered at FE/BE level — shared layer has no user journeys of its own.)

## Integration Tests

- `REPLAY_TEMPLATES` ↔ `getReplayTemplate` round-trip: every seeded id resolves; unknown id returns `undefined`.
- `PickDocument`/`ContractListRow`/`OptionsReplayRun`/`OptionsContractListDoc` type checks: fixture shapes compile against the contracts (type-level test or a fixture-validation spec like existing `*-contracts` spec patterns — verify precedent).
- Firestore rules coverage in the existing rules/indexes spec pattern (verify precedent — `tests/functions/firestore-rules-indexes-*.test.ts` precedent under earlier topics): authed read allowed on both new roots, unauthed denied, client write denied.

## Unit Tests

- `getReplayTemplate`: hit + miss.
- `REPLAY_TEMPLATES` seed entries: each has a well-formed `PickDocCoordinate` (`type` enum, `targetDelta` in (0,1) magnitude with sign matching `type`, `expiry.dte` positive int); no duplicate ids.
- `OptionsReplayStartRequest` validation inputs (boundary shapes shared with BE tests): empty `symbols`, malformed `startDate` — asserted at BE layer; shared layer only owns the type.

## Test Seams

- No runtime seams — this layer is types + a pure registry + collection constants. The registry is imported, not fetched, in all higher-level tests.

## Existing Test Coverage

- `*-contracts` spec precedent — find the existing shared-contract spec file and extend its pattern rather than inventing a harness.
- `st-collections.ts` constants are covered indirectly by every test that builds paths — no dedicated spec needed unless one exists (verify).

**Topic:** Options Backtest  
**Topic Slug:** options-backtest  
**Thread:** Backtest Analytics  
**Thread Slug:** backtest-analytics  
**Issue:** #1357  
**Thread Parent:** #1266  
**Topic Parent:** #1238  
**Domain:** BACKTEST  
**Type:** TEST  
**Status:** Draft  
**Created:** 2026-11-02  
**Last Updated:** 2026-11-02  

# Test Plan — SHARED: Backtest Analytics

## E2E User Journeys

- (Covered at FE/BE level — shared layer has no user journeys of its own.)

## Integration Tests

- `EXIT_STRATEGIES` ↔ `getExitStrategy` round-trip: every seeded `exitId` resolves; unknown id → `undefined`; no duplicate ids.
- Registry invariants: each entry has a valid `kind`, `order` unique, `label` non-empty; `target-pct-premium`/`stop-pct-premium` carry `pct`, `absolute-price` carries `price`, `dte-time` carries `dte`.
- Fixture-validation spec (existing `*-contracts` spec pattern): an `AnalysisTradeRecord` + `AnalysisResultDoc` fixture compiles/validates against the contracts — including the conditional-field conventions (exit fields only on `outcome:'exit'`, expiry fields only on `'expired'`).
- Firestore rules/indexes spec (existing `firestore-rules-indexes-*` pattern) — **deferred to #1368** (collection lands there): authed read allowed on `st-options-analysis-results`, unauthed denied, client write denied; `contractListDocId + exitId` and `runId + exitId` indexes declared.

## Unit Tests

- `getExitStrategy`: hit + miss.
- `EXIT_REGISTRY_VERSION`: present, positive integer (guard against accidental removal).
- Payload-shape tests for `OptionsAnalysisStartRequest`, `OptionsReplayRetryRequest` boundary shapes (malformed `contractListDocId`/`runId` asserted at BE layer; shared layer owns the types).

## Test Seams

- No runtime seams — types + pure registry + constants. Registry is imported, not fetched, in all higher-level tests; a test-only extra `ExitStrategyDef` can be appended in specs to prove "add a rule = registry entry only" (PRD story 12).

## Edge Cases

- Record with `outcome:'error'` carries `error` and no exit/expiry fields.
- `hold-to-expiry` kind requires no params.
- Aggregate contract: `hitRatePct` denominator excludes `errorCount`.

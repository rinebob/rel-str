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

# Test Plan: Paper Trading Infra — BE

## E2E User Journeys

- Launch a strategy instance → next open pass → trade doc exists with order+fill, cash debited.
- Accept signal as paper → equity trade filled at acceptance quote; expression trades PENDING → next noon pass → expressions OPEN with fills.
- Position open N days → nightly marks land → governing variant triggers → closing fill + cash + CLOSED; shadow variants record their own exit events.

## Integration Tests

- `paperSignalOrder` callable end-to-end with mocked RH MCP tool caller (quote fixtures) — asserts trade/cohort docs, no `place_*` calls.
- `expression-fill-pass` with stubbed chain + quote providers — asserts contract selection respects template delta/DTE and fill at mark.
- Migration script: seed `options-strategy-*` fixtures → migrate → positions readable via new repository with identical computed P&L.
- `eval-pass`: open trade + mark history → governing variant closes trade, shadow variant keeps state independent.

## Unit Tests

- **Pure functions:** fill math (signed cash flow, multiplier), realized/unrealized P&L, equity-curve aggregation, drawdown.
- **Exit rules:** each variant's `evaluate()` — initial-stop breach/no-breach, trailing high-water update + breach, time-stop day counting, limit-stddev level cross.
- **ID builders:** all kind formats + collision suffix.
- **ledger.applyFill:** entry creates trade+cash delta; exit fill closes + realizes P&L; option-leg assignment math (strike × 100 basis).
- **Repository:** appendMark/appendFill/updateVariantRun single-write mutations (mock Firestore).

## Test Seams

- Highest seam: `applyFill` + pass functions with injected `deps` (repository writers, quote providers, clock) — the existing `deps` pattern from `options-strategy-engine` passes carries over.
- Lower seams: pure rule/math functions.
- No Firestore emulator required for unit/integration coverage; keep mocks at the repository boundary.

## Existing Test Coverage

- `tests/functions/options-strategy-engine/*` — provider mapping, instrument map, open/mark/settlement passes; those tests move with the code and keep asserting the same behavior post-migration.

## Edge Cases

- Missing mark for a date (chain gap) → position skipped that day, variant state unchanged.
- Governing and shadow variant trigger same day → closing fill written once; shadow exit event still recorded.
- Signal accepted after market close → equity fill still uses the last RH quote (after-hours quote semantics noted); expressions wait for next noon pass.
- Trade-id collision (two accepts same day/symbol) → `-HHMM` suffix.
- Cash over-draw → allowed; negative balance recorded.
- Option mark absent from RH response → error logged on the trade, mark skipped, no crash of the pass.

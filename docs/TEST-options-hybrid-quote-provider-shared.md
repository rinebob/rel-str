**Topic:** Options Strategy Engine — Hybrid Quote Provider (AV EOD + Robinhood MCP)  
**Issue:** #115  
**Topic Parent:** #114  
**Area:** SHARED  
**Domain:** HYBRID-QUOTE-PROVIDER  
**Type:** TEST  
**Status:** Draft  
**Created:** 2026-08-14  
**Last Updated:** 2026-08-14

# SHARED Test Plan — Hybrid Options Quote Provider

## Goal

Verify that the shared contracts and OCC helpers are correct, complete, and consistent across frontend and backend TypeScript builds.

## Unit Tests

### OCC contract ID parsing/building
- Parse known OCC IDs (e.g. `SPY250817P00770000`, `QQQ240719C00450000`) into symbol, expiration, `OptionType`, and strike.
- Round-trip: `buildOccContractId(parseOccContractId(id)) === id`.
- Reject malformed IDs and invalid component values.

### OptionQuote contract
- Construct valid `OptionQuote` objects for each `OptionQuoteSource`.
- Ensure optional Greek fields can be omitted without type errors.
- Ensure `mark` is required and `side` uses `TradeSide` enum.

### Instrument map contract
- Construct valid `OccRhInstrumentMapEntry` with and without `firstTradedDate`.
- Verify TTL field shape (`expiresAt`).

### Overnight simulation contract
- Construct an `OvernightDeltaSimulation` with a grid of points.
- Verify grid is symmetric around zero when default range/step is used.

### Cross-project type checking
- Import shared types in both `functions/` and frontend source files.
- Run `tsc --noEmit` in both projects to confirm no compile errors.

## Edge Cases

- Strike values with decimals round-trip through `buildOccContractId` correctly.
- `OptionType.PUT` maps to OCC character `P`; `OptionType.CALL` maps to `C`.

## Test Files

| Test | Location |
|------|----------|
| OCC helpers | `shared/options-common.spec.ts` or equivalent |
| Shared type smoke | Compile-time only; add a small runtime smoke test if a runtime test file does not yet exist |

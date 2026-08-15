**Topic:** Options Strategy Engine — Hybrid Quote Provider (AV EOD + Robinhood MCP)  
**Issue:** #115  
**Topic Parent:** #114  
**Area:** SHARED  
**Domain:** HYBRID-QUOTE-PROVIDER  
**Type:** IMPL  
**Status:** Draft  
**Created:** 2026-08-14  
**Last Updated:** 2026-08-14

# SHARED Implementation Plan — Hybrid Options Quote Provider

## Goal

Define the shared TypeScript contracts and OCC helpers that the backend quote providers, strategy engine, and future UI will use. Keep the engine decoupled from Alpha Vantage and Robinhood MCP specifics by funneling every quote through a single normalized shape.

## Scope

- Add `OptionQuoteSource` enum to `shared/options-common.ts`.
- Create a new shared contract file (`shared/options-strategy-engine-contracts.ts`) containing:
  - `OptionQuote`
  - `OccRhInstrumentMapEntry`
  - `OvernightDeltaGridPoint`
  - `OvernightDeltaSimulation`
  - `StrategyInstanceConfig` (grid + filter knobs)
- Ensure all shared types compile in both frontend and backend TypeScript projects.

## Files

| File | Change |
|------|--------|
| `shared/options-common.ts` | Add `OptionQuoteSource` enum |
| `shared/options-strategy-engine-contracts.ts` | New file with all engine-specific interfaces |

## Decisions

- `OptionQuote` is engine-specific. It intentionally does not reuse AV snapshot interfaces (`HistoricalOptionsContractV2Observation`, `ContractLatestSnapshot`) because those carry source-specific fields and naming; the mapping to `OptionQuote` happens inside each provider.
- `OccRhInstrumentMapEntry` lives in SHARED because it is read by backend functions and may later be consumed by a UI review screen.
- `firstTradedDate` is optional and derived by the system; Robinhood does not expose it.

## Acceptance Criteria

- [ ] `OptionQuoteSource` enum exists with `AV_EOD`, `RH_MCP`, `AV_REALTIME`.
- [ ] `OptionQuote` interface matches the PRD and uses `OptionType` + `TradeSide` + `OptionQuoteSource` enums.
- [ ] `OccRhInstrumentMapEntry` and `OvernightDeltaSimulation` interfaces match the PRD.
- [ ] `StrategyInstanceConfig` exposes `overnightGridRangePct`, `overnightGridStepPct`, and `maxOvernightMovePct` with sensible defaults.
- [ ] No frontend/backend build errors after adding the new contracts file.

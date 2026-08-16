**Topic:** Options Strategy Engine — Hybrid Quote Provider (AV EOD + Robinhood MCP)  
**Issue:** #114  
**Domain:** HYBRID-QUOTE-PROVIDER  
**Type:** AS-BUILT  
**Status:** Complete  
**Created:** 2026-08-15  
**Last Updated:** 2026-08-15

# As-Built — Hybrid Options Quote Provider

## Overview

Implemented a hybrid options quote provider that combines Alpha Vantage EOD data (for nightly selection) with Robinhood MCP real-time quotes (for intraday marking). The system runs three scheduled passes — selection, open, and mark — to manage wheel-style options positions end-to-end.

## What was built

### Shared contracts (#120)
- `shared/options-strategy-engine-contracts.ts` — `OptionQuote`, `OccRhInstrumentMapEntry`, `OvernightDeltaSimulation`, `OvernightDeltaGridPoint`, `StrategyInstanceConfig` interfaces
- `shared/options-common.ts` — `OptionType`, `OptionQuoteSource` enum, OCC contract ID parse/build helpers
- `OptionQuoteSource` enum: `AV_EOD`, `RH_MCP`, `AV_REALTIME`
- `interpolatedClose?: boolean` field on `OptionQuote` (added during #123 review)

### AV EOD provider + selection + simulation (#121)
- `functions/src/options-strategy-engine/quote-providers/av-eod-option-quote-provider.ts` — maps AV EOD historical contracts to `OptionQuote`
- `functions/src/options-strategy-engine/selection/eod-selection-pass.ts` — selects best contract by delta/DTE
- `functions/src/options-strategy-engine/eod-orchestrator.ts` — coordinates selection, instrument map persistence, and simulation persistence
- `functions/src/options-strategy-engine/pricing/black-scholes.ts` — closed-form Black-Scholes pricing (delta, gamma, theta, vega, rho)
- `functions/src/options-strategy-engine/pricing/overnight-simulation.ts` — builds overnight delta grid across configurable price range
- `functions/src/options-strategy-engine/instrument-map/` — OCC→RH instrument map resolver, service, reader, writer, types

### RH MCP session manager + quote provider (#122)
- `functions/src/options-strategy-engine/mcp/robinhood-mcp-session-manager.ts` — manages MCP session lifecycle, reuses connection across calls
- `functions/src/options-strategy-engine/quote-providers/rh-mcp-option-quote-provider.ts` — maps RH MCP option quotes to `OptionQuote`, handles missing close.price, sets `interpolatedClose` flag
- `functions/src/rh-agent-mcp/auth/env-credential-repository.ts` — extracts env-based credentials for MCP auth
- `OptionContractRef` type for normalized contract references across the map layer

### Open pass + mark pass (#123)
- `functions/src/options-strategy-engine/passes/open-pass.ts` — reads prior night's simulation, computes actual overnight move, selects nearest grid point, opens position if no existing position found, supports `maxOvernightMovePct` filter
- `functions/src/options-strategy-engine/passes/mark-pass.ts` — lists open positions, batches quote fetches, writes raw quotes, updates P&L atomically via `markPosition` helper
- `functions/src/options-strategy-engine/logging.ts` — pass-specific logger factory

### Cloud functions + schedules (#124)
- `functions/src/options-strategy-engine/options-strategy-passes.ts` — wires three scheduled Cloud Functions + one manual callable:
  - `optionsSelectionPass` — nightly at 7:00 PM PT (Mon-Fri)
  - `optionsOpenPass` — morning at 6:45 AM PT (Mon-Fri)
  - `optionsMarkPass` — every 30 min during market hours (Mon-Fri)
  - `optionsMarkPassManual` — manual trigger with auth check
- Config bridge: `toSharedConfig` converts Firestore strategy instance configs to shared `StrategyInstanceConfig`
- `spreadTypeToOptionSide` maps spread types to option type/side

### Tests (#129, #130)
- `shared/options-strategy-engine-contracts.spec.ts` — 21 jest tests for OCC helpers and contract shapes
- 11 BE test files — 77 node:test tests covering all components
- `tests/functions/options-strategy-engine/hybrid-quote-provider-integration.test.ts` — 7 integration tests for full selection → open → mark flow

## Architecture decisions

1. **Hybrid provider model**: AV EOD for nightly selection (free, historical), RH MCP for intraday marking (real-time, requires credentials). Avoids paying for real-time AV quotes while still getting accurate marks during market hours.

2. **Overnight delta simulation**: Pre-computes a grid of option prices across a configurable overnight price range (default ±2.5% in 0.5% steps) using closed-form Black-Scholes. The open pass selects the nearest grid point to the actual overnight move, avoiding the need for real-time quotes at market open.

3. **OCC→RH instrument map**: Persistent Firestore mapping from OCC contract IDs to Robinhood instrument IDs. Avoids re-resolving instruments on every mark pass. TTL-based expiration with backfill on next access.

4. **Dependency injection**: All passes accept optional `deps` parameters for their external dependencies (quote providers, repositories, readers). Enables unit testing with mocks and integration testing with mocked boundaries.

5. **Atomic mark writes**: `markPosition` helper batches the raw quote write and position P&L update into a single Firestore transaction, preventing partial updates on failure.

6. **`interpolatedClose` flag**: RH MCP quotes may have interpolated close prices (when market data is stale). The flag propagates through the mark pass to the position record, enabling downstream analysis of mark quality.

## Deviations from original design

- **`interpolatedClose` field**: Not in the original PRD. Added during #123 interim review when it was discovered that RH MCP close prices can be interpolated. The field was added to `OptionQuote` in shared contracts and populated in the RH MCP provider.

- **`OptionContractRef` type**: Introduced during #122 refactor to normalize contract references across the instrument map layer. Simplified the resolver interface.

- **Config bridge helpers**: `toSharedConfig` and `spreadTypeToOptionSide` were extracted during #124 review to avoid duplication between scheduled and manual mark pass functions.

## Test coverage

- 21 SHARED tests (jest) — OCC helpers, contract shapes, all 3 quote sources
- 77 BE tests (node:test) — unit tests for all components + 7 integration tests
- 98 total tests, all passing
- Typecheck clean, build clean

## Files

### Shared
- `shared/options-strategy-engine-contracts.ts`
- `shared/options-strategy-engine-contracts.spec.ts`
- `shared/options-common.ts`
- `shared/tsconfig.json`

### Functions — source
- `functions/src/options-strategy-engine/options-strategy-passes.ts`
- `functions/src/options-strategy-engine/eod-orchestrator.ts`
- `functions/src/options-strategy-engine/logging.ts`
- `functions/src/options-strategy-engine/selection/eod-selection-pass.ts`
- `functions/src/options-strategy-engine/passes/open-pass.ts`
- `functions/src/options-strategy-engine/passes/mark-pass.ts`
- `functions/src/options-strategy-engine/pricing/black-scholes.ts`
- `functions/src/options-strategy-engine/pricing/overnight-simulation.ts`
- `functions/src/options-strategy-engine/pricing/overnight-simulation-writer.ts`
- `functions/src/options-strategy-engine/quote-providers/option-quote-provider.ts`
- `functions/src/options-strategy-engine/quote-providers/av-eod-option-quote-provider.ts`
- `functions/src/options-strategy-engine/quote-providers/rh-mcp-option-quote-provider.ts`
- `functions/src/options-strategy-engine/instrument-map/occ-rh-instrument-map-types.ts`
- `functions/src/options-strategy-engine/instrument-map/occ-rh-instrument-map-reader.ts`
- `functions/src/options-strategy-engine/instrument-map/occ-rh-instrument-map-writer.ts`
- `functions/src/options-strategy-engine/instrument-map/occ-rh-instrument-map-service.ts`
- `functions/src/options-strategy-engine/instrument-map/mcp-instrument-map-resolver.ts`
- `functions/src/options-strategy-engine/mcp/robinhood-mcp-session-manager.ts`
- `functions/src/rh-agent-mcp/auth/env-credential-repository.ts`

### Functions — tests
- `tests/functions/options-strategy-engine/av-eod-option-quote-provider.test.ts`
- `tests/functions/options-strategy-engine/black-scholes-overnight-simulation.test.ts`
- `tests/functions/options-strategy-engine/eod-orchestrator.test.ts`
- `tests/functions/options-strategy-engine/eod-selection-pass.test.ts`
- `tests/functions/options-strategy-engine/hybrid-quote-provider-integration.test.ts`
- `tests/functions/options-strategy-engine/mark-pass.test.ts`
- `tests/functions/options-strategy-engine/occ-rh-instrument-map-service.test.ts`
- `tests/functions/options-strategy-engine/open-pass.test.ts`
- `tests/functions/options-strategy-engine/options-strategy-passes.test.ts`
- `tests/functions/options-strategy-engine/rh-mcp-option-quote-provider.test.ts`
- `tests/functions/options-strategy-engine/robinhood-mcp-session-manager.test.ts`

### Docs
- `docs/PRD-options-hybrid-quote-provider.md`
- `docs/IMPL-options-hybrid-quote-provider-shared.md`
- `docs/IMPL-options-hybrid-quote-provider-be.md`
- `docs/TEST-options-hybrid-quote-provider-shared.md`
- `docs/TEST-options-hybrid-quote-provider-be.md`
- `docs/CODE-REVIEW-options-hybrid-quote-provider-interim.md`
- `docs/CODE-REVIEW-options-hybrid-quote-provider-122.md`

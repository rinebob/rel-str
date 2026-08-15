**Topic:** Options Strategy Engine — Hybrid Quote Provider (AV EOD + Robinhood MCP)  
**Issue:** #115  
**Topic Parent:** #114  
**Area:** BE  
**Domain:** HYBRID-QUOTE-PROVIDER  
**Type:** TEST  
**Status:** Draft  
**Created:** 2026-08-14  
**Last Updated:** 2026-08-14

# Backend Test Plan — Hybrid Options Quote Provider

## Goal

Verify that each backend component behaves correctly in isolation and integrates safely with Firestore, the Alpha Vantage partner proxy, and the Robinhood MCP tools.

## Unit Tests

### Quote providers
- **AV EOD provider:**
  - Map a sample `HistoricalOptionsContractV2Observation` / `ContractLatestSnapshot` into an `OptionQuote`.
  - Handle missing optional fields (bid, ask, Greeks) without throwing.
  - Set `source: OptionQuoteSource.AV_EOD`.
- **RH MCP provider:**
  - Map a sample `get_option_quotes` result into an `OptionQuote` with `mark` from `adjusted_mark_price`.
  - Convert all decimal strings to numbers.
  - Return `null`/error for a missing `close.price` instead of falling back.
  - Skip null Greek fields and only populate `OptionQuote` when present.
  - Set `source: OptionQuoteSource.RH_MCP`.
  - Set `asOf` from `quote.updated_at`.

### Instrument map service
- Read an existing map entry from Firestore.
- Backfill a missing entry by calling mocked `get_option_instruments` and `get_option_chains`.
- Write a new entry with correct `expiresAt`.
- Handle pagination in `get_option_instruments` responses.

### Robinhood MCP session manager
- Open one session per function invocation.
- Reuse the session across multiple tool calls.
- Close the session on function exit.
- Surface credential/connection errors clearly.

### Black-Scholes simulator
- Compare output against a reference implementation or known option calculator for a small set of SPY/QQQ-like inputs.
- Verify grid is symmetric when default range/step is used.
- Verify `baseUnderlyingPrice`, `baseContractID`, and `computedAt` are stored.

## Integration Tests

### Selection pass
- With a mocked AV EOD response, the function selects a candidate contract by delta/DTE.
- The candidate and simulation grid are written to `daily-analysis/{date}`.
- Instrument map entries for the candidate are written to `options-rh-instrument-map`.

### Open pass
- With a mocked underlying price and pre-existing `daily-analysis/{date}` document, the function records the nearest grid point.
- Existing open positions for the same symbol cause the candidate to be skipped.

### Mark pass
- With mocked open positions and mocked `get_option_quotes` response, the function updates position `raw-quotes` and P&L.
- Batch size does not exceed 20 instrument IDs.
- Missing `close.price` produces a data-quality error and does not update the official prior close.
- Interpolated close is stored with a flag and not used for P&L.

## E2E / Manual Verification

- Deploy functions to a non-prod project or run locally with ADC.
- Exercise `rhOptionQuoteDiscovery` to confirm field names remain stable before relying on them in parsers.
- Run one full selection → open → mark cycle against real AV EOD and RH MCP data for one symbol.

## Test Data

- Use the observed SPY sample from `docs/PRD-options-hybrid-quote-provider.md` for RH MCP quote/instrument fixtures.
- Use synthetic AV EOD snapshots covering calls and puts across multiple strikes and expirations.

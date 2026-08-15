**Topic:** Options Strategy Engine — Hybrid Quote Provider (AV EOD + Robinhood MCP)  
**Issue:** #115  
**Topic Parent:** #114  
**Area:** BE  
**Domain:** HYBRID-QUOTE-PROVIDER  
**Type:** IMPL  
**Status:** Draft  
**Created:** 2026-08-14  
**Last Updated:** 2026-08-14

# Backend Implementation Plan — Hybrid Options Quote Provider

## Goal

Build the Firebase Cloud Functions, services, and providers that implement the hybrid quote strategy: AV EOD for nightly contract selection and overnight simulation, Robinhood MCP for live marks on open positions.

## Components

### 1. Quote provider abstraction

- `OptionQuoteProvider` interface: `getQuote(contractID, symbol, side): Promise<OptionQuote>`.
- Implementations:
  - `AvEodOptionQuoteProvider` — fetches prior-session chain and maps to `OptionQuote` with `source: OptionQuoteSource.AV_EOD`.
  - `RobinhoodMcpOptionQuoteProvider` — uses the instrument map and `get_option_quotes`, returns `source: OptionQuoteSource.RH_MCP`.

### 2. Robinhood MCP session manager

- `RobinhoodMcpSessionManager` opens one MCP session per function invocation, lazily.
- Closes the session when the function returns.
- Reads `RH_CREDENTIAL_BUNDLE` from Google Secret Manager.

### 3. OCC → RH instrument map service

- `OccRhInstrumentMapService`:
  - Reads map entries from `options-rh-instrument-map/{occId}`.
  - Backfills missing entries by calling `get_option_instruments` (and `get_option_chains` if `chain_id` is unknown).
  - Builds new entries during the AV EOD selection pass and writes them to Firestore.
  - Computes `expiresAt` = expiration date + 3 months.

### 4. Black-Scholes simulator

- Implement closed-form pricing in `functions/src/options-strategy-engine/pricing/option-pricing.ts`.
- Inputs: underlying price, strike, time to expiration, risk-free rate, implied volatility, option type.
- Outputs per grid point: `delta`, `mark`, `theta`.
- Store results on `options-strategy-instances/{instanceId}/daily-analysis/{date}.overnightDeltaSimulation`.

### 5. Selection pass

- Scheduled after market close.
- Fetches AV EOD chain for each configured symbol.
- Selects candidate contract by delta + DTE rules.
- Builds instrument map entries for the candidate.
- Runs overnight delta simulation and persists it.

### 6. Open pass

- Scheduled shortly after market open.
- Reads the prior night’s `daily-analysis/{date}` document.
- Looks up current underlying price and selects the closest grid point.
- Records actual overnight move vs. simulated grid point.
- Skips symbols that already have an open position for the same strategy instance.
- `max-overnight-move` filter is disabled by default; data is recorded, not rejected.

### 7. Mark pass

- Scheduled periodically during market hours.
- Reads open positions for each strategy instance.
- Batches up to 20 RH instrument IDs per `get_option_quotes` call to preserve official `close` data.
- Converts decimal strings to numbers.
- Surfaces data-quality errors if `close.price` is missing; stores `interpolatedClose` flag when relevant.
- Updates position `raw-quotes` subcollection and unrealized P&L.

### 8. Cloud Functions wiring

- `optionsSelectionPass` (scheduled, post-close)
- `optionsOpenPass` (scheduled, post-open)
- `optionsMarkPass` (scheduled, market-hours)

## Firestore Collections

- `options-strategy-instances/{instanceId}` — instance config, status, latest daily analysis reference.
- `options-strategy-instances/{instanceId}/daily-analysis/{date}` — candidate, simulation grid, open-pass result.
- `options-strategy-instances/{instanceId}/rejected-candidates/{occId}` — future rejected candidate records.
- `options-strategy-positions/{positionId}` — open positions, raw quote history, realized/unrealized P&L.
- `options-rh-instrument-map/{occId}` — global OCC → RH instrument map.

## Risks and Mitigations

| Risk | Mitigation |
|------|------------|
| RH MCP latency (~1s/call) | Reuse one session per invocation; batch mark calls. |
| Greeks/IV null for deep/far contracts | Only populate `OptionQuote` Greek fields when present; simulator uses AV EOD Greeks. |
| Missing official close | Surface data-quality error; do not fall back. |
| Interpolated close | Store flag; do not use for official P&L. |
| AV EOD contract selection drift | Documented and accepted for the wheel strategy; simulator shows projected delta at next open. |

## Dependencies

- `shared/options-strategy-engine-contracts.ts` (SHARED task)
- Existing AV partner historical-options proxy in functions.
- Existing RH MCP connection/auth utilities in `functions/src/rh-agent-mcp/`.

## Acceptance Criteria

- [ ] `OptionQuoteProvider` abstraction exists with AV EOD and RH MCP implementations.
- [ ] RH MCP session is opened once per function invocation and reused across calls.
- [ ] Instrument map is built from AV EOD selection and read at mark time.
- [ ] Overnight delta grid is computed and stored per strategy instance per date.
- [ ] Open pass skips symbols with existing open positions.
- [ ] Mark pass batches ≤20 instrument IDs and records official close when available.
- [ ] Missing `close.price` is surfaced as an error, not silently backfilled.
- [ ] Cloud Functions are scheduled and wired to the passes.

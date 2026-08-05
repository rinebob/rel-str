**Topic:** Spread Time Series Viewer  
**Issue:** #77  
**Domain:** SPREAD-PRICING  
**Type:** Design Doc  
**Status:** Draft  
**Created:** 2026-08-03  
**Last Updated:** 2026-08-03  

# Design Doc: Spread Time Series Viewer

## Summary

Add a dedicated **Spread Time Series Viewer** to the RH Agent app that supports multi-series comparison of spread price time series, with an optional overlay of the underlying asset price. The viewer will integrate the new `partnerSpreadTimeSeries` and `partnerSpreadTimeSeriesBatch` endpoints and provide a spread builder, per-spread list management, and a chart tuned for N price series.

## Motivation

SA has deployed historical spread time series endpoints for both single and batch (up to 200) spreads. Traders need to explore spread price behavior relative to the underlying, compare multiple spreads on the same chart, and manage a list of spreads for analysis. The existing Options Contract Viewer is purpose-built for single-contract inspection and cannot cleanly serve this use case.

## Open Questions

- Should the first implementation support single-spread mode, batch mode, or both in parallel?
- What spread types and per-type form constraints are required for the spread builder?
- How many lower panes should the chart support (e.g., normalized spread price, Greeks, per-leg marks)?
- Should the contract viewer be deprecated once the spread viewer is stable, or will both coexist?
- Is the normalized price comparison pane (batch mode, zero-anchored) in scope for the first phase?

## Supporting Material

- [ADR-003: Spread Time Series Viewer — Separate Pipeline](../adr/ADR-003_spread-time-series-viewer.md)

## Architectural Decision

Per ADR-003, build a **separate spread-specific pipeline** that mirrors the existing contract infrastructure. Spread-specific code (types, proxy, callables, service, store, chart, page) is fully separate. Shared infrastructure services are reused as read-only dependencies.

| Layer | Contract (existing) | Spread (new) |
|---|---|---|
| Shared types | `shared/options-contract-contracts.ts` | `shared/spread-contracts.ts` |
| Endpoint paths | `PartnerEndpointPath` (existing entries) | Add `SPREAD_TIME_SERIES`, `SPREAD_TIME_SERIES_BATCH` |
| Backend proxy | `functions/src/options-contract-proxy.ts` | `functions/src/spread-proxy.ts` |
| Callables | `functions/src/options-contract.callables.ts` | `functions/src/spread.callables.ts` |
| Callable names | `CallableName` (existing entries) | Add spread entries |
| Angular service | `options-contract.service.ts` | `spread.service.ts` |
| Store | `options-contract-viewer.store.ts` | `spread-viewer.store.ts` |
| Chart component | `components/options-contract-chart/` | `components/spread-chart/` |
| Page | `pages/option-chart/` | `pages/spread-chart/` |

**Shared infrastructure (not duplicated):**
- `partner-infrastructure.ts` — OIDC token generation, `fetchWithRetry` (extended to support POST with body)
- `RsBarsService` — underlying bars fetching (reused as-is)
- `OptionsContractService.getContractIndex$` — contract index (expirations + strikes) for the spread builder dropdowns
- `RH_AGENT_ALLOWED_ORIGINS` — CORS config for callables

## Future Work

- **Normalized spread price comparison pane (batch mode):** A lower pane with a zero baseline where each spread price series is anchored to zero on its first trading day, showing day-over-day price change rather than absolute price. This normalizes spreads of different price levels for direct profitability comparison. May produce visual clutter with many series; needs evaluation. Deferred to a future phase.

# ADR-003: Spread Time Series Viewer — Separate Pipeline

## Status

Accepted

## Context

SA has deployed two new endpoints for historical spread time series: `partnerSpreadTimeSeries` (single spread) and `partnerSpreadTimeSeriesBatch` (up to 200 spreads). We need to integrate these into the RH Agent app to enable exploration of spread price behavior relative to the underlying.

The existing Options Contract Viewer at `/rh-agent/option-chart` is a single-contract inspection tool with its own page, store, service, backend proxy, callables, shared types, and chart component. The spread viewer has fundamentally different UI needs: a spread builder dialog, a multi-series comparison chart, per-spread list management, and a different data shape (spread price + portfolio Greeks + per-leg marks vs. single contract mark + IV + volume/OI).

## Decision

Build a **separate spread-specific pipeline** that mirrors the existing contract infrastructure. Spread-specific code (types, proxy, callables, service, store, chart, page) is fully separate. Shared infrastructure services are reused as read-only dependencies.

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

**Rationale:**
- The existing contract chart component is purpose-built for single-contract multi-pane rendering (mark, IV, Greeks, volume/OI). The spread chart needs N price series, configurable lower panes, and leg mark overlays — a different rendering model.
- The spread builder UI (dialog with constrained per-spread-type forms, add/clone, sidenav list) has no counterpart in the contract viewer.
- Keeping the pipelines separate allows independent evolution. The contract viewer may eventually be deprecated once the spread chart proves stable, but that decision is deferred.
- Mixing concerns in a single component/store/service would create conditional-mess code that serves neither use case well.

## Consequences

- Some code pattern duplication (callable boilerplate, proxy fetch/retry/parse, store state management). This is intentional and accepted.
- `fetchWithRetry` in `partner-infrastructure.ts` is extended with an optional `body` param to support POST requests. This is backward compatible — existing GET callers are unaffected.
- The spread viewer reuses `OptionsContractService` for contract index data (expirations/strikes). This is a read-only dependency; the spread pipeline does not modify contract state.
- `PartnerEndpointPath` and `CallableName` enums are extended with spread entries. These are additive changes to shared enum files.
- The spread chart component is cloned from the existing `OptionsContractChartComponent` as a starting point, then adapted independently. The existing component is left untouched.

## Future Work

- **Normalized spread price comparison pane (batch mode):** A lower pane with a zero baseline where each spread price series is anchored to zero on its first trading day, showing day-over-day price change rather than absolute price. This normalizes spreads of different price levels for direct profitability comparison. May produce visual clutter with many series; needs evaluation. Deferred to a future phase.

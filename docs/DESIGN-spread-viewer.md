**Topic:** Spread Time Series Viewer  
**Issue:** #77  
**Domain:** SPREAD-VIEWER  
**Type:** Design Doc  
**Status:** Draft  
**Created:** 2026-08-03  
**Last Updated:** 2026-08-03  

# Design Doc: Spread Time Series Viewer

## Summary

Add a dedicated **Spread Time Series Viewer** to the RH Agent app that supports multi-series comparison of spread price time series, with an optional overlay of the underlying asset price. The viewer integrates the `partnerSpreadTimeSeries` single endpoint via a Cloud Tasks queue architecture and provides a spread builder, spread list management with Firestore persistence, and a multi-series chart with pagination.

## Motivation

SA has deployed historical spread time series endpoints for both single and batch (up to 200) spreads. Traders need to explore spread price behavior relative to the underlying, compare multiple spreads on the same chart, and manage a list of spreads for analysis. The existing Options Contract Viewer is purpose-built for single-contract inspection and cannot cleanly serve this use case.

## Open Questions

- ~~Should the first implementation support single-spread mode, batch mode, or both in parallel?~~ **Resolved:** Single endpoint only in Phase 1, parallelized via Cloud Tasks (1 spread per task). Batch endpoint available for future optimization.
- ~~What spread types and per-type form constraints are required for the spread builder?~~ **Resolved:** 4 spread types (vertical, straddle, strangle, iron_condor) + custom mode. Structured forms with pre-population and auto long/short assignment.
- ~~How many lower panes should the chart support?~~ **Resolved:** Single pane with underlying overlay on secondary Y-axis. Greeks/per-leg marks deferred.
- ~~Should the contract viewer be deprecated once the spread viewer is stable, or will both coexist?~~ **Resolved:** Both coexist. The contract viewer remains for single-contract inspection; the spread viewer serves multi-spread comparison.
- ~~Is the normalized price comparison pane in scope for the first phase?~~ **Resolved:** Deferred to future phase.

## Supporting Material

- [ADR-003: Spread Time Series Viewer — Separate Pipeline](../adr/ADR-003_spread-time-series-viewer.md)

## Architectural Decision

Per ADR-003, build a **separate spread-specific pipeline** that mirrors the existing contract infrastructure. Spread-specific code (types, proxy, callables, service, store, chart, page) is fully separate. Shared infrastructure services are reused as read-only dependencies.

| Layer | Contract (existing) | Spread (new) |
|---|---|---|
| Shared types | `shared/options-contract-contracts.ts` | `shared/spread-contracts.ts` + `shared/options-common.ts` |
| Endpoint paths | `PartnerEndpointPath` (existing entries) | Add `SPREAD_TIME_SERIES` (single only) |
| Backend proxy | `functions/src/options-contract-proxy.ts` | `functions/src/spread-proxy.ts` |
| Run orchestrator | — | `functions/src/spread-run-orchestrator.ts` (new) |
| Run worker | — | `functions/src/spread-run-worker.ts` (new) |
| Run model | — | `functions/src/spread-run-model.ts` (new) |
| Callable names | `CallableName` (existing entries) | Add `SUBMIT_SPREAD_RUN` |
| Angular service | `options-contract.service.ts` | `spread.service.ts` + `spread-run.service.ts` |
| Shared service | — | `options-common.service.ts` (new — `getContractIndex$`) |
| List service | — | `spread-list.service.ts` (new — Firestore CRUD) |
| Store | `options-contract-viewer.store.ts` | `spread-viewer.store.ts` |
| Chart component | `components/options-contract-chart/` | `components/spread-chart/` |
| Builder dialog | — | `components/spread-builder-dialog/` (new) |
| Page | `pages/option-chart/` | `pages/spread-chart/` |

**Shared infrastructure (not duplicated):**
- `partner-infrastructure.ts` — OIDC token generation, `fetchWithRetry` (extended to support POST with body)
- `RhAgentChartService` — underlying bars from `symbol-data` Firestore collection (reused as-is)
- `OptionsCommonService.getContractIndex$` — contract index (expirations + strikes) for the spread builder dropdowns (new shared service; `OptionsContractService` retains duplicate for now)
- `RH_AGENT_ALLOWED_ORIGINS` — CORS config for callables

## Queue Architecture

All spread series loading goes through a Cloud Tasks queue — even for a single spread. This mirrors the existing `backtest-runs` and `rs-backfill-runs` patterns.

**Flow:**
1. Frontend calls `submitSpreadRun` callable with all pending spread definitions
2. Orchestrator writes `spread-runs/{runId}` aggregate doc, enqueues 1 Cloud Task per spread, returns `{ runId }`
3. Worker task calls SA single endpoint for 1 spread, writes result to `spread-runs/{runId}/jobs/{spreadIndex}` subcollection, increments aggregate counters
4. `SpreadRunService` observes run + jobs via `onSnapshot`, emits RxJS observables to store
5. Store updates `Spread` entries with series data as job docs arrive

**Worker config:** 20 concurrent dispatches, 10/sec rate, 256 MiB, 60s timeout, 3 retries with 10-60s backoff.

**Firestore collections:**
- `spread-runs/{runId}` — aggregate doc (status, counts, timestamps). Authenticated read, backend-only write.
- `spread-runs/{runId}/jobs/{jobId}` — per-spread result doc (series, debitOrCredit, gaps, legMetadata, error). Authenticated read, backend-only write.
- `spread-lists/{listId}` — user-named spread definition lists + auto-maintained "recent" list. User-scoped read/write.

No cleanup of old run docs in Phase 1.

## Future Work

- **SA batch endpoint integration:** Use `partnerSpreadTimeSeriesBatch` for efficiency if single-endpoint volume becomes a problem.
- **Normalized spread price comparison pane:** A lower pane with a zero baseline where each spread price series is anchored to zero on its first trading day. Deferred to a future phase.
- **Scheduled cleanup for old spread-runs docs.**
- **Filtering UI:** DOW filters, winners/losers filters, date range filters for selecting which spreads to plot.
- **Backtest plotting mode:** Load positions from backtest runs, entry-anchored charting.
- **Greeks pane and per-leg marks pane.**

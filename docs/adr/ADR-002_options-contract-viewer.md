# ADR-002: Options Contract Viewer Dashboard

## Status

Accepted

## Context

We need a viewer dashboard to request a historical options contract by OCC ID, inspect the returned time-series data, and plot it on a chart alongside the underlying price. The primary motivation is validating Savant Partner API historical options data (especially 2026 gaps), with research overlays as a follow-on. A future requirement is Black-Scholes candlestick interpolation using IV and underlying OHLC to synthesize option OHLC bars.

## Decisions

- **Dedicated chart component.** A new `options-contract-chart` Syncfusion component is built separately from `app-flex-chart`. The options data model (daily observations with mark/bid/ask/Greeks, no OHLC) is different enough from equity bars that extending flex-chart would add complexity to a component already tuned for equities and indicators. The dedicated chart reuses the same Syncfusion services (zoom, pan, scrollbar, legend) for consistent UX. The X-axis uses a **DateTimeCategory axis** — this avoids weekend/holiday gaps in the time series while still rendering date-formatted labels (e.g. `MMM dd`).
- **Backend callable.** A new `getHistoricalOptionsContract` callable in `functions/src/options-contract.callables.ts` wraps the existing `callPartnerHistoricalOptionsContractV2` helper in `functions/src/options-contract-proxy.ts`. No caching — live fetch every request so we can spot SA data issues directly. Auth follows the same pattern as existing callables (Firebase Auth inherited via `onCall`). CORS is restricted via `RH_AGENT_ALLOWED_ORIGINS` allowlist.
- **Single-contract milestone first.** Milestone 1 supports one OCC ID input, fetch, and display. Multi-contract overlay (multiple marks on the main pane, per-contract toggles in lower panes) is a follow-on.
- **Underlying overlay.** When a contract loads, underlying daily bars are auto-fetched via `RsBarsService.getDailyBars$()` for the contract's date range. The underlying `close` renders as a faint line on the main pane with a right Y-axis. User can toggle it off.
- **Chart panes.** Main pane: option `mark` (primary), underlying `close` (toggleable, right axis). Bid/ask series were removed during implementation — the mark is sufficient for validation and the faint bounds added visual noise. Lower-1: IV. Lower-2: delta + gamma (theta/vega colors reserved for future series). Lower-3: volume columns + OI line (off by default). No technical indicators — just raw series from the data.
- **Full lifetime fetch, zoom/pan in-chart.** No date range inputs. The full contract series is fetched and the user zooms/pans within the chart, matching the flex-chart UX. Y-axes dynamically snap to the visible data range on zoom/pan/scroll via a computed `axisRanges` signal and an `applyYAxisViewport` effect.
- **FE state.** NgRx SignalStore + service. Component is UI-only.
- **Contract length selector.** A dropdown allows selecting a target contract length (0DTE through LEAP). When a length is selected, the backend resolves the closest matching contract from the options chain by expiration proximity, falling back to the input contract ID if resolution fails. This enables comparing the same strike/type across different expiration windows.
- **Shared contracts.** Options contract DTOs (`HistoricalOptionsContractV2Observation`, `PartnerHistoricalOptionsContractV2Response`, `GetHistoricalOptionsContractRequest`) and the OCC ID parser (`parseOccContractId`) live in `shared/options-contract-contracts.ts`, imported by both frontend and backend via the `@options-contract/contracts` path alias.
- **Route.** `/rh-agent/option-chart`, lazy-loaded under the RH Agent feature.
- **Contract navigation.** After a contract search, prev/next chevron buttons at the bottom-left of the chart allow cycling through search results without re-searching. A position counter (`3 / 25`) shows the current index. The store tracks `currentSearchIndex` and exposes `navigateContract(direction)` which loads the next/prev contract from the cached `searchResults` array. Search results are no longer cleared on contract selection, preserving the navigation list for the session.
- **Header metadata.** Contract ID, symbol, type, strike, expiration, DTE, observation count, data quality flags (gaps, NaN IV).

## Considered Options

- **Extending `app-flex-chart`:** Rejected. Flex-chart is category-indexed by `PriceBar` OHLC and tightly coupled to the equity indicator model. Options observations are flat daily data points with no OHLC. Adapting flex-chart would complicate an equity-focused component.
- **Bid/ask series:** Removed during implementation. The mark is sufficient for data validation; faint bid/ask bounds added visual clutter without analytical value for the current use case.
- **Caching contract series:** Rejected for milestone 1. Caching would mask the exact SA data gaps we're validating. Can add snapshot-save later.
- **Date range inputs:** Rejected. Zoom/pan in-chart is simpler and matches existing UX.

## Consequences

- New callable `getHistoricalOptionsContract` added to `functions/src/options-contract.callables.ts`.
- New page and chart component under `src/app/features/rh-agent/pages/option-chart/`.
- New SignalStore and service for options contract viewer state.
- Shared contracts module at `shared/options-contract-contracts.ts` with `@options-contract/contracts` path alias in both `tsconfig.json` and `functions/tsconfig.json`.
- `CONTEXT.md` gains options-viewer domain terms.
- Future multi-contract support will require extending the store and chart to manage a list of contracts with per-contract visibility toggles.
- Future Black-Scholes candlestick interpolation will require IV, underlying OHLC, and mark as close — the data is already available from the contract series and underlying fetch.
- **Contract discovery (partnerListContractsV2).** SA is implementing a new endpoint `partnerListContractsV2` that returns available option contract IDs from GCS storage, filterable by expiration, strike, and type. This solves the current discovery gap where the viewer requires a known OCC contract ID. The full integration is stubbed and ready:
  - Shared types (`ListContractsV2Contract`, `PartnerListContractsV2Response`, `GetListContractsRequest`) in `shared/options-contract-contracts.ts`
  - Backend proxy `callPartnerListContractsV2` in `functions/src/options-contract-proxy.ts` with URL/audience constants
  - Callable `listOptionsContracts` in `functions/src/options-contract.callables.ts`
  - Frontend `listContracts$()` method in `options-contract.service.ts`
  - Once SA deploys, the contract length selector's `resolveContractIdByLength` workaround (which fetches the full raw chain and filters) can be replaced with a direct `partnerListContractsV2` call for precise contract ID lookup.
  - **Deprecated code scheduled for removal:** `resolveContractIdByLength`, `targetDaysFromLength`, and `parseTimeUntilExpiration` in `functions/src/options-contract-proxy.ts` are marked `@deprecated` and will be deleted once `partnerListContractsV2` is broken in and the UI uses `listContracts$()`. The `length` parameter on `callPartnerHistoricalOptionsContractV2`, `GetHistoricalOptionsContractRequest`, and `getHistoricalOptionsContract$()` exists solely to trigger the workaround and will be removed at the same time.
- **Partner proxy refactoring.** The original `functions/src/partner-proxy.ts` (838 lines) was decomposed into three focused files:
  - `functions/src/partner-infrastructure.ts` — shared plumbing (`PARTNER_AUDIENCE`, `CALLER_SA`, `PartnerHttpError`, `PartnerInterval`, `generateIdTokenWithEmail`, `fetchWithRetry`)
  - `functions/src/options-contract-proxy.ts` — options domain proxy functions (`callPartnerHistoricalOptions`, `callPartnerHistoricalOptionsContractV2`, `callPartnerListContractsV2`, deprecated `resolveContractIdByLength` helpers) with options-specific URL/audience constants
  - `functions/src/partner-proxy.ts` — general partner endpoints (`callPartnerTimeSeries`, `callPartnerMarketHolidays`, `callPartnerIntradaySnapshotV2`, `callPartnerCompanyOverview`, `callPartnerTrackedSymbols`, `partnerProxyTest`, `getTrackedSymbols`) with general URL/audience constants
  - Each domain's constants are colocated with its proxy logic. `PartnerInterval` is re-exported from `partner-proxy.ts` for backward compatibility with `webhooks-config.ts` and `symbol-fetch.ts`.

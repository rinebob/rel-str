# ADR-002: Options Contract Viewer Dashboard

## Status

Accepted

## Context

We need a viewer dashboard to request a historical options contract by OCC ID, inspect the returned time-series data, and plot it on a chart alongside the underlying price. The primary motivation is validating Savant Partner API historical options data (especially 2026 gaps), with research overlays as a follow-on. A future requirement is Black-Scholes candlestick interpolation using IV and underlying OHLC to synthesize option OHLC bars.

## Decisions

- **Dedicated chart component.** A new `options-contract-chart` Syncfusion component is built separately from `app-flex-chart`. The options data model (daily observations with mark/bid/ask/Greeks, no OHLC) is different enough from equity bars that extending flex-chart would add complexity to a component already tuned for equities and indicators. The dedicated chart reuses the same Syncfusion services (zoom, pan, scrollbar, legend) for consistent UX. The X-axis uses a **category axis** (indexed by observation position), not a date axis — this avoids weekend/holiday gaps in the time series, matching the flex-chart approach.
- **Backend callable.** A new `getHistoricalOptionsContract` callable in `functions/src/partner-proxy.ts` wraps the existing `callPartnerHistoricalOptionsContractV2` helper. No caching — live fetch every request so we can spot SA data issues directly. Auth follows the same pattern as existing callables (Firebase Auth inherited via `onCall`).
- **Single-contract milestone first.** Milestone 1 supports one OCC ID input, fetch, and display. Multi-contract overlay (multiple marks on the main pane, per-contract toggles in lower panes) is a follow-on.
- **Underlying overlay.** When a contract loads, underlying daily bars are auto-fetched via `RsBarsService.getDailyBars$()` for the contract's date range. The underlying `close` renders as a faint line on the main pane with a right Y-axis. User can toggle it off.
- **Chart panes.** Main pane: option `mark` (primary), `bid`/`ask` (faint bounds), underlying `close` (toggleable, right axis). Lower-1: IV. Lower-2: delta + gamma (theta/vega off by default). Lower-3: volume columns + OI line (off by default). No technical indicators — just raw series from the data.
- **Full lifetime fetch, zoom/pan in-chart.** No date range inputs. The full contract series is fetched and the user zooms/pans within the chart, matching the flex-chart UX.
- **FE state.** NgRx SignalStore + service. Component is UI-only.
- **Route.** `/rh-agent/option-chart`, lazy-loaded under the RH Agent feature.
- **Header metadata.** Contract ID, symbol, type, strike, expiration, DTE, observation count, data quality flags (gaps, NaN IV).

## Considered Options

- **Extending `app-flex-chart`:** Rejected. Flex-chart is category-indexed by `PriceBar` OHLC and tightly coupled to the equity indicator model. Options observations are flat daily data points with no OHLC. Adapting flex-chart would complicate an equity-focused component.
- **Caching contract series:** Rejected for milestone 1. Caching would mask the exact SA data gaps we're validating. Can add snapshot-save later.
- **Date range inputs:** Rejected. Zoom/pan in-chart is simpler and matches existing UX.

## Consequences

- New callable `getHistoricalOptionsContract` added to `functions/src/partner-proxy.ts`.
- New page and chart component under `src/app/features/rh-agent/pages/option-chart/`.
- New SignalStore and service for options contract viewer state.
- `CONTEXT.md` gains options-viewer domain terms.
- Future multi-contract support will require extending the store and chart to manage a list of contracts with per-contract visibility toggles.
- Future Black-Scholes candlestick interpolation will require IV, underlying OHLC, and mark as close — the data is already available from the contract series and underlying fetch.

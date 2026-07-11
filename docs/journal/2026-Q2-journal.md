# Q2 2026 Journal

## Current Implementation Efforts (Q2)

- RS-BE-FEAT-RHAGENT-2606 – RH Agent: PDR-triggered daily scan architecture
  - Status: in-progress
  - Last change: 2026-06-18
  - Notes: Core PDR-triggered architecture implemented and deployed. PDR Pub/Sub trigger (`rhAgentPdrTrigger`), shared helpers (`rh-agent-shared.ts`), Cloud Tasks worker (`rhAgentProcessSymbol`), manual run callable (`rhAgentManualRun`), and full-universe symbol seeding (`seedAllSymbolsFromPartner`) are all live. Full ~760-symbol universe seeded to `rh-agent-symbols` collection. Next: verify end-to-end PDR flow, implement historical backtest, and add opportunity approval UI.

## Entries

### 2026-06-13

- RS-BE-FEAT-RHAGENT-2606
  - First successful test run: 20 symbols processed via `rhAgentTriggerDaily` with `?date=2026-06-13`. All symbols hit `rs-symbol-cache`, RSI calculations verified (e.g., AMZN 34.78, AAPL 44.05). No signals generated — June 13 was a flat day (no RSI < 30 AND price drop > 2% combo met).
  - Closest to signal: LLY (−2.39% drop, RSI 62.67 — not oversold).

### 2026-06-16

- RS-BE-FEAT-RHAGENT-2606
  - Implemented `rhAgentPdrTrigger` (Pub/Sub on `partner-data-ready`, `runType: "intraday-snapshot"`). Trigger fetches bulk intraday snapshot via `callPartnerIntradaySnapshotV2`, passes `IntradaySnapshot` data in each Cloud Tasks job payload so workers do not make per-symbol API calls.
  - Extracted shared utilities into `rh-agent-shared.ts`: `getMarketDate`, `getDeadlineISO`, `loadEnabledSymbols`, `createDailyRun`, `createJobAndEnqueue`. Both `rhAgentPdrTrigger` and `rhAgentManualRun` now delegate to this module. Run IDs: PDR runs = `marketDate`; manual runs = `{marketDate}_manual_{timestamp}`.
  - Added `seedAllSymbolsFromPartner` to `rh-agent-seed-admin.ts`: fetches the full active symbol universe from SavantAPI via `callPartnerTrackedSymbols` and bulk-writes to `rh-agent-symbols`.
  - Updated `callPartnerIntradaySnapshotV2` and `callPartnerTrackedSymbols` in `partner-proxy.ts`.
  - Updated `functions/src/index.ts` exports: `rhAgentPdrTrigger`, `seedAllSymbolsFromPartner` added.
  - Updated docs: `RH-AGENT-ARCH.md`, `RH_AGENT_PROGRESS.md`, `rh-agent-cloud-function/README.md` all reflect current architecture.
  - **Status**: in-progress (PDR trigger and shared helpers deployed; awaiting first live PDR intraday-snapshot message).

### 2026-06-18

- RS-BE-FEAT-RHAGENT-2606
  - Completed full symbol universe seed. Called `seedAllSymbolsFromPartner` to populate `rh-agent-symbols` collection with ~760 symbols from SavantAPI partner. Verified in Firestore: all symbols present with `enabled: true`, `source: 'partner-universe'`.
  - **Status**: full universe seeded, ready for end-to-end PDR flow verification.

### 2026-07-09

- RS-BE-FEAT-RHAGENT-2606 / SA intraday full bar
  - **Bug fix**: Intraday daily bars (today's candle) were missing from charts for D/W/M. Root cause: `rh-agent-worker.ts` only called `syncIntradayWmToSymbolData` on intraday runs, which refreshed W/M but never wrote today's daily bar to `symbol-data`. The charts read from Firestore so always showed the prior EOD bar.
  - **Fix**: Replaced `syncIntradayWmToSymbolData` with `syncSymbolToSymbolData(symbol, false)` (incremental). This fetches the last 14 daily bars + W/M from SA and writes them all to `symbol-data` in one call. SA's new full intraday OHLCV bar aggregation now lands in Firestore on every intraday run, giving the charts a real candle for today.
  - **Cleanup**: Removed `rh-agent-symbols` upsert from `syncSymbolToSymbolData`. It was a ~750-write no-op on every intraday run. Upsert moved to `symbol-data-symbol-added.ts` where it belongs (only fires on new-symbol onboarding). `syncSymbolToSymbolData` is now a pure data-sync function.
  - `intraday-wm-sync.ts` is now dead code — to be deleted in the `i*` fields cleanup PR.
  - Docs updated: `RS-BARS-STORAGE-2607-01`, `RH-AGENT-SYMBOL-ONBOARDING-2607-01`.

### 2026-07-10

- RS-FE-FEAT-FLEXCHART / Crosshair performance and cleanup
  - **Completed** the remaining FlexChart crosshair fixes from the third thermo-nuclear review:
    - Disabled Syncfusion built-in crosshair and draw custom vertical/horizontal lines via DOM + `requestAnimationFrame` outside Angular zone.
    - Throttled crosshair store/broadcast updates by bar index and rounded price.
    - Cached crosshair line and price-label DOM refs with `afterNextRender`.
    - `ChartSyncOverlayComponent` uses binary search over precomputed sorted timestamps and caches its own line elements.
    - Crosshair now shows across the full chart height (including lower indicator panes); price label only follows in the primary Y-axis.
    - Horizontal crosshair propagates to sibling charts even when the cursor is in lower panes by falling back to the hovered bar's close price.
    - Moved lifecycle coordination and initial zoom logic into `ChartLifecycleFacade`; component reads axis state from the facade instead of the chart object.
    - Reset `hovered` in `ChartViewportStore.resetViewport()`.
  - **Cleanup from latest review pass**:
    - Fixed stale `priceLabelEl` cache by rendering the label unconditionally and hiding it with CSS by default.
    - Removed dead `TooltipService`, `CrosshairService`, tooltip config, and `(tooltipRender)` handler.
    - Removed unused `#dateLabel`, `#priceLabel`, `#hoverVLine`, `#hoverHLine` template refs.
    - Removed dead `ChartCrosshairCoordinator` service and broadcast calls.
    - Throttled `ResizeObserver` callback with `requestAnimationFrame`.
    - Converted numeric string attributes (`opacity`, `width`) to property bindings.
    - Removed redundant `crosshairTooltip: { enable: false }` from `primaryXAxis`.
    - Fixed single-bar `applyInitialZoom` edge case.
  - **Docs updated**: `FLEX-CHART-ARCH-2607-01_flex-chart-component-decomposition-plan.md`.
  - **Verification**: `npx ng build --configuration development --project rel-str` passes.

## End-of-Quarter Summary

*(to be filled at end of Q2)*

## Upcoming / New Efforts

- RS-BE-FEAT-RHAGENT-2606 (continued): PDR end-to-end verification, historical backtest (`rhAgentBacktestRange`), opportunity approval UI, Robinhood OAuth integration.

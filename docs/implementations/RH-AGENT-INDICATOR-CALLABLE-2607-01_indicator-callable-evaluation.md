# RH-AGENT-INDICATOR-CALLABLE-2607-01 — Exclusive Use of Backend Indicator Callable

## Current state

### RH Agent signal detail chart — backend-only ✅

`src/app/features/rh-agent/stores/indicator-series.store.ts` loads indicator series exclusively via the backend callable `rhAgentGetSymbolIndicatorSeries`.

`src/app/features/rh-agent/utils/rh-agent-chart-indicators.ts` provides `injectCallableIndicatorData`, whose comment explicitly states:

> Always overwrites the config data with the backend response, even when empty, so the flex chart never silently falls back to its inline calculator.

This is consumed by:
- `signal-detail.component.ts`
- `quick-charts.component.ts`

These components do not compute ST zone, trend strength, or trend bands from raw bars.

### Remaining frontend computation — chart annotations only

The same utility file still uses local calculators for derived **visual markers**, not the main indicator series:
- `computeSignalDotsData` — signal markers on the trend-strength histogram.
- `computeUptickDotsV1` / `computeUptickDotsV2` — ST Trend Rider uptick dots.
- `computeHtfZoneV2` / `computeHtfWindowData` — higher-timeframe zone window dots.

These take the backend indicator data or raw bars as input and produce dot/marker overlays. They are not a fallback for missing backend data.

### Standalone signal-history page — still computes locally ⚠️

`src/app/features/rh-agent/pages/signal-history/signal-history.component.ts` is a separate standalone page that:
- Fetches D/W/M bars via `HeatmapChartDataService`.
- Computes ST zone and trend strength locally.
- Detects signals with `detectZoneSignals` and `detectTrendStrengthSignals`.

This page does not use the RH Agent backend callable or the RH Agent data model.

## Evaluation

| Area | Uses backend callable | Notes |
|------|----------------------|-------|
| RH Agent signal detail chart | ✅ Yes | No fallback to local indicator calculators. |
| RH Agent quick-charts | ✅ Yes | Same backend-only path. |
| RH Agent chart annotations | ⚠️ Partial | Local calculators for signal/uptick dots derived from backend data. |
| Standalone signal-history page | ❌ No | Separate feature using `HeatmapChartDataService` and local computation. |

## Decision

The RH Agent chart components have already achieved **exclusive backend indicator computation**. No further migration is required for the RH Agent dashboard itself.

The standalone `signal-history` page is intentionally a separate exploratory tool and is out of scope for the RH Agent backend-only mandate. If it should also use the backend callable, that becomes a separate frontend task, not a RH Agent architecture decision.

## Recommendation / next-step task

T24 evaluation goal is met for the RH Agent chart components: the main indicator series and signal markers already come from the backend callable.

The backend now pre-computes all chart annotations: ST Trend Rider uptick dot markers (price with ATR offset), trend-strength signal dots (DI hist with offset), and higher-timeframe zone windows (weekly-on-daily, monthly-on-weekly). The frontend no longer computes any of these locally. `signal-detail` and `quick-charts` consume the backend-generated `dotMarkers` and `htfWindows` directly. The frontend-only helper functions for computing dots and HTF windows (`computeUptickDotsV1`, `computeUptickDotsV2`, `computeSignalDotsData`, `computeHtfZoneV2`, `computeHtfWindowData`, `convertTrendStrengthSignals`) were removed because the backend is now the single source of truth for all chart annotations.

Fix: the callable's `filterResponse` in `rh-agent-indicator-series.ts` was stripping the `dotMarkers` and `htfWindows` fields before returning the response. It now preserves them when the corresponding strategies/indicators are requested.

Decision: backend annotation generation is now the active path. The comparison showed that the render time is dominated by the chart itself, not the annotation conversion, so the backend path is preferred for architectural consistency.

Optional follow-up (not part of this remediation): migrate the standalone `signal-history` page to use `rhAgentGetSymbolIndicatorSeries` if product wants a single source of truth for all signal history views.

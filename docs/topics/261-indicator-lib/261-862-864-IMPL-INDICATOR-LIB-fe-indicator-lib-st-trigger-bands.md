# Implementation Plan — ST Trigger Bands (FE)

**Topic:** Trading Indicator Library  
**Topic Slug:** indicator-lib  
**Thread:** Implement ST Trigger Bands in ST Indicator Library  
**Thread Slug:** st-trigger-bands  
**Issue:** #864  
**Thread Parent:** #862  
**Topic Parent:** #261  
**Domain:** INDICATOR-LIB  
**Type:** Implementation Plan  
**Area:** FE  
**Status:** Draft  
**Created:** 2026-10-07  
**Last Updated:** 2026-10-07  

## Overview

Plot the Trigger Bands (PRD #863) from the indicator-series callable response: coloured step-line bands plus pullback and breakout dots on the price overlay, opt-in from the ST indicator menu, on the daily and weekly charts. The FE has no calculator; all numbers come from the BE (see the BE IMPL plan).

## Modules

### 1. Chart indicator + registry

- `StIndicator.ST_TRIGGER_BANDS` in `src/app/features/shared/components/flex-chart/flex-chart.types.ts`.
- `ST_TRIGGER_BANDS_INDICATOR` (`IndicatorOption`) in a new `indicators/st-trigger-bands.indicator.ts`: overlay pane, price axis, no params (length and body are fixed).
- Registry entries in `indicators/indicator-registry.ts` (option list, series-type map; there is no local calculator, so no calculator entry), following `ST_STD_DEV_LINES_INDICATOR`.
- Not added to `DEFAULT_ST_INDICATORS`.

### 2. Callable data conversion

In `src/app/features/savant-trader/utils/chart-indicators/indicator-converters.ts`:

- `convertIntervalIndicators` returns trigger-band chart data from `intervalData.indicators.triggerBands`, keyed to bar indexes via the date-to-index map already used by `trendBandsToChartData`.
- `injectCallableIndicatorData` handles `StIndicator.ST_TRIGGER_BANDS` (alongside `TREND_BANDS`), and `triggerBands` joins the continuous-series staleness warning list.
- Rendering approach: split each band into contiguous colour runs by state (neutral / pullback / breakout) and draw them as line segments, mirroring how the existing bespoke multi-segment series (`zigZagSeries`, `stdDevLineSeries`) are built in `ChartDataAdapter` (`chart-data-adapter.service.ts`). The task confirms against that code whether the existing flat `{x,y}` indicator contract suffices or a bespoke series is needed.
- Colours: pullback and breakout state colours are defined in `shared/flex-chart-indicator-visuals.ts` (alias `@flex-chart/indicator-visuals`) so they stay a single source of truth; defaults avoid blue and yellow collisions with other ST indicators and avoid red/green pairs (colour-vision accessibility).

### 3. Dots

In `signal-marker-converters.ts`: `convertTriggerBandsDotMarkers(intervalData)` maps `dotMarkers.triggerBands` to `ChartScatterPoint[]`, with long/short colours and distinct styling for breakout versus pullback dots (selected by `signalType`). Wire it through `extras-signals.ts` and the extras consumers used by `quick-charts`, `signal-detail` and the gallery card chart, the same way the zone dots are. Dots are part of the single Trigger Bands toggle (one menu entry produces the bands config and the dots config).

### 4. Requesting the data (opt-in)

- When the Trigger Bands indicator is enabled, the chart's indicator-series request must include `IndicatorFamily.TRIGGER_BANDS`. The task verifies how `IndicatorSeriesStore` (`stores/indicator-series.store.ts`) keys and merges cached responses by filters, and ensures that adding the family neither refetches needlessly nor breaks the default cached response.
- The gallery card chart builds its config from the store's callable data; it gets bands only if the user has the indicator enabled there (the task decides whether gallery cards, which currently force a fixed set, are in scope; default: not).

### 5. Menu

Add the toggle to the ST indicator menu (`signal-detail` non-default list, as for `ST_STD_DEV_LINES`) and wherever the opt-in ST indicators are enumerated (`quick-charts`).

## Cross-Area Boundaries

- Depends on the BE tasks (contract, callable, dots) being deployed. Until then, the indicator renders nothing (empty `triggerBands`), which must not error.
- Types `TriggerBandsPoint` and `DotMarker.version` live in `common/indicator.types.ts` and are changed in the BE contract task, not here.

## Risks

- **Per-state colour runs.** Splitting lines by state multiplies series; the task keeps the segment count bounded (one run per contiguous state, two bands) and checks flat-page performance (see the gallery perf notes in `gallery-card-chart.component.ts`).
- **Dot overlap.** A pullback and a breakout dot can fall on the same bar; styling must keep both readable.
- **Request/cache behaviour** as described above.
- **Screenshot capture.** The server-side screenshot assembler maps its own indicator set (`functions/src/screenshot-capture/chart-series-mappers.ts`); parity is out of scope and should be noted in the task if screenshots later need it.

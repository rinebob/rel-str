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
**Status:** Complete  
**Created:** 2026-10-07  
**Last Updated:** 2026-10-08  

## Overview

Plot the Trigger Bands (PRD #863) from the indicator-series callable response: coloured step-line bands plus pullback and breakout dots on the price overlay, opt-in from the ST indicator menu, on the daily and weekly charts. The FE has no calculator; all numbers come from the BE (see the BE IMPL plan).

## Modules

### 1. Chart indicator + registry

- `StIndicator.ST_TRIGGER_BANDS` in `src/app/features/shared/components/flex-chart/flex-chart.types.ts`.
- `ST_TRIGGER_BANDS_INDICATOR` (`IndicatorOption`) in a new `indicators/st-trigger-bands.indicator.ts`: overlay pane, price axis, no params (length and body are fixed).
- Registry entries in `indicators/indicator-registry.ts`: export and series-type map (there is no local calculator, so no calculator entry), following `ST_STD_DEV_LINES_INDICATOR`. **Implemented in #879 with one deliberate deferral:** the option-list entry (`ST_INDICATOR_OPTIONS`, which feeds the menus in signal-detail, the sandbox and `base-indicators`) is added with the toggle and request wiring in #880, so no dead toggle ships between the two tasks.
- Not added to `DEFAULT_ST_INDICATORS`.
- The never-used placeholder `st-trigger-band.indicator.ts` (singular) and `StIndicator.TRIGGER_BAND` were removed; `StIndicator.ST_TRIGGER_BANDS = 'st-trigger-bands'` replaces them.

### 2. Callable data conversion

In `src/app/features/savant-trader/utils/chart-indicators/indicator-converters.ts`:

- `convertIntervalIndicators` returns trigger-band chart data from `intervalData.indicators.triggerBands`, keyed to bar indexes via the date-to-index map already used by `trendBandsToChartData`.
- `injectCallableIndicatorData` handles `StIndicator.ST_TRIGGER_BANDS` (alongside `TREND_BANDS`), and `triggerBands` joins the continuous-series staleness warning list.
- Rendering (revised after sandbox UAT — the original band x state StepLine split looked like disjointed segments): a bespoke `triggerBandSeries` in `ChartDataAdapter`, like `zigZagSeries` / `stdDevLineSeries`, because the flat `{x,y}` indicator contract cannot carry per-state lines. The callable series rides on the config as `IndicatorConfig.triggerBandData` (same pattern as `bandData`). The pure builder `computeTriggerBandLines` (in `st-trigger-bands.indicator.ts`) produces exactly TWO `MultiColoredLine` series — one per band — dense over the bar range with `null` warm-up gaps. Each point carries `color` (`pointColorMapping`); Syncfusion colours a segment by its LEFT endpoint, so each point holds the next bar's state colour, reproducing TradingView's right-endpoint colouring. One uniform width (`ST_TRIGGER_BANDS_LINE_WIDTH`). `MultiColoredLineSeriesService` is provided in `flex-chart.component.ts` (it replaced `StepLineSeriesService` — Trigger Bands was its only consumer), and the generic main-pane line branch excludes `ST_TRIGGER_BANDS`.
- Colours (revised to the Pine palette after sandbox UAT): `ST_TRIGGER_BANDS_COLORS` in `shared/flex-chart-indicator-visuals.ts` (alias `@flex-chart/indicator-visuals`). `ST_TRIGGER_BANDS_COLORS` is per-band: neutral band `#ffffff` (white, as the Pine plot); upper = long side — pullback `#ffeb3b` (yellow), breakout `#2962ff` (blue); lower = short side — pullback `#2962ff`, breakout `#ffeb3b`. A pullback borrows the opposite side's colour so the warning reads against the trend; a breakout keeps its own. Uniform width (`ST_TRIGGER_BANDS_LINE_WIDTH` = 2 — the per-state widths were removed: variable stroke weight read as disjointed segments). Upper-band state comes from the long flags, lower-band state from the short flags; the per-bar pullback flag wins over the breakout flag (the two never coincide). Caveat: neutral white suits the dark theme; the light appearance needs a remap before this renders there.

### 3. Dots

In `signal-marker-converters.ts`: `convertTriggerBandsDotMarkers(intervalData)` maps `dotMarkers.triggerBands` to `ChartScatterPoint[]`, with long/short colours and distinct styling for breakout versus pullback dots (selected by `signalType`). Wire it through `extras-signals.ts` and the extras consumers used by `quick-charts`, `signal-detail` and the gallery card chart, the same way the zone dots are. Dots are part of the single Trigger Bands toggle (one menu entry produces the bands config and the dots config).

### 4. Requesting the data (opt-in)

- When the Trigger Bands indicator is enabled, the chart's indicator-series request must include `IndicatorFamily.TRIGGER_BANDS`. The task verifies how `IndicatorSeriesStore` (`stores/indicator-series.store.ts`) keys and merges cached responses by filters, and ensures that adding the family neither refetches needlessly nor breaks the default cached response.
- The gallery card chart builds its config from the store's callable data; it gets bands only if the user has the indicator enabled there (the task decides whether gallery cards, which currently force a fixed set, are in scope; default: not).

### 5. Menu

Add the toggle to the ST indicator menu (`signal-detail` non-default list, as for `ST_STD_DEV_LINES`) and wherever the opt-in ST indicators are enumerated (`quick-charts`).

### As built in #880

**Dev-first workflow.** Per the user's direction, dev features are built in the `dev/flex-chart` sandbox in isolation and migrated to prod surfaces (signal-detail, quick-charts, gallery) only when stable. An earlier draft wired the toggle into signal-detail directly; that wiring was reverted and moved into the sandbox. flex-chart gained a dev mode to enforce the boundary:

- **Render gate:** `FlexChartConfig.dev?: boolean`. `FlexChartComponent.effectiveConfig` — the single funnel into the adapter, lifecycle facade and axis labels — strips any `IndicatorConfig` whose type is in `DEV_INDICATOR_TYPES` (`st-trigger-bands`, `st-trigger-bands-dots`) unless `dev: true`. Prod surfaces can't draw a dev indicator even if handed its config.
- **Menu gate:** `ST_DEV_INDICATOR_OPTIONS` (bands only — the dots are a companion overlay, not a menu item) sits beside `ST_INDICATOR_OPTIONS`; prod menus use the prod list, the sandbox uses `[...ST_INDICATOR_OPTIONS, ...ST_DEV_INDICATOR_OPTIONS]`.
- **Promotion path:** move the option into a prod menu list, drop the types from `DEV_INDICATOR_TYPES`, wire the prod caller's request/merge.

**Sandbox wiring** (`pages/flex-chart-sandbox`):

- **Toggle:** Trigger Bands appears in the indicator picker, off by default, disabled in synthetic mode (generated bars have no callable response).
- **Request:** a separate lean call, `intervals [daily, weekly]`, `indicators [TRIGGER_BANDS]`, `strategies [TRIGGER_BANDS]` (the strategy value stops the backend falling back to its default strategy set; it yields no strategy output), cached under its own `IndicatorSeriesStore` key via `loadIfNeeded`, issued from an effect only while the toggle is on in real mode, wrapped in `untracked`. The default response is never refetched or invalidated. ~850 KiB uncompressed on AAPL D+W; wire size unmeasured. Constants live next to `DEFAULT_CHART_*` in `chart.store.ts`. Monthly is not requested — the M toggle draws no bands.
- **Merging:** `injectTriggerBandsData` sets the series on the Trigger Bands config only; running the full `injectCallableIndicatorData` over the lean response would blank the other configs' data.
- **Dots:** `convertTriggerBandsDotMarkers` colours by `signalType` through `ST_TRIGGER_BANDS_DOT_COLORS` — the Pine palette (long breakout blue, short breakout yellow, long pullback yellow, short pullback blue; two hues, the dot's position carries the side) — and drops unknown types. They ride on a companion scatter overlay (`ST_TRIGGER_BANDS_DOTS_INDICATOR`) added through `ChartExtras.triggerBandsDots`. Dots have their own sandbox-only "TB dots" checkbox (default **off**, so band transitions can be inspected clean; requires the indicator enabled + real mode). The backend emits a pullback dot on every armed-state bar (the Pine's `longPullbackState` circle plot — the warning stays lit until the breakout) plus one per breakout.
- **Not wired through `extras-signals.ts`:** these dots come from the opt-in response, not the default one that file's signals read.
- **Prod migration, still to do when stable:** the signal-detail `ST_EXTRA_INDICATOR_OPTIONS` entry, per-interval offering and `OPT_IN_IDS`, the same lean request + merge (the code is written and was verified — it moved to the sandbox unchanged in shape), and a decision on quick-charts/gallery.

## Cross-Area Boundaries

- Depends on the BE tasks (contract, callable, dots) being deployed. Until then, the indicator renders nothing (empty `triggerBands`), which must not error.
- Types `TriggerBandsPoint` and `DotMarker.version` live in `common/indicator.types.ts` and are changed in the BE contract task, not here.

## Risks

- **Per-state colour runs.** Splitting lines by state multiplies series; the task keeps the segment count bounded (one run per contiguous state, two bands) and checks flat-page performance (see the gallery perf notes in `gallery-card-chart.component.ts`).
- **Dot overlap.** A pullback and a breakout dot can fall on the same bar; styling must keep both readable.
- **Request/cache behaviour** as described above.
- **Screenshot capture.** The server-side screenshot assembler maps its own indicator set (`functions/src/screenshot-capture/chart-series-mappers.ts`); parity is out of scope and should be noted in the task if screenshots later need it.

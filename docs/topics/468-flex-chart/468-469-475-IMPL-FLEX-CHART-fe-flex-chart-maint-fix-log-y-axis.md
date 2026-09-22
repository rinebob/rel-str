**Topic:** Flex Chart Maintenance  
**Topic Slug:** flex-chart-maint  
**Thread:** Fix Log Scale Y-Axis  
**Thread Slug:** fix-log-y-axis  
**Issue:** #475  
**Thread Parent:** #469  
**Topic Parent:** #468  
**Domain:** FLEX-CHART  
**Type:** Implementation Plan  
**Status:** Approved  
**Created:** 2026-09-21  
**Last Updated:** 2026-09-22  

# Implementation Plan: Fix Log Scale Y-Axis (FE)

## Approach

**Manual log transform on a `Double` axis.** Syncfusion's built-in `Logarithmic` valueType is abandoned: it snaps labels to powers of 10 and does not honor arbitrary min/max — a prior session established the `zoomFactor`/`zoomPosition` workaround is a dead end. Instead, log scale is implemented by transforming all primary-pane series values to `log10(price)` before binding, driving the axis with ordinary `minimum`/`maximum` in log space (the exact mechanism that already works for linear), and inverting the transform (`10^v`) everywhere a value is shown to the user.

All mechanism work is proved inside a purpose-built sandbox page before any consumer is touched. Rollout is out of scope for this Thread.

## Architecture

### Data flow (log mode)

```mermaid
flowchart LR
    Bars[PriceBar[] + indicator series<br/>price units] --> T["transform(v) = log10(clamp(v))"]
    T --> DS[Bound dataSources<br/>log units]
    DS --> SF[Syncfusion ejs-chart<br/>Double axis]
    VP[computeViewport<br/>visible bars] -->|"min/max in log units"| SF
    SF -->|"log value"| INV["invert(v) = 10^v"]
    INV --> UI[axis labels, tooltips,<br/>crosshair, debug readout]
```

### Transform seam — extension to `ScaleStrategy`

`ScaleStrategy` (`strategies/scale-strategy.types.ts`) already owns `computeViewport`, `formatLabel`, `priceFromPixel`, `pixelFromPrice`. The manual approach adds two members:

- `transformValue(price: number): number` — `log10(max(price, FLOOR))`; identity for linear.
- `invertValue(v: number): number` — `10^v`; identity for linear.

`LogarithmicScaleStrategy` is rewritten: `valueType` becomes `'Double'`, `computeViewport` returns min/max in log units over the visible bars (same padding semantics as linear, applied in log space), and `priceFromPixel`/`pixelFromPrice` continue to translate between pixel position and *real price* (i.e., they invert internally so callers keep working in prices).

### Transform coverage — every primary-pane series

All series bound to the primary axis must be transformed before binding. From `flex-chart.component.html`, on the primary pane:

| Series kind | Fields to transform |
|---|---|
| Price candles (`categoryBars`) | `high`, `low`, `open`, `close` |
| ST Trend Bands (Candle) | `high`, `low`, `open`, `close` |
| Std-dev fill zones (RangeArea) | `high`, `low` |
| Std-dev lines, ZigZag lines/projected (Line) | `y` |
| ZigZag trigger dots, signal dots, main-pane scatter (Scatter) | `y` |
| Main-pane line indicators (EMA, etc.) | `y` |

Lower panes (RSI/MACD/etc. via `yAxisName`) are **not** transformed — they keep linear axes.

The transform is applied at the series-producing computed signals in `flex-chart.component.ts` (each `*Series()` computed), gated on `config.logScale`, so the template stays unchanged and the strategy remains the single source of the mapping.

### Display inversion — every place a log-unit value surfaces

- `axisLabelRender` handler: rewrite each label through `invertValue` → `formatLabel` (real price text).
- Tooltips: Syncfusion shows raw bound values; intercept via `tooltipRender` (or equivalent) and invert back to prices.
- Crosshair price label + sync overlay: these read pixel→price through `priceFromPixel` — already strategy-routed; verify they keep emitting real prices.
- `chartState.yAxis.visibleRange` will be in log units — audit consumers (chart-sync-overlay, crosshair handlers) and invert where they interpret it as price.
- Debug readout (sandbox): display both the computed log-space viewport and its inverted price equivalents next to visible-range high/low.

### Tick/gridline placement

Syncfusion `Double` axes support a uniform `interval` and `axisLabelRender` per-label rewrite, but not arbitrary tick positions. Strategy: compute the desired log-sensible tick prices for the visible range (1-2-5-style steps), then in `axisLabelRender` keep/format labels near target ticks and blank the rest. Minor imperfection is acceptable per PRD; extents and geometry are the hard requirement.

### Sandbox page

- New auth-guarded route added to `AppRoutes` + `core-routes.ts` (e.g. `flex-chart-sandbox`), no nav-menu entry.
- Hosts one `FlexChartComponent`; symbol input loads real bars + indicator overlays via `IndicatorSeriesStore` (same callable path as quick-charts).
- Synthetic-data toggle: deterministic generated OHLC presets — wide-ratio range, low-priced, and a series containing 0/negative values.
- Linear/log toggle wired to `config.logScale`; debug readout showing axis extents vs visible-range high/low in both log and price units.

## Risks

- **Transform coverage misses a series** → misaligned overlay. Mitigation: the inventory above is enumerated from the template; the sandbox exercises overlays (trend bands, dots) specifically.
- **`chartState.yAxis.visibleRange` consumers** may assume price units — must audit; silent wrongness possible if missed.
- **Tooltip inversion** — Syncfusion tooltip pipeline may need `tooltipRender` interception; unproven until sandbox.
- **dataBind/refresh timing races** already exist in the facade (`getVisibleSeries` crash suppression); transform changes datum magnitudes, which could interact with those races — watch for it.

## Phases & Tasks

- **Phase 1 — Sandbox shell:** tasks 1–2. Demoable: page renders a real-data chart with toggle + readout.
- **Phase 2 — Log transform core:** tasks 3–4. Demoable: correct log geometry + correct extents; real prices everywhere.
- **Phase 3 — Ticks & edge cases:** tasks 5–6. Demoable: genuine log look; ≤0 and wide-ratio cases verified.

| # | Task | Blocked by |
|---|---|---|
| 1 | Sandbox shell: route + page + flex-chart host + symbol input + log toggle + debug readout | — |
| 2 | Synthetic data mode: generator + presets (wide ratio, low price, ≤0) | 1 |
| 3 | Transform seam + `LogarithmicScaleStrategy` rewrite (Double axis, log-space viewport) + transform all primary-pane series | 1 |
| 4 | Display inversion: axis labels, tooltips, crosshair, chartState consumers show real prices | 3 |
| 5 | Log-sensible tick/gridline placement | 4 |
| 6 | Edge cases: ≤0 clamp, empty data, extreme ratios; PRD acceptance pass in sandbox | 4 |

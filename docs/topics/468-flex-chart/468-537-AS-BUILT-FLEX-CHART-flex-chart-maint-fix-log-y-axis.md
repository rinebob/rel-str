# AS-BUILT — Fix Log Scale Y-Axis

**Topic:** Flex Chart Maintenance  
**Topic Slug:** flex-chart-maint  
**Thread:** Fix Log Scale Y-Axis  
**Thread Slug:** fix-log-y-axis  
**Issue:** #537  
**Thread Parent:** #469  
**Topic Parent:** #468  
**Domain:** FLEX-CHART  
**Type:** AS-BUILT  
**Status:** Complete  
**Created:** 2026-09-22  
**Last Updated:** 2026-09-22  

## What was built

A manual logarithmic Y-axis for `FlexChartComponent`, proven in an
auth-guarded sandbox page before any rollout to real chart consumers.

### The core problem

Syncfusion's native `valueType: 'Logarithmic'` axis could not fit the
Y-axis to the visible range's data high/low — its log axis works in
absolute value space, so zoomed views showed a fixed decade ladder that
ignored the visible window. The charts were effectively useless in log
mode.

### Architecture

- **Transform seam** — `strategies/log-transform.ts` holds the pure
  mapping: `toLogAxis` (log10 with `LOG_AXIS_FLOOR = 0.001` clamp),
  `fromLogAxis`, `nicePriceStep`, `nicePriceTicks`. One mapping shared by
  the scale strategy, the data adapter, and the lifecycle facade.
- **Strategy** — `LogarithmicScaleStrategy` computes the viewport in log
  units (pad via `PAD_FACTOR`/`FLAT_PAD`), inverts axis values for labels,
  and maps pixels↔prices so equal % moves render as equal pixels.
- **Data adapter** — `ChartDataAdapter` transforms main-pane/overlay
  series (candles, zigzag, std-dev lines, trend bands) into log units;
  lower-pane indicator series stay in native units.
- **Display inversion** — `ChartAxisLabelService` blanks generated labels
  and draws gutter labels at exact tick positions; `tooltipRender` and the
  crosshair invert log units back to real prices.
- **Ticks** — `nicePriceTicks` picks a linear 1-2-5 step for sub-decade
  ranges and a decade grid (1-2-5 per decade, or powers of 10 past 3
  decades) for multi-decade ranges. StripLines + gutter labels read the
  same tick array — single source.
- **Sandbox** — `pages/flex-chart-sandbox/` hosts a FlexChart with real
  data (ChartStore) or deterministic synthetic presets (`wide-ratio`,
  `penny`, `non-positive`, flat, single-bar, etc.), a D/W/M switcher,
  linear/log toggle, ST indicator checkboxes, and a debug readout showing
  viewport vs axis vs visible hi/lo vs computed ticks.

### Deviations from the original design

- Syncfusion's built-in `Logarithmic` axis was rejected — documented in
  `log-transform.ts` header and the impl plan; the axis stays `Double`
  and the log-ness lives entirely in the transform seam.
- Rapid linear↔log toggling during `dataBind` needed explicit race
  handling (try/catch around `dataBind`, scale-flip re-snap effect,
  `resetViewport` deliberately not clearing tick state).
- Review-gate fixes: `formatPrice` is now magnitude-aware (sub-$1 labels
  render as decimals), and `nicePriceTicks` never emits non-positive
  ticks when a floor-pinned viewport hands it `priceLo ≤ 0`.

### Rollout status

Sandbox only — by design. Real chart consumers (quick-charts, signal
detail, etc.) still run the pre-existing behavior; rollout is a future
Thread under Topic #468 once the sandbox pass is fully signed off.

### Verification

- 162 flex-chart tests green (13 suites); full suite 1721 green at ship.
- Manual QA checklist lives on issue #537.

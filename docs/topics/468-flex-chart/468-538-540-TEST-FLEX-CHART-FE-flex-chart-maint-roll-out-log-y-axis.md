# TEST — Roll log y-axis scale to all FlexChart consumers (FE)

**Topic:** Flex Chart Maintenance  
**Topic Slug:** flex-chart-maint  
**Thread:** Roll log y-axis scale to all consumers  
**Thread Slug:** roll-out-log-y-axis  
**Issue:** #540  
**Thread Parent:** #538  
**Topic Parent:** #468  
**Domain:** FLEX-CHART  
**Type:** TEST  
**Area:** FE  
**Status:** Complete  
**Created:** 2026-09-23  
**Last Updated:** 2026-09-23  

## E2E / manual journeys

### J1 — Default log on for every consumer
1. Open each surface (quick-charts, swing-analysis, signal-detail) with a
   symbol that has a wide price range (e.g. SPY vs a penny stock).
2. Verify the Y-axis is logarithmic: equal % moves occupy equal vertical
   pixels and the gutter labels use the decade-aware ladder.
3. Verify no NaN axis or crash for sub-$1 symbols.

### J2 — Toggle to linear
1. Click the "Log Y-axis" pill/toolbar control to set it to No.
2. Verify the chart re-renders as linear: equal dollar moves occupy
   equal vertical pixels.
3. Verify tooltips, crosshairs, and overlays still show real prices.

### J3 — Per-page toggle does not leak across pages
1. Toggle linear on quick-charts.
2. Navigate to swing-analysis — it should still open in log mode.
3. Reload swing-analysis — it should reset to log mode (no persistence).

## Integration boundaries

| Boundary | What to verify |
|---|---|
| `FlexChartComponent` ↔ parent config | Parent's `logScale: false` overrides default; omitted `logScale` defaults to true. |
| `ChartToolbarComponent` ↔ page signal | Toolbar displays page state and emits toggle without local state. |
| Page signal ↔ multiple charts | Toggling one control updates every chart on the page synchronously. |
| Log toggle ↔ existing fullscreen toggle | Both outputs work independently. |

## Unit test targets

### Shared layer

#### `FlexChartComponent`
- **default-log**: when parent passes `{ indicators: [] }`, effective
  config has `logScale: true`.
- **parent-can-disable**: when parent passes `{ indicators: [], logScale: false }`,
  effective config has `logScale: false`.
- **existing-specs-still-pass**: no regression in current component specs.

#### `ChartToolbarComponent`
- **reflects-input**: button text/state matches `logScale()` input.
- **emits-toggle**: click calls `logScaleToggle.emit()`.
- **coexists-with-fullscreen**: fullscreen and log toggle are independent.

### Consumer wiring

#### `quick-charts`
- **default-true**: initial render passes `logScale: true` to each chart's
  `config`.
- **page-toggle**: clicking the header pill flips the `logScale` value
  passed to every chart card.

#### `swing-analysis-page`
- **default-true**: initial render passes `logScale: true` to the main chart.
- **page-toggle**: header pill toggles the chart's `logScale`.

#### `signal-detail`
- **default-true**: all three timeframes receive `logScale: true`.
- **toolbar-sync**: all three toolbars display the same page-level state.
- **page-toggle**: toggling any toolbar or a dedicated page-level control
  flips all three charts.

## Test seams

- Mock `FlexChartComponent` in consumer specs to assert the `config`
  input value (same pattern already used in quick-charts/swing-analysis
  specs).
- For shared-layer specs, use the real `FlexChartComponent` with a stubbed
  `ChartLifecycleFacade`/`ChartDataAdapter` if needed; the existing
  component spec already mocks Syncfusion.

## Edge cases

- Parent passes `logScale: undefined` — defaults to true.
- Rapid toggles — no duplicate `dataBind` crash (covered by existing
  facade race handling).
- Sub-$1 / corrupt data — handled by the existing transform seam; a
  smoke test in `quick-charts` uses the `non-positive` fixture if feasible.

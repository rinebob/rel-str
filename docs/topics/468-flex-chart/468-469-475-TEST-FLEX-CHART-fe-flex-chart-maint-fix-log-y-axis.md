**Topic:** Flex Chart Maintenance  
**Topic Slug:** flex-chart-maint  
**Thread:** Fix Log Scale Y-Axis  
**Thread Slug:** fix-log-y-axis  
**Issue:** #475  
**Thread Parent:** #469  
**Topic Parent:** #468  
**Domain:** FLEX-CHART  
**Type:** Test Plan  
**Status:** Approved  
**Created:** 2026-09-21  
**Last Updated:** 2026-09-22  

# Test Plan: Fix Log Scale Y-Axis

## E2E User Journeys

- Journey 1: Open the sandbox route → enter a symbol → real bars render → toggle log → axis re-renders with log geometry, real-price labels.
- Journey 2: With log on → zoom to a narrow window → axis extents snap to visible high/low → pan → extents update again.
- Journey 3: Switch to synthetic mode → pick the ≤0 preset → chart renders without error, clamped points at the floor.
- Journey 4: Toggle linear ↔ log repeatedly → no artifacts, no stale extents, crosshair/tooltips correct in both modes.

## Integration Tests

- `FlexChartComponent` + `ChartYAxisViewportController` + `ChartViewportStore`: setting `config.logScale` produces a log-space viewport applied to the primary axis; toggling back restores linear extents.
- `ChartLifecycleFacade` viewport effect: `snapYAxisToVisibleRange` recomputes extents in log units on zoom/pan and writes `primaryYAxis.minimum/maximum` (not zoomFactor).
- `chartState` emission: `yAxis.visibleRange` semantics documented and consumers (sync overlay, crosshair) invert to prices correctly.
- Sandbox page + `IndicatorSeriesStore` (mocked): symbol input produces chart data; synthetic toggle swaps datasets.

## Unit Tests

- Pure functions: `transformValue` / `invertValue` round-trip (`invert(transform(p)) === p` for p > 0); clamp of ≤0 to floor; log-space padding in `computeViewport` (min/max of visible high/low with pad, in log units); `priceFromPixel`/`pixelFromPrice` against known log geometry (equal % moves = equal pixels).
- `LogarithmicScaleStrategy.computeViewport`: empty visible bars, single bar, all-equal prices, wide-ratio data, ≤0 values in input.
- Tick computation helper (if extracted): 1-2-5-style tick prices for a given log range.
- `LinearScaleStrategy` regression: unchanged behavior when `logScale` is off.

## Test Seams

- Highest seam: the sandbox page itself (manual verification in dev server against real + synthetic data) — this is the primary "does it actually work" check; the PRD acceptance criteria are exercised there.
- Component test harness (TestBed): flex-chart with mocked `SfChartInstance` — assert viewport written to `primaryYAxis` in log units and label/crosshair inversion.
- Pure function calls: transform/invert/viewport math — the bulk of correctness coverage.

## Existing Test Coverage

- `chart-data-adapter.service.spec.ts`, `st-std-dev-lines.indicator.spec.ts`, `st-zigzag.*.spec.ts` cover indicator/adapter logic but not axis scaling. No existing coverage of `ScaleStrategy` or the viewport controller — this plan adds it.

## Edge Cases

- Empty dataset / zero visible bars.
- Single visible bar (zero-width range).
- All-equal prices (zero-height range).
- Values ≤ 0 interspersed in a positive series (clamp) and an entirely non-positive series (renders flat at floor — acceptable per PRD).
- Extreme ratio range (e.g., 0.01 → 10,000) — axis extents and labels remain sane.
- Rapid toggle during dataBind — no crash (facade race suppression).

**Topic:** Trading Indicator Library  
**Topic Slug:** indicator-lib  
**Thread:** Dual ST ZigZag Overlay  
**Thread Slug:** dual-st-zigzag-overlay  
**Issue:** #386  
**Thread Parent:** #383  
**Topic Parent:** #261  
**Domain:** INDICATOR-LIB  
**Type:** Test Plan  
**Status:** Draft  
**Created:** 2026-09-17  
**Last Updated:** 2026-09-17  

---

# SHARED Test Plan — Multi-ZigZag Chart Rendering

## E2E journeys

1. **Single ZigZag backward compat:** Page passes one ST_ZIGZAG config →
   chart renders exactly as before (one set of lines, one projected line).
2. **Dual ZigZag:** Page passes two ST_ZIGZAG configs with different colors →
   chart renders two sets of lines with distinct colors, two projected
   lines (dashed).
3. **N ZigZag:** Page passes three ST_ZIGZAG configs → chart renders three
   sets of lines. (N-ready verification.)

## Integration boundaries

- `ChartDataAdapter.zigZagSeries` returns `ZigZagChartSeries[]` (array).
- `computeZigZagSeries` accepts `instanceId` and `lineColor` parameters.
- Template iterates over the array with `@for ... track series.key`.

## Unit test targets

### `st-zigzag.types.ts`
- `ZigZagConfig` includes `lineColor` field.
- `DEFAULT_CONFIG.lineColor` is `'#1976d2'`.

### `st-zigzag.indicator.ts`
- `computeZigZagSeries` with `instanceId='zz1'` produces keys prefixed with
  `zz1-`.
- `computeZigZagSeries` with `lineColor='#ff0000'` produces lines with that
  color.
- `computeZigZagSeries` with no `instanceId` falls back to un-prefixed keys
  (backward compat).

### `chart-data-adapter.service.ts`
- `zigZagSeries` with zero ST_ZIGZAG configs returns `[]`.
- `zigZagSeries` with one ST_ZIGZAG config returns array of length 1.
- `zigZagSeries` with two ST_ZIGZAG configs returns array of length 2.
- Each result entry has distinct keys and colors.

## Edge cases

- Two configs with the same `id` → key collision (caller responsibility,
  document the constraint).
- Config with `lineColor` unset → falls back to default `#1976d2`.
- Empty bars array → `computeZigZagSeries` returns empty lines.

## Test seams

- `computeZigZagSeries` is pure — test directly with mock bars and config.
- `ChartDataAdapter` can be tested via `TestBed` with mock `FlexChartConfig`.

**Topic:** Trading Indicator Library  
**Topic Slug:** indicator-lib  
**Issue:** #387  
**Task:** #390  
**Thread Parent:** #383  
**Topic Parent:** #261  
**Domain:** INDICATOR-LIB  
**Type:** Code Review  
**Status:** Complete  
**Created:** 2026-09-18  
**Last Updated:** 2026-09-18  

---

# Code Review — Task #390: Multi-ZigZag rendering in flex-chart

## Summary

Task #390 makes flex-chart generically support multiple ST_ZIGZAG indicator
instances with independent configs and visual styling. The adapter returns
`ZigZagChartSeries[]` (array), `computeZigZagSeries` accepts optional
`instanceId`/`lineColor` options, line keys/names are namespaced per instance,
and the template loops over the array. Backward-compatible — a single ZigZag
config produces a length-1 array and renders exactly as before.

This is Task A2 (SHARED). It consumes `lineColor` from Task #389 (A1).

## Findings by severity

### Critical

None.

### Major

None.

### Minor

1. **Display names use raw config id** —
   `st-zigzag.indicator.ts:162-163` builds display names as
   `ZigZag (${instanceId})`. The adapter passes `zigZagConfig.id` as
   `instanceId`. If a caller uses the standard config dialog, ids are
   param-dumps like `st-zigzag-5,2,2,true,false,#1976d2`, producing ugly
   tooltip/legend names. The current caller (swing-analysis page) uses a
   clean id (`'st-zigzag-swing-analysis'`), so the name is acceptable today.
   **Deferred to Task #393** (dual-mode UI) where the actual instance ids
   will be determined and display names can be refined.

2. **Key collision risk with duplicate ids** —
   `IndicatorConfig.id` is not guaranteed unique across ST_ZIGZAG configs.
   Two configs with identical params get identical ids → identical line
   keys → `@for ... track line.key` collisions. This is caller
   responsibility, documented in the implementation plan's Risks section.
   The swing-analysis page must ensure unique `IndicatorConfig.id` values.

3. **Redundant `lineColor` pass-through in adapter** —
   `chart-data-adapter.service.ts:215-217` extracts `params['lineColor']`
   and passes it as `options.lineColor`, but `extractConfig` already reads
   the same param. `options.lineColor ?? config.lineColor` resolves to the
   same value through this path. The `options.lineColor` override is only
   meaningful for callers that want to override the param. Can be simplified
   to just `{ instanceId: zigZagConfig.id }` in a future cleanup.

4. **Type-erased fixture in adapter spec** —
   `chart-data-adapter.service.spec.ts:25` uses `as unknown as FlexChartDataset`
   to hide a fixture shape mismatch. Should use a typed `PriceBar[]` and
   build a typed `FlexChartDataset` directly.

5. **Vacuous test guards in adapter spec** —
   `chart-data-adapter.service.spec.ts:115-117` and `:127-129` wrap
   assertions in `if (result[0].lines.length > 0)`. If the mock bars produce
   no pivots, these tests pass without asserting anything. Should assert
   `result[0].lines.length > 0` first, then assert color/key.

### Nit

6. **Backward compat path unreachable from production** —
   The adapter always passes `instanceId: config.id`, so the un-prefixed
   key path in `computeZigZagSeries` (when `instanceId` is not provided) is
   only exercised by tests. Harmless — the path exists for direct callers
   of `computeZigZagSeries` that don't need namespacing.

7. **No `instanceId` on `ZigZagChartSeries`** —
   The outer template loop uses `track $index` because `ZigZagChartSeries`
   has no `instanceId` field. Adding one would allow `track zz.instanceId`
   for more stable tracking. Future enhancement.

8. **`track $index` vs `track series.key`** —
   The test plan mentions `track series.key` but `ZigZagChartSeries` has no
   `key` field. `track $index` is acceptable since the array is small and
   ordered. Consider adding a series-level key if identity tracking is
   needed.

9. **Indicator spec slightly over 300 lines** —
   `st-zigzag.indicator.spec.ts` is 355 lines. Test files commonly run
   long and this is a cohesive single-purpose spec. Low priority.

## Test results

- 12 test suites, 217 tests — all pass.
- Angular build passes.
- `ZIGZAG_COLOR` constant fully removed; no dangling references.
- `zigZagSeries` returns `[]` (not `null`) on all empty paths.
- Template excludes `ST_ZIGZAG` from `mainPaneSeries` loop (no double-rendering).

## Acceptance criteria verification

| Criterion | Status |
|-----------|--------|
| `zigZagSeries` returns `ZigZagChartSeries[]` (array) | MET |
| `.filter()` instead of `.find()` | MET |
| `computeZigZagSeries` per config, pushed to array | MET |
| No configs → `[]` | MET |
| `computeZigZagSeries` accepts `instanceId`/`lineColor` options | MET |
| Line keys prefixed with `${instanceId}-` | MET |
| Line names include instanceId | MET |
| Line color from `config.lineColor` (not hard-coded) | MET |
| Projected line key: `${instanceId}-zigzag-projected` | MET |
| Template: outer `@for` over array, inner `@for` over lines | MET |
| Backward compat: single config → length-1 array | MET |

## Verdict

**PASS** — All acceptance criteria met. No critical or major findings.
Minor findings are deferred to Task #393 (dual-mode UI) or future cleanup.

## Files changed

| File | Change |
|------|--------|
| `st-zigzag.indicator.ts` | Added `ComputeZigZagSeriesOptions`, `computeZigZagSeries` accepts `instanceId`/`lineColor`, removed `ZIGZAG_COLOR`, namespaced keys/names |
| `chart-data-adapter.service.ts` | `zigZagSeries` returns `ZigZagChartSeries[]`, uses `.filter()`, passes `instanceId`/`lineColor` per config |
| `flex-chart.component.html` | Outer `@for` loop over `zigZagSeries()` array, inner `@for` over `zz.lines` |
| `st-zigzag.indicator.spec.ts` | Added 7 multi-instance tests |
| `chart-data-adapter.service.spec.ts` | NEW spec with 7 tests |

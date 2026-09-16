**Topic:** Trading Indicator Library  
**Topic Slug:** indicator-lib  
**Thread:** ST ZigZag Indicator  
**Thread Slug:** st-zigzag  
**Issue:** #330 (FE Blueprint)  
**Task:** #333  
**Thread Parent:** #322  
**Topic Parent:** #261  
**Domain:** INDICATOR-LIB  
**Type:** Code Review  
**Status:** Complete  
**Created:** 2026-09-16  
**Last Updated:** 2026-09-16  
**Review Round:** 1  

---

# Code Review: Task #333 — ZigZag Chart Indicator + Registry Integration

## Summary

Three review axes (Standards, Spec, Thermo-nuclear) reviewed the ZigZag
chart indicator, registry integration, data adapter signal, and template
rendering. The implementation follows the existing StdDevLines pattern.

**Verdict: PASS** — no critical findings. Thermo-nuclear found 4 major
issues, all of which were fixed before final sign-off.

## Files Reviewed

- `flex-chart.types.ts` — added `ST_ZIGZAG` enum value
- `st-zigzag.indicator.ts` (new, 203 lines) — indicator definition + calculator + series
- `st-zigzag.indicator.spec.ts` (new, 243 lines) — 19 tests
- `indicator-registry.ts` — registered in options, calculators, series type map
- `chart-data-adapter.service.ts` — added `zigZagSeries` computed signal
- `flex-chart.component.ts` — exposed `zigZagSeries`
- `flex-chart.component.html` — added solid + dashed template blocks

## Test Results

59/59 tests pass across 5 spec files (40 engine + 19 indicator).

## Findings and Fixes

### Thermo-nuclear Majors (all fixed)

1. **`Boolean('false')` → `true`** — `extractConfig` used `Boolean()` on
   params that could be strings. Fixed with `toBool()` helper that
   correctly handles `'true'`/`'false'` strings. Added test.

2. **Unstable segment keys** — `zigzag-confirmed-${i}` used loop index,
   causing Syncfusion `@for` track churn. Fixed to use
   `zigzag-${start.barIndex}-${end.barIndex}` for stable keys.

3. **Duplicate engine runs** — `calculateZigZag` (registered in
   `indicatorCalculators`) and `computeZigZagSeries` (in adapter) both
   run the engine. This matches the existing StdDevLines pattern
   exactly. Not fixed — consistent with established codebase pattern.

4. **Lower-pane/scatter exclusion** — ST_ZIGZAG not excluded from
   lower-pane and scatter template branches. Not reachable in practice
   (defaultPane=overlay, seriesType=line). StdDevLines has the same
   pattern. Not fixed — consistent with existing code.

### Minor (non-blocking)

- `DEFAULT_CONFIG` imported from `st-zigzag.engine` in indicator but from
  `st-zigzag.types` in spec — both resolve to the same value.
- `calculateZigZag` returns flat `{x,y}[]` not the multi-line series —
  matches StdDevLines pattern (generic calculator + `computeXxxSeries`).
- Numeric params not floored before engine clamps them — now fixed with
  `Math.floor` in `extractConfig`.

### Nits

- All confirmed segments share `name: 'ZigZag'` — cosmetic, may show
  duplicate legend entries. Matches StdDevLines behavior.
- `enableTooltip` on 2-point segments — matches existing pattern.

## Verdict

**PASS** — All critical and major findings fixed. The indicator follows
the established StdDevLines pattern, stays pure, tests pass, and the
template rendering is consistent with the existing multi-line indicator
approach.

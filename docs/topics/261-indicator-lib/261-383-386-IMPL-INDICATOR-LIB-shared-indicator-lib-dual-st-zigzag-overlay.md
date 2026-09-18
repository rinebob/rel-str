**Topic:** Trading Indicator Library  
**Topic Slug:** indicator-lib  
**Thread:** Dual ST ZigZag Overlay  
**Thread Slug:** dual-st-zigzag-overlay  
**Issue:** #386  
**Thread Parent:** #383  
**Topic Parent:** #261  
**Domain:** INDICATOR-LIB  
**Type:** Implementation Plan  
**Status:** Draft  
**Created:** 2026-09-17  
**Last Updated:** 2026-09-17  

---

# SHARED Implementation Plan — Multi-ZigZag Chart Rendering

## Scope

Make flex-chart generically support multiple ST_ZIGZAG indicator instances with
independent configs and visual styling. Backward-compatible — a single ZigZag
config still works exactly as today.

Covers US-4 from the PRD.

## Current state

- `ChartDataAdapter.zigZagSeries()` uses `.find()` — renders only the first
  ST_ZIGZAG config.
- `st-zigzag.indicator.ts` hard-codes line color (`#1976d2`), width (`1.5`),
  keys (`zigzag-{start}-{end}`), and names (`'ZigZag'`).
- `flex-chart.component.html` has a single ZigZag rendering block, not a loop.
- `ZigZagConfig` has no `lineColor` field.

## Changes

### Task A1: Add `lineColor` to `ZigZagConfig`

**File:** `src/app/features/shared/components/flex-chart/indicators/st-zigzag.types.ts`

- Add `lineColor: string` to `ZigZagConfig` interface (default `#1976d2`).
- Update `DEFAULT_CONFIG` to include `lineColor: '#1976d2'`.
- This field is FE-only — the Pine export has its own `Settings` type and is
  unaffected.

### Task A2: Multi-ZigZag rendering in flex-chart

**Files:**
- `src/app/features/shared/components/flex-chart/services/chart-data-adapter.service.ts`
- `src/app/features/shared/components/flex-chart/indicators/st-zigzag.indicator.ts`
- `src/app/features/shared/components/flex-chart/flex-chart.component.html`

**Adapter changes:**
- Change `zigZagSeries` computed from `ZigZagChartSeries` to
  `ZigZagChartSeries[]` (array).
- Replace `.find()` with `.filter()` to get all ST_ZIGZAG configs.
- For each config, call `computeZigZagSeries(bars, config.params)` and push
  the result into the array.
- If no ST_ZIGZAG configs exist, return `[]`.

**Indicator changes:**
- `computeZigZagSeries` accepts an optional `instanceId: string` and
  `lineColor: string` parameter.
- Line keys are prefixed with `${instanceId}-` (e.g.,
  `${instanceId}-zigzag-{start}-{end}`).
- Line names include the instanceId (e.g., `'ZigZag (large)'`).
- Line color comes from `config.params.lineColor` (not the hard-coded
  constant).
- Projected line key: `${instanceId}-zigzag-projected`.

**Template changes:**
- Replace the single ZigZag rendering block with an outer `@for` loop over
  `zigZagSeries()` (the array).
- Inner `@for` loop over `series.lines` remains.
- Projected line block moves inside the outer loop.

## Backward compatibility

- A single ST_ZIGZAG config produces a `ZigZagChartSeries[]` of length 1.
- The template loops over it, rendering exactly as before.
- `ZigZagConfig.lineColor` defaults to `#1976d2` (today's hard-coded color).

## Risks

- **Key collisions:** If `instanceId` is not unique across ST_ZIGZAG configs,
  `@for` track keys will collide. The caller (swing analysis page) must
  ensure unique `IndicatorConfig.id` values.
- **Template complexity:** The outer loop adds nesting. Keep it flat —
  one `@for` for series, one `@for` for lines within.

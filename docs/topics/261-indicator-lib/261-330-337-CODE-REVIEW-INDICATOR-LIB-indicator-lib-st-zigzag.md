**Topic:** Trading Indicator Library  
**Topic Slug:** indicator-lib  
**Thread:** ST ZigZag Indicator  
**Thread Slug:** st-zigzag  
**Issue:** #337  
**Thread Parent:** #322  
**Topic Parent:** #261  
**Domain:** INDICATOR-LIB  
**Type:** Code Review  
**Status:** Pass  
**Created:** 2026-09-17  
**Last Updated:** 2026-09-17  

---

# Code Review: Task #337 — FE Stats Panel Component

## Summary

Task #337 implements `stats-panel.component.ts`, a standalone Angular component that renders distribution summaries (mean, median, std dev, percentiles, min, max) per direction and Syncfusion column-chart histograms for magnitude % and duration, split by up/down direction. The component consumes pre-computed `SwingStats` (filtered to confirmed swings by `computeSwingStats` in the engine) and exposes `stats` and `loading` inputs.

**Verdict: PASS** — All three review axes pass after addressing findings. No critical or major findings remain.

## Files Reviewed

- `src/app/features/savant-trader/swing-analysis/components/stats-panel.component.ts` (242 lines)
- `src/app/features/savant-trader/swing-analysis/components/stats-panel.component.spec.ts` (340 lines)

## Axis 1 — Standards

**No critical or major findings.**

| # | Severity | Finding | Resolution |
|---|----------|---------|------------|
| S1 | minor | `CommonModule` imported but unused (template uses `@if`/`@for` built-in control flow) | **Fixed** — removed import and from `imports` array |
| S2 | nit | `summaryFields` was a template-called method that rebuilt arrays per CD cycle | **Fixed** — precomputed in `toDirectionView` as `magnitudePercentFields` / `magnitudeAbsoluteFields` / `durationFields` |
| S3 | nit | Histogram `bins.length > 0` guard evaluated in template | Accepted — declarative enough; not blocking |

## Axis 2 — Spec

All acceptance criteria **MET**:

- [x] Renders distribution summary (mean, median, std dev, percentiles, min, max) per direction
- [x] Renders histograms using Syncfusion column charts (magnitude %, duration, split by direction)
- [x] Confirmed swings only (projected swing excluded from stats) — engine-side filter, component consumes pre-filtered `SwingStats`
- [x] Empty state when no stats
- [x] Loading state
- [x] Unit tests pass (22 stats-panel tests, 151 total across 9 suites)

| # | Severity | Finding | Resolution |
|---|----------|---------|------------|
| P1 | major | Distribution summary test asserted labels but not rendered values for median, stdDev, or percentiles | **Fixed** — `readFieldMap` helper added; all 10 fields asserted with exact formatted values for up magnitude %, up duration, and down magnitude % |
| P2 | major | Histogram tests verified only wrapper `div` count; `ejs-chart` element not asserted | **Fixed** — added tests asserting `ejs-chart` presence for up magnitude, up duration, and down magnitude histograms |
| P3 | minor | No explicit tests for down direction | **Fixed** — down magnitude % values asserted |
| P4 | minor | Null-stats and zero-swing empty states share the same UI/message | Accepted — single empty message is intentional; both cases are tested |

## Axis 3 — Thermo-nuclear

**No critical findings. One major finding (fixed).**

| # | Severity | Finding | Resolution |
|---|----------|---------|------------|
| T1 | major | `format()` used `Math.abs(v) >= 100 ? toFixed(0) : toFixed(2)` for all fields — `magnitudeAbsolute` ≥ 100 lost cents, values < 0.01 rendered as `0.00` | **Fixed** — `format()` now takes a `kind` argument (`percent` / `currency` / `duration`); percent/currency preserve 4 decimals for < 0.01, 3 for < 1, 2 otherwise; duration uses 1 decimal. Regression test added for 0.005 rendering as `0.0050` |
| T2 | nit | Hardcoded `height="180px"` on histogram charts | Accepted — reasonable default; can be parameterized later if needed |
| T3 | nit | `HistogramPoint` is a component-local type | Accepted — clean, scoped; no second consumer exists |
| T4 | nit | `format()` does not normalize negative zero | Accepted — inputs are aggregates; low impact |

## Test Results

```
Test Suites: 9 passed, 9 total
Tests:       151 passed, 151 total
```

Stats-panel suite: 22 tests covering creation, loading state, empty state (null + zero swings), direction sections, count, magnitude % / $ / duration distribution values (up + down), all field labels, histogram containers, ejs-chart presence (up mag, up dur, down mag), empty histogram placeholders (magnitude + duration), small-value formatting, and state precedence (loading > content, null > content).

## FE Verification

The stats panel cannot be exercised in the running app yet — the host page and route are Task #338. Component-level rendering, distribution values, histogram chart wiring, and all states are verified via TestBed. Syncfusion chart rendering will be verified in-browser once Task #338 lands the page.

## Non-blocking Follow-ups

- Consider `repeat(auto-fit, minmax(160px, 1fr))` for the direction grid if narrow viewports clip stat blocks.
- Consider exposing histogram height as an `@Input()` if reuse needs different sizes.
- Consider filtering `directions()` to only directions with `count > 0` if the zero-direction placeholder is undesired (currently intentional — shows "Down (0)" with "No data" histograms).

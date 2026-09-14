**Topic:** Trading Indicator Library  
**Topic Slug:** indicator-lib  
**Thread:** Trend Rider Zero Cross  
**Thread Slug:** trend-rider-zero-cross  
**Issue:** #309  
**Thread Parent:** #304  
**Topic Parent:** #261  
**Task:** #310  
**Domain:** INDICATOR-LIB  
**Type:** Code Review  
**Status:** Complete  
**Created:** 2026-09-13  
**Last Updated:** 2026-09-13

## Summary

Task #310 implements Trend Rider Zero Cross detection and chart wiring for the Savant Trader frontend. The implementation adds a pure `detectZoneZeroCrossDots` detector, a `computeZeroCrossDots` converter that derives dots client-side from raw zone series, four new computed signals (daily/weekly × V1/V2), and wiring into both signal-detail and quick-charts components.

Three review axes ran in parallel (Standards, Spec, Thermo-nuclear). The initial review found two critical issues and several major/minor findings. Both critical issues and the major findings were fixed before this final review doc was written:

1. **Critical — Duplicate indicator `id`:** Zero-cross dots reused the uptick-dot `IndicatorOption`, producing duplicate `id`s in the `indicators` array that would break `@for track indicator.id` in the flex-chart template. **Fixed** by adding `ST_ZONE_V1_ZERO_CROSS_DOTS_INDICATOR` and `ST_ZONE_V2_ZERO_CROSS_DOTS_INDICATOR` with their own `id`, `label`, and `StIndicator.ZONE_ZERO_CROSS_DOTS` enum value, registered in the indicator registry and added to the toggle menu.
2. **Critical — Null zone skip fabricated false crosses:** `computeZeroCrossDots` dropped null zone values, collapsing `[-1, null, +1]` into `[-1, +1]` and firing a false cross. **Fixed** by preserving nulls as `undefined` in the zone data and breaking the sign-flip sequence whenever either side is `undefined`.
3. **Major — Duplicated ATR/bar-map setup:** Both `detectZoneUptickDots` and `detectZoneZeroCrossDots` built the same `barMap` + `computeATR` context. **Fixed** by extracting `buildDotPlacementContext(bars)` shared helper.
4. **Major — Zero-cross dots gated by uptick toggle:** Zero-cross dots were shown only when the uptick-dot toggle was on, coupling two independent features. **Fixed** by giving zero-cross dots their own toggle (the new indicator options) and adding them to the default selection sets.
5. **Major — Missing converter-level tests for null zones:** Added 5 new tests covering null/undefined zone values breaking the sequence.

## Findings by severity

### Critical

- **Duplicate indicator `id` when both uptick and zero-cross dots shown** — `base-indicators.ts` lines 152–157 (original). `addUptickDots` was called with the same `ST_ZONE_V1_UPTICK_DOTS_INDICATOR` for both uptick and zero-cross data, producing duplicate `id`s (`st-zone-v1-uptick-dots-default`). The flex-chart template tracks series by `indicator.id`, so duplicate keys would throw or silently drop a series. **Fixed:** created `ST_ZONE_V1_ZERO_CROSS_DOTS_INDICATOR` and `ST_ZONE_V2_ZERO_CROSS_DOTS_INDICATOR` with distinct `id`s, added `StIndicator.ZONE_ZERO_CROSS_DOTS` enum value, registered in `indicator-registry.ts`, added to `ST_INDICATOR_OPTIONS` menu and `SERIES_TYPE_MAP`.

### Major

- **Null zone skip fabricated false crosses** — `signal-marker-converters.ts` lines 120–126 (original). `computeZeroCrossDots` filtered out null zones before passing to `detectZoneZeroCrossDots`, so `[-1, null, +1]` became `[-1, +1]` and fired a false cross two bars late. **Fixed:** `computeZeroCrossDots` now preserves nulls as `undefined`, and `detectZoneZeroCrossDots` accepts `y: number | undefined` and skips any pair where either side is `undefined`. Added 5 tests covering null/undefined cases.

- **Duplicated ATR/bar-map setup** — `st-trend-rider-dots.indicator.ts` lines 113–119 and 233–238 (original). Both detection functions built the same `barMap` and called `computeATR`. **Fixed:** extracted `buildDotPlacementContext(bars)` helper returning `{ barMap, atr }`, used by both functions.

- **Zero-cross dots gated by uptick toggle** — `signal-detail.component.ts` lines 434–435 (original). Zero-cross dots were shown only when `sel.has(ST_ZONE_V1_UPTICK_DOTS_INDICATOR.id)`, coupling two independent features. **Fixed:** zero-cross dots now have their own indicator options and are gated by `sel.has(ST_ZONE_V1_ZERO_CROSS_DOTS_INDICATOR.id)`. Added to `INDICATORS_BY_INTERVAL` default selection sets for daily and weekly.

- **Missing converter-level tests for null zones** — `st-trend-rider-dots.indicator.spec.ts`. The 19 original tests covered the detector but missed null/undefined zone values, which the converter now handles. **Fixed:** added 5 tests: null breaks sequence, current undefined, previous undefined, null gap cleared, both defined and adjacent.

### Minor

- **`UptickDotPoint` type overloaded for zero-cross dots** — `st-trend-rider-dots.indicator.ts` line 230. `detectZoneZeroCrossDots` returns `UptickDotPoint[]`, a name semantically specific to uptick detection. The shape is generic `{ x, y, color }`. Renaming to `DotPoint` or `TrendRiderDotPoint` would be cleaner. **Deferred** — the type is internal and renaming would touch the existing uptick function too; not blocking.

- **`computeZeroCrossDots` lives in signal-marker-converters.ts** — the file is for pre-computed marker conversions, but `computeZeroCrossDots` is client-side computation from raw zone series. **Deferred** — moving it would add a new file for one function; not blocking.

- **`createExtrasSignals` signature grew from 2 to 4 positional params** — `extras-signals.ts` lines 46–51. Only zero-cross dots need bars; uptick dots, windows, and signal dots still come from `intervalData`. An options object or optional bar signals would be cleaner. **Deferred** — the 4-param signature is still readable and both call sites are updated; not blocking.

- **"Zero cross" name is semantically misleading** — `st-trend-rider-dots.indicator.ts` line 225. The function fires only on strict sign flips, not on transitions through zero (`-1 → 0` or `0 → +1`). This is intentional (zero is neutral), but the name may confuse future maintainers. **Deferred** — the name matches the PRD/feature naming ("Trend Rider Zero Cross"); renaming would diverge from the product vocabulary.

### Nit

- **Color hex case inconsistency** — `base-indicators.ts` lines 56–67. `UptickDotColors` uses lowercase (`#4caf50`), `ZeroCrossDotColors` uses mixed case (`#009688`, `#ff9800`). **Deferred** — cosmetic.

- **Test color assertions slightly tautological** — `st-trend-rider-dots.indicator.spec.ts` lines 196–208. The "uses teal for long" and "uses orange for short" tests assert the color passed in is the color returned. **Deferred** — they document the expected colors clearly.

## Test results

- **Unit tests:** 24/24 pass in `st-trend-rider-dots.indicator.spec.ts` (19 original + 5 new null zone tests)
- **Flex-chart area:** 50/50 pass (24 zero-cross + 26 std-dev-lines)
- **TypeScript build:** passes with no errors (`tsc --noEmit --project tsconfig.app.json`)
- **Pre-existing failures:** Unrelated test failures in order-execution, portfolio, spread-viewer, and trading-config areas are from Topic #219 Portfolio Dashboard work and are not caused by Task #310.

## PRD acceptance criteria

| US | Criterion | Status | Evidence |
|---|---|---|---|
| US1 | V1 neg→pos teal hollow circle below bar at `low - ATR(14)*2.5` | MET (detection/placement/color) | `detectZoneZeroCrossDots` lines 257–294; `ZeroCrossDotColors.long = #009688` |
| US2 | V1 pos→neg orange hollow circle above bar at `high + ATR(14)*2.5` | MET (detection/placement/color) | Same function; `ZeroCrossDotColors.short = #ff9800` |
| US3 | Same for V2 sign flips | MET | `computeZeroCrossDots(..., v1=false)` path; `ST_ZONE_V2_ZERO_CROSS_DOTS_INDICATOR` |
| US4 | Zero-cross and confirmation dots render together | MET | Distinct indicator `id`s prevent `@for track` collisions; both wired in signal-detail and quick-charts |
| US5 | Hollow circles, teal/orange, visually distinct | PARTIAL | Colors and distinct indicator options are in place. **Hollow marker rendering** (e.g., `isFilled: false`) is not yet implemented in the flex-chart renderer — the marker config in `flex-chart.component.html` uses solid circles for all scatter series. This is a renderer-level change that affects all scatter dots, not just zero-cross. **Deferred to a follow-up** since it requires a renderer change that may affect existing indicators. |
| US6 | Pine and TS produce identical dots | DEFERRED | TS implementation is deterministic. Pine parity is Task #311. |

## Verdict

**PASS** — All critical and major findings are fixed. The implementation meets the PRD acceptance criteria for detection, placement, colors, and coexistence (US1–US4). US5 (hollow circles) is partially met — colors and distinct indicator options are in place, but the hollow marker rendering requires a flex-chart renderer change that is deferred to a follow-up. US6 (Pine parity) is deferred to Task #311.

Tests pass (24/24 unit, 50/50 flex-chart area). Build passes. The remaining minor/nit findings are deferred and do not block shipping.

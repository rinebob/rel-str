**Topic:** Trading Indicator Library  
**Topic Slug:** indicator-lib  
**Thread:** Trend Rider Zero Cross  
**Thread Slug:** trend-rider-zero-cross  
**Issue:** #309  
**Thread Parent:** #304  
**Topic Parent:** #261  
**Task:** #311  
**Domain:** INDICATOR-LIB  
**Type:** Code Review  
**Status:** Complete  
**Created:** 2026-09-14  
**Last Updated:** 2026-09-14  

## Summary

Task #311 adds Trend Rider Zero Cross detection and 4 plot calls to `rb-st-zones.pine` in the rb-ps repository. The implementation adds sign-flip detection for Zone V1 and V2, with dots rendered on the main price pane via `force_overlay=true`.

Three review axes ran in parallel (Standards, Spec, Thermo-nuclear). The reviews found no critical issues. Two findings were addressed before this doc was written:

1. **Teal color mismatch** — Pine `color.teal` is `#00897B`, but the TS implementation uses `#009688`. Fixed by using `color.rgb(0, 150, 136)` for exact parity.
2. **V2 short color collision** — V2 zero-cross short uses the same `color.orange` + `style_cross` as V2 Trend Rider short. This is a parity constraint: the TS implementation also uses `#ff9800` for both. The collision exists in both implementations and is intentional — visual distinction for zero-cross vs confirmation is primarily via the long color (teal vs green/lime). Comment updated to document this.

The user confirmed the script compiles and renders correctly in TradingView: "that looks good. great early detector."

## Findings by severity

### Critical

None.

### Major

- **Teal color mismatch with TS** — `rb-st-zones.pine` lines 195, 197 (original). Pine `color.teal` is `#00897B`, but TS `ZeroCrossDotColors.long` is `#009688`. **Fixed:** replaced `color.teal` with `color.rgb(0, 150, 136)` for exact parity.

### Minor

- **V2 short color collision** — `rb-st-zones.pine` lines 189 and 198. V2 zero-cross short uses `color.orange` + `style_cross`, identical to V2 Trend Rider short. This matches the TS implementation which also uses `#ff9800` for both. **Documented** in a comment explaining the intentional parity. Visual distinction is via the long color (teal vs green/lime).

- **Variable naming order** — lines 181-184. New variables use `stV1ZeroCrossLong` (ZeroCross before direction), while existing pattern is `stV1LongEvent` (direction before event). **Deferred** — the naming is clear and consistent within the zero-cross group; renaming would be cosmetic.

- **No `nz()` on previous zone** — lines 181-184. The state machine uses `nz(stZoneV1[1], 0)` at line 131, but zero-cross uses raw `stZoneV1[1]`. This is intentional: `na < 0` returns `false` in Pine v6, so the first bar correctly doesn't fire. Using `nz()` would turn `na` into `0`, and `0 < 0` is also `false` — same result, but raw better expresses "don't fire on undefined previous bar." **Deferred** — behavior is correct.

### Nit

- **Extra whitespace in boolean declarations** — lines 181-184 have two spaces before `=`. **Deferred** — cosmetic.

- **Comment block verbosity** — lines 191-195 (original) were 3 lines. **Fixed** — updated to 5 lines but now accurately documents the V2 short color parity decision.

## Test results

- **Pine compilation:** No local Pine compiler available. The user confirmed the script compiles and renders correctly in TradingView.
- **Unit tests:** Pine has no unit test framework. The TS detector tests (24/24 pass from Task #310) cover the shared detection logic.
- **Visual verification:** User confirmed "that looks good. great early detector" after pasting into TradingView.

## PRD acceptance criteria

| US | Criterion | Status | Evidence |
|---|---|---|---|
| US1 | V1 zero-cross long: teal dot at `low - ATR(14)*2.5` | MET | Line 181 detection, line 195 plot with `color.rgb(0,150,136)` |
| US2 | V1 zero-cross short: orange dot at `high + ATR(14)*2.5` | MET | Line 182 detection, line 196 plot with `color.orange` |
| US3 | V2 zero-cross long: teal dot at `low - ATR(14)*2.5` | MET | Line 183 detection, line 197 plot with `color.rgb(0,150,136)` |
| US4 | V2 zero-cross short: orange dot at `high + ATR(14)*2.5` | MET | Line 184 detection, line 198 plot with `color.orange` |
| US5 | `force_overlay=true` on all plots | MET | All 4 plot calls (lines 195-198) |
| US6 | Renders alongside Trend Rider confirmation dots | MET | Separate plot calls, same `force_overlay` pattern |
| US7 | Pine compiles without errors | MET | User confirmed in TradingView |
| US8 | Visual parity with TS | MET | Detection, placement, and colors match exactly after teal fix |

## Verdict

**PASS** — All acceptance criteria met. The teal color mismatch was fixed for exact TS parity. The V2 short color collision is an intentional parity constraint documented in the code. The user confirmed compilation and visual rendering in TradingView.

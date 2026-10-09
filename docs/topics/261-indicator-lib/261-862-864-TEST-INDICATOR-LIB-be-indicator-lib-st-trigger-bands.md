# Test Plan — ST Trigger Bands (BE)

**Topic:** Trading Indicator Library  
**Topic Slug:** indicator-lib  
**Thread:** Implement ST Trigger Bands in ST Indicator Library  
**Thread Slug:** st-trigger-bands  
**Issue:** #864  
**Thread Parent:** #862  
**Topic Parent:** #261  
**Domain:** INDICATOR-LIB  
**Type:** Test Plan  
**Area:** BE  
**Status:** Complete  
**Created:** 2026-10-07  
**Last Updated:** 2026-10-08  

## Unit tests: `computeStTriggerBands`

Location: `tests/functions/st-trigger-bands.test.ts` (prior art: `tests/functions/std-dev-lines.test.ts`). Bars are small hand-worked sets; expected values are derived from the Pine definitions in the PRD, not from running the implementation.

- Empty and short input: `[]` and fewer than 3 bars return arrays of matching length; `upper`/`lower` are `null` for bars 0 and 1; all flags `false`.
- Band values: `upper[t] = max(bodyHigh[t-2..t])`, `lower[t] = min(bodyLow[t-2..t])` for a known set, using candle bodies (a bar with a long wick does not widen the band; an up bar uses close as body high, a down bar uses open).
- Long pullback: true when the upper band is flat or falling versus the previous bar, false while it is rising; `null` band comparisons are false.
- Long pullback state: latches on the first pullback, carries across non-pullback bars, clears on breakout; starts off. (A pullback and a breakout cannot occur on the same bar, so "pullback wins" is unreachable; asserted as an invariant in the verification script.)
- Long breakout, positive: band flat/falling the bar before, body high crosses above the prior upper band, state on the previous bar: flag fires on exactly that bar.
- Long breakout, negative: no fire without a prior pullback (band rising from the start); no fire when body high only equals the prior band. The "band rising the bar before" and "not a fresh cross" gates are implied by the state and the band definition (see the BE IMPL risk note), so they have no separate reachable case.
- Breakout resets state: after a breakout, a second breakout cannot fire until a new pullback re-arms it.
- Short side: mirror cases for pullback, state, breakout and each negative gate on the lower band / body low.
- Long and short are independent: a bar can carry flags for both sides.
- Determinism and length: output arrays all have the input's length.

## Integration tests

Location: alongside existing indicator-computation specs.

- `computeSymbolIndicatorSeries` returns `indicators.triggerBands` for daily, weekly and monthly, one point per bar with matching `d`.
- Trigger bands are present even when an interval has fewer than 30 bars but at least 3 (not gated by the other indicators' 30-bar rule).
- `dotMarkers.triggerBands` contains a breakout dot for every breakout flag and a pullback dot for every armed pullback-state bar (the warning stays lit until the breakout clears it — revised after sandbox UAT to match the Pine's `longPullbackState` circle plot), with `version: 'TB'`, correct `direction`, `signalType` and `index`; `y` is on the correct side of the bar.
- Existing families (`zoneV1`, `zoneV2`, `trendStrength`, `trendBands`, zone and trend-strength dots, HTF windows) are byte-identical to before for the same input (regression).

## Callable filtering tests

Location: alongside `indicator-series` specs if present; otherwise a focused spec on `filterResponse`.

- Request with `TRIGGER_BANDS` in `indicators`: `indicators.triggerBands` and `dotMarkers.triggerBands` are returned.
- Request without it (including the default set): neither is returned.
- Requesting `TRIGGER_BANDS` does not add zone or trend-strength dots, and requesting only strategies does not return trigger-band dots.

## Verification script

- A script under `functions/scripts/verify/` (convention: `indicator-lib-268-engine.ts`) that runs the engine on a real symbol's cached bars and prints the last N bars' bands and flags, for comparison with the TradingView chart on the same symbol.

## Pine verification (manual)

- Load the cleaned `rb-st-trigger-bands.pine` and the web chart on the same symbol and period; confirm bands and pullback/breakout bars coincide over a visible window. Record the result in the task's UAT doc (QA #381 convention).

## Edge Cases

- Flat market (all bodies equal): the bands are flat, so pullback is true on every bar from bar 3; a breakout requires a strictly higher body high, so none fire.
- Gaps: body-based bands ignore wicks but gaps move bodies; no special handling.
- Doji bars (`open == close`): body high equals body low; valid.
- Missing or zero prices: not handled specially (bars come from the cached store).
- The last bar is forming: its flags are computed like any other; consumers decide whether to wait for the close.

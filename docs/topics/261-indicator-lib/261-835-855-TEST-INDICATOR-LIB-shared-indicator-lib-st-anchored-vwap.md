**Topic:** Trading Indicator Library  
**Topic Slug:** indicator-lib  
**Thread:** ST Anchored VWAP  
**Thread Slug:** st-anchored-vwap  
**Issue:** #855  
**Thread Parent:** #835  
**Topic Parent:** #261  
**Domain:** INDICATOR-LIB  
**Type:** Test Plan  
**Area:** SHARED  
**Status:** Draft  
**Created:** 2026-10-07  
**Last Updated:** 2026-10-07  

# SHARED Test Plan: ST Anchored VWAP Pine Refinement

Pine has no automated test harness and no local compiler, so this plan is a **manual verification checklist** run in TradingView, same convention as the prior Pine exports (QA #381). The reference for correct behaviour is the finished web sandbox.

## E2E User Journeys

- Journey 1: User pastes the refined script into TradingView and adds it to a chart → it compiles without errors or warnings that affect output, and four lines (magenta high / cyan low, thick large / thin small) render.
- Journey 2: User opens the web sandbox and TradingView on the same symbol, interval and params → anchor bars, confirmation bars, handoff bars and first drawn values match.
- Journey 3: User sets `historyStart` and then clears it → history behaves as in the web sandbox (era mode keeps the first `maxHistory`; unset keeps the most recent).

## Integration Tests

- Pine detection core vs web `computeZigZagAnchorEvents`: the same set of anchor events (pivot bar, confirmation bar, side, replaced) on the same data.
- Pine VWAP values vs web `computeAnchoredVwap`: the same values at sampled bars.

## Unit Tests

Not applicable — no Pine unit-test framework. The checklist below stands in.

## Verification Checklist

- [ ] Script compiles in the Pine editor with no errors; any warnings are understood and recorded.
- [ ] No line is drawn before its anchor's confirmation bar; nothing is attached back to the pivot bar.
- [ ] The previous same-side line runs through the new anchor's confirmation bar and stops there; the new line starts on that bar.
- [ ] A replaced same-side pivot: the replaced anchor's line is drawn and ends at the replacement's confirmation bar.
- [ ] The first drawn value of a line equals the VWAP of the pivot bar through the confirmation bar (spot-check against the web sandbox).
- [ ] Both scales render independently; a pivot that qualifies only at the small percentage appears only on the small lines.
- [ ] Only confirmed pivots anchor; no line jumps or vanishes as the live bar forms.
- [ ] Active lines extend to the latest bar; terminated segments are faded.
- [ ] `historyStart` set: history renders from that date forward, up to `maxHistory`; nothing earlier than the date; the cap eats the recent end.
- [ ] `historyStart` unset: the most recent `maxHistory` terminated segments render; the oldest are dropped.
- [ ] Total polyline count never exceeds TradingView's limit at the default and maximum `maxHistory` (per-scale cap, both sides combined).
- [ ] Zero or missing volume: the line carries flat and never breaks.
- [ ] Confirmation-bar markers, thin step duplicate lines, hindsight polylines and the debug table are gone.
- [ ] The four colors and the retracement percentages are inputs; defaults are magenta/cyan, 2% and 5%.
- [ ] Plot-vs-polyline decision for active lines recorded (and, if `plot()`, the handoff step judged acceptable).
- [ ] Runs without a timeout or "takes too long" error on a long daily history and on an intraday chart.

## Test Seams

- Highest seam: side-by-side comparison against the web sandbox on identical inputs.
- Lower seam: spot-checking individual anchors and first drawn values.

## Existing Test Coverage

- The Stage 1 prototype was viewed on real charts only; there is no prior automated or documented checklist for this script. `rb-st-zigzag.pine` was verified manually (QA #381) and is the precedent for this approach.

## Edge Cases

- Very short history (fewer bars than `leftDepth + rightDepth`).
- No pivots found.
- Only one side has pivots.
- Symbol with no volume data.
- Intraday vs daily vs weekly charts.
- A pivot confirmed on the final confirmable bar.
- Anchors older than any series-history buffer (the array-indexed design must handle them).
- Extreme `maxHistory` and `historyStart` combinations near the drawing budget.

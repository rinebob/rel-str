**Topic:** Trading Indicator Library  
**Topic Slug:** indicator-lib  
**Thread:** ST ZigZag Indicator  
**Thread Slug:** st-zigzag  
**Issue:** #325  
**Thread Parent:** #322  
**Topic Parent:** #261  
**Domain:** INDICATOR-LIB  
**Type:** Test Plan  
**Status:** Draft  
**Created:** 2026-09-15  
**Last Updated:** 2026-09-15  

---

# SHARED Test Plan: ST ZigZag Pine Export

## E2E User Journeys

- Journey 1: User adds `rb-st-zigzag.pine` to a TradingView chart → sees ZigZag lines with projected pivot dashed line
- Journey 2: User changes `leftDepth`/`rightDepth` independently → pivot confirmation window changes asymmetrically
- Journey 3: User toggles `projectionPivots` off → no dashed projected line, confirmed pivots only

## Integration Tests

No automated integration tests. Manual verification against TradingView charts.

## Unit Tests

No automated unit tests for Pine scripts. The Pine export is a near-direct
copy of the verified source with the `depth` → `leftDepth`/`rightDepth`
split as the only structural change.

## Test Seams

- **Manual verification** — compare Pine output against TradingView's
  built-in ZigZag indicator with matching parameters:
  - Symmetric depths (`leftDepth = rightDepth = 5`) should match
    TradingView's `depth = 10` output exactly
  - Asymmetric depths (`leftDepth = 3, rightDepth = 7`) should produce
    pivots confirmed by 3 bars left + 7 bars right
  - Projection on/off should match TradingView's `projectionPivots` toggle
  - `devThreshold` values should match TradingView's `devThreshold`
  - `allowZigZagOnOneBar` on/off should match TradingView's toggle

## Existing Test Coverage

- `docs/topics/261-indicator-lib/reference/zigzag-lib-source.pine` — the
  verified source for manual comparison

## Edge Cases

- Asymmetric depths where `leftDepth` ≠ `rightDepth` — verify the
  `findPivotPoint` loop bounds are correct
- `leftDepth` or `rightDepth` below 2 — verify clamping to 2
- Very small `devThreshold` — many pivots, verify no performance issues
- Very large `devThreshold` — few pivots, verify correct behavior
- `allowZigZagOnOneBar = false` with a bar that has both the highest high
  and lowest low — verify only one pivot registered
- Projection with no confirmed pivots yet — verify no projection drawn

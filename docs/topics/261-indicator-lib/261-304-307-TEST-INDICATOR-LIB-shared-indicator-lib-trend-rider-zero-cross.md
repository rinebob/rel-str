**Topic:** Trading Indicator Library  
**Topic Slug:** indicator-lib  
**Thread:** Trend Rider Zero Cross  
**Thread Slug:** trend-rider-zero-cross  
**Issue:** #307  
**Thread Parent:** #304  
**Topic Parent:** #261  
**Domain:** INDICATOR-LIB  
**Type:** Test Plan  
**Status:** Complete  
**Created:** 2026-09-13  
**Last Updated:** 2026-09-13  

---

## Overview

Unit tests for the TS zero-cross detection function and manual verification
that Pine and TS produce identical dots.

## Test Target

`detectZoneZeroCrossDots` in
`src/app/features/shared/components/flex-chart/indicators/st-trend-rider-dots.indicator.ts`

Pure function: zone data + price bars → dot points. No mocking required.

## Test Location

`src/app/features/shared/components/flex-chart/indicators/st-trend-rider-dots.indicator.spec.ts`
(extend existing spec if one exists, otherwise create new)

## Test Seams

The highest-value seam is the `detectZoneZeroCrossDots` function. Given
synthetic zone data and price bars, the dot positions and colors are
deterministic.

## Unit Test Cases

### detectZoneZeroCrossDots — Basic detection

1. **Bullish cross:** Zone data goes from -1 to +1 between consecutive
   bars. Assert a long dot appears at `bar.low - ATR*2.5` with teal color.

2. **Bearish cross:** Zone data goes from +1 to -1 between consecutive
   bars. Assert a short dot appears at `bar.high + ATR*2.5` with orange
   color.

3. **No cross (same sign):** Zone goes from +1 to +2. Assert no dot.

4. **No cross (through zero):** Zone goes from -1 to 0. Assert no dot
   (landed on neutral, not a new sign).

5. **No cross (from zero):** Zone goes from 0 to +1. Assert no dot
   (0 is neutral, not a sign).

### detectZoneZeroCrossDots — Jump cases

6. **Jump over zero:** Zone goes from -2 to +1. Assert bullish cross dot
   fires (sign flipped).

7. **Large jump:** Zone goes from +3 to -3. Assert bearish cross dot
   fires (sign flipped).

8. **Jump to zero:** Zone goes from -2 to 0. Assert no dot (landed on
   neutral).

### detectZoneZeroCrossDots — Multiple crosses

9. **Multiple crosses in sequence:** Zone goes -1→+1→-1→+1 over 4 bars.
   Assert 4 dots: long, short, long, short.

10. **Crosses interspersed with flat zones:** Zone goes -1→+1→+1→-1.
    Assert 2 dots: long on first cross, short on second cross. Flat bar
    produces no dot.

### detectZoneZeroCrossDots — Edge cases

11. **Empty input:** Empty zone data. Assert empty result.

12. **Single bar:** One bar of zone data. Assert empty result (need at
    least 2 bars to detect a cross).

13. **All zero zones:** All zone values are 0. Assert no dots.

14. **V1 range:** Zone values span -3 to +3. Verify crosses at every
    sign-flip boundary.

15. **V2 range:** Zone values span -4 to +4. Verify crosses at every
    sign-flip boundary.

### detectZoneZeroCrossDots — Placement

16. **ATR offset:** Verify dot Y position uses `bar.low - ATR(14)*2.5`
    for longs and `bar.high + ATR(14)*2.5` for shorts.

17. **Color assignment:** Verify long dots use teal (`#009688`) and short
    dots use orange (`#FF9800`).

## Pine vs TS Parity (Manual)

1. Load the same symbol/period in both TradingView (Pine) and the local
   flex-chart (TS).
2. Enable the Zones indicator in both.
3. Compare zero-cross dots bar-by-bar:
   - Same bars have dots
   - Same dot placement (above/below bar)
   - Same dot colors
4. Test with a symbol that has clear regime shifts (e.g., SPY during a
   market correction) to verify multiple crosses render correctly.

## Chart Wiring (Manual)

1. Run `npm start` (dev server).
2. Open the chart for a symbol.
3. Add the Zones indicator.
4. Confirm zero-cross dots appear on the main price pane:
   - Teal hollow circles below bars for bullish crosses
   - Orange hollow circles above bars for bearish crosses
5. Confirm zero-cross dots and Trend Rider confirmation dots both render
   without hiding each other.

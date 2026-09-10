**Topic:** Trading Indicator Library  
**Topic Slug:** indicator-lib  
**Thread:** Standard Deviation Lines  
**Thread Slug:** std-dev-lines  
**Issue:** #264  
**Thread Parent:** #262  
**Topic Parent:** #261  
**Domain:** INDICATOR-LIB  
**Type:** Test Plan  
**Status:** Draft  
**Created:** 2026-09-09  
**Last Updated:** 2026-09-09  

---

## Overview

Unit tests for the BE computation engine (`std-dev-lines.ts`). The FE chart
indicator is verified manually by running the dev server and confirming the
bands render correctly.

## Test Target

`functions/src/indicators/std-dev-lines.ts`

Pure function: `computeStdDevLines`. No Firestore, no I/O, no external
dependencies. Tests use synthetic `OHLCV[]` bars with known prices.

## Test Location

`tests/functions/std-dev-lines.test.ts`

Run via: `npx tsx --test ../tests/functions/std-dev-lines.test.ts` (from
`functions/`), following the existing test pattern.

## Test Seams

The highest-value seam is the pure computation module. Given synthetic bars
with known close prices, the center line, std dev, and band values are all
deterministic. No mocking required.

## Unit Test Cases

### computeStdDevLines — SMA center line

1. **Basic SMA center line:** 5 bars with closes [100, 101, 102, 103, 104],
   period=5. Assert center line at bar 4 = 102.0 (mean of all 5).

2. **SMA NaN for insufficient data:** Same 5 bars, period=5. Assert center
   line values at bars 0-3 are NaN.

3. **SMA with longer period:** 10 bars, period=10. Assert center line at
   bar 9 = mean of all 10 closes. Assert bars 0-8 are NaN.

### computeStdDevLines — EMA center line

4. **Basic EMA center line:** 5 bars, period=3. Assert EMA seed at bar 2 =
   SMA of first 3 closes. Assert EMA at bar 3 and 4 follow the EMA formula.

5. **EMA NaN for insufficient data:** 2 bars, period=3. Assert all center
   line values are NaN.

### computeStdDevLines — Standard deviation

6. **Basic std dev:** 5 bars with closes [100, 101, 102, 103, 104], period=5,
   SMA center. Assert std dev at bar 4 = sqrt(2.0) ≈ 1.414 (population std
   dev of [100,101,102,103,104] with mean 102).

7. **Std dev with constant prices:** 5 bars all with close=100, period=5.
   Assert std dev at bar 4 = 0 (no variance).

8. **Std dev NaN for insufficient data:** Same as SMA — first `period - 1`
   bars have NaN std dev.

### computeStdDevLines — Regular bands

9. **Regular band values:** 5 bars, period=5, SMA center=102, std dev≈1.414.
   Assert upper band at level 1.0 = 102 + 1.414 ≈ 103.414. Assert lower
   band at level 1.0 = 102 - 1.414 ≈ 100.586.

10. **All regular levels:** Default levels [0.5, 1.0, 1.5, 2.0, 2.5]. Assert
    each upper band = center + level × stdDev and each lower band = center -
    level × stdDev.

11. **Band symmetry:** Assert upper and lower bands are symmetric around
    the center line for each level.

### computeStdDevLines — Fibonacci bands

12. **Fibonacci band values:** Same setup. Assert upper band at level 0.618
    = 102 + 0.618 × 1.414. Assert lower band at level 0.618 = 102 - 0.618 ×
    1.414.

13. **All Fibonacci levels:** Default levels [0.618, 1.618, 2.618]. Assert
    each band value is correct.

### computeStdDevLines — Configuration

14. **Custom std dev levels:** Config with `stdDevLevels: [1.0, 2.0]`.
    Assert only those levels are computed.

15. **Custom fib dev levels:** Config with `fibDevLevels: [1.618]`. Assert
    only that level is computed.

16. **EMA center line config:** Config with `centerLineType: 'ema'`. Assert
    center line matches EMA calculation.

17. **Custom period:** Config with `period: 10`. Assert center line and std
    dev use 10-bar window.

### computeStdDevLines — Edge cases

18. **Empty input:** Empty `OHLCV[]`. Assert no crash, empty result arrays.

19. **Single bar:** One bar. Assert all values are NaN (insufficient data for
    any reasonable period).

20. **Bars fewer than period:** 3 bars, period=5. Assert all center line and
    band values are NaN.

21. **All same price:** All bars have the same close. Assert std dev = 0,
    all bands = center line.

## Edge Cases

- **NaN prices:** Bars with NaN close should be handled gracefully (skip or
  treat as 0, matching `emaSeries` behavior).
- **Zero period:** Config with `period: 0`. Should return all NaN or throw.
- **Negative period:** Config with `period: -1`. Should return all NaN or
  throw.

## FE Verification (Manual)

The chart indicator is verified manually by:

1. Running `npm start` (dev server).
2. Opening the chart for SPY or QQQ.
3. Adding the "Std Dev Lines" indicator.
4. Confirming:
   - Center line (SMA or EMA) renders correctly.
   - Regular bands at 0.5, 1.0, 1.5, 2.0, 2.5 std devs render as lines.
   - Fibonacci bands at 0.618, 1.618, 2.618 render as lines.
   - Toggle between regular-only, fib-only, and combined modes works.
   - Combined mode shows fills between nearest regular and Fibonacci lines.
   - Changing the period updates the bands.
   - Switching between SMA and EMA updates the center line.

## Verification Script

`functions/scripts/verify/indicator-lib-265-engine.ts` — loads real SPY
daily bars from Firestore, runs the engine, prints center line and band
values for a sample of dates. Validates structure and NaN handling.

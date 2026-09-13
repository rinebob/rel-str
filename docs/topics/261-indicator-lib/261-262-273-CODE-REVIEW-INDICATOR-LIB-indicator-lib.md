**Topic:** Trading Indicator Library  
**Topic Slug:** indicator-lib  
**Thread:** Standard Deviation Lines  
**Thread Slug:** std-dev-lines  
**Issue:** #262  
**Thread Parent:** #262  
**Topic Parent:** #261  
**Task:** #273  
**Domain:** INDICATOR-LIB  
**Type:** Code Review  
**Status:** Complete  
**Created:** 2026-09-10  
**Last Updated:** 2026-09-10  

---

## Summary

Three review axes (Standards, Spec, Thermo-nuclear) were run against the Pine Script v6 file `rb-ps/rb-ta/ind/rb-st-std-dev-lines.pine` for Task #273 (Export ST StdDevLines to PineScript).

**Verdict: PASS** — All critical and major findings were fixed during review. Remaining findings are minor/nit and deferred.

## Findings by severity

### Critical (fixed)

1. **SMA std dev loop ran in EMA mode** — `rb-st-std-dev-lines.pine:51-60`
   - The `smaStd` O(period) for-loop was guarded by `if not na(sma)` instead of `if maType == "sma"`, so it ran on every bar even when EMA mode was selected.
   - **Fix:** Guarded with `if maType == "sma" and not na(sma)`.

### Major (fixed)

2. **EMA did not carry forward on NaN closes** — `rb-st-std-dev-lines.pine:39-45`
   - The EMA update `emaValue := close * k + emaValue[1] * (1 - k)` became permanently `na` if `close` was `na`, diverging from the TS `emaSeries` which carries forward the previous value.
   - **Fix:** Added `na(close) ? emaValue[1] : ...` carry-forward, matching TS behavior.

3. **EWMA variance did not carry forward on NaN closes** — `rb-st-std-dev-lines.pine:62-79`
   - The variance update did not handle `na(close)`, causing `ewmaVar` to become `na` and freeze.
   - **Fix:** Added `if na(close) ewmaVar := ewmaVar[1]` branch, matching TS `computeEmaStdDev`.

4. **EMA and EWMA computations ran in SMA mode** — `rb-st-std-dev-lines.pine:41, 67`
   - The EMA and EWMA blocks ran on every bar regardless of `maType`, wasting computation in SMA mode.
   - **Fix:** Guarded both blocks with `if maType == "ema"`.

### Minor (fixed)

5. **Colors were inline literals instead of named constants** — `rb-st-std-dev-lines.pine:28-36`
   - Other ST Pine files use named color constants (e.g., `rb-st-trend-strength.pine`).
   - **Fix:** Extracted `CENTER_COLOR`, `REG_COLOR_05`..`REG_COLOR_25`, `FIB_COLOR_06`..`FIB_COLOR_26` as `const color` constants.

### Minor (deferred)

6. **Core math is top-level instead of `f_*` helper functions** — `rb-st-std-dev-lines.pine:32-84`
   - Sibling files (`rb-st-trend-bands.pine`, `rb-st-trend-strength.pine`) wrap engines in `f_` functions.
   - **Deferred:** The inline approach is readable for this file's complexity. Refactoring to functions would add indirection without significant benefit for a read-only reference indicator.

7. **SMA std dev O(period) per bar** — `rb-st-std-dev-lines.pine:54-60`
   - The manual for-loop is O(period) per bar. Pine's `ta.stdev(close, period, true)` (population, biased=true) could replace it.
   - **Deferred:** The manual loop matches the TS implementation's explicit computation. Switching to `ta.stdev` would require verifying Pine's `biased` parameter default and NaN handling. Can be optimized later if performance is an issue at high periods.

### Nit (deferred)

8. **Output variables lack `st` prefix** — `rb-st-std-dev-lines.pine:97-150`
   - Sibling files prefix series (`stCtfFastOpen`, `stDiPlus`). This file uses `rUp05`, `fUp06`, `center`.
   - **Deferred:** The `r`/`f` prefix convention is clear and readable. No collision risk in a standalone indicator.

9. **Indicator title uses camelCase** — `rb-st-std-dev-lines.pine:5`
   - `"Savant Trader StdDevLines"` vs sibling pattern `"Savant Trader Trend Bands"`.
   - **Deferred:** Minor cosmetic difference. The short title `"ST StdDev"` is clear.

## Spec accounting

| PRD requirement | Status | Notes |
|---|---|---|
| Center line: SMA or EMA, configurable period (default 50) | MET | Inputs match TS |
| Population std dev (divide by N) | MET | Manual computation, `/ period` |
| SMA rolling-window std dev | MET | For-loop over window |
| EMA exponentially-weighted std dev, same decay factor | MET | `alpha = 2/(period+1)`, EWMA update |
| Regular bands: 0.5, 1.0, 1.5, 2.0, 2.5 | MET | 5 levels, gray gradient |
| Fibonacci bands: 0.618, 1.618, 2.618 | MET | 3 levels, green gradient |
| Three display modes | MET | regular-only, fib-only, combined |
| Combined mode fills at 8% opacity | MET | `color.new(..., 92)` |
| Colors match TS implementation | MET | RGB values match hex codes |
| NaN handling: first period-1 bars produce na | MET | ta.sma and var initialization |
| EMA NaN carry-forward | MET (fixed) | `na(close) ? emaValue[1] : ...` |
| Band formula: center ± level × stdDev | MET | All 16 bands |
| Nearest fib mapping for fills | MET | 0.5→0.618, 1.0→0.618, 1.5→1.618, 2.0→1.618, 2.5→2.618 |

## Test results

- **Pine compilation:** Not run in this environment — requires TradingView Pine v6 compiler. User should paste into TradingView to verify.
- **TypeScript:** `npx tsc --noEmit -p tsconfig.json` — 1 pre-existing error in `indicator-config-dialog.component.ts` (from #269, not #273).
- **Functions build:** `cd functions && npm run build` — PASS.
- **No automated tests for Pine files** — consistent with the existing ST Pine indicators (#228-#233).

## Verdict

**PASS** — All critical and major findings fixed. The Pine file correctly mirrors the TS StdDevLines implementation. Remaining minor/nit findings are deferred or cosmetic. TradingView visual validation is recommended before final ship.

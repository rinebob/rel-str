**Topic:** Trading Indicator Library  
**Topic Slug:** indicator-lib  
**Thread:** Standard Deviation Lines  
**Thread Slug:** std-dev-lines  
**Issue:** #265  
**Task:** #268  
**Thread Parent:** #262  
**Topic Parent:** #261  
**Domain:** INDICATOR-LIB  
**Type:** Code Review  
**Status:** Complete  
**Created:** 2026-09-09  
**Last Updated:** 2026-09-09  

---

## Summary

Task #268 implements the BE verification script for the Std Dev Lines
computation engine. Three review axes ran in parallel: Standards, Spec,
and Thermo-nuclear. The thermo-nuclear review identified the script as
a structural smoke test rather than a correctness check — this was the
primary driver for the fixes.

## Findings by Severity

### Major

1. **File naming inconsistency** — Files used `265` (Blueprint #) instead
   of `268` (Task #), breaking the existing convention (`strat-lib-257-*`,
   `strat-lib-258-*`).
   **Fix:** Renamed to `indicator-lib-268-engine.ts` and `indicator-lib-268.md`.
   Updated `README.md` and `run-all.ts`.

2. **No golden numeric checks** — The script only validated structure,
   NaN handling, and symmetry. It never checked that `centerLine[i]` equals
   the actual SMA/EMA or that `stdDev[i]` equals the actual population std
   dev. A regression in the math could pass every check.
   **Fix:** Added Part A — deterministic golden-value checks with a synthetic
   fixture (closes [100, 101, 102, 103, 104], period 5). Verifies SMA=102,
   std dev=sqrt(2), all band values match `center ± level × stdDev`, EMA
   seed and EWMA std dev match hand-computed values.

3. **Out-of-bounds false positive** — `!Number.isNaN(result.centerLine[49])`
   treats `undefined` as "not NaN." If fewer than 50 bars loaded, the check
   would pass on `undefined`.
   **Fix:** Changed to `Number.isFinite()` with a `bars.length > PERIOD - 1`
   guard.

4. **No guard against empty/short data** — `check('loaded bars', length > 0)`
   logged failure but didn't return. Next line would throw `TypeError` on
   `rawBars[0].date`.
   **Fix:** Added early `process.exit(1)` on empty data and on
   `rawBars.length < PERIOD`.

5. **Raw-bar mapping defaulted to 0** — `close: b.close ?? 0` would feed
   bogus prices for missing data.
   **Fix:** Reject malformed bars (missing/NaN close) instead of defaulting
   to 0. Count and report skipped bars.

6. **Per-task guide structure didn't match pattern** — Used a different
   layout than `strat-lib-257.md`.
   **Fix:** Reformatted to match: `## Scripts` → `### script.ts` → bold
   headings (`**Command:**`, `**What it does:**`, etc.) + `## Pipeline
   stages covered` + `## Order`.

### Minor

7. **Band formula not verified** — Only checked symmetry and upper-band
   ordering, never that `upper = center + level × stdDev`.
   **Fix:** Added formula verification at first, middle, and last bar.

8. **Symmetry checks sampled at only one bar** — Only the last bar.
   **Fix:** Added checks at first non-NaN bar, middle, and last bar.

9. **EMA verification incomplete** — Only checked regular band symmetry,
   not fib bands, ordering, or formula.
   **Fix:** Added complete EMA checks: formula, symmetry (regular + fib),
   ordering (regular + fib, upper + lower).

10. **Lower-band ordering not checked** — Only upper bands.
    **Fix:** Added lower-band ordering checks (lower narrows with higher level).

11. **EMA-vs-SMA threshold brittle** — Used `> 0.01` absolute, which fails
    for low-priced symbols. Changed to `> 0.01%` relative, which still
    failed because EMA and SMA converge with 1803 bars.
    **Fix:** Changed to `!==` (not identical), which catches a bug where
    EMA accidentally uses SMA calculation.

12. **Engine edge cases not exercised** — Empty input, period=0,
    non-integer period not tested.
    **Fix:** Added edge case checks in Part A.

### Nit

13. **Band lookup repeated in loop** — `result.regularBands.find(...)`
    called inside the 5-bar print loop.
    **Fix:** Extracted `reg1` and `fib1618` before the loop.

14. **Last-5-bar loop negative indices** — `bars.length - 5` could be
    negative for tiny datasets.
    **Fix:** Used `Math.max(bars.length - 5, 0)`.

15. **Guide "failing result" text inaccurate** — Said "prints count of
    failed checks" but script prints `passed/total`.
    **Fix:** Updated guide text to match actual output.

## Test Results

| Check | Result |
|---|---|
| Verification script | 184/184 checks pass against real Firestore |
| SDS tests | 81/81 pass |
| Build | Succeeds |
| Typecheck | Only 2 pre-existing `broker-order-adapter.ts` errors (unrelated) |

## Verdict

**PASS** — All major findings fixed. The script now has two parts:
Part A (deterministic golden-value checks) and Part B (real Firestore
data with formula, symmetry, ordering, and EMA verification). 184 checks
pass. Build succeeds. No new typecheck errors.

**Topic:** Trading Indicator Library  
**Topic Slug:** indicator-lib  
**Thread:** Standard Deviation Lines  
**Thread Slug:** std-dev-lines  
**Issue:** #265  
**Task:** #267  
**Thread Parent:** #262  
**Topic Parent:** #261  
**Domain:** INDICATOR-LIB  
**Type:** Code Review  
**Status:** Complete  
**Created:** 2026-09-09  
**Last Updated:** 2026-09-09  

---

## Summary

Task #267 implements the BE computation engine for Standard Deviation Lines
and its unit tests. Three review axes ran in parallel: Standards, Spec, and
Thermo-nuclear.

## Findings by Severity

### Critical

1. **OHLCV type mismatch in test helper** — `std-dev-lines.test.ts:19` imported
   `OHLCV` from `st-trend-bands.ts` (no `date` field) but the `bar()` helper
   returned an object with `date`. Under `strict: true` this is an excess-
   property compile error.
   **Fix:** Removed `date` from the `bar()` helper — the engine only uses
   `close`, so `date` is not needed for testing.

### Major

2. **Duplicate OHLCV declaration** — `std-dev-lines.ts:23` re-declared
   `OHLCV` instead of importing it. The repo already has `OHLCV` in
   `st-trend-bands.ts`, and the established pattern is to import it.
   **Fix:** Import `OHLCV` from `./st-trend-bands` instead of re-declaring.

3. **EMA std dev NaN handling** — `computeEmaStdDev` did not guard against
   `NaN` closes. One `NaN` in the seed window or update step would poison
   the variance permanently.
   **Fix:** Skip `NaN` closes in the seed window (divide by `validCount`).
   During the update step, `NaN` closes carry forward the previous variance
   (matching `emaSeries` behavior of carrying forward the EMA value).

4. **No period validation** — `computeStdDevLines` did not validate that
   `period` is a positive integer. Non-integer or invalid periods would
   silently produce wrong output.
   **Fix:** Added `Number.isInteger(period) && period >= 1` check. Invalid
   periods return all-`NaN` arrays.

### Minor

5. **Duplicated band construction logic** — The regular and Fibonacci band
   loops were byte-for-byte identical except for the source array.
   **Fix:** Extracted `buildBands(levels, centerLine, stdDev)` helper.

6. **assertApprox NaN guard** — `assertApprox` treated `NaN` actual as a pass
   because `Math.abs(NaN - expected) >= tol` is `false`.
   **Fix:** Added `Number.isNaN(actual)` guard that fails the assertion.

7. **Dead validCount logic** — `computeRollingStdDev` had a `validCount`
   branch that was effectively dead because `smaSeries` does not tolerate
   `NaN` closes (the center line would already be `NaN`).
   **Fix:** Removed the `validCount` logic — always divide by `period`.

8. **Used `isNaN` instead of `Number.isNaN`** — Global `isNaN` coerces; the
   stricter `Number.isNaN` is already used in the tests.
   **Fix:** Replaced all `isNaN` with `Number.isNaN` in the engine.

9. **Used `assert.equal` instead of `assert.strictEqual`** — The existing
   test pattern uses `assert.strictEqual` for integer/length assertions.
   **Fix:** Replaced all `assert.equal` with `assert.strictEqual`.

10. **Missing outer `describe` wrapper** — Tests used top-level `describe`
    blocks without a function-level wrapper.
    **Fix:** Wrapped all groups in `describe('computeStdDevLines', ...)`.

### Nit

11. **CenterLineType comment promised VWAP** — The comment advertised future
    `'vwap'` support, but the union did not include it.
    **Fix:** Removed the future-tense VWAP reference from the comment.

## Test Results

| Check | Result |
|---|---|
| Unit tests (std-dev-lines) | 30/30 pass |
| SDS tests | 81/81 pass |
| Build | Succeeds |
| Typecheck | Only 2 pre-existing `broker-order-adapter.ts` errors (unrelated) |

## Spec Coverage

All PRD acceptance criteria for the BE engine are met:
- Pure computation module at the specified path
- `computeStdDevLines` with correct signature
- Config with `centerLineType`, `period`, `stdDevLevels`, `fibDevLevels`
- SMA and EMA center lines
- Population std dev (SMA: rolling-window, EMA: exponentially-weighted)
- Regular bands at default levels [0.5, 1.0, 1.5, 2.0, 2.5]
- Fibonacci bands at default levels [0.618, 1.618, 2.618]
- NaN for first `period-1` bars
- Empty input, single bar, insufficient data handled
- Custom levels and period configurable

Deferred (separate tasks):
- FE chart indicator (Task #269)
- Firestore verification script (Task #268)

## Verdict

**PASS** — All critical and major findings fixed. All minor findings
addressed. Tests pass (30/30 + 81/81). Build succeeds. No new typecheck
errors.

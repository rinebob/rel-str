# Verification Guide: strat-lib-257 — Return Computation Module

## Scripts

### strat-lib-257-compute.ts

Verifies the pure return computation module (`open-close-returns.ts`) with
realistic OHLCV bars matching the normalized shape from `loadAllDailyBars`.

**Command:**
```
cd functions
npx tsx scripts/verify/strat-lib-257-compute.ts
```

**Arguments/flags:** None.

**What a passing result looks like:**
```
=== All verification checks passed ===
```
All 9 checks print ✔ before the summary. Exit code 0.

**What a failing result looks like:**
An `AssertionError` with `actual` vs `expected` values. Exit code 1.

**Setup/teardown:** None required. No Firestore, no ADC, no external dependencies.

## Pipeline stages covered

1. **Return computation** — `computeOpenCloseReturns` produces correct intraday
   and overnight returns, fixed-amount P&L, compounded equity, and metrics.
2. **Metrics computation** — `computeDailyReturnMetrics` (delegating to `computeMetricsCore`) produces correct win/loss
   counts, profit factor, max drawdown, and Sharpe ratio.
3. **Edge cases** — first day has no overnight return, skipped days are tracked.

## Order

Run this script after the unit tests pass:
```
cd functions
npx tsx --test ../tests/functions/open-close-returns.test.ts
npx tsx scripts/verify/strat-lib-257-compute.ts
```

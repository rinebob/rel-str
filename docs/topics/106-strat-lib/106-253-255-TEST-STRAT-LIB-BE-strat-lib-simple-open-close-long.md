**Topic:** Trading Strategy Library
**Topic Slug:** strat-lib
**Thread:** Simple Open-Close Long
**Thread Slug:** simple-open-close-long
**Issue:** #255
**Thread Parent:** #253
**Topic Parent:** #106
**Domain:** STRAT-LIB
**Type:** Test Plan
**Status:** Complete
**Created:** 2026-09-09
**Last Updated:** 2026-09-09

---

## Overview

Unit tests for the return computation module (`open-close-returns.ts`). The script
runner is integration-level (Firestore + file I/O) and is not unit-tested — it's
verified by running it against real data.

## Test Target

`functions/src/st-cloud-function/backtest/open-close-returns.ts`

Pure functions: `computeOpenCloseReturns` and `computeReturnMetrics`. No Firestore, no
I/O, no external dependencies. Tests use synthetic `OHLCV[]` bars with known prices.

## Test Location

`tests/functions/open-close-returns.test.ts`

Run via: `tsx --test ../tests/functions/open-close-returns.test.ts` (from `functions/`),
following the existing SDS test pattern.

## Test Seams

The highest-value seam is the pure computation module itself. Given synthetic bars with
known open/close prices, the returns, P&L, equity, and metrics are all deterministic.
No mocking required.

## Unit Test Cases

### computeOpenCloseReturns

1. **Basic intraday return (Strat 1):** Two bars where day 2 has open=100, close=105.
   Assert `intradayReturn = 0.05` (5%).

2. **Basic overnight return (Strat 2):** Two bars where day 1 close=100, day 2 open=103.
   Assert `overnightReturn = 0.03` (3%).

3. **Negative intraday return:** Bar with open=100, close=95. Assert
   `intradayReturn = -0.05`.

4. **Negative overnight return:** Prior close=100, open=97. Assert
   `overnightReturn = -0.03`.

5. **First day has no overnight return:** The first bar has no prior close, so
   `overnightReturn` should be null/undefined and `skipped` should be true for Strat 2
   on that day. Strat 1 (intraday) should still compute normally for the first bar.

6. **Missing open skips both strategies:** Bar with open=0 or undefined. Assert
   `skipped = true`, `skipReason` mentions missing open, both returns are null.

7. **Missing close skips intraday and next day's overnight:** Bar with close=0. Assert
   `skipped = true` for that day's intraday. Also assert the next day's overnight is
   skipped because prior close is invalid.

8. **Fixed-amount P&L calculation:** With `fixedAmount = 100000` and
   `intradayReturn = 0.05`, assert `intradayFixedPnl = 5000`.

9. **Compounded equity curve:** With `initialEquity = 100000`, day 1 return = 0.05,
   day 2 return = 0.03. Assert day 1 equity = 105000, day 2 equity = 108150.

10. **Skipped day count:** Mix of valid and invalid bars. Assert `skippedCount` matches
    the number of skipped days.

11. **Date range and bar count:** Assert `dateRange.first` and `dateRange.last` match
    the first and last bar dates, and `barCount` matches the input length.

### computeReturnMetrics

12. **Win/loss counts:** Daily P&L of [+500, -200, +300, -100]. Assert `winCount = 2`,
    `lossCount = 2`, `tradeCount = 4`.

13. **Gross profit and loss:** Same input. Assert `grossProfit = 800`, `grossLoss = 300`.

14. **Profit factor:** Assert `profitFactor = 800 / 300 ≈ 2.667`.

15. **Percent profitable:** Assert `percentProfitable = 50.0`.

16. **Total net profit:** Assert `totalNetProfit = 500`.

17. **Max drawdown from equity curve:** Equity curve with a peak followed by a trough.
    Assert `maxDrawdown` and `maxDrawdownPct` match the peak-to-trough decline.

18. **Sharpe ratio from equity curve:** Equity curve with known daily returns. Assert
    `sharpeRatio` is computed correctly (annualized, sqrt(252)).

19. **Empty input:** Empty `dailyPnl` and `equityCurve`. Assert no crash, all metrics
    zero.

## Edge Cases

- **Single bar:** Only one bar — Strat 1 computes, Strat 2 has no prior close (skipped).
- **All bars skipped:** Every bar has missing data — `skippedCount = barCount`, metrics
  all zero, equity curve is just the initial equity.
- **Zero-price bars:** Open or close = 0 should be treated as missing, not as a valid
  price.
- **NaN/Infinity:** Non-finite values in open/close should be treated as missing.

## Integration Verification (Manual)

The script runner is verified manually by running:
```
cd functions
npx tsx scripts/open-close-strategy-comparison.ts
```

Verify:
- Console prints date range and bar count for SPY and QQQ.
- Console prints summary table with metrics for both strategies.
- Console prints Strat 2 / Strat 1 return ratio.
- JSON file is written to `functions/scripts/output/open-close-comparison.json`.
- JSON file contains per-day records for all symbols and strategies.

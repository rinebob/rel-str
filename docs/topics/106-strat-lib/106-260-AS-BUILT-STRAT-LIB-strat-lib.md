**Topic:** Trading Strategy Library
**Topic Slug:** strat-lib
**Issue:** #260
**Topic Parent:** #106
**Domain:** STRAT-LIB
**Type:** As-Built
**Status:** Complete
**Created:** 2026-09-09
**Last Updated:** 2026-09-09

---

## As-Built — Topic #106: Trading Strategy Library

### Overview

The Trading Strategy Library is a permanent umbrella for independently managed trading strategy research Threads. Each Thread researches a mechanical strategy against historical OHLCV data, verifies or rejects a claimed edge, and produces a daily record suitable for backtest analysis.

### What was built

#### Thread #253 — Simple Open-Close Long

Two mirrored strategy flavors:
1. **Intraday (Strat 1):** Buy at open, sell at close. Return = `(close - open) / open`.
2. **Overnight (Strat 2):** Buy at close, sell at next day's open. Return = `(open - priorClose) / priorClose`.

##### Task #257 — Return computation module + unit tests

A pure backend module with no Firestore or I/O dependencies:

- `functions/src/st-cloud-function/backtest/open-close-returns.ts` — `computeOpenCloseReturns()` computes both strategies' daily returns, fixed-amount P&L, compounded equity curves, and aggregate `BacktestMetrics` for each strategy.
- `functions/src/st-cloud-function/backtest/backtest-metrics.ts` — Shared `computeMetricsCore()` used by both trade-based `computeMetrics()` and return-based `computeDailyReturnMetrics()`.
- `functions/src/st-cloud-function/backtest/backtest-math-helpers.ts` — Shared `safeDiv`, `stdDev`, `TRADING_DAYS_PER_YEAR`.
- `tests/functions/open-close-returns.test.ts` — 48 unit tests covering returns, edge cases, invalid prices, fixed P&L, compounded equity, full metrics through pipeline, and input validation.

##### Task #258 — Script runner for open-close strategy comparison

- `functions/scripts/open-close-strategy-comparison.ts` — Loads SPY and QQQ daily bars from Firestore, runs the computation module, writes JSON output with run metadata, and prints a console summary table with P&L ratios.
- `functions/scripts/verify/strat-lib-258-comparison.ts` — 42-check verification script that runs the actual runner and cross-checks with independent computation.

### Architecture decisions

1. **Pure computation module** — `computeOpenCloseReturns` takes `OHLCV[]` and returns `OpenCloseSymbolResult` with no I/O. This allows unit testing without Firestore and future extraction for production deployment.

2. **Shared metrics core** — `computeMetricsCore()` eliminates duplicated metrics algorithm between trade-based and return-based callers. Both `computeMetrics()` and `computeDailyReturnMetrics()` delegate to it.

3. **Compounded metrics coherence** — Metrics are derived from the compounded equity curve (not fixed-amount P&L) so all fields describe a single coherent pass. Fixed-amount totals are preserved separately.

4. **Seeded equity curves** — Equity curves start with the initial-equity point so the first daily return is included in the Sharpe calculation.

5. **Input validation** — `computeOpenCloseReturns` throws `RangeError` for non-positive or non-finite `fixedAmount` and `initialEquity`.

6. **Verification scripts shell out to the real runner** — The #258 verification script runs the actual script runner via `execFileSync` rather than reconstructing the pipeline, ensuring the CLI, file I/O, and console output are all exercised.

### Deviations from original design

1. **Function name** — The implementation plan referenced `computeReturnMetrics`; the actual export is `computeDailyReturnMetrics` (delegating to `computeMetricsCore`). More descriptive.

2. **`symbol` parameter** — `computeOpenCloseReturns` added an optional `symbol` parameter not in the original plan. Backward-compatible, needed for the result structure.

3. **JSON output metadata** — The JSON output includes `generatedAt`, `fixedAmount`, and `initialEquity` run metadata not specified in the plan. Added for provenance.

### Research findings

The original claim was that the overnight strategy is "approximately 10x more profitable" than the intraday strategy. The data does **not** support this:

| Symbol | Intraday P&L | Overnight P&L | Ratio |
|---|---|---|---|
| SPY | $46,571 | $75,308 | 1.62x |
| QQQ | $64,668 | $129,284 | 2.00x |

Overnight is more profitable, but by ~1.6-2x, not 10x. Both strategies are profitable with positive Sharpe ratios, but the edge is modest.

### Files created

```
functions/src/st-cloud-function/backtest/open-close-returns.ts
functions/src/st-cloud-function/backtest/backtest-metrics.ts
functions/src/st-cloud-function/backtest/backtest-math-helpers.ts
functions/scripts/open-close-strategy-comparison.ts
functions/scripts/verify/strat-lib-257-compute.ts
functions/scripts/verify/strat-lib-257.md
functions/scripts/verify/strat-lib-258-comparison.ts
functions/scripts/verify/strat-lib-258.md
functions/scripts/verify/run-all.ts
functions/scripts/verify/README.md
tests/functions/open-close-returns.test.ts
docs/topics/106-strat-lib/106-253-254-PRD-STRAT-LIB-strat-lib-simple-open-close-long.md
docs/topics/106-strat-lib/106-253-255-IMPL-STRAT-LIB-BE-strat-lib-simple-open-close-long.md
docs/topics/106-strat-lib/106-253-255-TEST-STRAT-LIB-BE-strat-lib-simple-open-close-long.md
docs/topics/106-strat-lib/106-256-257-CODE-REVIEW-STRAT-LIB-strat-lib.md
docs/topics/106-strat-lib/106-256-258-CODE-REVIEW-STRAT-LIB-strat-lib.md
docs/topics/106-strat-lib/106-260-AS-BUILT-STRAT-LIB-strat-lib.md
```

### Issue hierarchy

```
#106 Topic: Trading Strategy Library — CLOSED, 8_LIVE
  └── #253 Thread: Simple Open-Close Long — CLOSED
        ├── #254 Idea: Simple Open-Close Long — CLOSED
        ├── #255 Plan: Simple Open-Close Long — CLOSED
        └── #256 BE Blueprint: Simple Open-Close Long — CLOSED
              ├── #257 BE: Return computation module + unit tests — CLOSED, 8_LIVE
              └── #258 BE: Script runner for open-close strategy comparison — CLOSED, 8_LIVE
```

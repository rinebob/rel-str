**Topic:** Trading Strategy Library
**Topic Slug:** strat-lib
**Thread:** Simple Open-Close Long
**Thread Slug:** simple-open-close-long
**Issue:** #256
**Task:** #257
**Topic Parent:** #106
**Domain:** STRAT-LIB
**Type:** Code Review
**Status:** Draft
**Created:** 2026-09-09
**Last Updated:** 2026-09-09

---

## Summary

Three review axes ran in parallel: Standards, Spec, and Thermo-nuclear. Tests pass (25/25). The implementation is clean and well-typed, but a critical metrics-coherence bug and several major issues must be fixed before shipping.

**Verdict: FAIL**

## Findings by Severity

### Critical

1. **BacktestMetrics mixes fixed-amount P&L with compounded equity curve**
   - File: `functions/src/st-cloud-function/backtest/open-close-returns.ts:195-199, 221-225, 244-248, 272-273`
   - `computeOpenCloseReturns` pushes fixed-amount P&L (`fixedAmount * return`) into `intradayPnl`/`overnightPnl`, but pushes compounded equity into `intradayEquityCurve`/`overnightEquityCurve`. `computeReturnMetrics` then derives `totalNetProfit`, `profitFactor`, win/loss metrics from the fixed P&L, but `maxDrawdown`, `sharpeRatio`, and `calmarRatio` from the compounded curve. The resulting `BacktestMetrics` object does not describe a single coherent pass.
   - **Fix:** Pass daily P&L derived from the compounded equity curve (daily equity change) so all metrics describe the compounded pass. Fixed-amount totals are already preserved separately in `intradayFixedTotalPnl`/`overnightFixedTotalPnl`.

### Major

2. **Calmar ratio formula diverges from existing `backtest-metrics.ts`**
   - File: `functions/src/st-cloud-function/backtest/open-close-returns.ts:146-148`
   - New code: `totalReturn / (maxDrawdownPct / 100)` where `maxDrawdownPct` is against running peak.
   - Existing `backtest-metrics.ts:78-79`: `totalReturn / (maxDrawdown / initialCash)`.
   - These diverge once equity exceeds initial equity. Must match the existing convention.

3. **Equity curves missing initial-equity point — first daily return excluded from Sharpe**
   - File: `functions/src/st-cloud-function/backtest/open-close-returns.ts:222-225, 245-248`
   - The first point pushed is equity *after* day 1. `computeReturnMetrics` starts at `i=1`, so the return from `initialEquity` to the first recorded point is never included in Sharpe.
   - **Fix:** Seed each equity curve with `{ date: bars[0].date, equity: initialEquity }` before the loop, or treat `initialEquity` as the implicit first point.

4. **`safeDiv` and `stdDev` duplicated from `backtest-metrics.ts`**
   - Files: `open-close-returns.ts:69-78` and `backtest-metrics.ts:10-19`
   - Exact duplicates. Extract to a shared helper or import from the existing module.

5. **Tautological tests for Sharpe, profitFactor, maxDrawdownPct**
   - File: `tests/functions/open-close-returns.test.ts:277-289, 317-331, 350-373`
   - Tests recompute the expected value using the same formula as the implementation. They pass by construction and cannot catch a wrong implementation.
   - **Fix:** Use hand-calculated literal expected values, not recomputed formulas.

6. **Overnight strategy P&L, equity, and metrics almost untested**
   - File: `tests/functions/open-close-returns.test.ts:58-82, 184-213`
   - Tests cover `overnightReturn` arithmetic but never assert `overnightFixedPnl`, `overnightCompoundedEquity`, `overnightCompoundedFinalEquity`, or `overnightMetrics` values. Half the output is unverified.

### Minor

7. **Dead import `OpenCloseDailyRecord`**
   - File: `tests/functions/open-close-returns.test.ts:15`
   - Imported but never used. Remove.

8. **Missing tests for non-finite prices, all-skipped, all-wins**
   - File: `tests/functions/open-close-returns.test.ts`
   - `isValidPrice` correctly rejects `NaN`/`Infinity`/negative, but no tests exercise these. All-skipped and all-wins paths are untested.

9. **Missing metric assertions for `average*`, `winLossRatio`, `calmarRatio`**
   - File: `tests/functions/open-close-returns.test.ts:247-386`
   - These metrics are computed but never asserted in tests.

10. **Skipped records store invalid open/close as `0` instead of `null`**
    - File: `functions/src/st-cloud-function/backtest/open-close-returns.ts:256-260`
    - Inconsistent with `priorClose` which uses `null`. Use `null` for all invalid prices.

### Nits

11. **`Math.sqrt(252)` repeated magic number** — extract to a shared constant.
12. **`computeReturnMetrics` name too close to `computeMetrics`** — consider `computeDailyReturnMetrics`.
13. **`assert.strictEqual` on floating-point values** — use tolerance-based assertions.
14. **Repeated test fixtures** — extract shared `pnl`/`equityCurve` fixtures.

## Test Results

- Unit tests: **25/25 pass** via `tsx --test`
- Verification script: **9/9 checks pass**
- Typecheck: clean (2 pre-existing errors in `broker-order-adapter.ts`, unrelated)

## Verdict

**FAIL** — Critical finding #1 (metrics coherence) and major findings #2-#6 must be fixed before shipping.

## What Needs Fixing

1. **Fix metrics coherence** — derive `dailyPnl` from the compounded equity curve so all metrics describe one pass.
2. **Fix Calmar formula** — match `backtest-metrics.ts` convention: `totalReturn / (maxDrawdown / initialEquity)`.
3. **Add initial-equity point** to equity curves so first daily return is included in Sharpe.
4. **Extract `safeDiv`/`stdDev`** to shared helpers or import from existing module.
5. **Replace tautological tests** with hand-calculated expected values.
6. **Add overnight strategy tests** for P&L, equity, and metrics.
7. **Remove dead import**, add missing edge-case tests, fix invalid-price storage to `null`.

---

## Re-Review — 2026-09-09 (Task #257)

### Previous Findings Resolution

All 14 previous findings (1 critical, 5 major, 4 minor, 4 nits) are **FIXED**:

| # | Previous Finding | Status | Evidence |
|---|---|---|---|
| Critical 1 | Metrics mixed fixed P&L with compounded equity | FIXED | `open-close-returns.ts:236-240, 261-264` — dailyPnl now derived from compounded equity changes |
| Major 2 | Calmar formula diverged | FIXED | `open-close-returns.ts:146-148` now matches `backtest-metrics.ts:68-69` |
| Major 3 | Equity curves missing initial point | FIXED | `open-close-returns.ts:199-207` seeds both curves with initialEquity |
| Major 4 | safeDiv/stdDev duplicated | FIXED | Extracted to `backtest-math-helpers.ts`, imported by both modules |
| Major 5 | Tautological tests | FIXED | Tests now use hand-calculated literals with tolerance |
| Major 6 | Overnight untested | FIXED | Overnight P&L, equity, final equity, metrics coherence tests added |
| Minor 7-10, Nits 11-14 | Various | FIXED | Dead import removed, edge cases added, null prices, constant, rename, tolerance, fixtures |

### New Findings

#### Major

1. **`computeDailyReturnMetrics` duplicates the full `computeMetrics` algorithm**
   - Files: `open-close-returns.ts:89-167` and `backtest-metrics.ts:11-89`
   - The previous review extracted `safeDiv`/`stdDev` to shared helpers, but the full metrics algorithm (win/loss, gross P&L, profit factor, max drawdown, Sharpe, Calmar) is still implemented twice. Any future change has to be made in two places.
   - **Fix:** Extract a shared `computeMetricsCore(pnlSeries, equityCurve, initialCash)` that both `computeMetrics` and `computeDailyReturnMetrics` delegate to.

2. **Test file exceeds 400-line threshold**
   - File: `tests/functions/open-close-returns.test.ts` (528 lines)
   - Grew from 387 to 528 lines after adding overnight tests, edge cases, and metric assertions. Exceeds the 400-line strong-smell threshold from coding guidelines.
   - **Fix:** Split into `open-close-returns.test.ts` (computeOpenCloseReturns) and `daily-return-metrics.test.ts` (computeDailyReturnMetrics).

3. **Integration tests don't validate full BacktestMetrics through the pipeline**
   - File: `tests/functions/open-close-returns.test.ts:361-382`
   - Only `totalNetProfit` is asserted through `computeOpenCloseReturns`. Other metrics (profitFactor, sharpeRatio, calmarRatio, maxDrawdown, averages) are only tested via standalone `computeDailyReturnMetrics`, not through the real bar → P&L → equity → metrics pipeline.
   - **Fix:** Add a multi-day fixture and assert full `result.intradayMetrics` and `result.overnightMetrics` against hand-calculated values.

#### Minor

4. **Verification guide references old function name**
   - File: `functions/scripts/verify/strat-lib-257.md:33`
   - Still says `computeReturnMetrics`; should be `computeDailyReturnMetrics`.

5. **No validation for `fixedAmount` / `initialEquity`**
   - File: `open-close-returns.ts:183-188`
   - Negative/zero/NaN values silently accepted, producing misleading metrics.

#### Out of Scope (pre-existing, not introduced by this task)

- `backtest-simulator.ts` doesn't seed its equity curve with initial cash — pre-existing issue affecting existing Sharpe calculations. Not introduced by Task #257.
- `backtest-metrics.ts` mixes realized-trade P&L with mark-to-market equity — pre-existing coherence issue in existing code. Not introduced by Task #257.

### Test Results

- Unit tests: **40/40 pass**
- Verification script: **9/9 checks pass**
- SDS tests: **81/81 pass** (no regressions)
- Typecheck: clean (2 pre-existing errors in `broker-order-adapter.ts`, unrelated)

### Verdict: FAIL

Three major findings remain:
1. Duplicated metrics algorithm — extract shared core
2. Test file too large — split into two files
3. Integration tests incomplete — assert full metrics through pipeline

### What Needs Fixing

1. **Extract shared metrics core** — `computeMetricsCore(pnlSeries, equityCurve, initialCash)` in `backtest-metrics.ts` or a new file; both `computeMetrics` and `computeDailyReturnMetrics` delegate to it.
2. **Split test file** — `open-close-returns.test.ts` for `computeOpenCloseReturns`, `daily-return-metrics.test.ts` for `computeDailyReturnMetrics`.
3. **Add integration metrics tests** — multi-day fixture with hand-calculated full `BacktestMetrics` assertions through `computeOpenCloseReturns`.
4. **Fix verification guide** — update function name reference.
5. **Add input validation** — guard against non-positive `fixedAmount`/`initialEquity`.

---

## Re-Review 3 — 2026-09-09 (Task #257)

### Previous Findings Resolution

All 5 findings from Re-Review 2 (3 major, 2 minor) are **FIXED**:

| # | Previous Finding | Status | Evidence |
|---|---|---|---|
| Major 1 | Duplicated metrics algorithm | FIXED | `computeMetricsCore` in `backtest-metrics.ts:19-97`; both `computeMetrics` and `computeDailyReturnMetrics` delegate to it |
| Major 2 | Test file too large | DEFERRED | User explicitly deferred the test file split |
| Major 3 | Integration tests incomplete | FIXED | Full `BacktestMetrics` assertions through pipeline in `open-close-returns.test.ts:385-458` |
| Minor 4 | Verification guide function name | FIXED | `strat-lib-257.md:33` now references `computeDailyReturnMetrics` |
| Minor 5 | Input validation | FIXED | `RangeError` guards in `open-close-returns.ts:117-122`; tests in `:460-489` |

### New Findings

No critical or major findings. Only minor/nit follow-ups remain.

#### Minor

1. **`computeDailyReturnMetrics` lives in strategy file, not metrics file**
   - File: `open-close-returns.ts:90-96`
   - It's a generic wrapper delegating to `computeMetricsCore`, not strategy-specific. Could be co-located with `computeMetrics` in `backtest-metrics.ts`.
   - **Deferred** — low priority, doesn't affect correctness.

2. **Inline equity-curve type `{ date: string; equity: number }[]` duplicated**
   - Files: `backtest-metrics.ts:21` and `open-close-returns.ts:92`
   - Could extract a shared `EquityCurvePoint` type to `backtest-types.ts`.
   - **Deferred** — low priority.

3. **Integration tests only check `sharpeRatio` for finiteness, not exact value**
   - File: `open-close-returns.test.ts:434, 456`
   - The fixture produces mean-zero returns, so Sharpe is exactly 0. Could assert `approxEqual(m.sharpeRatio, 0)` instead of `Number.isFinite`.
   - **Deferred** — low priority.

4. **Stale doc references to old function name `computeReturnMetrics`**
   - Files: PRD `:162`, TEST plan `:26, 81`, IMPL plan `:50, 52`
   - Docs still say `computeReturnMetrics` but module exports `computeDailyReturnMetrics`.
   - **Deferred** — docs can be updated on next plan pass.

#### Nits

5. **`backtest-math-helpers.ts` header comment is stale**
   - File: `backtest-math-helpers.ts:4-5`
   - Says "used by both backtest-metrics.ts and open-close-returns.ts" but `open-close-returns.ts` now imports `computeMetricsCore` from `backtest-metrics.ts`, not the helpers directly.

6. **Skip-reason deduplication uses fragile substring match**
   - File: `open-close-returns.ts:188`
   - `r.includes('open')` could be replaced with a `Set` of error kinds.

7. **OHLCV alias fallback logic repeated inline**
   - File: `open-close-returns.ts:138, 149-150, 153, 230-231`
   - `bar.date ?? bar.d ?? bar.t` pattern repeated; could extract `getBarDate`/`getBarPrice` helpers.

8. **Input-validation tests don't cover all non-finite cases**
   - File: `open-close-returns.test.ts:460-489`
   - Missing `Infinity`/`-Infinity`/`NaN` for `initialEquity`.

9. **Floating-point assertions produce unhelpful failure messages**
   - File: `open-close-returns.test.ts` (many places)
   - `assert.ok(approxEqual(...))` produces `false == true` without actual/expected values.

### Test Results

- Unit tests: **45/45 pass**
- Verification script: **9/9 checks pass**
- SDS tests: **81/81 pass** (no regressions)
- Typecheck: clean (2 pre-existing errors in `broker-order-adapter.ts`, unrelated)

### Verdict: PASS

No critical or major findings. All previous critical and major findings are fixed and verified. The remaining minor/nit findings are low-priority follow-ups that don't block shipping. The test file split (Major 2 from Re-Review 2) remains explicitly deferred by the user.

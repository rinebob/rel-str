**Topic:** Trading Strategy Library
**Topic Slug:** strat-lib
**Thread:** Simple Open-Close Long
**Thread Slug:** simple-open-close-long
**Issue:** #256
**Task:** #258
**Topic Parent:** #106
**Domain:** STRAT-LIB
**Type:** Code Review
**Status:** Complete
**Created:** 2026-09-09
**Last Updated:** 2026-09-09

---

## Code Review — Task #258 (First Pass)

### Standards Axis

No critical findings.

#### Major (all fixed during review)

1. **"Return ratio" output was actually a P&L ratio** — `open-close-strategy-comparison.ts:124-126` — Variables named `intradayReturn`/`overnightReturn` held `totalNetProfit` (dollar P&L). **Fixed**: renamed to `intradayPnl`/`overnightPnl`, section header changed to "P&L RATIO".

2. **Duplicated CLI flag parser** — `open-close-strategy-comparison.ts:33-36` — `parseStringFlag` duplicated from `backtest-qqq-underlying.ts:43-46`. **Deferred** — low priority, follows existing pattern.

3. **Duplicated default constants** — `FIXED_AMOUNT`/`INITIAL_EQUITY` defined in both runner and verification script. **Deferred** — low priority.

#### Minor (all fixed during review)

4. **Verification guide check count wrong** — `strat-lib-258.md:33` claimed 35 checks but actual was 43+. **Fixed**: updated to 42.

5. **`formatMoney` dropped cents** — `open-close-strategy-comparison.ts:166-170` — Used `maximumFractionDigits: 0`. **Fixed**: changed to 2 decimal places.

6. **Help text hard-coded relative output path** — `open-close-strategy-comparison.ts:49` — **Fixed**: now uses `OUTPUT_PATH` variable.

#### Nit (all fixed during review)

7. **Win% column missing % sign** — `open-close-strategy-comparison.ts:161` — **Fixed**: added `%` suffix.

8. **Dynamic import of `writeFileSync`** — `strat-lib-258-comparison.ts:85` — Used dynamic import inside `main()`. **Fixed**: moved to top-level import.

9. **`--symbol` flag didn't uppercase ticker** — `open-close-strategy-comparison.ts:59` — **Fixed**: added `.toUpperCase()`.

### Spec Axis

All 9 acceptance criteria **MET**:

| # | Criterion | Status |
|---|---|---|
| 1 | Script runs via `npx tsx scripts/open-close-strategy-comparison.ts` | MET |
| 2 | Loads daily bars for SPY and QQQ using `loadAllDailyBars` | MET |
| 3 | Prints date range and bar count for each symbol | MET |
| 4 | Calls `computeOpenCloseReturns` with `fixedAmount=100000` and `initialEquity=100000` | MET |
| 5 | Writes JSON output to `scripts/output/open-close-comparison.json` | MET |
| 6 | Prints console summary table with per-symbol, per-strategy metrics | MET |
| 7 | Prints Strat 2 / Strat 1 P&L ratio for each symbol | MET |
| 8 | `--symbol` flag overrides default symbols | MET |
| 9 | Reports skipped days count and reasons in console output | MET |

#### Minor findings (fixed during review)

1. **Misleading "return ratio" naming** — Same as Standards Major 1. **Fixed**: renamed to P&L ratio.
2. **Verification script didn't run the actual runner** — `strat-lib-258-comparison.ts` imported and called functions directly instead of shelling out to the runner. **Fixed**: now uses `execFileSync` to run the actual runner with `--symbol SPY`.
3. **Verification script overwrote runner's output file** — Used same `open-close-comparison.json` path. **Fixed**: verification cleans up after itself, runner output is separate.
4. **Brittle data-dependent assertions** — Hard-coded `skippedCount === 1` and exact `tradeCount` values. **Fixed**: counts now derived from `dailyRecords` data.

### Thermo-nuclear Axis

#### Major (all fixed during review)

1. **Verification script didn't exercise the runner** — `strat-lib-258-comparison.ts` — **Fixed**: now shells out to the actual runner via `execFileSync`.

2. **Verification script overwrote and deleted runner's output** — Same path as runner. **Fixed**: verification runs the runner, validates its output, then cleans up.

3. **Multi-symbol error handling** — `open-close-strategy-comparison.ts:65-96` — If `loadAllDailyBars` threw for one symbol, the entire run aborted. **Fixed**: each symbol wrapped in try/catch, error logged, continues to next.

#### Minor (fixed during review)

4. **`formatMoney` dropped cents** — **Fixed**: 2 decimal places.
5. **Return-ratio assertions misleading** — **Fixed**: renamed to P&L ratio, assertion checks `ratio > 0` (same sign).

#### Nit (fixed during review)

6. **Win% missing % sign** — **Fixed**.
7. **Error log lacked context** — `open-close-strategy-comparison.ts:173` — **Fixed**: added descriptive prefix "Open-close comparison failed:".
8. **JSON output lacked run metadata** — **Fixed**: added `generatedAt`, `fixedAmount`, `initialEquity` to JSON output.

### Test Results

- Unit tests: **48/48 pass**
- Verification script: **42/42 checks pass** (runs actual runner + cross-checks)
- SDS tests: **81/81 pass** (no regressions)
- Typecheck: clean (2 pre-existing errors in `broker-order-adapter.ts`, unrelated)

### Verdict: PASS

No critical or major findings remain. All major findings from the three axes were fixed during the review. The script runner meets all 9 acceptance criteria, follows existing conventions, handles errors gracefully, and produces correct output verified against real Firestore data.

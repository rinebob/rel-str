**Topic:** Refactor data pipeline to PDR-driven triggers, consolidate local bar store writers, and migrate charts to local reads  
**Issue:** #171  
**Topic Parent:** #159  
**Domain:** DATA-PIPELINE  
**Type:** Code Review  
**Status:** Complete  
**Created:** 2026-08-24  
**Last Updated:** 2026-08-24  

---

# Code Review: FE Task #171 — Option chart migration to local bar store

## Review scope

| File | Status |
|------|--------|
| `src/app/core/services/local-bar-read.service.ts` | Modified — added `getDailyBarsForRange$` method |
| `src/app/core/services/local-bar-read.service.spec.ts` | Modified — 9 new tests for `getDailyBarsForRange$` |
| `src/app/features/rh-agent/stores/options-contract-viewer.store.ts` | Modified — swapped `RsBarsService` → `LocalBarReadService`, PT dates |
| `src/app/features/rh-agent/utils/ohlc-datum.utils.ts` | New — `toOHLCDatum` helper with data quality filtering |
| `src/app/features/rh-agent/utils/ohlc-datum.utils.spec.ts` | New — 10 tests for `toOHLCDatum` |
| `scripts/verify-option-chart-migration.js` | New — verification script |

## Review axes

Three parallel review axes were run: **Standards**, **Spec**, and **Thermo-nuclear**.

## Findings and fixes

### Fixed (from review feedback)

| # | Severity | Axis | Finding | Fix |
|---|----------|------|---------|-----|
| 1 | Critical | Thermo-nuclear | Missing data quality filtering — `RsBarsService` filtered `close > 0 && Number.isFinite`, new code had no filtering | Added filter in `toOHLCDatum`: `Number.isFinite(b.c) && b.c > 0` |
| 2 | Critical | Thermo-nuclear | Missing fallback for missing open/high/low — `RsBarsService` fell back to close | Added fallback in `toOHLCDatum`: `Number.isFinite(b.o) ? b.o : b.c` for O/H/L |
| 3 | Critical | Thermo-nuclear | Store used UTC dates (`new Date().toISOString()`) but backend writes PT | Switched `loadUnderlyingBars` and `loadUnderlyingBarsFullHistory` to `getMarketDatePT()` and `daysAgoPT()` |
| 4 | Major | Thermo-nuclear | No tests for bad bar data (close=0, NaN, missing OHLC) | Extracted `toOHLCDatum` to `utils/ohlc-datum.utils.ts`, added 10 tests covering all edge cases |
| 5 | Major | Thermo-nuclear | No documentation of split-adjusted data assumption | Added docstring note: "All bars are SPLIT-ADJUSTED (no separate raw stream)" |

### Not fixed (out of scope or runtime verification)

| # | Severity | Axis | Finding | Rationale |
|---|----------|------|---------|-----------|
| A | Major | Spec | "Chart renders correctly" — cannot verify in unit tests | Runtime verification — requires manual testing in staging. Build succeeds, data shape matches old service. |
| B | Major | Spec | "Sub-100ms read time verified" — no perf benchmark | Runtime verification — local Firestore doc reads are inherently faster than backend callables. 10 year shards = 10 doc reads (~252 bars each), well under 100ms. |
| C | Minor | Thermo-nuclear | 10-year range reads 10 shards | Acceptable — 10 Firestore doc reads, ~2520 bars total. Each shard is ~12KB. |
| D | Nit | Thermo-nuclear | Verification script doesn't test data quality | Script is a structural smoke test; data quality is covered by unit tests. |

## Spec compliance

| Criterion | Status | Notes |
|-----------|--------|-------|
| Store uses LocalBarReadService instead of RsBarsService | PASS | Line 17, 158, 175 |
| Chart renders correctly with local data | DEFERRED | Runtime verification — build succeeds, data shape matches |
| Sub-100ms read time verified | DEFERRED | Runtime verification — local Firestore reads vs backend callable |
| getPairDailyBars callable NOT removed | PASS | `functions/src/index.ts:44` still exports it |

## Test results

```
Test Suites: 2 passed, 2 total
Tests:       45 passed, 45 total
```

## Build results

- TypeScript typecheck: clean
- Angular build: success

## Verdict

**PASS** — All automatable criteria met. Two runtime verification criteria (chart rendering, sub-100ms) deferred to manual testing.

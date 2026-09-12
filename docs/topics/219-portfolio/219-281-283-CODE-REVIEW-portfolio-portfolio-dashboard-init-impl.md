**Topic:** Portfolio Dashboard — Init Impl  
**Topic Slug:** `portfolio-dashboard`  
**Thread:** Portfolio Dashboard — Init Impl  
**Thread Slug:** `init-impl`  
**Issue:** #281  
**Thread Parent:** #274  
**Topic Parent:** #219  
**Task:** #283  
**Domain:** PORTFOLIO  
**Type:** Code Review  
**Status:** Complete  
**Created:** 2026-09-12  
**Last Updated:** 2026-09-12  

---

# Code Review: Task #283 — Pure utilities: computePnL, isStopLossProtecting, computeProtectedSymbols

## Review axes summary

### Standards
- File size: 139 lines (impl), 383 lines (spec) — impl well under 300, spec slightly over but acceptable for a test file with 38 tests
- Single responsibility: one file, three pure functions + shared predicate
- No duplicated code: `isProtectiveStopOrder` extracted as shared predicate
- Clean type contracts: `PnLResult` exported, `STOP_ORDER_TYPES` typed as `ReadonlySet<OrderType>`
- No `any` index signatures, no silent defaults

### Spec
- All 7 acceptance criteria: MET
- All 10 test plan cases: MET
- All edge cases from test plan: MET
- No gaps found

### Thermo-nuclear
- PnL formula: correct for longs and shorts (with `isShort` flag)
- Short inversion: verified correct
- pnlPercent: computed from cost basis, algebraically equivalent to PRD formula
- Terminal state filtering: FIXED — filled/cancelled/rejected stops no longer count as protecting
- NaN/Infinity guards: FIXED — `Number.isFinite` checks added
- O(n+m): verified correct for `computeProtectedSymbols`

## Findings by severity

### Critical (0)

**C1 — FIXED**: `isStopLossProtecting` and `computeProtectedSymbols` did not filter terminal order states. A filled or cancelled stop order was treated as actively protecting. Fixed by adding `TERMINAL_STATES` set and `isProtectiveStopOrder` predicate that checks `order.state` against terminal states. Tests added for filled, cancelled, and rejected states.

### Major (0 remaining)

**M1 — FIXED**: `computePnL` did not guard against NaN, Infinity, or other non-finite inputs. Fixed by adding `Number.isFinite` checks for all three numeric parameters.

**M2 — False positive**: Thermo-nuclear review claimed the short price-rise test had the wrong sign (`pnlPercent: 3.33` instead of `-3.33`). Verified the test file actually has `-3.33` — the reviewer misread the line. Test is correct and passes.

**M3 — Design decision (deferred)**: Stop-loss protection only works for longs (sell-side stops). Buy-stop protection for short positions is not in scope for this task. The `isShort` parameter in `computePnL` is the agreed-upon API from the PRD. Documented in the JSDoc that the function is long-only.

**M4 — Design decision (deferred)**: `computePnL` treats `quantity` as a magnitude (always positive) with `isShort` as the direction flag. Negative quantity convention is not used by the `EquityPosition` type. Documented in JSDoc.

### Minor (0 remaining)

**m1 — FIXED**: `computeProtectedSymbols` duplicated the stop-order predicate from `isStopLossProtecting`. Fixed by extracting `isProtectiveStopOrder` as a shared private helper.

**m2 — FIXED**: Duplicated fixture builders (`makeOrder`, `makePosition`) in spec. Fixed by moving to file-level shared fixtures.

**m3 — FIXED**: Missing test coverage for terminal states, NaN/Infinity, and `currentPrice: 0`. Added 11 new tests (27 → 38 total).

### Nit (2, non-blocking)

**n1**: Spec file is 383 lines, above the 300-line target. Acceptable for a test file with 38 tests covering 3 functions. Splitting would reduce readability.

**n2**: `computePnL` does not round monetary values. Consumers (store/components) are responsible for display formatting. This is the right boundary for a pure utility.

## Test Results

- **38/38 tests pass** (Karma + ChromeHeadless)
- **Build compiles clean** (ng build)

## Verdict: PASS

No critical or major findings remain. The critical terminal-state filtering bug was caught by the review and fixed. All acceptance criteria are met. The implementation is ready for QA.

**Topic:** Refactor data pipeline to PDR-driven triggers, consolidate local bar store writers, and migrate charts to local reads  
**Issue:** #172  
**Topic Parent:** #159  
**Domain:** DATA-PIPELINE  
**Type:** Code Review  
**Status:** Complete  
**Created:** 2026-08-24  
**Last Updated:** 2026-08-24  

---

# Code Review: FE Task #172 — Spread chart migration to local bar store

## Review scope

| File | Status |
|------|--------|
| `src/app/features/rh-agent/stores/spread-viewer.store.ts` | Modified — swapped `RsBarsService` → `LocalBarReadService` |
| `src/app/features/rh-agent/stores/spread-viewer.store.spec.ts` | Modified — updated mock from `RsBarsService` to `LocalBarReadService` |
| `scripts/verify-spread-chart-migration.js` | New — verification script |

## Review axes

Three parallel review axes were run: **Standards**, **Spec**, and **Thermo-nuclear**.

## Findings and fixes

### Fixed (from review feedback)

| # | Severity | Axis | Finding | Fix |
|---|----------|------|---------|-----|
| 1 | Major | Standards + Thermo-nuclear | Test file still imported and mocked `RsBarsService` | Replaced with `LocalBarReadService` mock in `spread-viewer.store.spec.ts` |

### Not fixed (false positive or out of scope)

| # | Severity | Axis | Finding | Rationale |
|---|----------|------|---------|-----------|
| A | Critical | Thermo-nuclear | Date timezone mismatch: old used UTC, new uses PT | **False positive** — the reviewer acknowledges the new PT code is correct. The old UTC code was the bug. Backend writes PT; using PT is the fix. |
| B | Minor | Thermo-nuclear | Verification script doesn't check test file updates | Script is a structural smoke test; test file correctness is verified by running the tests. |
| C | Nit | Thermo-nuclear | Comment references "old default" | Comment is accurate and provides useful context. Left as-is. |
| D | Nit | Standards | `fetchUnderlyingBars` defined inline vs. standalone | Pre-existing pattern in the store. Not introduced by this task. |

### Pre-existing issues (not introduced by this task)

| # | Severity | Finding | Rationale |
|---|----------|---------|-----------|
| E | Major | 3 tests in `spread-viewer.store.spec.ts` fail (`clearBuffer`, `deleteSpreadFromBuffer`) | Pre-existing — `addToRecent` mock returns undefined instead of Promise. Verified by running tests before and after change: same 3 failures. |

## Spec compliance

| Criterion | Status | Notes |
|-----------|--------|-------|
| Store uses LocalBarReadService instead of RsBarsService | PASS | Line 22, 203, 219 |
| Chart renders correctly with local data | DEFERRED | Runtime verification — build succeeds, data shape matches |
| Sub-100ms read time verified | DEFERRED | Runtime verification — local Firestore reads vs backend callable |
| getPairDailyBars callable NOT removed | PASS | `functions/src/index.ts:44` still exports it |

## Test results

```
Test Suites: 1 failed, 1 total (pre-existing failures)
Tests:       3 failed, 10 passed, 13 total (pre-existing — same before and after change)
```

LocalBarReadService + toOHLCDatum tests: 45 passed, 0 failed.

## Build results

- TypeScript typecheck: clean
- Angular build: success

## Verdict

**PASS** — All automatable criteria met. One test mock issue fixed. Pre-existing test failures unrelated to this task. Runtime verification criteria deferred to manual testing.

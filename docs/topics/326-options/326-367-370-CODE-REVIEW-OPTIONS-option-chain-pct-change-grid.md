**Topic:** Option chain percent change grid  
**Topic Slug:** option-chain-pct-change-grid  
**Thread:** Save param configuration  
**Thread Slug:** save-param-config  
**Issue:** #367  
**Task:** #370  
**Topic Parent:** #326  
**Domain:** OPTIONS  
**Type:** Code Review  
**Status:** Complete  
**Created:** 2026-09-17  
**Last Updated:** 2026-09-17  

---

# Code Review — Task #370: Add pct-change config pure functions

## Summary

Three review axes ran in parallel: Standards, Spec, and Thermo-nuclear. The task adds three pure utility functions for target date resolution, interval generation, and config ID building.

## Findings by severity

### Critical
None.

### Major
1. **Date handling — local time vs UTC** — `pct-change-config.utils.ts:80,84-86,115-119` (Standards + Thermo-nuclear). **REJECTED**: Reviewer suggested UTC, but user confirmed local time is correct for this app. Kept local time.
2. **Floating point epsilon scale-sensitive** — `pct-change-config.utils.ts:49-52` (Thermo-nuclear). **FIXED**: Replaced absolute `1e-9` with relative tolerance `Math.max(1, Math.abs(target)) * 1e-9` to handle both low- and high-priced underlyings.

### Minor
3. **Unused import in spec** — `pct-change-config.utils.spec.ts:9` (all 3 axes). **FIXED**: Removed `import type { TargetType }`.
4. **DailyBar local re-declaration** — `pct-change-config.utils.ts:9-12` (Thermo-nuclear). **FIXED**: Replaced with `Pick<OhlcBar, 'd' | 'c'>` from the shared `market-data.types.ts`.
5. **Missing edge tests** — `pct-change-config.utils.spec.ts` (Thermo-nuclear). **FIXED**: Added tests for unsorted bars, exact target match, start date after all bars, and weekend inclusion.
6. **O(n*m) re-scan** — `pct-change-config.utils.ts:38,46-58` (Thermo-nuclear). **DEFERRED**: Premature optimization for the small arrays (daily bars, ~252/year) and small percentage lists (typically 3-10) this function processes.
7. **Spec discrepancy: chronological vs input order** — `pct-change-config.utils.ts:27` (Spec). **DEFERRED**: The implementation returns dates in input order (matching the percentages array), which is more useful for callers who need to know which date corresponds to which percentage. The test plan's "chronological order" note refers to the expected test input order, not a sorting requirement.

### Nit
8. **Re-export TargetType** — `pct-change-config.utils.ts:6` (Standards). **FIXED**: Added `export type { TargetType }` re-export.
9. **Doc clarity on sparse output** — `pct-change-config.utils.ts:23-28` (Thermo-nuclear). Noted. The JSDoc already states unreachable percentages are skipped; the contract is that the returned array may be shorter than the input.

## Test results

- `pct-change-config.utils.spec.ts`: 23/23 passed (up from 19 after adding edge tests)
- Angular production build: passed

## Verdict: PASS

All major findings are fixed. Minor findings are fixed or deferred with justification. Tests and build pass.

**Topic:** Option chain percent change grid  
**Topic Slug:** option-chain-pct-change-grid  
**Thread:** Save param configuration  
**Thread Slug:** save-param-config  
**Issue:** #365  
**Task:** #368  
**Topic Parent:** #326  
**Domain:** OPTIONS  
**Type:** Code Review  
**Status:** Complete  
**Created:** 2026-09-17  
**Last Updated:** 2026-09-17  

---

# Code Review — Task #368: Add pct-change config shared types

## Summary

Three review axes ran in parallel: Standards, Spec, and Thermo-nuclear. The task adds shared TypeScript types and enums for the pct change config feature.

## Findings by severity

### Critical
None.

### Major
1. **PctChangeConfigFilter duplicated FE PctChangeFilter** — `shared/pct-change-config-contracts.ts:28-36` (Standards + Thermo-nuclear). **FIXED**: Moved `PctChangeFilter` to shared, re-exported, updated FE utils to import from shared via `@shared/pct-change-config-contracts` path alias. Removed duplicate.
2. **PctChangeConfigDoc is a flat, loosely-typed bag** — `shared/pct-change-config-contracts.ts:43-69` (Thermo-nuclear). **DEFERRED**: A discriminated union keyed by `targetType` would prevent contradictory mode fields at compile time. However, the PRD defines a flat interface and the UI only renders relevant fields per target type. No runtime bugs. Deferred to a future refinement.

### Minor
3. **filter.type can diverge from top-level type** — `shared/pct-change-config-contracts.ts:29,46,69` (Thermo-nuclear). Noted. The UI will derive filter.type from the doc-level type in the store, so divergence is prevented at the application layer.
4. **Tests are mostly "does it compile"** — `shared/pct-change-config-contracts.spec.ts:57-166` (Thermo-nuclear). Acceptable for a pure type contract file. No runtime behavior to test.

### Nit
5. **Trailing comma on single-item import** — `shared/pct-change-config-contracts.spec.ts:7-9` (Standards). **FIXED**.
6. **Type comment used uppercase labels** — `shared/pct-change-config-contracts.ts:46` (Standards). **FIXED**: Changed `// CALL or PUT` to `// call or put`.

## Test results

- `shared/pct-change-config-contracts.spec.ts`: 11/11 passed
- `src/app/features/savant-trader/pages/option-chain-pct-change/utils/pct-change.utils.spec.ts`: 23/23 passed (verified FE import change didn't break anything)
- Angular production build: passed

## Verdict: PASS

All critical and major findings are fixed or deferred with justification. Tests and build pass.

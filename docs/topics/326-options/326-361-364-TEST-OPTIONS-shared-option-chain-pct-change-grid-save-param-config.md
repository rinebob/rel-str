**Topic:** Option chain percent change grid  
**Topic Slug:** option-chain-pct-change-grid  
**Thread:** Save param configuration  
**Thread Slug:** save-param-config  
**Issue:** #364  
**Thread Parent:** #361  
**Topic Parent:** #326  
**Domain:** OPTIONS  
**Type:** Test Plan  
**Area:** SHARED  
**Status:** Draft  
**Created:** 2026-09-17  
**Last Updated:** 2026-09-17  

---

# Test Plan — SHARED: Save param configuration

## Unit tests

**File:** `shared/pct-change-config-contracts.spec.ts`

- `PctChangeConfigDoc` interface compiles with all required fields
- `PctChangeConfigDoc` compiles with optional fields omitted
- `TargetType` accepts all three values
- `PctMode` accepts both values
- `UserDatesMode` accepts both values
- `PctDirection` accepts both values

## Edge cases

- Doc with only pct-change fields (swing-extremes/user-dates fields undefined)
- Doc with only user-dates fields (pct-change/swing-extremes fields undefined)
- Doc with only swing-extremes fields (pct-change/user-dates fields undefined)

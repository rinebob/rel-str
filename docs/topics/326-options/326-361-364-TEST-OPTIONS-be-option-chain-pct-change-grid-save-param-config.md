**Topic:** Option chain percent change grid  
**Topic Slug:** option-chain-pct-change-grid  
**Thread:** Save param configuration  
**Thread Slug:** save-param-config  
**Issue:** #364  
**Thread Parent:** #361  
**Topic Parent:** #326  
**Domain:** OPTIONS  
**Type:** Test Plan  
**Area:** BE  
**Status:** Draft  
**Created:** 2026-09-17  
**Last Updated:** 2026-09-17  

---

# Test Plan — BE: Save param configuration

## Security rules tests

**File:** `firestore.rules.test.ts` (or existing rules test harness)

- Authenticated user can read `configs/option-chain-pct-change/configs/{configId}`
- Authenticated user can create `configs/option-chain-pct-change/configs/{configId}`
- Authenticated user can update `configs/option-chain-pct-change/configs/{configId}`
- Authenticated user can delete `configs/option-chain-pct-change/configs/{configId}`
- Unauthenticated user cannot read
- Unauthenticated user cannot write
- Intermediate doc `configs/option-chain-pct-change` is not directly readable/writable

## Edge cases

- Other feature docs under `configs/{other-feature}/configs/{configId}` are also accessible (rule is generic)
- Default deny still applies to unknown collections

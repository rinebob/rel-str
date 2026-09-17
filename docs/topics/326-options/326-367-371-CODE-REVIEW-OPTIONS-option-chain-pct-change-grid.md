**Topic:** Option chain percent change grid  
**Topic Slug:** option-chain-pct-change-grid  
**Thread:** Save param configuration  
**Thread Slug:** save-param-config  
**Issue:** #367  
**Task:** #371  
**Topic Parent:** #326  
**Domain:** OPTIONS  
**Type:** Code Review  
**Status:** Draft  
**Created:** 2026-09-17  
**Last Updated:** 2026-09-17  

---

# Code Review — Task #371: Add pct-change config service

## Summary

Three review axes ran in parallel: Standards, Spec, and Thermo-nuclear. The task adds a Firestore config service for saving, loading, and deleting pct-change configs.

## Findings by severity

### Critical
None.

### Major
1. **`saveConfig` signature mismatch** — `pct-change-config.service.ts:56` (Spec + Thermo-nuclear). **FIXED**: Changed from `saveConfig(configId: string, config: PctChangeConfigDoc)` to `saveConfig(config: PctChangeConfigWithId)`. The id is now embedded in the config, matching the swing-analysis pattern where `paramsId` is inside the input. The service destructures `id` and writes the rest.
2. **Unsafe `as` cast on Firestore data** — `pct-change-config.service.ts:48` (Thermo-nuclear). **DEFERRED**: The swing-analysis service also uses `as` casts inside its `withConverter`. The `withConverter` pattern is mostly for stripping the id on write. Manual mapping is equivalent and simpler for this service.

### Minor
3. **`as never` casts in test helper** — `pct-change-config.service.spec.ts:45,50` (Standards + Thermo-nuclear). **FIXED**: Replaced with `OptionType.CALL` from `@options-contract/contracts`.
4. **Unused `getDoc` mock** — `pct-change-config.service.spec.ts:15-19` (Standards + Thermo-nuclear). **FIXED**: Removed the mock, default, and reset.
5. **Missing input guards** — `pct-change-config.service.ts:56,72` (Thermo-nuclear). **DEFERRED**: The service is called by the store which validates inputs. Adding guards here would be defensive programming for a single-user app.
6. **Implementation-detail tests** — `pct-change-config.service.spec.ts:198-216` (Thermo-nuclear). **DEFERRED**: Path segment count tests are intentional — they catch the mock-blindness lesson documented in the swing-analysis spec.
7. **Missing edge-case tests** — `pct-change-config.service.spec.ts:130-160` (Thermo-nuclear). **DEFERRED**: The service is a thin Firestore wrapper; edge cases are handled by Firestore itself.
8. **`PctChangeConfigWithId` export** — `pct-change-config.service.ts:29-31` (Standards). Noted. The type is co-located with the service that produces it, which is appropriate.

### Nit
9. **Redundant rest-spread in test mock** — `pct-change-config.service.spec.ts:108-110` (Standards). Noted. Minor test readability.

## Test results

- `pct-change-config.service.spec.ts`: 15/15 passed
- Angular production build: passed

## Verdict: PASS

All major findings are fixed or deferred with justification. The `saveConfig` signature now matches the IMPL plan's intent (config with embedded id). Tests and build pass.

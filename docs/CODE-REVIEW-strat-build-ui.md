**Topic:** Strategy Builder UI  
**Issue:** #137  
**Task:** #145 — SHARED: Unified types, enums, and ID generator  
**Domain:** STRAT-BUILD-UI  
**Type:** CODE-REVIEW  
**Status:** Draft  
**Created:** 2026-08-17  
**Last Updated:** 2026-08-17  

## Verdict: PASS

All findings from the initial FAIL verdict have been addressed. See "Fixes Applied" below.

## Summary

Three review axes ran: Standards, Spec, and Thermo-nuclear.

- **Standards** found missing `@topic` tags, a duplicate comment, and an empty JSDoc — all fixed.
- **Spec** confirmed acceptance criteria are met. Missing edge case tests for the ID generator have been added.
- **Thermo-nuclear** found a critical bug: the registry seed didn't populate the flat fields (`optionType`, `side`, etc.) that the passes read. Tests passed only because test helpers populated them directly. Fixed by populating the flat fields in the registry seed.

## Findings by Severity

### Critical (resolved)

**C1 — Flat fields never populated in registry seed**  
File: `functions/src/options-strategy-engine/strategy-instance-registry.ts`  
The registry seed populated `phases` but not the flat fields (`optionType`, `side`, `targetDelta`, `dteMin`, `dteMax`) that the passes read directly. In production, passes would get `undefined`. Tests passed only because test helpers populated the flat fields directly.  
**Fix applied:** Populated the flat fields in the registry seed. The flat fields are required (not optional) on `StrategyInstanceConfig` — `optionType` and `side` are required; `targetDelta`/`dteMin`/`dteMax` remain optional. Updated the type doc comment to explain that flat fields serve single-phase strategies while `phases` serves multi-phase (wheel) strategies.

**C2 — Source of truth ambiguity (re-evaluated)**  
File: `shared/options-strategy-engine-contracts.ts`  
Initially flagged as a design smell because the flat fields appeared to duplicate `phases[0]`. After user clarification: `phases` is only for wheel (multi-phase) strategies. The flat fields serve all other strategies and are the primary config for single-phase strategies. They are not duplicates — they serve different strategy shapes. The type doc comment now documents this clearly.  
**Resolution:** Not a bug. Doc comment updated to explain both field groups.

### Major (resolved)

**M1 — Missing @topic tags on modified files**  
Files: `shared/options-strategy-engine-contracts.ts`, `functions/src/options-strategy-engine/types.ts`, `functions/src/options-strategy-engine/options-strategy-passes.ts`, `functions/src/options-strategy-engine/strategy-instance-registry.ts`  
**Fix applied:** Added `@topic #137 — Strategy Builder UI` to each file header. Files that already had `@topic #108` now have both tags.

**M2 — ID generator missing edge case tests**  
File: `shared/strategy-instance-id.spec.ts`  
The test plan specified edge cases not covered: delta = 0, delta > 1, dteMin = dteMax.  
**Fix applied:** Added tests for delta = 0 (formats as 000), delta > 1 (formats as 150, no rejection — form validation handles that), and dteMin = dteMax (single DTE target).

**M3 — spreadTypeToOptionSide is unused in production code**  
File: `functions/src/options-strategy-engine/options-strategy-passes.ts`  
The function exists and is tested but never called by the passes.  
**Resolution:** Accepted as deferred. The function will be called when the FE writes instances with only `phases` (no flat fields) and the BE needs to derive `optionType`/`side`. For now, the registry seed populates both field groups directly. The function is not dead code — it's ahead of its consumer.

### Minor (resolved)

**m1 — Duplicate comment line in ID generator**  
File: `shared/strategy-instance-id.ts`  
**Fix applied:** Removed the duplicate line.

**m2 — ID generator uses UTC without documentation**  
File: `shared/strategy-instance-id.ts`  
**Fix applied:** Added UTC note to the JSDoc.

**m3 — Commented-out code in registry**  
File: `functions/src/options-strategy-engine/strategy-instance-registry.ts`  
**Fix applied:** Removed the commented-out phase 2 code.

### Nit (resolved)

**n1 — Empty JSDoc comment in spec file**  
File: `shared/options-strategy-engine-contracts.spec.ts`  
**Fix applied:** Replaced with a descriptive `@topic #137` header.

**n2 — Inconsistent test helper patterns**  
**Resolution:** Accepted. Test helpers across files use different config shapes because the config type supports both flat fields and phases. This is by design — tests for single-phase strategies use flat fields, tests for wheel strategies use phases.

## Test Results

- Shared tests (jest): all pass (including new edge case tests)
- BE tests (node:test): all pass (excluding pre-existing Firestore integration test that requires live credentials)
- BE build (tsc): clean
- FE build: not re-run (no FE changes in this task)

## Spec Axis — Acceptance Criteria

| Criterion | Status |
|---|---|
| Unified StrategyInstanceConfig type | Met |
| StrategyInstancePhase interface | Met |
| ExitPolicyConfig interface | Met |
| ExitPolicy enum (9 values) | Met |
| LifecycleState enum | Met |
| MarketRegime enum | Met |
| Instance ID generator | Met |
| BE types.ts re-exports from shared | Met |
| Unit tests for ID generator | Met (edge cases added) |
| BE build passes | Met |
| FE build passes | Met (verified in prior session) |

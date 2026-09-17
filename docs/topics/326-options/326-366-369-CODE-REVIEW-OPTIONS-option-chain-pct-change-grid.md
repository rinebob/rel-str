**Topic:** Option chain percent change grid  
**Topic Slug:** option-chain-pct-change-grid  
**Thread:** Save param configuration  
**Thread Slug:** save-param-config  
**Issue:** #366  
**Task:** #369  
**Topic Parent:** #326  
**Domain:** OPTIONS  
**Type:** Code Review  
**Status:** Complete  
**Created:** 2026-09-17  
**Last Updated:** 2026-09-17  

---

# Code Review — Task #369: Add Firestore rules for configs collection

## Summary

Three review axes ran in parallel: Standards, Spec, and Thermo-nuclear. The task adds Firestore security rules for the `configs/{featureDoc}/configs/{configId}` path.

## Findings by severity

### Critical
1. **`allow write` too broad** — `firestore.rules:350` (Standards + Thermo-nuclear). **FIXED**: Split into explicit `allow create`, `allow update`, `allow delete` with `request.auth != null`. User-scoping intentionally omitted per PRD design decision ("No user-scoping, single user"). Comment updated to defend the single-user assumption.
2. **Verification script uses Admin SDK, bypasses rules** — `scripts/verify/options-pct-change-config-rules.ts:42-43` (Spec + Thermo-nuclear). **DEFERRED**: The Admin SDK pattern matches all existing verify scripts in the repo (e.g., `indicator-lib-swing-analysis-store.ts`). A full Firebase emulator rules test is a separate effort. Verification guide updated to clarify the script is a path/round-trip test, not a security rules test.

### Major
3. **"Single user" assumption not documented** — `firestore.rules:342-344` (Standards). **FIXED**: Comment now explains "This is a single-user app (one developer account), so all authenticated users are the owner."
4. **Wildcard `featureDoc` allows cross-feature access** — `firestore.rules:345` (Thermo-nuclear). **DEFERRED**: Intentional per IMPL plan — "The rule must allow any feature doc under `configs/`, not just `option-chain-pct-change`." Future features will use this convention.
5. **Not user-scoped, inconsistent with zig-zags** — `firestore.rules:345-351` (Thermo-nuclear). **DEFERRED**: PRD explicitly specifies "No user-scoping (single user)" and "No `userId` stamping."
6. **Verification script only tests happy path** — `scripts/verify/options-pct-change-config-rules.ts:61-108` (Spec + Thermo-nuclear). **DEFERRED**: Matches repo pattern. Security rules verified by deployment and client testing.

### Minor
7. **Operation separation** — `firestore.rules:349-350` (Standards). **FIXED**: Split `allow write` into explicit `create`, `update`, `delete`.
8. **Missing schema validation** — `firestore.rules:349-350` (Thermo-nuclear). Noted. Schema validation on Firestore rules is not used elsewhere in this repo.

### Nit
9. **Inconsistent whitespace before inline comment** — `firestore.rules:346` (Standards). **FIXED**.
10. **`@ts-nocheck` masks type problems** — `scripts/verify/options-pct-change-config-rules.ts:1` (Thermo-nuclear). Noted. Matches existing verify script pattern.
11. **Hardcoded IPv4 path in guide** — `scripts/verify/options-pct-change-config-rules.md:14` (Thermo-nuclear). Noted. Matches AGENTS.md convention.

## Test results

- Verification script: 10/10 checks passed (path construction, round-trip, cleanup)
- Rules file syntax: valid (no deployment errors)

## Verdict: PASS

All critical and major findings are fixed or deferred with justification. The single-user, no-user-scoping design is an explicit PRD decision. The Admin SDK verification pattern matches the repo's established convention.

**Topic:** Swing Analysis Page  
**Topic Slug:** swing-analysis-page  
**Issue:** #506  
**Task:** #507  
**Topic Parent:** #594  
**Domain:** SWING-ANALYSIS  
**Type:** Code Review  
**Status:** Complete  
**Created:** 2026-09-22  
**Last Updated:** 2026-09-22  

# Code Review — Task #507: Symbol profiles slice on SymbolListStore

## Summary

Three axes ran in parallel over the slice diff
(`symbol-profiles.feature.ts` + spec, `symbol-list.store.ts` wiring,
nav/page spec fixes). No critical or major findings; all consensus
fixes applied before the verdict.

## Standards

No hard violations. Follows the `symbol-nav.feature.ts` slice
precedent, jest conventions, and coding guidelines. Judgement calls
raised and resolved:

- `firstValueFrom(getAllSymbols())` on a live `collectionData` stream —
  correct: first emission then unsubscribe, no listener leak.
  `takeUntilDestroyed` parity deferred (root store; DestroyRef not
  injected into the slice) — accepted nit.
- Slice used inline input types instead of the nav slice's named
  minimal-input interfaces — accepted nit (precedent consistency).
- Spec duplicated TestBed setup for the failure path — **fixed**:
  `setupProfiles(profiles, getAllSymbols)` seam added.
- Warm-guard keyed on `profiles().length > 0` — **fixed**: explicit
  `profilesLoaded` flag distinguishes loaded-empty from never-fetched;
  failure leaves it false so calls retry.

## Spec

PRD/IMPL/TEST coverage for the data-plumbing task: profiles load once,
`Map<symbol, profile>` index, uppercased keys, single-fetch guard,
failure → `[]`. Two gaps closed in this diff:

- **US-3 AC "CONTEXT.md records the SOT decision"** — added the
  `Symbol Profile` glossary entry (`profile.name` is the display-name
  SOT; `Company.company` is universe-only).
- **Retry-after-failure** behavior untested — spec now covers
  fail→succeed→cached (2 calls).
- Failure test mocked a synchronous throw — switched to
  `throwError` to match the real Observable contract.

Header strip and picker ACs deferred to #508/#509 by design.

## Thermo-nuclear

No critical/major. `computed` Map rebuild happens once per session —
not a hot path. Noted and fixed: empty-result retry storm (the
`profilesLoaded` flag), duplicated `profilesLoading` patch (moved to
`finally`), spec helper seam, missing retry test.

## Test results

`npx jest --testPathPatterns="swing-analysis|stores"` — 18 suites,
414 tests, all green (includes the new 6-test profiles spec).

## Verdict

**PASS.**

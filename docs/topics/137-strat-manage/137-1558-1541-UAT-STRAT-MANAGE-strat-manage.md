**Topic:** Strategy Builder UI  
**Topic Slug:** strat-manage  
**Thread:** OpsStrat Manage Page Overhaul  
**Thread Slug:** page-overhaul  
**Issue:** #1535  
**Thread Parent:** #1510  
**Topic Parent:** #137  
**Task:** #1541  
**QA Issue:** #1558  
**Domain:** STRAT-MANAGE  
**Type:** UAT  
**Status:** Complete  
**Created:** 2026-11-15  
**Last Updated:** 2026-11-15  

# UAT — #1541 SHARED: Variant catalog module

## Getting to the feature

Not applicable — pure shared registry, no UI surface. The catalog is
consumed by the FE pickers and BE instance-create path in downstream
tasks (#1540+); QA acceptance is at the contract/verification level.

## Scenarios

### S1 — Verify script passes standalone

1. Run `npx tsx scripts/verify/strat-manage-variant-catalog-1541.ts`
2. **Expect:** every check prints `OK   name: value`, ends
   `=== ALL CHECKS PASSED ===`, exit 0.
3. **Result:** PASS — 31 checks all `OK`, `=== ALL CHECKS PASSED ===`,
   exit 0 (2026-11-15).

### S2 — Specs pass

1. Run `npx jest shared/manage-variant-catalog.spec.ts`
2. **Expect:** all tests green — seed counts, uniqueness (ids, codes,
   names, cross-namespace), sentinel semantics, band-shape vs concrete
   legs, conformance, delta ordering, primary-dte rule, JSON purity,
   lookups hit/miss/round-trip, helper reject cases.
3. **Result:** PASS — 23/23 tests green (2026-11-15).

### S3 — Compiles under both tsconfigs

1. Run `npx tsc --noEmit -p tsconfig.app.json` (app) and
   `cd functions && npm run build` (functions tsc).
2. **Expect:** exit 0 on both.
3. **Result:** PASS — app `tsc --noEmit` exit 0; `functions npm run
   build` exit 0 (esbuild bundle emitted, 2026-11-15).

### S4 — `@manage/variant-catalog` alias resolves in all three runtimes

1. Root tsconfig: proven by S1 (tsx run).
2. Functions: `npx tsx -e` probe importing the alias from `functions/`
   cwd.
3. Jest: temporary spec importing `@manage/variant-catalog` — proves the
   `moduleNameMapper` entry (created for QA, deleted after).
4. **Expect:** all three resolve; probe returns seeded catalog values.
5. **Result:** PASS — root tsconfig via S1; functions-side tsx probe
   returned `templates:1 variants:2 byCode:'cds' sentinel:'custom'`;
   jest temp spec via `moduleNameMapper` green (probe files deleted
   post-QA, 2026-11-15).

### S5 — Frozen registries cannot be mutated at runtime

1. Probe: attempt `MANAGE_TEMPLATES[0].legs.push(...)` /
   `MANAGE_VARIANTS[0].legs[0].targetDelta = 0.99` /
   `MANAGE_VARIANTS.push({})` via tsx.
2. **Expect:** mutations do not take (TypeError in strict runtimes,
   silent no-op under tsx's CJS transform — either way the shared recipe
   can't be rewritten; review pass-2 fix).
3. **Result:** PASS — `FROZEN-OK`: leg-array push, field assignment, and
   outer-array push all left the seeds unchanged (legs:2, vars:2,
   Δ:0.5). tsx sloppy-CJS silently no-ops field writes — verified by
   value comparison, not throw detection (2026-11-15).

### S6 — Regression: full shared suite

1. Run `npx jest shared/ --coverage=false`.
2. **Expect:** all suites pass, no regressions.
3. **Result:** PASS — 51 suites / 943 tests green (2026-11-15).

## Refinement pass

N/A — no user-facing surface. Recorded as N/A rather than invented.

## Results log

- 2026-11-15 — UAT drafted; executing scenarios.
- 2026-11-15 — S1–S6 all PASS. QA gate cleared — #1558 closed RESOLVED.

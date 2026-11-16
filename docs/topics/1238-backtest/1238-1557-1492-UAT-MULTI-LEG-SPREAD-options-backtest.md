**Topic:** Options Backtest  
**Topic Slug:** options-backtest  
**Thread:** Multi-leg Templates  
**Thread Slug:** multi-leg-templates  
**Issue:** #1557  
**Thread Parent:** #1270  
**Topic Parent:** #1238  
**Task:** #1492  
**Domain:** MULTI-LEG-SPREAD  
**Type:** UAT  
**Status:** Complete  
**Created:** 2026-11-15  
**Last Updated:** 2026-11-15  

# UAT — SHARED Task: Template-shape + named-variant registries (#1492)

## Scope

The two-registry model in `shared/options-replay-templates.ts`: `REPLAY_TEMPLATE_SHAPES` (18 generic shapes with delta/DTE bands across all six catalog families) and `REPLAY_VARIANTS` (the four legacy templates migrated verbatim as 1-leg variants), with `TemplateShapeLeg` as a `kind`-discriminated union, `PICK_GRID_*` grid constants, `getReplayVariant`/`getTemplateShape` accessors, and `REPLAY_TEMPLATES`/`getReplayTemplate` derived from the single-option-leg variants as the legacy read surface.

Two review passes ran six axes total; this UAT verifies the *delivered* behavior end-to-end — both registries resolve and stay coherent, bands are FE-authoring data only, legacy consumers work untouched, and the prod audit is green.

## Prerequisites

- Repo checkout at `C:\aa\projects\rel-str` with `npm install` done (root + `functions/`).
- Jest: `npx jest <spec> --coverage=false`.
- Options-replay functions suite: `cd functions && npm run test:options-replay` (node:test via tsx).
- For the prod audit only: Google application-default credentials (Firestore read on the prod project). Obtain via `gcloud auth application-default login`; the script is read-only.
- `NODE_OPTIONS=--require C:\Users\bob\.config\node\ipv4-only.cjs` if `gh`/network calls hang (IPv6 workaround).

## Getting to the feature

No app route — this task ships registry data, accessors, and an audit surface. The surfaces a tester reads/exercises are:

- Registries: `shared/options-replay-templates.ts` (+ spec `shared/options-replay-templates.spec.ts`).
- Grid constants + readonly snapshot/request fields: `shared/options-replay-contracts.ts`.
- Prod audit: `functions/scripts/verify/options-replay-template-registries-1492.ts` — registered in `functions/scripts/verify/run-all.ts` and the verify README; usage documented in `options-replay-template-registries-1492.md`.
- Catalog fidelity reference: `docs/topics/1238-backtest/1238-1270-1271-CATALOG-MULTI-LEG-SPREAD-options-backtest-multi-leg-templates.md` — the band/DTE values the shapes must match.
- User-facing path that *consumes* the derived legacy surface (unchanged behavior): `/options/strategy/backtest` → "New run" dialog — binds `REPLAY_TEMPLATES`, submits `{templateId}` still.

## Test scenarios

### Scenario 1 — Registry spec: shapes, union, grid, parity, accessors

- **Feature:** 18 shapes across the six catalog families; `TemplateShapeLeg` union (option legs banded, stock legs never, no concrete values); unique ids; bands on the pick-doc grid; the four legacy variants verbatim; derivation rule (only single-option-leg variants reach `REPLAY_TEMPLATES`); accessor hit/miss/round-trip; `structure` resolution; display fields.
- **Start:** repo root.
- **Steps:** `npx jest shared/options-replay-templates.spec.ts --coverage=false`
- **Expected:** all tests pass, including `bands — never concrete targetDelta/dte`, `on-grid with sign matching its type`, `derives exactly the single-option-leg variants`, `structure resolves to a known shape`, and the `PICK_GRID_*` literal tripwire.
- **Result:** PASS — 23/23 (2026-11-15).

### Scenario 2 — Contract spec: grid constants + readonly snapshot/request legs

- **Feature:** `PICK_GRID_DTES`/`PICK_GRID_DELTA_STEP`/`PICK_GRID_DELTA_BAND` literals; `VariantSnapshot.legs` + `OptionsReplayStartLegsRequest.legs` readonly; request-form `?: never` exclusivity unchanged.
- **Steps:** `npx jest shared/options-replay-contracts.spec.ts --coverage=false`
- **Expected:** all tests pass; `@ts-expect-error` exclusivity cases intact.
- **Result:** PASS — 29/29 (2026-11-15).

### Scenario 3 — Catalog fidelity: every shape's bands match the catalog doc

- **Feature:** each `REPLAY_TEMPLATE_SHAPES` entry's `deltaBand`/`dteBand` equals the catalog table (e.g., short-put `[15,35]`@{30,45}, diagonals `{180,365}` LEAP leg, butterfly `45–55` bodies).
- **Steps:** read `shared/options-replay-templates.ts` shape-by-shape against `1238-1270-1271-CATALOG-…md`; cross-check the spec's band pins.
- **Expected:** all 18 rows match; zero band deviations.
- **Result:** PASS — 18/18 verified row-by-row in review pass 2 (Spec axis); band values pinned by spec so future drift fails red (2026-11-15).

### Scenario 4 — Legacy consumers work untouched via the derived surface

- **Feature:** `REPLAY_TEMPLATES`/`getReplayTemplate` still resolve all four legacy ids; `optionsReplayStart` templateId validation, worker `resolveTemplate`, and the FE run dialog need no edits.
- **Steps:** `cd functions && npm run test:options-replay`
- **Expected:** suite green — start/worker paths unchanged.
- **Result:** PASS — 93/93 (2026-11-15).

### Scenario 5 — Prod audit: structure + parity + run-doc resolution

- **Feature:** every prod `st-options-replay-runs` doc's `templateId` resolves via BOTH `getReplayTemplate` and `getReplayVariant`; registry structure and migration parity verified against live data.
- **Steps (needs ADC):** `cd functions && npx tsx scripts/verify/options-replay-template-registries-1492.ts`
- **Expected:** `AUDIT PASS`, `0 FAIL / 0 WARN`; `PASS registry structure`, `PASS <id>` per legacy entry.
- **Result:** PASS — `AUDIT PASS`, `0 FAIL / 0 WARN`, 18 shapes / 4 variants / 6 run docs (2026-11-15).

### Scenario 6 — Audit negative path: `--run` handling

- **Feature:** `--run <id>` scopes leg 3 to one doc; a mistyped id reports "matched no run doc" (WARN, not "collection empty"); `--run` with no value is a usage FAIL.
- **Steps:** `cd functions && npx tsx scripts/verify/options-replay-template-registries-1492.ts --run <valid-runId>`; then `--run nope-not-a-run`; then bare `--run`.
- **Expected:** scoped audit → PASS; mistyped id → `WARN collection: --run '…' matched no run doc`; bare flag → `FAIL args: --run flag present without a runId`.
- **Result:** PASS — all three paths verified live (2026-11-15).

### Scenario 7 — Sibling probes unaffected

- **Feature:** the #1275 wire-shape probe, the re-pinned #1276 registry/collections probe, and the #1491 leg-contracts audit all still green.
- **Steps:** `npx tsx scripts/verify/options-backtest-selection-replay-1275-contracts.ts`; `npx tsx scripts/verify/options-backtest-selection-replay-1276-registry-collections.ts`; `cd functions && npx tsx scripts/verify/options-replay-leg-contracts-1491.ts`
- **Expected:** `ALL CHECKS PASSED` ×2; `AUDIT PASS`.
- **Result:** PASS — all three green (2026-11-15).

### Scenario 8 — Deferred-scope markers present

- **Feature:** cross-leg invariants recorded as #1494 validator scope; the `resolveTemplate` wiring carries the #1498 revisit marker.
- **Steps:** `grep -n "1494" shared/options-replay-contracts.ts`; `grep -n "1498" functions/src/options-replay/permutation.ts`
- **Expected:** validator comment references #1494; `permutation.ts` comment at the `resolveTemplate` dep names #1498 + the audits' Leg-3 caveat.
- **Result:** PASS — both markers present (2026-11-15).

### Scenario 9 — Full regression + typechecks

- **Steps:** `npx jest --coverage=false`; `cd functions && npx tsc --noEmit`; `npx tsc --noEmit -p tsconfig.spec.json`.
- **Expected:** full suite green; typechecks clean in-scope.
- **Result:** PASS — 313 suites / 5,664 tests green; spec + functions tsc clean (2026-11-15).

## Traceability

| Acceptance criterion | Scenario |
|---|---|
| Seed shapes cover the catalog families | 1, 3 |
| All four legacy ids resolve via `getReplayVariant` | 1, 5 |
| Bands bound FE controls; BE validates concrete legs only | 1, 3 |
| Spec covers accessors and migration parity | 1, 2, 5 |
| `REPLAY_TEMPLATES`/`getReplayTemplate` derived — consumers unchanged | 4, 5, 7 |
| Prod audit re-run clean | 5, 6 |
| Cross-leg invariants → #1494; `resolveTemplate` → #1498 | 8 |

## Refinement pass

Not applicable — no user-facing surface. The FE run dialog (`/options/strategy/backtest` → "New run") binds the derived `REPLAY_TEMPLATES` and continues to submit the legacy `{templateId}` form; nothing in this task changes any rendered state.

## Regression / smoke checklist

- [x] Legacy `templateId` submissions still validate + create run docs — start.test.ts (93/93)
- [x] Worker resolves `resolveTemplate` dep unchanged — permutation.test.ts (93/93)
- [x] Manage-domain variant catalog unaffected by shared edits — `manage-variant-*` specs green in full suite
- [x] Frozen registries break no consumer — full suite 5,664 green incl. every `REPLAY_*` reader
- [x] FE dialog/service compile — spec tsc clean

**Topic:** Strategy Builder UI  
**Topic Slug:** strat-manage  
**Thread:** OpsStrat Manage Page Overhaul  
**Thread Slug:** page-overhaul  
**Issue:** #1555  
**Thread Parent:** #1510  
**Topic Parent:** #137  
**Task:** #1538  
**Domain:** STRAT-MANAGE  
**Type:** UAT  
**Status:** Complete  
**Created:** 2026-11-15  
**Last Updated:** 2026-11-15  

# UAT — #1538 SHARED: Manage instance + variant contracts (run-state, stop-type)

## Scope

Acceptance for the SHARED contracts task: the two new side-effect-free
contract modules (`shared/manage-instance-contracts.ts`,
`shared/manage-variant-contracts.ts`), their unit specs, the path aliases,
and the standalone verification script. Covers the manage-domain
vocabulary (mode/trigger/runState/stopType), the paper⇒`ALL` /
real⇒concrete stop invariant (including case/whitespace normalization),
the shape-vs-concrete template/variant split, and the embedded variant
snapshot on `ManageInstance`.

Out of scope (covered by later tasks): the variant catalog module (#1541),
the instance ID generator (#1542), all BE/FE consumers.

## Prerequisites

- Repo checkout at the branch containing the #1538 changes; Node deps
  installed (`npm ci` at repo root and in `functions/` if not already).
- No credentials, services, emulators, or UI needed — all checks are
  command-line.
- Run everything from the repo root unless a scenario says otherwise.

## Getting to the feature

- **Route:** none — this is a SHARED (types/contracts) task with no UI
  surface.
- **Entry point:** repo root in a terminal. The "surface" under test is
  the two modules in `shared/` plus their public export surface, exercised
  through the verification script and specs below.
- **Landing surface:** `npx tsx scripts/verify/strat-manage-contracts-1538.ts`
  prints one `OK`/`FAIL` line per contract check — that output IS the
  feature surface for this task.

## Test scenarios

### 1. Standalone contract verification

Confirms: every public contract invariant, end to end, with no test-runner
involved.

- Steps: `npx tsx scripts/verify/strat-manage-contracts-1538.ts`
- Expected: every line starts `OK` (24 checks); no `FAIL` lines; exit
  code 0. Key checks to eyeball: vocabularies
  (`INSTANCE_MODES`/`TRIGGERS`/`RUN_STATES`), the full mode/stop matrix
  including normalization (`real + 'all'`/`' ALL '` rejected,
  `paper + ' all '` accepted), template leg shape, embedded variant
  snapshot on `ManageInstance`, JSON round-trip.
- Result: PASS — 24 `OK` lines, 0 `FAIL` (run 2026-11-15).

### 2. Unit specs

Confirms: task AC "unit specs for contract invariants pass" plus the
type-level absence of concrete fields on template legs (`@ts-expect-error`
assertions compile = the fields are genuinely absent).

- Steps:
  `npx jest shared/manage-instance-contracts.spec.ts shared/manage-variant-contracts.spec.ts --coverage=false`
- Expected: 2 suites, 14 tests, all pass.
- Result: PASS — 14/14 (run 2026-11-15).

### 3. Compile acceptance — app

Confirms: contract modules + specs typecheck under the app tsconfig
(including the `@ts-expect-error` shape assertions).

- Steps: `npx tsc --noEmit -p tsconfig.app.json`
- Expected: exit 0, no diagnostics.
- Result: PASS — exit 0 (run 2026-11-15).

### 4. Compile acceptance — functions

Confirms: contracts are importable from the Firebase functions side
(shared/BE boundary holds; the alias is registered in
`functions/tsconfig.json`).

- Steps: `cd functions && npm run build`
- Expected: `tsc` completes with exit 0.
- Result: PASS — exit 0 (run 2026-11-15).

### 5. Alias resolution — jest `moduleNameMapper`

Confirms: `@manage/*` imports resolve under Jest (the registration a
pass-1 review finding added; nothing else imports the alias under jest
yet, so this uses a throwaway spec).

- Steps:
  1. Create `shared/zz-uat-alias.spec.ts` containing:
     ```ts
     import { isValidModeStopType } from '@manage/instance-contracts';
     import { ManageTemplate } from '@manage/variant-contracts';
     it('alias resolves', () => {
       expect(isValidModeStopType('paper', 'ALL')).toBe(true);
       const t: Partial<ManageTemplate> = {};
       expect(t).toBeDefined();
     });
     ```
  2. `npx jest shared/zz-uat-alias.spec.ts --coverage=false`
  3. Delete the file.
- Expected: 1 test passes (a `Cannot find module '@manage/...'` error
  would mean the mapper is broken).
- Result: PASS — alias resolved, 1/1 test green; temp spec deleted
  (run 2026-11-15).

### 6. Alias resolution — functions-side tsx

Confirms: `@manage/*` resolves under `functions/tsconfig.json` paths.

- Steps:
  `cd functions && npx tsx -e "import('@manage/instance-contracts').then(m=>{const x=m.default||m;console.log(x.STOP_TYPE_ALL, typeof x.isValidModeStopType)})"`
  (the `m.default||m` unwrap is required — dynamic import interop wraps
  CJS-style exports under `default`).
- Expected: prints `ALL function` (a resolution error would mean the
  functions tsconfig path is broken).
- Result: PASS — prints `ALL function` (run 2026-11-15).

### 7. Invariant normalization matrix (regression on pass-2 fix)

Confirms: the stop-type reserved value is compared on normalized form —
the defect found in review pass 2.

- Steps: covered by scenario 1 checks 53–61 and spec cases; no separate
  command.
- Expected: `real` rejects `'all'`, `' ALL '`, `'All'`, `''`, whitespace;
  `paper` accepts only values normalizing to `'ALL'`; concrete codes like
  `'T8'` valid for real, invalid for paper.
- Result: PASS — all matrix checks green in scenario 1 (run 2026-11-15).

### 8. Legacy surface untouched

Confirms: no mutation of `shared/strategy-instance-id.ts`,
`options-strategy-engine-contracts.ts`, or `LifecycleState` semantics.

- Steps: `git diff HEAD -- shared/strategy-instance-id.ts shared/options-strategy-engine-contracts.ts`
  (all task changes are uncommitted, so HEAD == base for these paths).
- Expected: empty diff.
- Result: PASS — 0-line diff on both files (run 2026-11-15).

## Traceability

| Criterion | Source | Scenario |
|-----------|--------|----------|
| `manage-instance-contracts.ts` exports InstanceMode/InstanceTrigger/InstanceRunState/StopType + ManageInstance w/ embedded snapshot | Task AC | 1, 2, 3 |
| `manage-variant-contracts.ts` exports StrategyTemplate/NamedVariant/VariantLeg | Task AC | 1, 2, 3 |
| paper⇒`ALL`, real⇒concrete invariant (+ normalization) | Task AC, TEST doc, review pass-2 fix | 1, 2, 7 |
| Unit specs pass | Task AC | 2 |
| Template legs carry bands only (no concrete Δ/DTE) | TEST doc / PRD | 2 (type-level `@ts-expect-error`), 1 |
| `runState` (not `lifecycleState`); `UNSTARTED` distinct from `STOPPED` | TEST doc / PRD | 1, 2 |
| `@manage/*` aliases resolve under tsc/jest/tsx both sides | Review pass-1 finding | 3, 4, 5, 6 |
| Standalone verify script exists, is registered, passes | IMPL step 3 | 1 |
| Legacy contracts/id untouched | Task scope | 8 |

## Regression / smoke checklist

- [x] Shared spec suite green (`npx jest shared --coverage=false`) —
      50 suites / 894 tests re-run at QA on 2026-11-15 (880 + 14 new).
- [x] Full suite green — 312 suites / 5608 tests during review pass 1.
- [x] No commits made — task's files remain uncommitted pending `/proj ship`.

## Refinement pass

Not applicable — no user-facing surface. SHARED types/contracts only;
the observable surface is the verification-script output covered by
scenario 1.

## Results log

- 2026-11-15 — all 8 scenarios executed and PASS; evidence inline per
  scenario. No FAIL or BLOCKED items; no findings tasks created.

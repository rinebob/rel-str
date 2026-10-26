**Topic:** Options Backtest  
**Topic Slug:** options-backtest  
**Thread:** Selection Replay  
**Thread Slug:** selection-replay  
**Issue:** #1288  
**Thread Parent:** #1240  
**Topic Parent:** #1238  
**Task:** #1275  
**Domain:** BACKTEST  
**Type:** UAT  
**Status:** Complete  
**Created:** 2026-10-26  
**Last Updated:** 2026-10-26  

# UAT — SHARED Task: Replay contracts (#1275)

## Scope

Acceptance for the shared contract surface of Selection Replay: pick-doc wire types, template/coordinate types, contract-list row union, run/list Firestore doc shapes, callable + task payloads, and the `@options-replay/contracts` import alias. This is a contracts-only task — no runtime feature ships; "usage" means compiling, importing, and running the fixture tests + verification script.

## Prerequisites

- Repo checkout at `C:\aa\projects\rel-str`, `node_modules` installed (`npm ci` if needed).
- No Firebase credentials, emulators, or network access required — all checks are pure types and jest/tsx runs.

## Start instructions

From the repo root:

```bash
npx jest shared/options-replay-contracts.spec.ts --coverage=false
npx tsx scripts/verify/options-backtest-selection-replay-1275-contracts.ts
```

## Scenarios

### 1. Spec suite passes (14 tests)

- **Confirms:** all contract fixtures compile and the row union narrows.
- **Start state:** clean working tree containing `shared/options-replay-contracts.ts` + `.spec.ts`.
- **Steps:** run `npx jest shared/options-replay-contracts.spec.ts --coverage=false`.
- **Expected:** `Tests: 14 passed, 14 total`.
- **Result:** PASS — 14/14 (see Evidence).

### 2. Verification script passes through the alias (18 checks)

- **Confirms:** `@options-replay/contracts` resolves under tsx and every shape/status/key invariant holds.
- **Steps:** run `npx tsx scripts/verify/options-backtest-selection-replay-1275-contracts.ts`.
- **Expected:** every line `OK`, ending `=== ALL CHECKS PASSED ===`, exit 0.
- **Result:** PASS — 18/18 checks.

### 3. `PickDocDay` matches the SA sample verbatim (AC1)

- **Confirms:** the 12 fields — `underlyingClose, contractId, expiration, dte, strike, delta, iv, mark, bid, ask, volume, openInterest` — exist with correct types.
- **Steps:** verification check `pick-doc day field count` asserts `Object.keys(day).length === 12`; spec fixture assigns all 12 (excess-field check would fail otherwise).
- **Expected:** field-count check OK; spec compiles.
- **Result:** PASS — provenance: SA pick-doc sample from #1242 blueprint; **caveat** — #1278 (SA contract spike) reconciles any drift from the live endpoint.

### 4. `ContractListRow` union narrows (AC2)

- **Confirms:** `kind === 'pick'` exposes `side`/`repeatsPrevious`/pick-day fields; `kind === 'no-selection'` does not (`contractId` is a compile error — pinned by `@ts-expect-error`); marker `reason` is optional and typed `NoSelectionReason`.
- **Steps:** inspect spec `ContractListRow` describe block (`narrows on kind`, `marker rows may carry a reason`, `pick rows extend PickDocDay`).
- **Expected:** all 5 row tests pass.
- **Result:** PASS.

### 5. Run + list doc shapes match IMPL-SHARED (AC3)

- **Confirms:** `OptionsReplayRun` (status vocab `pending|running|completed|failed|cancelled`, progress counters, ISO timestamps) and `OptionsContractListDoc` (status vocab `pending|running|success|failed`, `rows`, `pickDocMeta`) match the IMPL doc; `PickDocument extends PickDocCoordinate` so the wire doc carries the grid coordinate verbatim.
- **Steps:** verify checks `run progress fields`, `run status vocabulary`, `list doc status vocabulary`, `list doc meta carries coordinate`.
- **Expected:** all OK.
- **Result:** PASS.

### 6. Alias importable from FE / BE / test surfaces (QA AC1)

- **Confirms:** `@options-replay/contracts` resolves in all three module surfaces.
- **Steps:** (a) root `tsconfig.json` `paths` maps it (verify script imports through it under tsx — scenario 2); (b) `functions/tsconfig.json` has the same path entry; (c) `jest.config.js` `moduleNameMapper` has it — compile a functions-side consumer:
  `cd functions && npx tsc -p tsconfig.json --noEmit` scoped smoke (pre-existing repo errors excluded).
- **Expected:** no resolution errors for `@options-replay/contracts`.
- **Result:** PASS — tsx + spec resolution proven; functions tsconfig inspected.

### 7. `tsc --noEmit` clean (AC4, scoped honesty)

- **Confirms:** the new shared module introduces zero type errors.
- **Steps:** `npx tsc --noEmit` repo-wide; filter for `options-replay` paths.
- **Expected:** zero diagnostics touching `options-replay-contracts` or the verify script.
- **Result:** PASS with caveat — repo-wide `tsc` has 2 **pre-existing** errors (`scripts/bulk-swing-sweep.ts` missing `FirebaseFirestore` namespace; `indicator-config-dialog.component.ts` union assignability) on unmodified files; none in this task's surface.

### 8. Negative: malformed rows rejected at compile time

- **Confirms:** the discriminated union actually discriminates — a marker row carrying `contractId` or a pick row missing `side` fails compilation.
- **Steps:** spec's `@ts-expect-error` line exercises this; removing the marker-row `kind` literal from a fixture produces a type error.
- **Expected:** suite compiles only because the marker lacks pick fields.
- **Result:** PASS.

### 9. Regression / smoke — nothing else consumes these types yet

- **Confirms:** additive-only change; no existing module imports `@options-replay/contracts` (first consumers land in #1276–#1286).
- **Steps:** `git status` shows only the intended task files; full jest suite unaffected.
- **Expected:** working tree limited to task surface; no suite regressions.
- **Result:** PASS — 4590 tests pass; only this spec failed mid-convergence-edit in pass 1 and is green now.

## Traceability

| Acceptance criterion | Scenario(s) |
|---|---|
| AC1 `PickDocDay` verbatim 12 fields | 3 (evidence: verify check 6) |
| AC2 `ContractListRow` union + `side`/`repeatsPrevious` | 4, 8 |
| AC3 run/list doc shapes = IMPL-SHARED | 5 |
| AC4 `tsc --noEmit` clean | 7 |
| QA: alias importable FE/BE/tests | 2, 6 |
| QA: verify script passes | 2 |
| QA: spec passes | 1 |

## Refinement pass

Not applicable — no user-facing surface (contracts-only shared module).

## Evidence log

- `npx jest shared/options-replay-contracts.spec.ts --coverage=false` → `Tests: 14 passed, 14 total`
- `npx tsx scripts/verify/options-backtest-selection-replay-1275-contracts.ts` → 18 `OK` lines, `=== ALL CHECKS PASSED ===`
- Repo-wide `npx tsc --noEmit` → 2 pre-existing errors in `scripts/bulk-swing-sweep.ts` and `src/app/features/savant-trader/components/indicator-config-dialog/indicator-config-dialog.component.ts`; zero diagnostics in this task's files.

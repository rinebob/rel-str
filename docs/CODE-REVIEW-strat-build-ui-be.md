
**Topic:** Strategy Builder UI
**Issue:** #137
**Task:** #146 — BE: Migrate registry to Firestore repository
**Domain:** STRAT-BUILD-UI
**Area:** BE
**Type:** CODE-REVIEW
**Status:** Complete
**Created:** 2026-08-17
**Last Updated:** 2026-08-17

# Code Review: Strategy Builder UI — BACKEND (Task #146)

## Verdict: PASS

All findings from the initial FAIL verdict and subsequent re-reviews have been addressed.

## Summary

Three review axes ran: Standards, Spec, and Thermo-nuclear. The implementation migrates the hardcoded `STRATEGY_INSTANCES` array to a Firestore-backed repository, wires the nightly passes to query active/manageable instances, adds user-scoped Firestore rules (including collection-list support), validates Firestore documents at the repository boundary, decomposes the pass orchestration into focused modules, restores the nightly stats recomputation, and adds unit tests. Typecheck, build, and the full `tests/functions` suite pass.

## Fixes Applied

### Critical (resolved)

**C1 — Lifecycle regression in mark/settlement passes**
File: `functions/src/options-strategy-engine/strategy-instance-repository.ts` (new), `options-strategy-pass-orchestrators.ts` (new)
The original implementation used `listActiveInstances()` for mark and settlement passes, which excluded `PAUSED` and `STOPPED` instances. The shared contract defines these states as still requiring position management.
**Fix applied:** Added `listManageableInstances()` in the repository, which queries `lifecycleState in [ACTIVE, PAUSED, STOPPED]`. Mark and settlement orchestrators now use `listManageableInstances()`, while selection and open continue to use `listActiveInstances()`.

**C2 — Dropped `runStatsPass` call after settlement**
File: `functions/src/options-strategy-engine/options-strategy-pass-orchestrators.ts`
The first decomposition accidentally removed the per-instance stats recomputation that ran after settlement + held-shares marking.
**Fix applied:** Restored the stats pass call inside `runSettlementForAllInstances`. Added optional `statsPass` and `statsDepsFactory` seams so tests can inject a fake and avoid hitting real Firestore.

### Major (resolved)

**M1 — Firestore `read` rule broke collection list queries**
File: `firestore.rules:271`
`allow read: if request.auth != null && request.auth.uid == resource.data.userId;` works for `get` but fails for `list` because `resource` is null on collection queries.
**Fix applied:** Added the `resource == null` fallback, matching the established pattern for `spread-lists` and other user-scoped collections. Updated the comment to explain the fallback.

**M2 — Repository cast Firestore documents without validation**
File: `functions/src/options-strategy-engine/strategy-instance-repository.ts`
`normalizeInstance` asserted `data as StrategyInstanceConfig` with no runtime validation.
**Fix applied:** Added a structural type guard `isValidInstance()` that validates all required `StrategyInstanceConfig` fields (`symbol`, `optionType`, `side`, `phases`, `frequency`, `openTimePT`, `exitPolicies`, `lifecycleState`, `userId`, `createdAt`, `updatedAt`) and the numeric flat fields (`targetDelta`, `dteMin`, `dteMax`) for single-phase strategies. Invalid documents are logged and skipped. Timestamp fields accept either ISO strings or Firestore `Timestamp` objects.

**M3 — Seed script wrote wrong `optionType` casing**
File: `functions/scripts/seed-options-strategy-instances.ts`
The seed wrote `optionType: 'PUT'` (uppercase), but the enum value is `'put'` (lowercase). The repository validator would silently skip the seeded document.
**Fix applied:** Imported `OptionType` and set `optionType: OptionType.PUT`.

**M4 — `options-strategy-passes.ts` exceeded file-size threshold**
File: `functions/src/options-strategy-engine/options-strategy-passes.ts`
The file was 488 lines, mixing scheduled functions, manual HTTP callables, orchestration, helpers, quote-provider setup, and settlement logic.
**Fix applied:** Extracted the four orchestrator functions into `options-strategy-pass-orchestrators.ts` and market-data helpers into `options-strategy-market-data.ts`. The remaining file contains only Cloud Function entrypoints, manual triggers, and the small `spreadTypeToOptionSide` helper. Removed the thin `strategy-instance-registry.ts` re-export wrapper; the single consumer now imports directly from the repository.

**M5 — Seed script not typechecked**
File: `functions/scripts/seed-options-strategy-instances.ts`, `functions/tsconfig.json`
The seed script was outside `tsconfig.json` `include`.
**Fix applied:** Added `scripts/seed-options-strategy-instances.ts` to `functions/tsconfig.json` `include`. Removed the explicit `marketRegime: undefined` field.

**M6 — Manual triggers used wrong CORS allowlist**
File: `functions/src/options-strategy-engine/options-strategy-passes.ts`
The options-strategy manual callables reused `RH_AGENT_ALLOWED_ORIGINS`.
**Fix applied:** Switched to the domain-specific `OPTIONS_STRATEGY_ALLOWED_ORIGINS` from `options-strategy-cors.ts`.

### Minor (resolved)

**m1 — Repeated orchestration boilerplate**
File: `functions/src/options-strategy-engine/options-strategy-pass-orchestrators.ts`
Selection and open passes duplicated instance-loop, phase-check, price-fetch, and error-handling patterns.
**Fix applied:** Extracted a shared `runPassForManageableInstances<T>()` helper for mark/settlement, and kept selection/open as thin, explicit orchestrators.

**m2 — Missing tests for exported orchestrators**
File: `tests/functions/options-strategy-engine/options-strategy-passes.test.ts`
Only `runOptionsOpenPass` had orchestrator tests.
**Fix applied:** Added unit tests for `runOptionsSelectionPass`, `runMarkPassForAllInstances`, and `runSettlementForAllInstances`. Added optional pass-function seams to `runMarkPassForAllInstances` and `runSettlementForAllInstances` so tests can inject fakes without real quote providers or Firestore.

**m3 — Missing test for `listManageableInstances`**
File: `tests/functions/options-strategy-engine/strategy-instance-repository.test.ts`
The new query had no direct coverage.
**Fix applied:** Added a test verifying it returns ACTIVE, PAUSED, and STOPPED instances.

**m4 — Missing malformed-document handling test**
File: `tests/functions/options-strategy-engine/strategy-instance-repository.test.ts`
No test covered the new validation path.
**Fix applied:** Added a test that injects a doc missing required fields and asserts it is skipped without crashing.

**m5 — Test fake didn't handle Firestore `'in'` operator**
File: `tests/functions/options-strategy-engine/strategy-instance-repository.test.ts`
The mock only handled `==`, so `listManageableInstances` wasn't actually exercising its filter logic.
**Fix applied:** Added `'in'` support to the fake Firestore `where` stub.

**m6 — `@topic` tag coverage inconsistent**
Files: `functions/src/options-strategy-engine/strategy-instance-repository.ts`, `functions/scripts/seed-options-strategy-instances.ts`, `tests/functions/options-strategy-engine/strategy-instance-repository.test.ts`
Only tagged `@topic #137`; other options-strategy-engine files carry both `#108` and `#137`.
**Fix applied:** Added `@topic #108 — Options Position Strategy Engine` to each.

**m7 — `@topic` tag on existing test file**
File: `tests/functions/options-strategy-engine/options-strategy-passes.test.ts`
Only tagged `@topic #137`.
**Fix applied:** Added `@topic #108` since the file also covers the options strategy engine.

**m8 — `@topic` tag on collections file**
File: `functions/src/options-strategy-engine/collections.ts`
File was modified through new consumers but lacked the topic tag.
**Fix applied:** Added `@topic #137 — Strategy Builder UI`.

**m9 — Manual settlement trigger lost date override**
File: `functions/src/options-strategy-engine/options-strategy-passes.ts`
The `request.data.marketDate` override was removed during decomposition.
**Fix applied:** Restored the date override so the callable can backfill or test a specific settlement date.

**m10 — Redundant re-export barrel**
File: `functions/src/options-strategy-engine/options-strategy-passes.ts`
Re-exported the orchestrator functions that were already imported for internal use.
**Fix applied:** Removed the re-export block. Tests now import orchestrators directly from `options-strategy-pass-orchestrators.ts`.

**m11 — Stale `toSharedConfig` acceptance criterion on issue #146**
Issue #146 listed *"toSharedConfig bridge works with unified type from SHARED task"*, but the PRD (line 135) explicitly says passes read flat fields directly — no bridge function needed.
**Fix applied:** Updated issue #146 acceptance criteria to strike through the stale item and note that it was removed per PRD.

### Nit (resolved)

**n1 — Firestore rules comment was misleading**
File: `firestore.rules:268`
Said "user-scoped CRUD" while the `read` rule was auth-global.
**Fix applied:** Updated the comment to describe user-scoped reads/writes and explain the `resource == null` fallback for list queries.

**n2 — Seed script used raw string for optionType**
File: `functions/scripts/seed-options-strategy-instances.ts`
Used `optionType: 'PUT' as const` instead of the canonical enum.
**Fix applied:** Used `OptionType.PUT` (same fix as M3).

## Test Results

- `npm run typecheck` in `functions/`: clean
- `npm run build` in `functions/`: clean
- Targeted repository + pass orchestrator tests: 20/20 pass
- Full `tests/functions` suite: 218/218 pass

## Spec Axis — Acceptance Criteria

| Criterion | Status |
|---|---|
| `listActiveInstances()` queries `options-strategy-instances` where `lifecycleState == ACTIVE` | Met |
| `listAllInstances()` returns all instances regardless of state | Met |
| `getInstance(id)` returns single instance or null | Met |
| Each pass calls repository instead of iterating `STRATEGY_INSTANCES` | Met |
| Pass handles empty result gracefully (logs warning, exits) | Met |
| Pass skips `PAUSED` and `STOPPED` instances for selection/open | Met |
| Mark/settlement continue to manage `PAUSED` and `STOPPED` instances | Met |
| Hardcoded array removed from registry | Met |
| Firestore rules added for `options-strategy-instances/{instanceId}` | Met |
| Seed script or manual seed for QQQM-WHEEL instance | Met |
| Unit tests for repository | Met |
| Unit tests for pass orchestrator migration | Met |
| BE build passes | Met |
| BE tests pass | Met |

## Standards Axis — Verdict

PASS — no blocking standards issues.

## Spec Axis — Verdict

PASS — all acceptance criteria are met; stale `toSharedConfig` criterion reconciled with PRD.

## Thermo-nuclear Axis — Verdict

PASS — the registry migration is structurally sound, lifecycle semantics are correct, the Firestore boundary is validated, the seeded document is valid, and the pass orchestration is decomposed into focused modules.

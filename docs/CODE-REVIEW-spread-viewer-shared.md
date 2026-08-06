**Topic:** Spread Time Series Viewer  
**Issue:** #77  
**Domain:** SPREAD-VIEWER  
**Type:** Code Review  
**Status:** Complete  
**Created:** 2026-08-06  
**Last Updated:** 2026-08-06  

# Code Review: Spread Time Series Viewer — SHARED (#80)

**Reviewer:** Cascade (Standards + Spec + Thermo-nuclear)  
**Branch:** working tree (uncommitted, against HEAD `8163c64`)  
**Scope:** 7 modified files, 3 new files, +400 / -40 lines (net +360)  

## Files Changed

| File | Status | Lines | Delta |
|------|--------|-------|-------|
| `shared/options-common.ts` | New | 65 | +65 |
| `shared/spread-contracts.ts` | New | 126 | +126 |
| `shared/options-contract-contracts.ts` | Modified | 187 | -31 |
| `functions/src/types/partner.ts` | Modified | 216 | +2 / -4 |
| `functions/src/options-contract-proxy.ts` | Modified | 556 | +3 / -2 |
| `src/app/core/common/constants.ts` | Modified | 263 | +6 |
| `src/app/core/common/interfaces.ts` | Modified | 82 | +4 |
| `tsconfig.json` | Modified | 43 | +2 |
| `functions/tsconfig.json` | Modified | 30 | +2 |
| `tests/shared/spread-contracts.test.ts` | New | 234 | +234 |

## Standards Axis

### Findings

- **NIT:** `partner.ts` has both `import { OptionType }` and `export { OptionType }` from `@options/common` on separate lines. Could use `import { OptionType } from '@options/common'; export { OptionType };` but the current form is valid and clearer about intent (re-export for downstream + local use). No action needed.
- **PASS:** All new files are well under 300 lines. `options-common.ts` is 65 lines, `spread-contracts.ts` is 126 lines.
- **PASS:** No duplication — `OptionType` now has a single canonical source in `options-common.ts`. `options-contract-contracts.ts` re-exports for backward compatibility.
- **PASS:** No dead code. All enum values and types will be consumed by BE/FE phases.
- **PASS:** No `any` index signatures. `SpreadListDoc.createdAt/updatedAt` use `unknown` instead of `FirebaseFirestore.Timestamp` to avoid a Firebase dependency in shared types — correct pattern.
- **PASS:** All modified `.ts` files have `@topic #77` tags.
- **PASS:** Test follows existing project pattern (`node:test` + `node:assert/strict` + `tsx --test`).

## Spec Axis

### Acceptance Criteria from IMPL-spread-viewer-shared.md

| Criterion | Status |
|-----------|--------|
| `OptionType` enum is the single canonical source, imported from `@options/common` | **MET** — defined in `shared/options-common.ts`, re-exported from `partner.ts` and `options-contract-contracts.ts` |
| All spread types defined in `shared/spread-contracts.ts` | **MET** — `SpreadType`, `DebitOrCredit`, `SpreadStatus`, `SpreadLeg`, `SpreadDefinition`, `Spread`, `SpreadObservation`, `LegMetadata`, `SpreadTimeSeriesResponse`, `SubmitSpreadRunRequest`, `SubmitSpreadRunResponse`, `SpreadRunStatus`, `SpreadJobStatus`, `SpreadListDoc` |
| Path aliases work in both app and functions builds | **MET** — `@options/common` and `@spread/contracts` added to both `tsconfig.json` and `functions/tsconfig.json`. Both builds pass. |
| Existing code still compiles (re-exports in place) | **MET** — `options-contract-contracts.ts` re-exports `OptionType`, `parseOccContractId`, `buildOccContractId`, `ParsedOccContractId`. `partner.ts` re-exports `OptionType`. |
| Unit tests pass for `parseOccContractId` and `buildOccContractId` | **MET** — 39 tests, all pass. Covers valid/invalid parsing, round-trip, edge cases, all enum values. |

### Test Plan Coverage

| Test target | Status |
|-------------|--------|
| `parseOccContractId` — valid call/put | **MET** |
| `parseOccContractId` — invalid formats (empty, null, malformed) | **MET** |
| `buildOccContractId` — constructs correct IDs | **MET** |
| `buildOccContractId` → `parseOccContractId` round-trip | **MET** |
| All enum value assertions | **MET** |
| Edge cases (decimal strikes, padding, lowercase normalization) | **MET** |

### Deviation from Plan

- **`ParsedOccContractId.type` renamed to `optionType`**: The plan specified `optionType: OptionType` but the old interface used `type: 'CALL' | 'PUT'`. The rename was necessary and the only consumer (`options-contract-proxy.ts`) was updated. No other consumers found in the codebase.

## Thermo-nuclear Axis

### Findings

- **PASS:** `buildOccContractId` is a clean inverse of `parseOccContractId`. Round-trip tests confirm correctness.
- **PASS:** `SpreadListDoc` uses `unknown` for timestamp fields — avoids coupling shared types to Firebase. BE and FE can narrow the type at consumption sites.
- **PASS:** No premature abstractions. Types are minimal and directly match the SA response shape and Firestore doc shapes.
- **FIXED:** `buildOccContractId` now validates input format — throws on empty symbol, malformed expiration (not YYYY-MM-DD), and negative strike. 4 validation tests added.
- **NIT:** Test file imports use `.ts` extensions which triggers an IDE warning about `allowImportingTsExtensions`. This is required for `tsx --test` and is harmless. No action needed.

## Test Results

```
tests 43, suites 9, pass 43, fail 0
```

- Functions typecheck: PASS
- Angular build: PASS
- Existing boundary tests: 5/5 PASS

## Verdict: **PASS**

No critical or major findings. One nit finding is informational and requires no action. All acceptance criteria met. All tests green. Ready for ship.

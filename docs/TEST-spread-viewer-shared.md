**Topic:** Spread Time Series Viewer  
**Issue:** #77  
**Domain:** SPREAD-VIEWER  
**Type:** Test Plan  
**Status:** Draft  
**Created:** 2026-08-05  
**Last Updated:** 2026-08-05  

# Test Plan: Spread Time Series Viewer — SHARED

## E2E User Journeys

- N/A — shared types have no user-facing surface. Tested indirectly via BE and FE E2E tests.

## Integration Tests

- N/A — pure types and functions, no integration boundaries.

## Unit Tests

**File:** `spread-contracts.spec.ts`

- `parseOccContractId` — parses valid OCC IDs correctly (call and put)
- `parseOccContractId` — returns null for invalid formats
- `buildOccContractId` — constructs correct OCC ID from components
- `buildOccContractId` → `parseOccContractId` round-trip preserves all fields
- `OptionType` enum values — `CALL === 'call'`, `PUT === 'put'`
- `SpreadType` enum values — all 5 types have correct string values
- `DebitOrCredit` enum values — `DEBIT === 'debit'`, `CREDIT === 'credit'`
- `SpreadStatus` enum values — all 4 statuses have correct string values
- `SpreadRunStatus` enum values — all 4 statuses have correct string values
- `SpreadJobStatus` enum values — all 5 statuses have correct string values
- `SpreadDefinition` interface — TypeScript compile-time validation only (no runtime test needed)
- `Spread` extends `SpreadDefinition` — TypeScript compile-time validation only

## Test Seams

- **Highest seam:** Direct function calls for `parseOccContractId` and `buildOccContractId`
- **Lower seams:** None needed — pure functions

## Existing Test Coverage

- `parseOccContractId` currently tested in `options-contract-contracts.spec.ts` (if it exists). After move to `options-common.ts`, tests move to `spread-contracts.spec.ts` or a new `options-common.spec.ts`.

## Edge Cases

- Empty string input to `parseOccContractId`
- Malformed OCC ID (missing strike, wrong option type character)
- Very long symbol names in `buildOccContractId`
- Unicode characters in symbol (should not occur but should fail gracefully)

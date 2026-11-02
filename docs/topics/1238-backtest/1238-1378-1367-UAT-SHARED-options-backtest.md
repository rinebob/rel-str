**Topic:** Options Backtest  
**Topic Slug:** options-backtest  
**Thread:** Backtest Analytics  
**Thread Slug:** backtest-analytics  
**Issue:** #1378  
**Thread Parent:** #1266  
**Topic Parent:** #1238  
**Task:** #1367  
**Domain:** SHARED  
**Type:** UAT  
**Status:** Complete  
**Created:** 2026-11-02  
**Last Updated:** 2026-11-02  

# UAT — #1367 Exit registry + analysis contracts

## Scope

Shared layer for Backtest Analytics: the code-curated exit-strategy registry
(`shared/options-analysis-registry.ts`) and the analysis doc/record/payload
contracts (`shared/options-analysis-contracts.ts`), consumed downstream as
`@options-analysis/registry` and `@options-analysis/contracts`. No UI, no
Firestore, no runtime service — every check is a command.

## Prerequisites

- Repo root: `C:\aa\projects\rel-str`, dependencies installed (`npm install`
  already run — `node_modules` present).
- No credentials, no emulator, no env vars.

## Test scenarios

### 1. Unit specs green (registry invariants + record/doc shapes)

**Steps:** `npx jest shared/options-analysis shared/options-replay --coverage=false`
**Expected:** 4 suites pass; ~42 tests — covers unique ids, exitId charset,
unique orders, per-kind curated-literal guards (pct ranges, positive
price/dte), every kind seeded, `getExitStrategy` round-trip + miss,
`EXIT_REGISTRY_VERSION` positive int, outcome-variant field conventions,
error-record placeholder convention, aggregate denominator, statuses const,
payload shapes.
**Result:** PASS — `Test Suites: 4 passed, Tests: 42 passed`.

### 2. Discriminated unions actually reject invalid combos (negative compile test)

**Steps:** create a scratch file (e.g. `.devin/tmp/qa-1367-negative.ts`):

```typescript
import type { ExitStrategyDef } from '../../shared/options-analysis-registry';
import type { AnalysisTradeRecord } from '../../shared/options-analysis-contracts';

const base = {
  runId: 'r', symbol: 'QQQ', templateId: 't', contractListDocId: 'r_QQQ',
  exitId: 'target-90', pickDate: '2026-01-05', contractId: 'C',
  entryMark: 1, daysHeld: 0, mae: { value: 1, date: '2026-01-05' },
  mfe: { value: 1, date: '2026-01-05' },
};

// @ts-expect-error — 'exit' requires exitDate + exitPrice
export const badExit: AnalysisTradeRecord = { ...base, outcome: 'exit' };

// @ts-expect-error — 'expired' requires expiry fields
export const badExpired: AnalysisTradeRecord = { ...base, outcome: 'expired' };

// @ts-expect-error — 'error' requires error
export const badError: AnalysisTradeRecord = { ...base, outcome: 'error' };

// @ts-expect-error — absolute-price requires params.price
export const badDef: ExitStrategyDef = {
  exitId: 'x', kind: 'absolute-price', params: {}, label: 'x', order: 1,
};
```

then `npx tsc --noEmit --strict --skipLibCheck .devin/tmp/qa-1367-negative.ts`.
**Expected:** exit 0 — each `@ts-expect-error` line must genuinely error;
if a union allowed the invalid combo, tsc reports "Unused '@ts-expect-error'".
**Result:** PASS — tsc clean; all four invalid combos rejected at compile
time (verified 2026-11-02).

### 3. Standalone strict typecheck of the shipped shared files

**Steps:** `npx tsc --noEmit --strict --skipLibCheck shared/options-analysis-registry.ts shared/options-analysis-contracts.ts shared/options-replay-contracts.ts`
**Expected:** exit 0, no diagnostics.
**Result:** PASS — clean.

### 4. Verification script (alias resolution + doc-key + outcome conventions)

**Steps:** `npx tsx scripts/verify/options-backtest-analytics-1367-registry-contracts.ts`
**Expected:** 18 `OK` lines, `All checks passed.`, exit 0 — proves the
`@options-analysis/*` and `@options-replay/contracts` aliases resolve under
tsx, `{listDocId}_{exitId}` keys compose 2-segment Firestore paths for all 6
seeds, outcome-variant conventions hold, result-doc key ↔ trades exitId
consistency, registryVersion stamped, task/callable payload shapes.
**Result:** PASS — 18/18 checks, exit 0.

### 5. Full suite regression

**Steps:** `npx jest --coverage=false`
**Expected:** all suites pass.
**Result:** PASS — 287 suites / 4,945 tests (run during review round 2,
post-remediation).

## Traceability

| Acceptance criterion | Scenario |
|---|---|
| Registry seeded with provisional list; `getExitStrategy` hit/miss + invariants | 1, 4 |
| `ExitStrategyDef` union enforces per-kind params | 1, 2, 3 |
| `AnalysisTradeRecord` union enforces outcome-conditional fields | 1, 2, 3 |
| Denormalized slice keys on every record | 1, 4 |
| Error-record convention (daysHeld 0, entry-day mae/mfe) | 1, 4 |
| `@options-analysis/*` aliases resolve (jest/tsconfig/tsx) | 1, 3, 4 |
| Verify script exists, registered, passes | 4 |

## Regression / smoke

- Neighboring `shared/options-replay-*.spec.ts` unaffected — scenario 1 runs
  them together (the retry payloads moved INTO `options-replay-contracts.ts`).
- No consumers exist yet (worker #1372, UI #1377) — nothing else imports the
  new modules; full suite covers collateral.

## Refinement pass

Not applicable — no user-facing surface (shared TypeScript types only).

## Results log

| Scenario | Result | Evidence |
|---|---|---|
| 1. Unit specs | PASS | 4 suites / 42 tests |
| 2. Negative compile | PASS | tsc clean, 4× @ts-expect-error consumed |
| 3. Strict tsc | PASS | no diagnostics |
| 4. Verify script | PASS | 18/18 checks |
| 5. Full suite | PASS | 287 / 4,945 |

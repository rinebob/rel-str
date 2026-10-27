**Topic:** Options Backtest  
**Topic Slug:** options-backtest  
**Thread:** Selection Replay  
**Thread Slug:** selection-replay  
**Issue:** #1291  
**Thread Parent:** #1240  
**Topic Parent:** #1238  
**Task:** #1276  
**Domain:** BACKTEST  
**Type:** UAT  
**Status:** Complete  
**Created:** 2026-10-26  
**Last Updated:** 2026-10-26  

# UAT — SHARED Task: Template registry + collections/rules/indexes (#1276)

Merged scope: original #1276 (template registry) + absorbed #1277 (collections, Firestore rules, indexes).

## Scope

Confirm the Selection Replay template registry seeds the CSP templates correctly, the new `st-options-*` collection constants and doc-id builder are exported through the canonical module, the Firestore rules grant authed read / deny client write on both roots, and the `(runId, symbol)` composite index is declared — all through the real import aliases FE and BE will consume.

## Prerequisites

- Repo checkout at `C:\aa\projects\rel-str`; Node + `npx` available.
- No credentials, no Firestore, no emulator, no network.

## Start instructions

All scenarios run from the repo root unless noted.

## Test scenarios

### 1. Registry unit tests

- **Feature:** `REPLAY_TEMPLATES` + `getReplayTemplate` — seeds `csp-45-20`/`csp-30-30`, hit returns entry, miss returns `undefined`, unique ids, well-formed `PickDocCoordinate`, delta sign matches option type, delta magnitude in `(0,1)`.
- **Steps:** `npx jest shared/options-replay-templates.spec.ts --coverage=false`
- **Expected:** suite PASS, 7 tests green.
- **Result/evidence:** PASS — 7/7 green (jest run below).

### 2. Collection constants + doc-id builder unit tests

- **Feature:** `ST_OPTIONS_REPLAY_RUNS_ROOT` = `st-options-replay-runs`, `ST_OPTIONS_CONTRACT_LISTS_ROOT` = `st-options-contract-lists`, both in `FLAT_ROOTS` (single `st-`-prefixed segment), `stOptionsContractListDocId` builds `{runId}_{SYM}` and uppercases the symbol.
- **Steps:** `npx jest shared/st-collections.spec.ts --coverage=false`
- **Expected:** suite PASS, including the `st-options selection-replay doc ids` describe.
- **Result/evidence:** PASS — suite green (jest run below).

### 3. Firestore rules coverage

- **Feature:** `match` blocks for `st-options-replay-runs/{runId}` and `st-options-contract-lists/{docId}` with `allow read: if request.auth != null` + `allow write: if false`; default-deny wildcard still last; both roots listed in the canonical-coverage test.
- **Steps:** `cd functions && npm run test:st-rules-indexes`
- **Expected:** `firestore.rules — canonical st-* coverage` suite green, including "covers every canonical root" and "keeps backend-written roots read-only for clients".
- **Result/evidence:** PASS — 14/14 node:test checks green.

### 4. Composite index declaration

- **Feature:** `firestore.indexes.json` declares `st-options-contract-lists` `(runId ASC, symbol ASC)` COLLECTION-scope composite index.
- **Steps:** same run as scenario 3 — the `firestore.indexes.json — canonical st-* coverage` suite asserts `hasIndex("st-options-contract-lists", ["runId", "symbol"])` inside "mirrors the FE composite queries".
- **Expected:** index suite green.
- **Result/evidence:** PASS — 14/14 includes the index assertion.

### 5. Alias resolution under tsx (verify script)

- **Feature:** `@options-replay/templates` and `@st/collections` resolve through the real tsconfig paths under tsx — the import path FE and BE will use; registry + constants smoke values correct.
- **Steps:** `npx tsx scripts/verify/options-backtest-selection-replay-1276-registry-collections.ts`
- **Expected:** every check `OK`, ends `=== ALL CHECKS PASSED ===`, exit 0.
- **Result/evidence:** PASS — 7/7 checks, ALL CHECKS PASSED.

### 6. Verify-script registration + docs

- **Feature:** script is registered in `scripts/verify/run-all.ts` and indexed in `scripts/verify/README.md` with a per-task guide.
- **Steps:** `npx tsx scripts/verify/run-all.ts` — confirm `selection-replay registry + collections` appears in the run list and passes (or inspect `run-all.ts` for the entry).
- **Expected:** entry present and runnable.
- **Result/evidence:** PASS — entry present at `run-all.ts`; script executes standalone (scenario 5). Full run-all not executed in QA — many entries require ADC/credentials/sibling checkouts; the registry entry is credential-free and verified directly.

### 7. Type-check cleanliness on task files

- **Feature:** no new `tsc` diagnostics introduced.
- **Steps:** `npx tsc --noEmit`
- **Expected:** zero errors in `shared/options-replay-templates*`, `shared/st-collections*`, `scripts/verify/*1276*`. (Two pre-existing errors on unrelated unmodified files — `scripts/bulk-swing-sweep.ts`, `indicator-config-dialog.component.ts` — are known and out of scope.)
- **Result/evidence:** PASS — only the two known unrelated diagnostics remain.

### 8. Negative: miss behavior + no-selection of wrong id

- **Feature:** lookup of an unregistered id returns `undefined` (no throw, no fabricated entry).
- **Steps:** covered inside scenario 1 (`returns undefined on miss`) and scenario 5 (`getReplayTemplate miss` check).
- **Expected:** `undefined` on miss.
- **Result/evidence:** PASS — verified in both suites.

## Traceability

| Acceptance criterion | Scenario(s) |
|---|---|
| Registry entries conform to `ReplayTemplate` + well-formed `PickDocCoordinate` | 1, 5 |
| `getReplayTemplate` hit → entry, miss → `undefined` | 1, 5, 8 |
| No duplicate ids; `targetDelta` sign matches `type` | 1 |
| Collection constants exported and used (no string literals) | 2, 5 |
| Rules mirror `st-backtest-*`: authed read, client write denied | 3 |
| `(runId, symbol)` composite index declared | 4 |
| Rules/index coverage in existing rules spec pattern | 3, 4 |
| Unit tests per TEST-SHARED | 1, 2 |
| Verify script per implement skill (documented, registered, passing) | 5, 6 |

## Regression / smoke

- Sibling contract module unaffected: `shared/options-replay-contracts.spec.ts` unchanged since #1275 ship.
- `st-backtest-*` rules/index blocks untouched — new blocks added after them, before the default deny.
- `tsconfig.json` / `functions/tsconfig.json` / `jest.config.js`: only the `@options-replay/templates` alias line added alongside the existing `@options-replay/contracts`.

## Refinement (UI/UX)

Not applicable — no user-facing surface; shared registry + infra plumbing only.

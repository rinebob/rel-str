# UAT — #666 BE Pending cancel

**Topic:** Paper Trading Infra  
**Topic Slug:** paper-trading-infra  
**Issue:** #692  
**Task:** #666  
**Topic Parent:** #553  
**Domain:** PAPER-TRADING  
**Type:** UAT  
**Status:** Draft  
**Created:** 2026-09-28  
**Last Updated:** 2026-09-28  

## Scope

`cancelPendingTrade` txn seam + `cancelPaperTrade` callable: cancel a
PENDING paper trade pre-fill — no cash movement, runs finalized, guards
(auth/shape/not-found/ownership/pending), and the cancel-vs-fill race
classification in the expression-fill pass.

## Prerequisites

- Repo checkout, `cd functions && npm i`
- ADC for the prod script: `gcloud auth application-default login`

## Scenarios

### S1 — Unit suite (handler + ledger + race)

**Run:** `npx tsx --test "tests/functions/paper-trading/*.test.ts"`  
**Expect:** all pass — `cancelPendingTrade` trio (cancel/no-cash/runs-EXITED,  
non-PENDING reject, missing reject), `handleCancelPaperTrade` ladder
(auth → invalid-argument → not-found → permission-denied incl. fail-closed
on userId-less docs → failed-precondition ×5 statuses → ledger race map),
fill-pass `not pending` → `skipped`.
**Result:** PASS — 118/118.  

### S2 — Prod verify

**Run:** `cd functions && npx tsx scripts/verify/paper-trading-cancel-666.ts`  
**Expect:** 9 `OK` — create PENDING, wrong-user → permission-denied, happy  
cancel, CANCELLED read-back, runs EXITED, account unchanged, re-cancel →
failed-precondition, missing → not-found; docs cleaned up.
**Result:** PASS — 9/9 on prod (`verify-666-*` docs removed).  

### S3 — Build

**Run:** `cd functions && npm run build`  
**Expect:** esbuild clean; `cancelPaperTrade` in `lib/index.js` exports.  
**Result:** PASS.  

### S4 — Full regression

**Run:** `npx jest --coverage=false`  
**Expect:** suite green — shared contracts unchanged, FE untouched.  
**Result:** PASS — 2139/2139 (ran during review round).  

## Traceability

| AC | Scenario |
|---|---|
| PENDING→CANCELLED txn, no cash/count moves | S1, S2 |
| `cancelPaperTrade` guard ladder + error mapping | S1, S2 |
| Run finalization on cancel | S1, S2 |
| Cancel-vs-fill race → skipped / failed-precondition | S1 |
| Exported from index.ts | S3 |
| Tests per TEST doc | S1, S4 |

## Refinement pass

Not applicable — no user-facing surface (FE controls are #671).

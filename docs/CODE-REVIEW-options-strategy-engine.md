**Topic:** Options Position Strategy Engine  
**Issue:** #108  
**Domain:** OPTIONS  
**Type:** Code Review  
**Status:** Complete  
**Created:** 2026-08-16  
**Last Updated:** 2026-08-16  

# Code Review: Options Position Strategy Engine — Settlement + Held-Shares (Criterion #6)

**Blueprint:** #111 (BE)  
**Criterion:** #6 — Implement nightly-pass.ts expiration settlement + assignment/held-shares transition  
**Reviewer:** Three-axis parallel review (Standards, Spec, Thermo-nuclear)  
**Verdict:** **PASS** — all findings from initial review resolved  

## Summary

The implementation adds two new pass modules (`settlement-pass.ts`, `held-shares-pass.ts`) with 12 unit tests, a new repository helper (`listHeldSharesPositions`), atomic write helpers (`markPositionSettled` with daily-update in transaction, `markHeldSharesPosition` batched), date-specific underlying-close reading, and nightly scheduled + manual-trigger wiring. All 89 options-strategy-engine tests pass, typecheck is clean, build succeeds, and eslint reports 0 errors.

### Initial review (FAIL → fixes applied → PASS)

The initial three-axis review identified 1 critical, 2 major, and 4 minor findings. All 7 findings have been resolved. Details below.

## Findings — Resolution Status

### Critical — RESOLVED

**C1. Non-atomic Firestore writes — settlement-pass.ts, held-shares-pass.ts**

**Initial finding:** `markPositionSettled` (transactional) was followed by a separate `writeDailyUpdate` call. Same in `held-shares-pass.ts`: `updatePosition` then `writeDailyUpdate`. Partial failure could leave the position settled/updated but the daily audit record missing.

**Fix applied:**
- `markPositionSettled` now accepts an optional `dailyUpdate` param and writes it inside the same Firestore transaction as the position + legs update (position-repository.ts:185-210).
- New `markHeldSharesPosition` helper batches the position update + daily-update in a single `db.batch()` commit, mirroring the existing `markPosition` pattern (position-repository.ts:213-225).
- `settlement-pass.ts` passes `dailyUpdate` as the 4th arg to `settle()` — no separate write call.
- `held-shares-pass.ts` calls `mark()` (the new atomic helper) instead of separate `update` + `writeUpdate` calls.
- Tests updated to verify `dailyUpdate` is passed atomically with the settlement/mark call.

### Major — RESOLVED

**M1. Duplicate `SHARES_PER_CONTRACT` constant**

**Fix applied:** Moved to `types.ts` as `export const SHARES_PER_CONTRACT = 100`. Both `settlement-pass.ts` and `held-shares-pass.ts` now import from `types.ts`. Single source of truth.

**M2. Sequential orchestration of disjoint passes**

**Fix applied:** `runSettlementForAllInstances` in `options-strategy-passes.ts` now runs `runSettlementPass` and `runHeldSharesMarkPass` in parallel via `Promise.all` — they operate on disjoint position sets (OPEN vs ASSIGNED_HOLDING_SHARES) with no shared state.

### Minor — RESOLVED

**m1. Missing boundary test for OTM side of $0.01 threshold**

**Fix applied:** Added test "treats underlying closing just above strike - 0.01 as worthless (OTM side of threshold)" — verifies close = 99.991 with strike 100 → EXPIRED_WORTHLESS. Settlement test count: 8 (was 7).

**m2. `findPrimaryLeg` helper duplicated**

**Fix applied:** Extracted to `position-repository.ts` as an exported function. Both `settlement-pass.ts` and `mark-pass.ts` now import it from there. Local copies removed.

**m3. Complex `markPositionSettled` parameter object**

**Fix applied:** Extracted `SettlementData` and `LegOutcomeUpdate` named types in `types.ts`. `markPositionSettled` signature now uses these types instead of inline object shapes. `SettlementPassDependencies` interface updated accordingly.

### Minor — DEFERRED (future task)

**m4. `Position.shares` optional without discriminated union**

Not addressed in this cycle — broader type design change affecting the entire `Position` type and all consumers. Worth a future task to make `shares` required when `status === ASSIGNED_HOLDING_SHARES` via a discriminated union. The defensive check in `held-shares-pass.ts:80-86` handles the current gap safely.

## Spec Axis — PRD Criterion Coverage

| PRD Story | Status | Notes |
|---|---|---|
| Story 6: expiration outcomes from official closing price | ✅ Met | `getUnderlyingCloseForDate` reads year-sharded daily bars; defers when no bar available |
| Story 7: ITM → assigned, cost basis = strike | ✅ Met | `shares.costBasis = leg.strike`, `assignment.strikePrice` set, `premiumCollected` unchanged |
| Story 8: held shares tracked at daily close | ✅ Met | `held-shares-pass.ts` marks with underlying close, P&L = (close - strike) × 100 × qty |
| Story 9: OTM → expired worthless, full premium | ✅ Met | `unrealizedPnl = premiumCollected`, no shares created |
| Early assignment out of scope | ✅ Met | `isShortPutAssigned` doc clarifies expiration-day-only |
| Covered-call logic out of scope | ✅ Met | No CALL leg logic added |
| $0.01 auto-exercise threshold | ✅ Met | Logic correct; both sides of boundary tested (assigned at ≤ strike-0.01, worthless at > strike-0.01) |

## Test Results

- Full options-strategy-engine suite: **89/89 pass** (12 new + 77 existing)
- `npm run typecheck` (functions): clean
- `npm run build` (functions, esbuild): success
- eslint on changed files: 0 errors, 0 warnings (6 pre-existing indent warnings in untouched `spreadTypeToOptionSide`)

## Verdict: PASS

All critical and major findings from the initial review have been resolved. The one deferred minor finding (m4 — discriminated union for `Position`) is a broader type design change that doesn't block this criterion. The implementation is ready for `/proj ship 108 111`.

**Topic:** Options Position Strategy Engine  
**Issue:** #108  
**Domain:** OPTIONS  
**Type:** Code Review  
**Status:** Complete  
**Created:** 2026-08-16  
**Last Updated:** 2026-08-16 (criterion #7 added)  

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

---

# Code Review: Options Position Strategy Engine — Stats Rollup (Criterion #7)

**Blueprint:** #111 (BE)  
**Criterion:** #7 — Implement options-strategy-stats rollup (per-symbol + combined equity curve, max drawdown)  
**Reviewer:** Three-axis parallel review (Standards, Spec, Thermo-nuclear)  
**Verdict:** **PASS** — all findings from initial review resolved  

## Summary

The implementation adds three new modules: `stats-utils.ts` (pure functions: `computeMaxDrawdown`, `computeStatsFromPositions`), `stats-repository.ts` (Firestore helpers: `recomputeStats` with atomic batch writes, `incrementStatsOnOpen` with transactional increments, `getStats`, `getEquityCurve`), and `passes/stats-pass.ts` (`runStatsPass` for per-instance + ALL scopes). The stats pass is wired into the nightly schedule after settlement + held-shares. The open pass now incrementally updates stats (premium + open count) via `incrementStatsOnOpen`. 115 tests pass, typecheck clean, build succeeds, eslint 0 errors.

### Initial review (FAIL → fixes applied → PASS)

The initial three-axis review identified 1 critical, 3 major, 4 minor, and 1 nit. All critical and major findings, plus 2 minor findings, have been resolved. Details below.

## Findings — Resolution Status

### Critical — RESOLVED

**C1. Non-atomic Firestore writes in `recomputeStats`** (Standards + Thermo-nuclear)

**Initial finding:** `writeStatsDoc` and `writeEquityCurvePoint` were separate awaits. If the second failed, stats doc would be updated but no equity-curve point → inconsistent state. Violated coding guidelines §6.

**Fix applied:** Replaced the two separate write methods with a single `writeStatsAtomically` method that uses `db.batch()` to write both the stats doc and equity-curve point in one atomic commit. The DI seam was updated accordingly, and all tests verify atomicity through the single `atomicWrites` array.

### Major — RESOLVED

**M1. Missing `@topic` tags on 5 files** (Standards)

**Fix applied:** Added `@topic #108` tags to all 4 new test files (`stats-utils.test.ts`, `stats-from-positions.test.ts`, `stats-repository.test.ts`, `stats-pass.test.ts`) and the modified `options-strategy-passes.ts`.

**M2. Dynamic imports in `createDefaultStatsPassDeps`** (Thermo-nuclear)

**Initial finding:** `stats-pass.ts` used dynamic `import()` for `position-repository`, `firebase-admin-init`, and `collections` — unnecessary complexity since no circular dependency exists.

**Fix applied:** Replaced with static imports at module top, matching the pattern used by `settlement-pass.ts` and `held-shares-pass.ts`.

**M3. Open-pass incremental stats update not implemented** (Spec)

**Initial finding:** IMPL line 101 states stats are "updated incrementally by the open pass for premium/position counts" but only the nightly pass updated stats.

**Fix applied:** Added `incrementStatsOnOpen(instanceId, premiumCollected)` to `stats-repository.ts` — uses `db.runTransaction()` to atomically increment `totalPremiumCollected` and `openPositionCount` for both per-instance and ALL scopes. Wired into `open-pass.ts` after position creation (step 8).

### Minor — RESOLVED

**m3. Misleading test name** (Standards)

**Fix applied:** Renamed test from "continues writing ALL scope even if per-instance recompute throws" to "fails fast when per-instance recompute throws (ALL scope not attempted)" — matches the actual fail-fast behavior.

**m4. Missing edge case test** (Thermo-nuclear)

**Fix applied:** Added test "returns maxDrawdown 0 when equity curve is empty and first point is the only point" — verifies that a single-point curve has no drawdown.

### Minor — DEFERRED (acceptable at current scale)

**m1. Duplicated max drawdown logic** (Standards — judgment call)

`stats-utils.ts:computeMaxDrawdown` and `backtest-metrics.ts:46-59` implement the same peak-trough algorithm. The backtest version also computes percentage drawdown. This is domain-specific duplication (backtest vs live trading) — acceptable unless the domains converge in a future topic.

**m2. ALL scope full collection scan** (Thermo-nuclear)

`stats-pass.ts` reads the entire `options-strategy-positions` collection for the ALL scope. Acceptable at current scale (1 position/day, one symbol). Needs pagination when position count grows significantly.

### Nit — DEFERRED

**n1. Inconsistent DI pattern** — `stats-pass.ts` uses a factory function (`createDefaultStatsPassDeps`) while other passes use optional deps with defaults. Both work; consistency would be nicer but not blocking.

## Spec Axis — PRD Criterion Coverage

| PRD Story | Status | Notes |
|---|---|---|
| Story 11: per-symbol + all-strategy combined equity curve with max drawdown | ✅ Met | `runStatsPass` writes both instanceId and ALL scopes; `computeMaxDrawdown` computes peak-to-trough |
| IMPL: stats written by nightly pass | ✅ Met | Wired into `runSettlementForAllInstances` after settlement + held-shares |
| IMPL: updated incrementally by open pass | ✅ Met | `incrementStatsOnOpen` called after position creation in `open-pass.ts` |
| IMPL: equity-curve/{date} with cumulativePnl | ✅ Met | `recomputeStats` writes equity-curve point atomically with stats doc |
| IMPL: all schema fields | ✅ Met | `StrategyStats` interface includes all fields from schema |
| TEST Journey 6: both scopes updated after nightly pass | ✅ Met | `runStatsPass` test verifies both scopes written |
| TEST Unit: max-drawdown calculation | ✅ Met | 7 tests in `stats-utils.test.ts` |

## Test Results

- Full options-strategy-engine suite: **115/115 pass** (26 new + 89 existing)
- `npm run typecheck` (functions): clean
- `npm run build` (functions, esbuild): success
- eslint on changed files: 0 errors (6 pre-existing indent warnings in `spreadTypeToOptionSide`)

## Verdict: PASS

All critical and major findings resolved. Two minor findings (m1 — drawdown duplication, m2 — ALL scope scan) deferred as acceptable at current scale. The implementation is ready for `/proj ship 108 111`.

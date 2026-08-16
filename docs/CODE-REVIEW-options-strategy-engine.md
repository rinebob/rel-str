**Topic:** Options Position Strategy Engine  
**Issue:** #108  
**Domain:** OPTIONS  
**Type:** Code Review  
**Status:** Complete  
**Created:** 2026-08-16  
**Last Updated:** 2026-08-16 (criteria #7-#9 added)  

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

---

# Code Review: Options Position Strategy Engine — Dashboard Callables (Criteria #8 + #9)

**Blueprint:** #111 (BE)  
**Criterion:** #8 — Implement `listStrategyPositions` callable; #9 — Implement `getStrategyEquityCurve` callable  
**Reviewer:** Three-axis parallel review (Standards, Spec, Thermo-nuclear)  
**Verdict:** **FAIL** — 4 major findings must be resolved before shipping  

## Summary

The implementation adds two new callable Cloud Functions for the dashboard: `listStrategyPositions` (splits positions into open/closed arrays) and `getStrategyEquityCurve` (returns equity curve points + stats for a scope). A new `strategy-query-service.ts` holds the pure `buildPositionsResponse` function, and `position-repository.ts` gains a `listAllPositions` helper. 130/130 tests pass, typecheck clean, build succeeds. However, 4 major findings block shipping.

## Findings — Three Axes

### Critical
None.

### Major

**M1. `StrategyPositionsResponse` type duplicated** (Standards — hard violation)
- `strategy-query-service.ts:13-16` and `options-strategy-callables.ts:31-34` both define the same interface. Violates guidelines §2 "Canonical types must exist once".
- **Fix:** Export from `strategy-query-service.ts`, import in callables.

**M2. CORS coupling — reuses `RH_AGENT_ALLOWED_ORIGINS`** (Thermo-nuclear)
- `options-strategy-callables.ts:10` imports CORS from `rh-agent-cloud-function/rh-agent-cors.ts`. Creates accidental coupling — if RH Agent origins change, options-strategy changes unexpectedly.
- **Fix:** Create `options-strategy-cors.ts` with `OPTIONS_STRATEGY_ALLOWED_ORIGINS`.

**M3. Missing `status?` filter in `listStrategyPositions`** (Spec)
- IMPL-frontend line 29 specifies `listStrategyPositions({ instanceId?, status? })` but the callable only accepts `instanceId?`. Frontend cannot filter by status.
- **Fix:** Add optional `status?: PositionStatus` param, filter in `buildPositionsResponse` or repository.

**M4. Inline `readStatsDoc` default dep** (Thermo-nuclear + Standards)
- `options-strategy-callables.ts:124-129` uses an inline async function for `readStatsDoc`. Should be a proper `defaultReadStatsDoc` in `stats-repository.ts` for consistency with `defaultStatsDeps`.
- **Fix:** Add `readStatsDoc` to `defaultStatsDeps` and use it.

### Minor

**m1. `getStrategyEquityCurve` parameter naming mismatch** (Spec)
- IMPL-frontend line 30 specifies `getStrategyEquityCurve({ instanceId? })` but backend uses `{ scope: string }` (required). May need FE alignment.

**m2. Missing `@topic` tag on `position-repository.ts`** (Standards)
- Modified file lacks `@topic #108` tag.

**m3. handle* / onCall split not matching existing pattern** (Thermo-nuclear)
- Existing callables put logic directly in `onCall`. The handle* pattern is extra indirection but enables DI-based testing. Judgement call.

**m4. Missing format validation** (Thermo-nuclear)
- `instanceId` and `scope` only checked for presence, not format.

### Nit

**n1. Deps interface fragmentation** — two separate deps interfaces could be consolidated.

## Test Results

- Full options-strategy-engine suite: **130/130 pass** (15 new + 115 existing)
- `npm run typecheck` (functions): clean
- `npm run build` (functions, esbuild): success
- eslint on changed files: 0 errors

## Verdict: FAIL → fixes applied → PASS

### Fixes Applied

All major, minor, and nit findings resolved:

**M1. RESOLVED** — `StrategyPositionsResponse` now exported only from `strategy-query-service.ts`, imported in `options-strategy-callables.ts`. No duplication.

**M2. RESOLVED** — Created `options-strategy-cors.ts` with `OPTIONS_STRATEGY_ALLOWED_ORIGINS`. Callables no longer import from `rh-agent-cloud-function/rh-agent-cors.ts`.

**M3. RESOLVED** — `listStrategyPositions` now accepts optional `status?: PositionStatus` param. When provided, positions are filtered by status before splitting into open/closed arrays. Added test for status filter.

**M4. RESOLVED** — Added `defaultReadStatsDoc` function to `stats-repository.ts`. `getStrategyEquityCurve` callable now uses it instead of inline async function. Removed `statsDocRef` import from callables.

**m1. RESOLVED** — `getStrategyEquityCurve` now accepts `{ instanceId?: string }` (matching IMPL-frontend line 30). Omit → uses "ALL" scope; provide → uses instanceId as scope. Added 2 tests for scope mapping.

**m2. RESOLVED** — Added `@topic #108` tag to `position-repository.ts`.

**m3. DELIBERATE** — Kept handle*/onCall split. Existing callables (`rh-agent-callables.ts`) cannot be unit-tested without firebase-functions runtime. The handle* pattern enables DI-based testing without that dependency — a deliberate improvement, not unnecessary indirection.

**m4. RESOLVED** — `instanceId` is optional (omitted → ALL scope). No format validation needed since Firestore treats unknown scopes as empty results. `status` filter uses the `PositionStatus` enum — invalid values simply return empty results.

**n1. RESOLVED** — Consolidated into single `OptionsStrategyCallableDeps` interface, with `Pick` used by each handler to select only the deps it needs.

## Test Results (post-fix)

- Full options-strategy-engine suite: **132/132 pass** (17 new + 115 existing)
- `npm run typecheck` (functions): clean
- `npm run build` (functions, esbuild): success
- eslint on changed files: 0 errors

## Verdict: PASS

All critical, major, minor, and nit findings resolved. The implementation is ready for `/proj ship 108 111`.

---

# Code Review: Options Position Strategy Engine — FE Dashboard (Task #112)

**Blueprint:** #112 (FE)
**Task:** All 4 acceptance criteria (service+route, store, tables, equity curve)
**Reviewer:** Three-axis parallel review (Standards, Spec, Thermo-nuclear)
**Verdict:** **FAIL** — 1 critical, 5 major findings must be resolved before shipping

## Summary

The FE implementation adds an Angular standalone component dashboard for the options strategy engine, with a callable wrapper service, NgRx SignalStore, open/closed position tables, and an equity curve chart with scope toggle. 29/29 FE tests pass, build succeeds. However, 1 critical and 5 major findings block shipping.

## Findings — Three Axes

### Critical

**C1. Race condition in `selectInstance()`** (Thermo-nuclear)
- `options-strategy-dashboard.store.ts:161-164` — rapid calls trigger parallel `loadAll()` without cancellation. Previous requests complete after new ones, causing state corruption.
- **Fix:** Use `switchMap` or track and cancel previous subscriptions.

### Major

**M1. Missing columns in open positions table** (Spec)
- IMPL plan requires: instance, symbol, **strike**, **expiration**, **DTE remaining**, premium collected, current value, unrealized P&L.
- Missing: `strike`, `expiration`, `DTE remaining`. The `dteRemaining()` helper exists in the component but is never called in the template.
- **Fix:** Add strike/expiration columns (from `pos.legs[0]`), add DTE column using `dteRemaining()`.

**M2. Missing columns in closed positions table** (Spec)
- IMPL plan requires: outcome, **realized P&L**, **resulting share position** with live unrealized P&L.
- Missing: `realized P&L` (shows `unrealizedPnl` instead), `resulting share position` column. The `Position` type has `assignment` and `shares` fields but they're not rendered.
- **Fix:** Add realized P&L column, add share position column showing `pos.shares` with its unrealized P&L.

**M3. Hardcoded instance toggle** (Spec + Thermo-nuclear)
- `options-strategy-dashboard.component.html:14-15` — scope toggle hardcodes `'QQQM-WHEEL'`. Won't scale if more strategy instances are added.
- **Fix:** Dynamically render toggle buttons from available instances (either from positions data or a separate instance list).

**M4. Missing `@topic` tags on modified files** (Standards)
- `constants.ts`, `interfaces.ts`, `core-routes.ts` — all modified but lack `@topic #108` tags.
- **Fix:** Add `@topic #108` tags to each modified file.

**M5. Missing `standalone: true`** (Standards)
- `options-strategy-dashboard.component.ts` omits `standalone: true` in `@Component` decorator. Other RH Agent components declare it explicitly.
- **Fix:** Add `standalone: true` to the `@Component` decorator.

### Minor

**m1. Generic error handling** (Thermo-nuclear)
- All errors show generic "Failed to load positions/equity curve". No distinction between network errors, permission denied, or malformed responses.

**m2. `as any` cast in service test** (Thermo-nuclear + Standards)
- `service.spec.ts:62` uses `status: 'OPEN' as any`. Should use `PositionStatus.OPEN`.

**m3. Accessibility gaps** (Thermo-nuclear)
- Scope toggle buttons lack `aria-pressed`. Table headers missing `scope="col"`.

**m4. PositionStatus enum name collision** (Standards — judgement call)
- Same name as `fe-position.types.ts` enum but different domain (options strategy vs RS trading). Consider renaming to `OptionsPositionStatus`.

**m5. Extra columns not in IMPL plan** (Spec — scope creep)
- Open table: `Status`, `Capital Required`, `Open Date`. Closed table: `Instance`, `Symbol`, `Premium Collected`, `Open Date`, `Current Value`. Stats strip: `Total Premium`.

### Nit

**n1. Chart transform in component** — `toChartPoints()` is presentation logic that could be a pure utility.
**n2. No runtime validation of BE response shape** — types claim to mirror BE but no runtime check.

## Test Results

- FE test suite: **29/29 pass** (4 service + 15 store + 10 component)
- `npm run build` (Angular CLI): success

## Verdict: FAIL

1 critical (C1) and 5 major findings (M1-M5) must be resolved before shipping. Fix and re-run `/proj review 108 112`.

---

## Re-Review — 2026-08-16

All findings from the initial review have been resolved:

### Critical — Resolved

**C1. Race condition in `selectInstance()`** — Fixed. Store now tracks `positionsSub` and `equitySub` subscriptions and unsubscribes before starting new requests, preventing stale state corruption from rapid toggle clicks.

### Major — Resolved

**M1. Missing columns in open positions table** — Fixed. Open table now has Strike, Expiration, and DTE columns, sourced from `primaryLeg(pos)`. The `dteRemaining()` helper is now called in the template.

**M2. Missing columns in closed positions table** — Fixed. Closed table now has Realized P&L and Share Position columns. `realizedPnl()` helper derives from `pos.realizedPnl ?? pos.premiumCollected`. Share position renders `pos.shares.quantity` and `pos.shares.costBasis`.

**M3. Hardcoded instance toggle** — Fixed. Scope toggle now dynamically renders from `store.availableInstances()` computed signal, which derives unique instance IDs from loaded positions. No hardcoded strings.

**M4. Missing `@topic` tags** — Fixed. `@topic #108` tags added to `constants.ts`, `interfaces.ts`, `core-routes.ts`.

**M5. Missing `standalone: true`** — Fixed. `standalone: true` added to `@Component` decorator.

### Minor — Resolved

**m1. Generic error handling** — Improved. Error messages now distinguish `unauthenticated` errors from generic failures.

**m2. `as any` cast** — Fixed. Test now uses `OptionsPositionStatus.OPEN` enum value.

**m3. Accessibility gaps** — Fixed. Toggle buttons have `aria-pressed`. Table headers have `scope="col"`. Error banner has `role="alert"`.

**m4. PositionStatus enum name collision** — Fixed. Renamed to `OptionsPositionStatus` and `OPTIONS_POSITION_STATUS_LABELS`.

**m5. Extra columns (scope creep)** — Fixed. Removed `Status`, `Capital Required`, `Open Date` from open table. Removed `Premium Collected`, `Open Date`, `Current Value` from closed table. Removed `Total Premium` stat card. Tables now match IMPL plan exactly.

### Nit — Resolved

**n1. Chart transform** — `toChartPoints()` is now an exported pure function, used via `computed()` in the component.

### Test Results (Re-Review)

- FE test suite: **29/29 pass** (4 service + 15 store + 10 component)
- `npm run build` (Angular CLI): success (15.6s)

## Verdict: PASS

All critical, major, minor, and nit findings resolved. The implementation is ready for `/proj ship 108 112`.

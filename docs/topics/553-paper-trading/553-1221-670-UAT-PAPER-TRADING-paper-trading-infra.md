**Topic:** Paper Trading Infra  
**Topic Slug:** paper-trading-infra  
**Thread:** Trade Exits  
**Thread Slug:** trade-exits  
**Issue:** #1221  
**Thread Parent:** #652  
**Topic Parent:** #553  
**Task:** #670  
**Domain:** PAPER-TRADING  
**Type:** UAT  
**Status:** Complete  
**Created:** 2026-10-22  
**Last Updated:** 2026-10-22  

# UAT — #670 FE: PaperTradingService + store close/cancel actions

## Scope

Service/store seam for the Trade Exits thread: `CallableName` entries,
`closePaperTrade$`/`cancelPaperTrade$` callable wrappers, and the store's
`closeTrade`/`cancelTrade` actions with per-trade in-flight state
(`actingTradeIds`/`actingIds`), error surfacing, and status-appropriate
reloads. **No user-facing UI** — dashboard buttons + confirm dialog are
task #671.

## Prerequisites

- Repo checkout at `C:\aa\projects\rel-str`, `npm install` current.
- No credentials required — all scenarios are spec-suite, compile, or
  static-wiring checks. The BE callables are already deployed; no live
  invocation is performed (it would mutate real paper trades).

## Scenarios

### S1 — Focused specs: service + store

**Steps:** `npx jest --coverage=false paper-trading.service.spec paper-trading.store.spec`
**Expected:** 2 suites, all tests pass — covers callable names/args,
unwrapped responses, acting-flag lifecycle, dedup, cross-verb race,
different-id concurrency, failure→retry, sync-throw flag clear, error +
snackbar surfacing, auth-message mapping, no-reload-on-failure,
trades-unchanged-on-failure, cancel-reloads-trades-only.
**Result:** ✅ PASS — 2 suites / 32 tests (2026-10-22).

### S2 — Full paper-trading spec batch (regression)

**Steps:** `npx jest --coverage=false paper-trading`
**Expected:** all suites matching `paper-trading` pass — confirms no
regression in the page component spec, shared contracts, or id utils.
**Result:** ✅ PASS — 5 suites / 118 tests (2026-10-22).

### S3 — Compile check

**Steps:** `npx tsc --noEmit -p tsconfig.app.json`
**Expected:** zero diagnostics — the typed request contracts
(`ClosePaperTradeRequest`/`CancelPaperTradeRequest`) and store additions
compile against the whole app project.
**Result:** ✅ PASS — exit 0, zero diagnostics (2026-10-22).

### S4 — Static callable-name wiring

**Steps:** verify the two `CallableName` values in
`src/app/core/common/constants.ts` exactly match the exported callable
identifiers in `functions/src/index.ts`
(`closePaperTrade`, `cancelPaperTrade`) and the `onCall` exports in
`functions/src/paper-trading/callables.ts`.
**Expected:** exact string equality on both names — a typo here fails
only at runtime, so this is the deployment-contract pin.
**Result:** ✅ PASS — `closePaperTrade`/`cancelPaperTrade` exported at
`functions/src/index.ts:152-153`, defined at `callables.ts:959/727`;
exact match to `CallableName` at `constants.ts:220/222`.

### S5 — Page-load regression smoke (manual)

**Steps:** run the app (`npm start`), navigate to `trading/paper`, let
the trades table + account panel load; open devtools console.
**Expected:** page loads normally — trades/account render as before,
no console errors. There are intentionally **no new visible controls**
(#671 owns the buttons); the check is that the extended store API and
`actingIds` computed didn't break the page's binding.
**Result:** ✅ PASS — user confirmed clean load, no console errors
(2026-10-22, "all good").

## Traceability

| Acceptance criterion (task #670 / PRD seam) | Scenario |
|---|---|
| `CallableName` entries for both callables | S1, S4 |
| Service wrappers send `{tradeId}`, unwrap `res.data` | S1, S4 |
| Per-trade acting state exposed (`actingIds`) | S1, S5 |
| `closeTrade` lifecycle: mark → call → reload trades+account → clear | S1 |
| `cancelTrade` lifecycle: mark → call → reload trades only → clear | S1 |
| Duplicate/cross-verb actions on one tradeId prevented; different ids concurrent | S1 |
| Failure → error signal + snackbar; flag clears; rows unchanged | S1 |
| `unauthenticated` → shared auth message | S1 |
| Sync invoke throw cannot leak the flag | S1 |
| Existing store behavior preserved (loadTrades cancel, `includeAutoPaper`, grouping computeds, account/variant loads) | S2 |
| Whole app compiles against the new API | S3 |

## Regression / smoke checklist

- [x] paper-trading page component spec green (S2)
- [x] page loads with no console errors (S5)
- [x] no change to shared contracts or BE (diff is FE-only + 2 enum members)

## Findings

- None. Refinement pass: **Not applicable — no user-facing surface**
  (buttons/confirm are #671); S5 is the regression check that the page
  still binds cleanly against the extended store.

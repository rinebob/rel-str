**Topic:** Paper Trading Infra
**Topic Slug:** paper-trading-infra
**Thread:** Trade Exits
**Blueprint:** #663 (BE)
**Task:** #720
**Topic Parent:** #553
**Domain:** PAPER-TRADING
**Type:** CODE-REVIEW
**Status:** PASS — converged in 2 rounds
**Created:** 2026-09-30
**Last Updated:** 2026-09-30

# Code Review — #720 BE signal-trade settlement at expiration

## Scope

| File | Change |
|---|---|
| `functions/src/paper-trading/passes/signal-settlement-pass.ts` | NEW — `runSignalSettlementPass(marketDate, deps)` + `defaultSignalSettlementDeps` |
| `functions/src/paper-trading/engine/position-repository.ts` | `markPositionSettled` account resolution falls back to `trade.userId` when no `strategyInstanceId` |
| `functions/src/paper-trading/engine/options-strategy-pass-orchestrators.ts` | wired into `runSettlementForAllInstances` after eval pass, isolated try/catch |
| `tests/functions/paper-trading/signal-settlement-pass.test.ts` | NEW — 7 tests |
| `functions/package.json` | test registered in `test:paper-trading` |
| `functions/scripts/verify/paper-trading-signal-settlement-720.ts` + `scripts/verify/paper-trading-signal-settlement-720.md` | prod verify + guide |
| `functions/scripts/verify/run-all.ts`, `scripts/verify/run-all.ts`, both READMEs | registration |

## Design decisions to probe

- Eligibility: ALL option legs `expiration <= marketDate` (late-settle retries; share-only trades ignored; mixed legs → error).
- Settle date = max leg expiration; underlying close via SDS daily bar (`getUnderlyingCloseForDate(symbol, expiration)`); missing bar → error, stays eligible.
- All-OTM → `markPositionSettled(EXPIRED_WORTHLESS)`; any-ITM → `applyExitFill` at net intrinsic order price + governing run finalize (same shape as close callable). Assignment deliberately NOT modeled — paper accounts hold no delivered shares; ASSIGNED signal trades would re-zombie.
- `quoteSource: AV_EOD` on the settlement exit fill (EOD-bar-derived).

## Round 1 — findings → fixes

Three axes (Standards, Spec, adversarial) converged. Intrinsic sign math, txn status re-checks, eval→settlement ordering, per-trade error isolation, and cleanup completeness all verified clean. Findings and dispositions:

| # | Finding | Severity | Disposition |
|---|---|---|---|
| M1 | `computeStatsFromPositions` books EXPIRED realized P&L as `premiumCollected` (=0 for LONG orders) — the first LC/LP worthless expiry would read as P&L 0 | MED | **Fixed** — `tradeToPosition` now maps `realizedPnl` through for EXPIRED (same as CLOSED); stats-utils EXPIRED branch reads `pos.unrealizedPnl`. Identical value for SHORT, correct −cost for LONG. |
| M2 | Missing SDS bar on the expiration date → permanent nightly error (weekend/holiday expirations never have a bar on the date itself) | MED | **Fixed** — `settleClose` walks back up to 7 calendar days to the latest bar ≤ expiration; settlement dates carry the observed close's trading day. Persistent miss (untracked symbol, SDS outage) stays a loud nightly error. |
| L1 | Multi-leg support half-real: all legs priced at max-expiration close, `legId:''` collisions | LOW | **Fixed** — `optionLegs.length > 1` is now an explicit error (same posture as the mixed-legs guard). No signal producer emits multi-leg trades today. |
| L2 | userId asymmetry: ITM errored on missing userId, OTM settled anyway with skipped bookkeeping | LOW | **Fixed** — the `!trade.userId` guard moved ahead of both paths. |
| L3 | No sanity guard on computed `exitPrice` | LOW | **Fixed** — `!Number.isFinite || < 0` throws. |
| L4 | Verify script leaned on doc-id ordering: no seeded account → `openTradeCount` rode the lazy create-on-exit path through −1 | LOW | **Fixed** — account doc seeded with `openTradeCount: 2` / $400 cash, matching what `applyEntryFill` would have posted. |
| L5 | `settled === 2` brittle — a real expired prod trade settling would fail the count | LOW | **Fixed** — `settled >= 2`. |
| L6 | Dishonest fixtures: `VariantRun` cast with non-existent `enteredAt`, missing `workingState`; `account: {} as never` | LOW | **Fixed** — real `workingState: {}` runs and a real `PaperAccount` stub in tests + verify script. |
| L7 | Missing test coverage: mixed legs, multi-leg, missing userId, non-trading-day expiration | LOW | **Fixed** — 5 new tests (incl. Saturday-expiration walk-back pinned to Friday's close). |
| L8 | Share-only trades inflated `skipped` nightly, forever | LOW | **Fixed** — share-only trades `continue` without counting; they are not settlement candidates. |
| L9 | Duplicated sign-convention block vs `netExitBreakdown` | LOW | **Fixed** — `orderPriceForLiquidationValue` extracted to `ledger.ts` (canonical home); `callables.ts` + the pass share it. |
| L10 | Dead `unrealizedPnl: premium` in the OTM SettlementData (seam discards it for expired) | LOW | **Fixed** — passes 0 with a comment. |
| L11 | Stale "no settlement seam/path" text in `signal-mark-pass.ts` | LOW | **Fixed** — now says awaiting/failed nightly settlement. |
| L12 | `defaultSignalSettlementDeps(firestoreDb)` — `markPositionSettled` uses the module-global db, not the param | LOW | **Documented** in the deps docstring (same instance in prod). |
| L13 | `quoteSource: AV_EOD` is a provenance fiction (bar-derived intrinsic, not a quote) | NIT | **Commented** at the fill site; no better enum exists. |

### Follow-ups noted (not in scope)

- **Engine settlement parity**: `settlement-pass.ts:119` uses strict `leg.expiration !== date` — an engine trade on a missed/mismatched night has the same zombie bug #720 fixed for signal trades. Filed separately.
- **Assignment modeling**: ITM cash-settles at intrinsic rather than booking delivered shares. Economically identical *at settlement* (`−strike·100` cash + `+close·100` shares = `−intrinsic`), but loses post-assignment share-management practice — needs held-shares marking + a share exit seam for signal trades first (`listHeldSharesPositions` is strategy-scoped; `applyExitFill` can't price share exits).
- **`account.equity` drift** (pre-existing, systemic): no mark pass writes account equity, so post-close equity is off by un-booked mark drift. Same for manual closes.

## Round 2 — convergence

Round-1 fixes verified correct by an adversarial re-pass; all fixes confirmed (sign math identical by construction, walk-back date arithmetic correct across month boundaries, adapter+stats mapping yields identical SHORT values and correct −cost for LONG). New findings and dispositions:

| # | Finding | Severity | Disposition |
|---|---|---|---|
| R2-1 | `stats-from-positions.test.ts` encoded the pre-fix convention (EXPIRED fixtures with `unrealizedPnl: 0`) — latent failure on the exact branch that changed | MED | **Fixed** — fixtures now carry realized in `unrealizedPnl`; new test pins the LONG-side −cost path. |
| R2-2 | Migrated LONG expired docs would still read realized 0 via `positionToTrade` | LOW-MED | **Scoped** — comment added; legacy engine positions are SHORT-only so none can exist. |
| R2-3 | `settleClose` accepted `0`/negative closes (corrupt bar → catastrophic "ITM" settle) | LOW | **Fixed** — `price > 0` required. |
| R2-4 | Dashboard "Realized" column reads `pos.realizedPnl` which `Position` never emitted | LOW | **Fixed** — optional `realizedPnl` added to `Position`, emitted by `tradeToPosition`. |
| R2-5 | Verify residuals: seeded `equity: 400` dishonest (two open shorts ⇒ 0); `errors.length === 0` asserted the whole prod population | LOW | **Fixed** — `equity: 0` + `id` field; errors scoped to `verify-720*` trade ids. |
| R2-6 | Test fixture `unrealizedPnl: -70` contradicted its own marks (+70) | LOW | **Fixed**. |
| R2-7 | Leg-less OPEN trade silently ignored forever; walk-back had no lower bound vs entry date | LOW | **Fixed** — legless → error (consistent with the corrupt-shape posture); walk-back breaks at `entryFill.date` (a pre-entry close is a stale basis). |
| R2-8 | Stale convention comments in `stats-utils.ts`/`trade-adapter.ts` | NIT | **Fixed**. |

Re-verified post-round-2: settlement tests 13/13, `stats-from-positions` 5/5, full `test:paper-trading` **142/142**, `tsc --noEmit` + build clean, prod verify **15/15** (honest account seed, scratch-scoped error assertion; 7 live option trades skipped, 8 share-only correctly not candidates).

**Verdict: PASS — converged in 2 rounds.**

## Test results

- `signal-settlement-pass.test.ts`: 13/13; `stats-from-positions.test.ts`: 5/5; full `test:paper-trading`: 142/142; `tsc --noEmit` + build clean.
- Prod verify: 15/15 — seeded OTM+ITM expired trades on real QQQM bars settled correctly; live signal trades untouched; cleanup verified.
- Follow-up filed: **#724** — engine settlement pass uses strict `expiration !== date` (same missed-night zombie class on the strategy side).

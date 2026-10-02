**Topic:** Paper Trading Infra  
**Topic Slug:** paper-trading-infra  
**Thread:** Trade Exits  
**Blueprint:** #663 (BE)  
**Task:** #724  
**QA Issue:** #729  
**Topic Parent:** #553  
**Domain:** PAPER-TRADING  
**Type:** UAT  
**Status:** Complete — automated evidence accepted; manual UAT deferred by user (no UI surface; backend will be exercised when the strategy-builder UI lands)  
**Created:** 2026-10-01  
**Last Updated:** 2026-10-01  

# UAT — #724 engine settlement missed-night + weekend-expiry parity

## Scope under test

`runSettlementPass` settles OPEN engine positions whose primary leg `expiration <= runDate` (was `===`), reading the underlying close at the leg's expiration with a bounded walk-back to the last trading day, never before the position opened. ITM legs with no wired brokerage checker refuse worthless settlement.

## Scenarios

> Note: `Result` below = automated-verification outcome (script/test executed
> and observed), **not** user sign-off. The QA gate stays open until the user
> reviews and confirms.

| # | Scenario | Method | Expected | Result |
|---|----------|--------|----------|--------|
| 1 | Missed-night settle | prod verify `paper-trading-engine-settlement-724.ts` | Tuesday-expired trade settles at the Tuesday close; `legOutcome.closeDate` = expiration | PASS |
| 2 | Saturday expiry walk-back | prod verify (QQQM 2026-09-26 expiry) | Friday 09-25 close used; marks + closeDate dated Friday; script asserts no Saturday bar exists | PASS |
| 3 | Settlement bookkeeping | prod verify | statuses `EXPIRED`, +200/+400 premium realized, governing runs `EXITED` at 0, account `openTradeCount` 2→0, trades leave the OPEN population, all scratch docs deleted | PASS — 19/19 |
| 4 | ITM honesty guard | unit (new) | no checker + ITM put → error + zero settle calls; no checker + OTM → `EXPIRED_WORTHLESS` | PASS |
| 5 | Stale-close bounds | unit (new) | pre-entry close rejected; `openDate: ''` leg still floors at `pos.openDate`; no open date anywhere → loud error | PASS |
| 6 | Regression + chain | `test:paper-trading` + functions `run-all` | 154/154; settlement suite 13/13; verify entry green in sequence | PASS |

## Environment

- Prod Firestore, real QQQM SDS bars (2026-09-25 close 306.35; 2026-09-29 close 304.17)
- `runSettlementPass` invoked with the production dep wiring (`getUnderlyingCloseForDate`, default `listOpenPositions`/`markPositionSettled`, no `checkBrokerageOutcome` — matching the orchestrator)

## Accepted residuals

- **ITM engine trades cannot settle in prod** until a `BrokerageOutcomeChecker` is wired or computed locally — the pass now errors loudly (was: silently recorded worthless). Follow-up **#728** (4_BACKLOG).
- OPEN strategy trades orphaned by a deleted/invalid instance doc are unreachable by the per-instance enumeration — noted in #728.
- `tradeToPosition` throwing inside `listOpenPositions` aborts the instance's whole pass — pre-existing blast radius, out-of-contract docs only.
- Legacy `symbolDataSyncAdminHttp` path stamps `getMarketDatePT()` at completion (dead code today) — noted in #728.

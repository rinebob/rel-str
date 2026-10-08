**Topic:** Portfolio Dashboard  
**Topic Slug:** portfolio-dashboard  
**Thread:** Portfolio Dashboard — Update Stop Loss  
**Thread Slug:** update-stop-loss  
**Issue:** #895  
**Thread Parent:** #829  
**Topic Parent:** #219  
**Task:** #885  
**Domain:** PORTFOLIO  
**Type:** UAT  
**Status:** Complete  
**Created:** 2026-10-07  
**Last Updated:** 2026-10-07  

## Scope — Task #885: BrokerOrder TIF/market-hours + stop-ticket builder params

Foundation contract for the Update Stop Loss thread: `BrokerOrder` carries verbatim `timeInForce`/`marketHours`, the canonical `EquityTimeInForce`/`EquityMarketHours` unions are exported, stop-loss ticket builders accept a `StopOrderParams` options object, `buildStopLossUpdateTicket` emits the `stop_loss_update` sourceRef, and `toEquityTimeInForce`/`toEquityMarketHours` narrow verbatim RH strings to the unions. No user-facing UI in this task — acceptance is by unit test and build.

## Prerequisites

- Repo checkout at `C:\aa\projects\rel-str` with `npm install` already run.
- No dev server, credentials, or external services required — every scenario is a local jest suite or `ng build`.

## Test scenarios

### S1 — Ticket-builder params contract

- **Confirms:** explicit `StopOrderParams` reach the ticket; defaults `gtc`/`regular_hours` preserved for omitted fields and existing callers; `buildStopLossUpdateTicket` emits `sourceRef { type: 'stop_loss_update', id: <replaced order id> }`; entry-variant `buildStopLossTicket` threads params.
- **Steps:** run `npx jest src/app/features/savant-trader/utils/stop-loss-ticket.util.spec.ts`
- **Expected:** all 10 tests pass, including `writes the selected timeInForce and marketHours`, `defaults missing params independently`, `records the replaced order id in a stop_loss_update sourceRef`, and `links the stop to the entry ticket and threads params`.
- **Result:** ☑ PASS — `npx jest .../stop-loss-ticket.util.spec.ts` — 10/10 tests green (2026-10-07)

### S2 — BrokerOrder normalization

- **Confirms:** `normalizeOrder` parses RH `time_in_force`/`market_hours` verbatim onto `BrokerOrder`; absent fields yield `undefined` (no phantom values).
- **Steps:** run `npx jest src/app/core/robinhood-mcp/robinhood-mcp-client.service.spec.ts`
- **Expected:** suite passes, including `parses time_in_force and market_hours onto BrokerOrder` and `leaves timeInForce/marketHours undefined when the raw order omits them`.
- **Result:** ☑ PASS — `robinhood-mcp-client.service.spec.ts` — both new tests green; suite 60/60 (2026-10-07)

### S3 — Union narrowing helpers

- **Confirms:** `toEquityTimeInForce`/`toEquityMarketHours` pass canonical values through and return `undefined` for unrecognized RH values (`fok`, `ioc`, `overnight_hours`, empty, undefined) — never a silent default.
- **Steps:** run `npx jest src/app/features/savant-trader/utils/broker-order.util.spec.ts`
- **Expected:** suite passes, including the two new `toEquityTimeInForce`/`toEquityMarketHours` describe blocks.
- **Result:** ☑ PASS — `broker-order.util.spec.ts` — both narrowing describe blocks green; suite pass (2026-10-07)

### S4 — Build integrity

- **Confirms:** the type/contract changes compile across the app and both existing builder call sites (`order-ticket.component.ts`, `stop-loss-dialog.component.ts`).
- **Steps:** run `npx ng build --configuration development`
- **Expected:** bundle generation completes with exit 0.
- **Result:** ☑ PASS — `npx ng build --configuration development` — bundle generation complete, exit 0 (2026-10-07)

### S5 — Params reach the broker payload

- **Confirms:** ticket `timeInForce`/`marketHours` are not dropped downstream — `OrderExecutionService` forwards them to the RH tools.
- **Steps:** inspect `src/app/features/savant-trader/services/order-execution.service.ts` `buildReviewArgs`/`buildPlaceArgs` — confirm `time_in_force` and `market_hours` map from the ticket fields.
- **Expected:** both fields appear in the review and place args for the equity-order path.
- **Result:** ☑ PASS — verified by inspection: `order-execution.service.ts:185-186` maps `ticket.timeInForce`→`time_in_force` and `ticket.marketHours`→`market_hours` in `buildReviewArgs`; `buildPlaceArgs` (:193-195) reuses it and adds `ref_id`. Fields reach `place_equity_order`.

## Traceability

| Acceptance criterion | Scenario |
|---|---|
| `BrokerOrder` exposes TIF/market-hours from `time_in_force`/`market_hours` | S2 |
| Canonical unions `gfd\|gtc` and `regular_hours\|extended_hours\|all_day_hours` preserved + exported | S1, S3 |
| Builders accept and write explicit TIF/hours; defaults don't overwrite explicit values | S1 |
| `stop_loss_update` sourceRef carries the replaced order id | S1 |
| Params survive to the place-order boundary | S5 |
| No regression at existing call sites | S4 |

## Regression / smoke

- `npx jest` full suite — ran during review: 3068 pass, 3 failures in 2 suites owned by other in-flight threads (`screenshot-capture-contracts` PositionType, `st-anchored-vwap.engine` history window); none touch this task's files.
- Stop-loss dialog + order-ticket component suites: 45 pass.

## Refinement pass

Not applicable — no user-facing surface in this task. UI verification lands in #886 (form controls) and #888 (update dialog).

## Results log

- 2026-10-07 — all 5 scenarios PASS: 106 focused tests green, `ng build` clean, S5 contract trace verified at `order-execution.service.ts:185-186`. Refinement pass: N/A (no UI surface).

**Topic:** Options Trading Support  
**Topic Slug:** options  
**Thread:** Single-leg option orders  
**Thread Slug:** single-leg-option-orders  
**Issue:** #1023  
**Thread Parent:** #943  
**Topic Parent:** #942  
**Task:** #962  
**Domain:** FE  
**Type:** UAT  
**Status:** Complete  
**Created:** 2026-10-12  
**Last Updated:** 2026-10-12  

# UAT — #962 Option order submit path

Scope: `OrderExecutionService.submitOptionOrder` (review_option_order →
place_option_order via the shared submitReviewThenPlace flow), OPTION
routing in `OrderTicketStore.submitTicket`, and the option contract
summary in `OrderConfirmDialogComponent`. Execution-layer + dialog
rendering; no user-reachable option UI exists until #963/#964.

Prerequisites: none beyond the repo — no credentials, no dev server.
Evidence is the focused Jest suites (specs assert wire-arg shape and
classification directly against the MCP tool boundary) plus live RH
captures under `docs/topics/657-rh-mcp/captures/opt-place-*.json`.

## Scenarios

| # | Scenario | Command | Expected | Result | Evidence |
|---|---|---|---|---|---|
| 1 | Option review→place arg shape: legs `[{option_id,side,position_effect}]`, quantity, type, price on limit only, `market_hours:'regular_hours'`, `ref_id` place-only, no `direction` | `npx jest --coverage=false --testPathPatterns=order-execution.service.spec -t "submitOptionOrder"` | spec asserts full arg `toEqual` | PASS | submitOptionOrder block — 12 cases green |
| 2 | Review error short-circuits place; retryable/non-retryable classification parity; missing id → PLACEMENT_UNCONFIRMED; terminal → PLACEMENT_DEAD; `processed_quantity` fills parsed; `data.order` unwrap | same | classified errors, correct codes, place not called on review failure | PASS | same suite |
| 3 | Pre-flight guard: legs≠1, non-integer/non-positive quantity, missing price/stop_price per type, market+gtc → non-retryable failure, zero tool calls | same | early ExecutionResult failure | PASS | "rejects an unplaceable ticket" sweep — 7 shapes |
| 4 | Store routing: OPTION → submitOptionOrder (not submitEquityOrder), SUBMITTING transition, SUBMITTED+orderId on success, STAGED+error revert on failure, no snackbar | `npx jest --coverage=false --testPathPatterns=order-ticket.store.spec` | routing + lifecycle parity | PASS | 2 new option cases + full store suite green |
| 5 | Confirm dialog option rows: Underlying, OCC, Expires·Strike·CALL, BUY TO OPEN, N contracts, limit $/contract, Premium qty×price×100 (formatted); market orders hide price rows; pinned regular_hours shown; malformed OCC doesn't crash | `npx jest --coverage=false --testPathPatterns=order-confirm-dialog.component.spec` | all rows render / gate correctly | PASS | 5 dialog cases green |
| 6 | Equity/ETF regression — shared flow refactor keeps behavior | all three spec files | existing equity specs unchanged-green | PASS | 126/126 across the 3 files |
| 7 | Full-suite sanity | `npx jest --coverage=false` | no new failures vs baseline | PASS | 3663 pass / 43 fail — identical to baseline (screenshot-contracts enum pin + order.component Functions provider, both unrelated in-flight work) |
| 8 | Typecheck | `npx tsc -p tsconfig.app.json --noEmit` | clean | PASS | exit 0 |

## Traceability

- AC `place_option_order` args shape → S1
- AC review short-circuit + dead/unconfirmed parity → S2
- AC `submitTicket` OPTION routing + STAGED revert + no snackbar → S4
- AC confirm-dialog option summary (underlying, OCC, exp·strike·call/put, BUY TO OPEN, qty×price×100 premium) → S5
- TEST-948 option submit/routing/dialog targets → S1–S5; equity regression → S6
- Round-2 review remediations (wire-type gating, pre-validation, processed_quantity, display-vs-wire) → S1/S3/S5

## Refinement pass

Partial — the changed dialog has no user-reachable path (no UI produces
an OptionOrderTicket until #963/#964 wire the ticket component and tab
group). DOM structure + content verified via component spec (S5);
live visual inspection of the opened dialog is scheduled for the #964
UAT where the entry point exists.

## Regression / smoke checklist

- [x] Equity submit path behaviorally unchanged (shared flow, same parse precedence — cumulative_quantity before option fields)
- [x] PLACEMENT_DEAD refId-mint + fill-ambiguity handling applies to option tickets identically
- [x] `order-ticket.component.ts` untouched; OPTION edit/cancel gaps pinned to #963/#964 in IMPL-948
- [x] No new deps, no config changes, no verification scripts added

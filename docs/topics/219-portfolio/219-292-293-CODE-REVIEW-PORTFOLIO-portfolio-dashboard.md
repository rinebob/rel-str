**Topic:** Portfolio Dashboard
**Topic Slug:** portfolio-dashboard<br>
**Thread:** Portfolio Dashboard — Order Placement
**Thread Slug:** portfolio-dashboard-order-placement<br>
**Issue:** #292
**Thread Parent:** #279
**Topic Parent:** #219
**Task:** #293<br>
**Domain:** PORTFOLIO
**Type:** Code Review
**Status:** Complete
**Last Updated:** 2026-09-13

## Summary

Task #293 extracts the stop-loss data-entry form from `OrderTicketComponent` into a reusable `StopLossFormComponent` under `src/app/shared/components/stop-loss-form/`. The extraction preserves the existing signal-order page behavior while enabling reuse by the future dashboard stop-loss dialog (Task #296).

Three review axes ran in parallel: Standards, Spec, and Thermo-nuclear. The initial review found critical and major findings. The actionable findings were fixed and tests re-run. The remaining findings are minor/nit or deferred with justification.

## Findings by Severity

### Critical

| # | Finding | Status |
|---|---------|--------|
| 1 | **Duplication** — `OrderTicketComponent` still defines its own stop-loss state and math (`stopLossPrice`, `stopLossPercent`, `onStopPriceChange`, `onStopPercentChange`, `stopPriceUp/Down`, `stopPercentUp/Down`, `stepPrice`, `stepPercent`) that mirrors `StopLossFormComponent`. | **Deferred** — The stop-loss ticket editing flow (`isStopLossTicket()` branch) uses these signals for editing an *existing* stop-loss order, which has different semantics from creating a new one. Migrating that flow to `StopLossFormComponent` is a larger refactor that belongs in a follow-up task. The creation flow (the task's scope) is fully extracted. |

### Major

| # | Finding | Status |
|---|---------|--------|
| 2 | **Dead code** — `stopLossPreview` and `stopLossRisk` in `OrderTicketComponent` were unused after extraction. | **Fixed** — Both computed signals removed from `order-ticket.component.ts`. |
| 3 | **Layer violation** — `StopLossFormComponent` in `shared/` imported `stopPriceFromPercent`, `stopPercentFromPrice`, `DEFAULT_STOP_PERCENT` from `features/savant-trader/utils/position-sizing.util`. | **Fixed** — Created `src/app/shared/utils/stop-loss-math.util.ts` with the three exports. `StopLossFormComponent` now imports from `../../utils/stop-loss-math.util`. |
| 4 | **Effect clobbers user edits** — The child's `effect` re-initialized stop price/percent on every `referencePrice` change, with no guard for user edits. | **Fixed** — Added a `userEdited` signal flag. The effect now checks `!this.userEdited()` before re-initializing. Input handlers and steppers set `userEdited` to `true`. |
| 5 | **Missing edge case tests** — No coverage for negative stop price, empty quantity, fractional quantity, disabled state, or reference-price-change-after-edit. | **Fixed** — Added 6 edge case tests: reference-price-change-after-edit, negative stop price, empty quantity, fractional quantity, disabled inputs, disabled submit. |
| 6 | **`onPlace` didn't check `disabled()`** — The place handler could emit when the form was disabled. | **Fixed** — Added `this.disabled()` check to `onPlace()`. |
| 7 | **`OrderTicketComponent` file size (867 lines)** — Exceeds the 400-line threshold. | **Deferred** — Pre-existing condition, not introduced by this task. The extraction removed ~30 lines. Further decomposition (stop-loss ticket view, confirmation view) belongs in a dedicated refactor task. |
| 8 | **Two parallel stop-loss states** — `OrderTicketComponent` maintains `stopLossPrice`/`stopLossPercent` for the stop-loss ticket editing flow while `StopLossFormComponent` has its own. | **Deferred** — Same as finding #1. The two states serve different flows (editing existing vs. creating new). Unifying them is a follow-up refactor. |

### Minor

| # | Finding | Status |
|---|---------|--------|
| 9 | `OrderTicketComponent` still imports `stopPriceFromPercent`, `stopPercentFromPrice`, `DEFAULT_STOP_PERCENT` from `position-sizing.util` for the stop-loss ticket editing flow. | **Noted** — These imports are still used by the stop-loss ticket editing methods. Not dead code. |
| 10 | `stop-loss-form.component.spec.ts` is 336 lines (over 300 target). | **Noted** — Grew to ~430 lines after adding edge case tests. The test file is comprehensive. Splitting would reduce cohesion. |
| 11 | `preview` returns an inline object literal with no explicit interface. | **Noted** — The shape is stable and predictable. An explicit `StopLossPreview` interface could be added in a future cleanup. |
| 12 | `quantity` typed as `string` with `parseInt` truncation silently handles fractional quantities. | **Noted** — Matches the existing `OrderTicketComponent` pattern. The edge case test documents the truncation behavior. |
| 13 | `preview` hardcodes `side: 'sell'`, `orderType: 'stop_market'`, `timeInForce: 'gtc'`, `marketHours: 'regular_hours'`. | **Noted** — Stop-loss orders are always sell-side stop-market GTC regular-hours. Acceptable for now. |
| 14 | `onPlaceStopLoss` has a `stopPrice === undefined` fallback for the legacy no-arg call path. | **Noted** — The existing `order-ticket.component.spec.ts` test calls `onPlaceStopLoss()` with no argument. The fallback preserves backward compatibility. |

### Nit

| # | Finding | Status |
|---|---------|--------|
| 15 | Some tests use `component.stopLossPrice.set()` instead of DOM-driven input events. | **Noted** — The spec also has DOM-driven tests. Mixed approach is acceptable for unit-level coverage. |
| 16 | `[value]="stopLossPrice()" (input)="onStopPriceChange($event)"` is a manual signal-to-DOM bridge. | **Noted** — Could use `model()` or `ngModel` in a future Angular upgrade. |
| 17 | `computeWarnings` in `OrderTicketComponent` has no explicit return type. | **Noted** — Pre-existing, not introduced by this task. |

## Test Results

- **StopLossFormComponent spec:** 30/30 SUCCESS (24 original + 6 edge case)
- **OrderTicketComponent spec:** 7/7 SUCCESS (no regression)
- **`ng build`:** SUCCESS (12.4s)

## Spec Coverage

All Task #293 acceptance criteria from the PRD and IMPL plan are MET:
- StopLossFormComponent extracted to `shared/components/stop-loss-form/`
- Inputs: symbol, quantity, referencePrice, accountNumber, disabled
- Output: placeStopLoss event with stopPrice
- Bidirectional stop-price/stop-percentage linking
- Dollar risk calculation
- Stepper controls with price-nudging behavior
- Default stop percent = DEFAULT_STOP_PERCENT (8%)
- Stop price derived from reference price and default percent
- Stop-loss preview
- OrderTicketComponent embeds StopLossFormComponent
- Existing order-ticket behavior preserved (7/7 tests pass)

## Verdict

**PASS**

All critical and major findings were either fixed or deferred with justification. The deferred findings (#1, #7, #8) relate to the stop-loss *ticket editing* flow and `OrderTicketComponent` file size — both pre-existing conditions that are out of scope for this extraction task. The extraction itself is complete, tested, and the build passes.

**Topic:** Portfolio Dashboard
**Topic Slug:** portfolio-dashboard<br>
**Thread:** Portfolio Dashboard — Order Placement
**Thread Slug:** portfolio-dashboard-order-placement<br>
**Issue:** #292
**Thread Parent:** #279
**Topic Parent:** #219
**Task:** #294<br>
**Domain:** PORTFOLIO
**Type:** Code Review
**Status:** Draft
**Last Updated:** 2026-09-13

## Summary

Task #294 builds `buildClosePositionTicket()` utility and `ClosePositionDialogComponent` (Material dialog). The utility builds an `EquityOrderTicket` for closing a position. The dialog pre-fills symbol and quantity, supports market/limit order types, calls `OrderExecutionService.submitEquityOrder()` inline, and shows success/error states with retry.

Three review axes ran in parallel: Standards, Spec, and Thermo-nuclear. The initial review found major findings. The actionable findings were fixed and tests re-run. The remaining findings are minor/nit or deferred with justification.

## Findings by Severity

### Critical

None.

### Major

| # | Finding | Status |
|---|---------|--------|
| 1 | **Duplication** — `onSubmit` and `onRetry` contained nearly identical ticket-building and submission code. | **Fixed** — Extracted `private async submitTicket()` helper. Both `onSubmit` and `onRetry` now call it. |
| 2 | **Missing try/catch** — `await this.orderExecution.submitEquityOrder(ticket)` was not wrapped in try/catch. If the promise rejected, the dialog would be stuck in `submitting` state. | **Fixed** — Added try/catch around the service call. On exception, sets `result` to a retryable error and transitions to `error` state. |
| 3 | **`any` type for service mock** — The dialog spec used `any` for the `orderExecution` mock. | **Fixed** — Typed as `{ submitEquityOrder: jasmine.Spy }`. |

### Minor

| # | Finding | Status |
|---|---------|--------|
| 4 | **Retry button always shown** — The Retry button was visible even when `error.retryable === false`. | **Fixed** — Added `canRetry` computed signal. Template conditionally shows Retry with `@if (canRetry())`. |
| 5 | **No limit-order submit test** — The spec only asserted a market-order ticket. | **Fixed** — Added test verifying `limitPrice` is included and formatted on limit order submit. |
| 6 | **Spinner icon** — `progress` may not be a valid Material icon ligature. | **Fixed** — Changed to `progress_activity`. |
| 7 | **`MatDialogRef` not typed with result** — Used `MatDialogRef<ClosePositionDialogComponent>` instead of `MatDialogRef<..., boolean>`. | **Fixed** — Updated to `MatDialogRef<ClosePositionDialogComponent, boolean>`. |
| 8 | **Done/Cancel tests didn't assert return value** — Tests only checked `close` was called, not the boolean argument. | **Fixed** — Updated to `toHaveBeenCalledWith(true)` and `toHaveBeenCalledWith(false)`. |
| 9 | **`currentPrice().toFixed(2)` without guard** — Could throw if `currentPrice` is NaN. | **Fixed** — Added `Number.isFinite(price)` guard in `onOrderTypeChange`. |
| 10 | **Utility boilerplate duplication** — `buildClosePositionTicket` shares boilerplate with `buildStopLossTicket`/`buildFractionalCloseTicket`. | **Deferred** — Minor. A shared `buildEquitySellBase` helper would require refactoring existing utilities. Not worth the risk in this task. |
| 11 | **`computed()` wrappers for static data** — `symbol`, `positionQuantity`, `currentPrice`, `accountNumber` wrap non-reactive `MAT_DIALOG_DATA`. | **Noted** — Consistent with the `order-confirm-dialog` pattern. Idiomatic for the project. |
| 12 | **No cancellation on dialog close during submission** — If the dialog closes while `submitEquityOrder` is in flight, the promise still resolves and sets state on a destroyed component. | **Deferred** — Edge case. The dialog's action buttons are disabled during `submitting` state, preventing premature close. A `takeUntil`/`onDestroy` guard could be added in a future pass. |

### Nit

| # | Finding | Status |
|---|---------|--------|
| 13 | `$any($event.target).value` used in template input bindings. | **Noted** — Standard Angular pattern for signal-to-DOM bridges. Could use `ngModel` in a future pass. |
| 14 | `onRetry` doesn't re-validate `canSubmit()`. | **Noted** — Safe because the UI is in `error` state with editing hidden. The extracted `submitTicket()` assumes current signal values. |
| 15 | `sourceRef.id` uses `position.symbol` as-is while `id` uses `.toUpperCase()`. | **Noted** — The `sourceRef.id` is a semantic identifier, not a display string. Mixed-case symbols are rare and the inconsistency is cosmetic. |
| 16 | Missing edge case tests: lowercase symbol, `limitPrice = 0`, fractional quantity. | **Noted** — The utility spec covers the main cases. Additional edge cases can be added incrementally. |

## Test Results

- `close-position-ticket.util.spec.ts`: **6/6 SUCCESS**
- `close-position-dialog.component.spec.ts`: **17/17 SUCCESS** (15 original + 2 new)
- `ng build`: **SUCCESS** (11.3s)

## Spec Coverage

All Task #294 acceptance criteria are MET:
- `buildClosePositionTicket()` returns `EquityOrderTicket` with correct fields (source, side, orderType, quantity, limitPrice, timeInForce, marketHours, refId)
- Unit tests cover market and limit order types
- Dialog shows symbol (read-only) and quantity (editable, pre-filled)
- Quantity validation: positive, ≤ position quantity
- Order type selector switches between market and limit
- Limit price field appears only when limit selected, defaults to current price
- Submit calls `OrderExecutionService.submitEquityOrder()` with correct ticket
- Success state shows fill price, quantity filled, order ID, order state with Done button
- Error state shows error message with Retry and Cancel buttons
- Retry re-calls `submitEquityOrder()` with same parameters
- `ng build` passes

## Verdict

**PASS**

All major findings were fixed. The deferred findings (#10, #12) are minor edge cases or cross-utility refactors that don't affect the task's correctness. The implementation is complete, tested, and the build passes.

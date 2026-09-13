**Topic:** Portfolio Dashboard
**Topic Slug:** portfolio-dashboard<br>
**Thread:** Portfolio Dashboard — Order Placement
**Thread Slug:** portfolio-dashboard-order-placement<br>
**Issue:** #292
**Thread Parent:** #279
**Topic Parent:** #219
**Task:** #296<br>
**Domain:** PORTFOLIO
**Type:** Code Review
**Status:** Complete
**Last Updated:** 2026-09-13

## Summary

Task #296 builds `StopLossDialogComponent`, a Material dialog that embeds the shared `StopLossFormComponent`, builds a stop-loss ticket via `buildPositionStopLossTicket()`, calls `OrderExecutionService.submitEquityOrder()`, and shows success/error states with retry. A new `buildPositionStopLossTicket()` utility was added to support position-sourced stop-loss orders without requiring an entry order ticket.

Three review axes ran in parallel: Standards, Spec, and Thermo-nuclear. The initial review found a critical idempotency bug and several major findings. All actionable findings were fixed and tests re-run. The remaining findings are minor/nit or deferred with justification.

## Findings by Severity

### Critical

| # | Finding | Status |
|---|---------|--------|
| 1 | **Retry rebuilt ticket with new refId, breaking broker idempotency** — `onRetry` called `buildPositionStopLossTicket()` which generates a new `crypto.randomUUID()` each time. `OrderExecutionService` maps `refId` to `ref_id` for broker idempotency, so a retry with a new `ref_id` would be treated as a new order, potentially placing duplicate stop-loss orders. | **Fixed** — Dialog now stores the last built `EquityOrderTicket` and resubmits the same object on retry, preserving the `refId`. Added test asserting `secondTicket === firstTicket` and `refId` equality. |

### Major

| # | Finding | Status |
|---|---------|--------|
| 2 | **No concurrency guard on onSubmit/onRetry** — A double-click could fire two parallel submissions. | **Fixed** — Added `if (this.state() === 'submitting') return;` guard at the top of `onSubmit` and `onRetry`. Added test verifying only one call during concurrent invocation. |
| 3 | **Fractional share quantity could be submitted** — Stop-loss orders require whole shares, but `position.quantity` was stringified verbatim. | **Fixed** — `quantity` computed now uses `Math.trunc(this.data.position.quantity ?? 0)`. Added test verifying fractional quantity is truncated. |
| 4 | **Success view stop price display used non-existent field** — Template referenced `result()?.result?.stopPrice`, but `OrderTicketResult` has no top-level `stopPrice` field. | **Fixed** — Template now uses `result()?.result?.brokerOrder?.stopPrice ?? lastStopPrice().toFixed(2)`. `lastStopPrice` exposed as public readonly signal. |
| 5 | **DRY violation: `buildPositionStopLossTicket` and `buildStopLossTicket` were near-copies** — Only `sourceRef.id` differed. | **Fixed** — Extracted `buildStopLossTicketBase()` private helper. Both public functions now delegate to it with their respective `sourceRef`. |
| 6 | **Test mocks didn't match real `ExecutionResult` shape** — Mocks used `result.stopPrice` which doesn't exist on `OrderTicketResult`. | **Fixed** — Mocks now use `result.brokerOrder.stopPrice` matching the real `BrokerOrderSnapshot` shape. Added `lastStopPrice()` assertion. |

### Minor

| # | Finding | Status |
|---|---------|--------|
| 7 | **`[disabled]="false"` hardcoded on StopLossFormComponent** — Misleading binding that never disabled the form. | **Fixed** — Changed to `[disabled]="state() !== 'editing'"`. |
| 8 | **`lastStopPrice` signal not `readonly`** — Inconsistent with surrounding signal conventions. | **Fixed** — Changed to `readonly lastStopPrice`. |
| 9 | **Utility tests only cover `buildPositionStopLossTicket`** — Sibling functions `buildStopLossTicket` and `buildFractionalCloseTicket` have no tests. | **Deferred** — Pre-existing gap. The new function is tested. Adding tests for existing functions is out of scope for this task. |
| 10 | **Dialog state machine duplicated with close-position dialog** — Both share `DialogState`, `result`/`error`/`canRetry`, `onDone`/`onCancel`/`onRetry`. | **Deferred** — Acceptable with 2 siblings. Extract a base class when a 3rd order dialog is added. |

### Nit

| # | Finding | Status |
|---|---------|--------|
| 11 | **Static `MAT_DIALOG_DATA` wrapped in `computed` signals** — Adds signal overhead for values that never change. | **Noted** — Consistent with sibling `ClosePositionDialogComponent`. Direct property access would be marginally better but consistency wins. |
| 12 | **`try/catch` in `submitTicket` may never be exercised** — `OrderExecutionService` always returns a resolved `ExecutionResult`. | **Noted** — Defensive code kept for resilience. |

## Spec Coverage

All Task #296 acceptance criteria:
- **MET** — Dialog renders `StopLossFormComponent` with position context
- **MET** — Default stop percent and computed stop price initialized from current price (delegated to `StopLossFormComponent`)
- **MET** — Bidirectional linking works (delegated to `StopLossFormComponent`, tested in its own spec)
- **MET** — Dollar risk displays and updates reactively (delegated to `StopLossFormComponent`)
- **MET** — Preview shows correct order parameters (delegated to `StopLossFormComponent`)
- **MET** — Submit calls `OrderExecutionService.submitEquityOrder()` with stop-loss ticket
- **MET** — Success state shows order ID, stop price, order state with Done button
- **MET** — Error state shows error message with Retry and Cancel buttons
- **MET** — Retry re-calls `submitEquityOrder()` with same ticket (preserving refId)
- **MET** — `ng build` passes

## Test Results

- `stop-loss-ticket.util.spec.ts`: **4/4 SUCCESS**
- `stop-loss-dialog.component.spec.ts`: **11/11 SUCCESS** (9 original + 2 new for idempotency and concurrency)
- `ng build`: **SUCCESS** (12.8s)

## Verdict

**PASS**

The critical idempotency bug was caught and fixed before shipping. All major findings were addressed. The deferred findings are pre-existing gaps or acceptable patterns at the current scale. The implementation is complete, tested, and the build passes.

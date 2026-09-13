**Topic:** Portfolio Dashboard — Order Placement  
**Topic Slug:** `portfolio-dashboard`  
**Thread:** Portfolio Dashboard — Order Placement  
**Thread Slug:** `order-placement`  
**Issue:** #280  
**Thread Parent:** #279  
**Topic Parent:** #219  
**Domain:** PORTFOLIO  
**Type:** PRD  
**Status:** Approved  
**Created:** 2026-09-12  
**Last Updated:** 2026-09-12  

---

## Problem Statement

The Portfolio Dashboard (shipped in Thread #274) shows open equity and option positions, open orders, and order history across all Robinhood accounts. It is view-only — the trader can see their positions but cannot act on them from the dashboard. To close a position, the trader must navigate to the signal-order page, manually create a ticket, configure the order, and submit. To protect a position with a stop-loss, the same multi-step process is required.

The trader needs the ability to close positions and place stop-loss orders directly from the dashboard position tables, without navigating away. The infrastructure already exists — `OrderExecutionService` wraps `place_equity_order` with preflight review and ref_id idempotency, `buildStopLossTicket()` builds stop-loss tickets, and `OrderSource.POSITION_MANAGEMENT` is defined — but no dashboard UI wires these together.

## Solution

Add order placement actions to the equity positions table in the Portfolio Dashboard, delivered in two phases:

**Phase 1 — Close-position:** A "Close" action on each open equity position row opens a lightweight Material dialog pre-filled with the position's symbol and quantity. The trader can adjust quantity, select market or limit order type, and set a limit price if needed. Submitting calls `OrderExecutionService.submitEquityOrder()`, which runs the `review_equity_order` preflight silently and places the order with ref_id idempotency. The dialog stays open to show the result — fill details on success, error with retry on failure.

**Phase 2 — Stop-loss placement:** An "Add Stop" action on unprotected equity position rows opens a Material dialog with a shared `StopLossFormComponent` (extracted from the savant-trader `OrderTicketComponent`). The form provides stop price, stop percent with bidirectional linking, dollar risk calculation, and order preview — the same capability as the signal-order page's stop-loss section. Submitting builds a stop-loss ticket via `buildStopLossTicket()` and calls `OrderExecutionService.submitEquityOrder()`. The dialog stays open through data entry and confirmation.

Both phases use inline Material dialogs — no navigation away from the dashboard. After successful order placement, the dashboard refreshes positions and orders to reflect the new state.

**Phase 3 — Manual order entry** is deferred to a later Thread. Option order placement is out of scope — equity only.

## User Stories

1. As a trader, I want a "Close" action on each open equity position row in the dashboard, so that I can close a position without navigating to the signal-order page.
2. As a trader, I want the close-position dialog to pre-fill the position's symbol and quantity, so that I can submit a close order with minimal input.
3. As a trader, I want to adjust the quantity in the close-position dialog, so that I can close a partial position.
4. As a trader, I want to select market or limit order type in the close-position dialog, so that I can control the execution type.
5. As a trader, I want to set a limit price when using a limit order in the close-position dialog, so that I can specify the price I'm willing to accept.
6. As a trader, I want the close-position dialog to show fill details (fill price, quantity filled, order ID, order state) on success, so that I can confirm the order executed as expected.
7. As a trader, I want the close-position dialog to show an error message with a retry option on failure, so that I can recover from transient errors without re-entering the order details.
8. As a trader, I want the dashboard to refresh positions and orders after a successful close, so that the closed position and any resulting order reflect the new state.
9. As a trader, I want an "Add Stop" action on unprotected equity position rows, so that I can protect a position with a stop-loss order directly from the dashboard.
10. As a trader, I want the stop-loss dialog to show stop price and stop percent with bidirectional linking, so that I can set the stop by either price or percentage below current.
11. As a trader, I want the stop-loss dialog to show the dollar risk (shares × (current price − stop price)), so that I can understand the potential loss if the stop triggers.
12. As a trader, I want the stop-loss dialog to show a preview of the order that will be sent, so that I can verify the parameters before placing.
13. As a trader, I want the stop-loss dialog to show confirmation (order ID, stop price, order state) on success, so that I can confirm the stop-loss was placed.
14. As a trader, I want the stop-loss dialog to show an error message with a retry option on failure, so that I can recover from transient errors.
15. As a trader, I want the dashboard to refresh after a successful stop-loss placement, so that the position shows as protected.
16. As a trader, I want the stop-loss form in the dashboard to have the same capability as the signal-order page stop-loss section, so that I don't lose functionality by using the dashboard instead.

## Acceptance Criteria

### US1 — Close action on position rows
- Each open equity position row in the equity positions table has a "Close" action (button or icon).
- The action is only visible for open positions (non-zero quantity).
- Clicking "Close" opens a Material dialog.

### US2 — Close-position dialog pre-fill
- The dialog shows the position's symbol (read-only).
- The dialog pre-fills the quantity field with the position's current quantity.
- The dialog pre-selects market order type.
- The dialog pre-selects `gfd` time in force and `regular_hours` market hours.

### US3 — Partial close
- The quantity field is editable.
- The quantity field accepts positive numbers up to the position's quantity.
- The dialog validates that quantity is greater than zero before enabling submit.

### US4 — Order type selection
- The dialog has a market/limit order type selector.
- When limit is selected, a limit price field appears.
- The limit price field accepts positive numbers.
- The dialog validates that limit price is set when order type is limit before enabling submit.

### US5 — Limit price
- The limit price field is only visible when order type is limit.
- The limit price field accepts positive decimal numbers.
- The limit price defaults to the current price (if available) when limit is first selected.

### US6 — Close success state
- On successful submission, the dialog shows: fill price, quantity filled, order ID, order state.
- The dialog shows a "Done" button to dismiss.
- The submit button is hidden or disabled after success.

### US7 — Close error state
- On submission failure, the dialog shows the error message from `OrderExecutionService`.
- The dialog shows a "Retry" button that re-attempts submission with the same parameters.
- The dialog shows a "Cancel" button to dismiss without retrying.

### US8 — Dashboard refresh after close
- After the close-position dialog is dismissed (success or cancel), the dashboard refreshes positions and orders.
- The closed position either disappears (if fully closed) or shows reduced quantity (if partial).
- Any resulting sell order appears in the open orders section.

### US9 — Add Stop action on position rows
- Each open, unprotected equity position row has an "Add Stop" action.
- The action is only visible for positions without an existing stop-loss order.
- Clicking "Add Stop" opens a Material dialog.

### US10 — Stop-loss dialog with bidirectional linking
- The dialog shows stop price and stop percent fields.
- Editing stop price updates stop percent based on current price.
- Editing stop percent updates stop price based on current price.
- The stop percent defaults to `DEFAULT_STOP_PERCENT`.
- The stop price defaults to `stopPriceFromPercent(currentPrice, DEFAULT_STOP_PERCENT)`.

### US11 — Dollar risk display
- The dialog shows dollar risk = shares × (current price − stop price).
- Dollar risk updates reactively when stop price or quantity changes.
- Dollar risk is formatted as currency.

### US12 — Order preview
- The dialog shows a preview of the order parameters: symbol, side (sell), order type (stop_market), quantity, stop price, time in force (gtc), market hours (regular_hours), account number.

### US13 — Stop-loss success state
- On successful placement, the dialog shows: order ID, stop price, order state.
- The dialog shows a "Done" button to dismiss.

### US14 — Stop-loss error state
- On placement failure, the dialog shows the error message.
- The dialog shows a "Retry" button and a "Cancel" button.

### US15 — Dashboard refresh after stop-loss
- After the stop-loss dialog is dismissed, the dashboard refreshes positions and orders.
- The protected position shows as having stop-loss protection in the positions table.

### US16 — Stop-loss form parity with signal-order page
- The stop-loss form in the dashboard provides the same fields and behavior as the signal-order page's stop-loss section.
- The form is a shared `StopLossFormComponent` extracted from `OrderTicketComponent`.
- The signal-order page's `OrderTicketComponent` embeds the same `StopLossFormComponent` after extraction.
- Both use the same utilities: `stopPriceFromPercent`, `stopPercentFromPrice`, `DEFAULT_STOP_PERCENT`, `buildStopLossTicket`.

## Implementation Decisions

### Reuse existing OrderExecutionService
- `OrderExecutionService.submitEquityOrder()` handles preflight review (`review_equity_order`), placement (`place_equity_order`), ref_id idempotency, and error classification (retryable vs non-retryable).
- Both close-position and stop-loss flows call this service directly — no new execution service needed.
- The preflight review runs silently — errors surface only on failure. No pre-trade alert display.

### Order source
- Both close-position and stop-loss tickets use `OrderSource.POSITION_MANAGEMENT`.
- `buildStopLossTicket()` already sets this. A `buildClosePositionTicket()` utility will be added for close-position tickets.

### Close-position dialog
- Lightweight Material dialog with: symbol (read-only), quantity (editable), order type (market/limit), limit price (if limit), time in force (gfd), market hours (regular_hours).
- Not the full `OrderTicketComponent` — focused on the close use case.
- Dialog stays open through submit and confirmation.

### Stop-loss dialog with shared StopLossFormComponent
- Extract the stop-loss fields, bidirectional linking, dollar risk, and preview from `OrderTicketComponent` into a `StopLossFormComponent`.
- The signal-order page's `OrderTicketComponent` embeds the extracted component — no behavior change.
- The dashboard stop-loss dialog embeds the same component.
- The dialog provides the position context (symbol, quantity, current price, account number) and handles submit/confirmation.

### Dialog pattern
- Both dialogs use Angular Material `MatDialog`.
- Both dialogs stay open through data entry and submission.
- Both dialogs show success state (fill details / order confirmation) with "Done" button.
- Both dialogs show error state with "Retry" and "Cancel" buttons.
- No SnackBar for trade confirmation — the dialog is the confirmation.

### Dashboard refresh
- After dialog dismissal (success or cancel), the dashboard store's `refresh()` is called to re-fetch positions and orders.
- This reuses the existing two-phase loading architecture from Thread #274.

### Equity only
- Only equity positions get close and stop-loss actions.
- Option positions remain view-only in the dashboard.
- Option order placement is a future effort.

### Stop-loss detection
- The dashboard already computes `protectedSymbols` (positions with active stop-loss orders) from the open orders data.
- The "Add Stop" action is hidden for positions already in `protectedSymbols`.

## Testing Decisions

### Close-position dialog
- Test that the dialog opens with pre-filled symbol and quantity.
- Test that quantity is editable and validates (positive, ≤ position quantity).
- Test that order type selection shows/hides limit price field.
- Test that submit calls `OrderExecutionService.submitEquityOrder()` with the correct ticket.
- Test that success state shows fill details and "Done" button.
- Test that error state shows error message and "Retry" button.
- Test that retry re-calls `submitEquityOrder()` with the same parameters.
- Test that dialog dismissal triggers dashboard refresh.

### Stop-loss dialog
- Test that the dialog opens with default stop percent and computed stop price.
- Test bidirectional linking: editing stop price updates percent, and vice versa.
- Test dollar risk calculation updates reactively.
- Test that submit calls `OrderExecutionService.submitEquityOrder()` with a stop-loss ticket.
- Test success and error states.
- Test that dialog dismissal triggers dashboard refresh.

### StopLossFormComponent extraction
- Test that the extracted component produces the same outputs as the original `OrderTicketComponent` stop-loss section.
- Test that `OrderTicketComponent` still works correctly after extraction (no regression).

### Dashboard integration
- Test that "Close" action only appears on open equity positions.
- Test that "Add Stop" action only appears on unprotected equity positions.
- Test that dashboard refreshes after dialog dismissal.

### Prior art
- `order-execution.service.spec.ts` — existing tests for `OrderExecutionService`.
- `order-ticket.component.spec.ts` — existing tests for `OrderTicketComponent` stop-loss behavior.
- `portfolio-dashboard.component.spec.ts` — existing dashboard wiring tests.

## Out of Scope

- **Manual order entry** — deferred to a later Thread or phase. May share a component with the signal-order page's manual entry button when built.
- **Option order placement** — equity only. Option order placement requires a new execution service and different order flow (legs, premium, contract multiplier).
- **Batch stop-loss placement** — placing stop-loss orders on multiple positions at once. Could be a future enhancement.
- **Cancel existing stop-loss from dashboard** — the dashboard shows stop-loss protection but cancelling stops from the dashboard is not in scope. Cancellation remains on the signal-order page.
- **Order ticket persistence** — close-position and stop-loss orders are submitted directly to Robinhood via `OrderExecutionService`. They are not staged in the Firestore `OrderTicketStore`. This matches the existing `onCloseFractionalShare()` pattern in `OrderTicketComponent`.
- **Guardrails** — the close-position and stop-loss dialogs do not enforce guardrails (max units, max allocation). Guardrails are a signal-order page concept. Dashboard order placement is position management, not new entries.

## Technical Context

- **Data freshness:** The dashboard fetches live data from Robinhood MCP. After an order is placed, the refresh re-fetches positions and orders. There may be a brief delay (1-2 seconds) before the broker reflects the new state.
- **Market hours:** Close-position defaults to `regular_hours` and `gfd`. Stop-loss orders use `gtc` (good-till-cancelled) so they persist across sessions. The trader should be aware that stop-loss orders remain active until cancelled or triggered.
- **ref_id idempotency:** `OrderExecutionService` generates a `ref_id` for each order. Retries within the dialog reuse the same `ref_id` to prevent duplicate orders.
- **Error classification:** `OrderExecutionService` classifies errors as retryable (network, timeout, rate limit) or non-retryable (insufficient buying power, PDT, invalid symbol). The dialog shows the error message and offers retry for retryable errors.

## System Context Diagram

```mermaid
flowchart TD
    subgraph Dashboard["Portfolio Dashboard"]
        EqTable["Equity Positions Table"]
        OptTable["Option Positions Table (view-only)"]
        Orders["Open Orders Section"]
    end

    subgraph Dialogs["Material Dialogs"]
        CloseDialog["Close-Position Dialog"]
        StopDialog["Stop-Loss Dialog"]
        StopForm["StopLossFormComponent (shared)"]
    end

    subgraph Shared["Shared"]
        ExecService["OrderExecutionService"]
        Utils["buildStopLossTicket\nbuildClosePositionTicket\nstopPriceFromPercent\nstopPercentFromPrice"]
    end

    subgraph SignalOrder["Signal-Order Page"]
        OTC["OrderTicketComponent"]
    end

    subgraph Robinhood["Robinhood MCP"]
        PlaceOrder["place_equity_order"]
        ReviewOrder["review_equity_order"]
    end

    EqTable -->|"Close click"| CloseDialog
    EqTable -->|"Add Stop click"| StopDialog
    StopDialog embeds StopForm
    SignalOrder embeds OTC
    OTC embeds StopForm

    CloseDialog -->|"submitEquityOrder"| ExecService
    StopDialog -->|"submitEquityOrder"| ExecService
    StopDialog -->|"buildStopLossTicket"| Utils
    CloseDialog -->|"buildClosePositionTicket"| Utils

    ExecService -->|"preflight"| ReviewOrder
    ExecService -->|"place"| PlaceOrder

    CloseDialog -->|"dismiss → refresh"| Dashboard
    StopDialog -->|"dismiss → refresh"| Dashboard
```

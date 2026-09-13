**Topic:** Portfolio Dashboard — Order Placement  
**Topic Slug:** `portfolio-dashboard`  
**Thread:** Portfolio Dashboard — Order Placement  
**Thread Slug:** `order-placement`  
**Issue:** #291  
**Thread Parent:** #279  
**Topic Parent:** #219  
**Domain:** PORTFOLIO  
**Type:** TEST  
**Status:** Draft  
**Created:** 2026-09-12  
**Last Updated:** 2026-09-12  

---

## Overview

Test plan for FE-only Portfolio Dashboard order placement. Covers the `StopLossFormComponent` extraction, close-position dialog, stop-loss dialog, and dashboard wiring.

## Test Seams

The primary test seam is the component level — Angular component tests with mocked services. This matches the existing pattern in `order-ticket.component.spec.ts` and `portfolio-dashboard.component.spec.ts`.

- `StopLossFormComponent` — test in isolation with mocked inputs/outputs
- `ClosePositionDialogComponent` — test with mocked `OrderExecutionService`
- `StopLossDialogComponent` — test with mocked `OrderExecutionService` and embedded `StopLossFormComponent`
- `EquityPositionsTableComponent` — test with mocked dialog service and store
- `OrderExecutionService` — already tested in `order-execution.service.spec.ts`, no new tests needed

## Task 1: Extract StopLossFormComponent

### Unit tests
- Component renders stop price and stop percent fields
- Editing stop price updates stop percent based on current price
- Editing stop percent updates stop price based on current price
- Dollar risk updates when stop price or quantity changes
- Dollar risk = shares × (current price − stop price)
- Preview shows correct order parameters (symbol, side: sell, order type: stop_market, quantity, stop price, time in force: gtc, account number)
- Default stop percent = `DEFAULT_STOP_PERCENT`
- Default stop price = `stopPriceFromPercent(currentPrice, DEFAULT_STOP_PERCENT)`
- Place event emits with correct stop price

### Regression tests
- `OrderTicketComponent` still renders stop-loss section correctly after extraction
- `OrderTicketComponent` stop-loss behavior unchanged (bidirectional linking, dollar risk, preview, submit, cancel)
- Existing `order-ticket.component.spec.ts` tests pass with no modifications

## Task 2: Close-position utility + dialog

### Utility tests
- `buildClosePositionTicket()` returns `EquityOrderTicket` with correct fields
- `source` = `OrderSource.POSITION_MANAGEMENT`
- `sourceRef.type` = `'position_close'`
- `side` = `'sell'`
- `orderType` matches input (market/limit)
- `quantity` matches input
- `limitPrice` set when limit, undefined when market
- `timeInForce` = `'gfd'`
- `marketHours` = `'regular_hours'`
- `refId` is a valid UUID

### Dialog tests
- Dialog opens with pre-filled symbol (read-only) and quantity
- Quantity field is editable
- Quantity validation: positive, ≤ position quantity
- Order type selector switches between market and limit
- Limit price field appears only when limit selected
- Limit price defaults to current price when limit first selected
- Submit calls `OrderExecutionService.submitEquityOrder()` with correct ticket
- Success state shows fill price, quantity filled, order ID, order state
- Success state shows "Done" button
- Error state shows error message
- Error state shows "Retry" button that re-calls `submitEquityOrder()` with same params
- Error state shows "Cancel" button

## Task 3: Wire close-position into equity positions table

### Integration tests
- "Close" action appears on open equity position rows
- "Close" action does not appear on closed positions (zero quantity)
- Clicking "Close" opens `ClosePositionDialogComponent` with position data
- Dialog dismiss triggers `PortfolioDashboardStore.refresh()`
- Position data passed to dialog includes symbol, quantity, current price, account number

## Task 4: Stop-loss dialog

### Dialog tests
- Dialog opens with `StopLossFormComponent` rendered
- Default stop percent and computed stop price initialized
- Bidirectional linking works (price → percent, percent → price)
- Dollar risk displays and updates reactively
- Preview shows correct order parameters
- Submit calls `OrderExecutionService.submitEquityOrder()` with stop-loss ticket
- Success state shows order ID, stop price, order state
- Success state shows "Done" button
- Error state shows error message, "Retry" and "Cancel" buttons
- Retry re-calls `submitEquityOrder()` with same params

## Task 5: Wire stop-loss into equity positions table

### Integration tests
- "Add Stop" action appears on unprotected open equity position rows
- "Add Stop" action does not appear on protected positions (in `protectedSymbols`)
- "Add Stop" action does not appear on closed positions
- Clicking "Add Stop" opens `StopLossDialogComponent` with position data
- Dialog dismiss triggers `PortfolioDashboardStore.refresh()`
- After successful stop-loss placement, position shows as protected after refresh

## Edge cases

- Close-position with partial quantity: position remains open with reduced quantity after refresh
- Close-position with full quantity: position disappears from open positions after refresh
- Stop-loss on position with fractional shares: quantity passed as-is (stop-loss uses whole shares per existing `buildStopLossTicket` behavior)
- Network error during close: error state shows retryable error, retry succeeds
- Network error during stop-loss: error state shows retryable error, retry succeeds
- Dialog dismissed without submitting: no order placed, no refresh triggered (or refresh triggered to show current state — decide during implementation)

## Prior art

- `order-ticket.component.spec.ts` — existing stop-loss tests, bidirectional linking, submit flow
- `order-execution.service.spec.ts` — existing `OrderExecutionService` tests
- `portfolio-dashboard.component.spec.ts` — existing dashboard wiring tests
- `equity-positions-table.component.spec.ts` — existing positions table tests

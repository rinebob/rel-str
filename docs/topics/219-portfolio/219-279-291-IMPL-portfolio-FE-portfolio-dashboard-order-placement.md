**Topic:** Portfolio Dashboard — Order Placement  
**Topic Slug:** `portfolio-dashboard`  
**Thread:** Portfolio Dashboard — Order Placement  
**Thread Slug:** `order-placement`  
**Issue:** #291  
**Thread Parent:** #279  
**Topic Parent:** #219  
**Domain:** PORTFOLIO  
**Type:** IMPL  
**Status:** Draft  
**Created:** 2026-09-12  
**Last Updated:** 2026-09-12  

---

## Overview

FE-only implementation plan for Portfolio Dashboard order placement. No BE or SHARED work — `OrderExecutionService` already wraps `place_equity_order` with preflight review and ref_id idempotency, `buildStopLossTicket()` already builds stop-loss tickets, and the dashboard shell from Thread #274 provides positions, quotes, and order data.

## Architecture

### Shared component extraction

Extract the stop-loss fields, bidirectional linking, dollar risk, and preview from `OrderTicketComponent` (savant-trader feature) into a `StopLossFormComponent` in a shared location. The signal-order page's `OrderTicketComponent` embeds the extracted component with no behavior change. The dashboard stop-loss dialog also embeds it.

The component takes inputs: symbol, quantity, current price, account number, trading config. It emits: stopPrice, stopPercent, dollarRisk, preview, and a "place" event. It uses the existing utilities: `stopPriceFromPercent`, `stopPercentFromPrice`, `DEFAULT_STOP_PERCENT`.

### Close-position dialog

A `ClosePositionDialogComponent` (Material dialog) with:
- Symbol (read-only, from position)
- Quantity (editable, pre-filled from position, validated positive and ≤ position quantity)
- Order type selector (market/limit)
- Limit price (visible when limit, defaults to current price)
- Time in force (gfd, fixed)
- Market hours (regular_hours, fixed)

On submit, builds an `EquityOrderTicket` via `buildClosePositionTicket()` and calls `OrderExecutionService.submitEquityOrder()`. The dialog stays open through submission:
- Success: shows fill price, quantity filled, order ID, order state. "Done" button dismisses.
- Error: shows error message. "Retry" button re-attempts with same parameters. "Cancel" button dismisses.

### Stop-loss dialog

A `StopLossDialogComponent` (Material dialog) embedding `StopLossFormComponent`. The dialog provides position context (symbol, quantity, current price, account number) and handles:
- Building the stop-loss ticket via `buildStopLossTicket()`
- Calling `OrderExecutionService.submitEquityOrder()`
- Success state: shows order ID, stop price, order state. "Done" button dismisses.
- Error state: shows error message. "Retry" and "Cancel" buttons.

### Dashboard wiring

The equity positions table gets two new row actions:
- "Close" — visible on all open equity positions. Opens `ClosePositionDialogComponent`.
- "Add Stop" — visible only on unprotected open equity positions (not in `protectedSymbols`). Opens `StopLossDialogComponent`.

Both actions trigger `PortfolioDashboardStore.refresh()` after dialog dismissal to re-fetch positions and orders.

### Utilities

- `buildClosePositionTicket(position, orderType, quantity, limitPrice?, accountNumber)` — builds an `EquityOrderTicket` with `OrderSource.POSITION_MANAGEMENT`, side: sell, appropriate order type, and a generated ref_id. Mirrors the existing `buildStopLossTicket()` pattern.

## Tasks

### Task 1: Extract StopLossFormComponent
Extract stop-loss fields from `OrderTicketComponent` into a shared `StopLossFormComponent`. The signal-order page embeds it with no behavior change.

Inputs: symbol, quantity, current price, account number, trading config.
Outputs: stopPrice, stopPercent, dollarRisk, preview, place event.
Utilities: `stopPriceFromPercent`, `stopPercentFromPrice`, `DEFAULT_STOP_PERCENT`.

### Task 2: Close-position utility + dialog
Build `buildClosePositionTicket()` utility and `ClosePositionDialogComponent`.

The utility builds an `EquityOrderTicket` with:
- `source: OrderSource.POSITION_MANAGEMENT`
- `sourceRef: { type: 'position_close', id: position id }`
- `side: 'sell'`
- `orderType: 'market' | 'limit'`
- `quantity`, `limitPrice` (if limit)
- `timeInForce: 'gfd'`
- `marketHours: 'regular_hours'`
- `refId: crypto.randomUUID()`

The dialog calls `OrderExecutionService.submitEquityOrder()` and shows success/error states inline.

### Task 3: Wire close-position into equity positions table
Add "Close" action to open equity position rows. Open `ClosePositionDialogComponent` with position data. Trigger `refresh()` on dialog dismiss.

### Task 4: Stop-loss dialog
Build `StopLossDialogComponent` embedding `StopLossFormComponent`. Build ticket via `buildStopLossTicket()`. Call `OrderExecutionService.submitEquityOrder()`. Show success/error states inline.

### Task 5: Wire stop-loss into equity positions table
Add "Add Stop" action to unprotected open equity position rows. Open `StopLossDialogComponent` with position data. Trigger `refresh()` on dialog dismiss. Hide "Add Stop" for positions in `protectedSymbols`.

## Dependencies

```
Task 1 (extract StopLossFormComponent) ─┐
                                        ├──→ Task 4 (stop-loss dialog) ──→ Task 5 (wire stop-loss)
Task 2 (close utility + dialog) ─────────→ Task 3 (wire close-position)
```

Tasks 1 and 2 can start in parallel. Task 3 depends on 2. Task 4 depends on 1. Task 5 depends on 4.

## Refs

- [PRD: Portfolio Dashboard — Order Placement](219-279-280-PRD-portfolio-portfolio-dashboard-order-placement.md)
- [AS-BUILT: Portfolio Dashboard — Init Impl](219-290-AS-BUILT-PORTFOLIO-portfolio-dashboard.md)
- `src/app/features/savant-trader/services/order-execution.service.ts` — existing `OrderExecutionService`
- `src/app/features/savant-trader/utils/stop-loss-ticket.util.ts` — existing `buildStopLossTicket()`
- `src/app/features/savant-trader/components/order-ticket/order-ticket.component.ts` — source for `StopLossFormComponent` extraction
- `src/app/features/portfolio-dashboard/` — dashboard shell and section components from Thread #274

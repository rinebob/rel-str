**Topic:** Portfolio Dashboard  
**Topic Slug:** portfolio-dashboard  
**Thread:** Portfolio Dashboard — Update Stop Loss  
**Thread Slug:** update-stop-loss  
**Issue:** #861  
**Thread Parent:** #829  
**Topic Parent:** #219  
**Domain:** PORTFOLIO  
**Type:** IMPL  
**Status:** Draft  
**Created:** 2026-10-07  
**Last Updated:** 2026-10-07  

## Overview

FE-only implementation plan for Update Stop Loss. No BE or SHARED work — `OrderExecutionService` already composes `review_equity_order` → `place_equity_order` with `ref_id` idempotency and `cancel_equity_order`, and the dashboard shell provides positions, orders, and agent gating. The new primitive (`updateEquityStopOrder`) is cancel → submit with bounded retry; everything else is components, a small orchestrator service, and pure utilities.

## Architecture

### 1. `BrokerOrder` carries TIF + market hours

`BrokerOrder` (`core/robinhood-mcp/types/robinhood-mcp.types.ts`) gains optional `timeInForce?: string` and `marketHours?: string` — verbatim RH values, `undefined` when the payload omits them (matching the `legs`/`executions` convention; implemented in #885). `RobinhoodMcpClientService.normalizeOrder` parses `time_in_force` / `market_hours` from the raw payload (both are present in RH order responses; `parseBrokerOrder` in `order-execution.service.ts` already maps them into `BrokerOrderSnapshot`). Optional fields — no existing consumer breaks. This is the update dialog's prefill source for the original order's parameters. Consumers narrow the verbatim strings to the ticket unions via `toEquityTimeInForce` / `toEquityMarketHours` (`broker-order.util.ts`, #885) — unrecognized RH values return `undefined` so the caller picks the default, never a silent coercion.

### 2. Shared form gets the full ticket params

`StopLossFormComponent` gains:

- `timeInForce = model<'gfd' | 'gtc'>('gtc')` and `marketHours = model<'regular_hours' | 'extended_hours' | 'all_day_hours'>('regular_hours')` — two-way signal models.
- `showOrderParams = input(true)` — when false the TIF/hours pills are hidden (order-ticket case, see below).
- `initialStopPrice = input<number | null>(null)` — seeds `stopLossPrice` once, marks `userEdited`, and derives the percent through the existing price↔percent linking (update-mode prefill).
- TIF pill group (Day / GTC) and market-hours pill group (Regular / Extended / All Day), same pill markup pattern as `order-ticket.component.html`.
- `preview` uses `timeInForce()` / `marketHours()` instead of the hardcoded literals.
- `placeStopLoss` emits `{ stopPrice, timeInForce, marketHours }` — a breaking change to the payload type; both consumers are updated.

`OrderTicketComponent` binds `[(timeInForce)]="timeInForce"` / `[(marketHours)]="marketHours"` into the form and sets `[showOrderParams]="false"` — the ticket's own pills remain the single visible control on that page, and the form's preview finally tells the truth (today it shows `gtc`/`regular_hours` regardless of the ticket's selections). `onPlaceStopLoss` continues using `$event.stopPrice`; its ticket construction already reads the ticket's own TIF/hours signals, so no change is needed there beyond the binding.

### 3. Ticket builders take TIF + market hours

`buildStopLossTicketBase` and its three public wrappers take a `StopOrderParams` options object (`{ timeInForce?, marketHours? }`, inserted before the trailing `now` param); the base applies the historical `'gtc'` / `'regular_hours'` defaults so existing callers are unchanged. A new `buildStopLossUpdateTicket(symbol, quantity, stopPrice, accountNumber, replacedOrderId, params?, now?)` emits the `stop_loss_update` sourceRef — `{ type: 'stop_loss_update', id: originalOrderId }` — preserving replacement provenance on the ticket. The canonical unions are exported from `order-ticket.types.ts` as `EquityTimeInForce` / `EquityMarketHours` (implemented in #885).

### 4. `updateEquityStopOrder` primitive

New method on `OrderExecutionService`:

```ts
updateEquityStopOrder(
  accountNumber: string,
  orderId: string,
  ticket: EquityOrderTicket,
): Promise<UpdateStopResult>
```

Where `UpdateStopResult` extends `ExecutionResult` with `phase: 'cancel' | 'place'` and `unprotected: boolean` (true when cancel succeeded and placement failed).

Flow:

1. `cancelEquityOrder(accountNumber, orderId)` — on failure, return `{ success: false, phase: 'cancel', unprotected: false, error }` and **do not place** (placing on an uncertain cancel risks a duplicate stop; if the order already filled/cancelled, the position state changed and the user should refresh anyway).
2. `submitEquityOrder(ticket)` — retried up to `MAX_PLACE_ATTEMPTS = 3` total attempts while the error is `retryable`, with `RETRY_DELAY_MS = 500` between attempts. The same ticket object is resubmitted so the same `refId` is reused — RH idempotency makes a retry safe. Non-retryable errors return immediately.
3. Success → `{ success: true, result }`. Exhausted → `{ success: false, phase: 'place', unprotected: true, error }`.

Manual retry after a place-phase failure must not re-cancel (the order is already gone): the dialog retries by calling `submitEquityOrder` directly on the retained ticket, not the primitive. The primitive's caller-side contract: `phase === 'cancel'` → retry the whole update; `phase === 'place'` → retry placement only.

This is the shared primitive Thread #830 (trailing-stop engine) consumes — it takes a fully built ticket, so the future server-side caller supplies its own ticket construction.

### 5. Updatable-stop selection (pure utilities)

`portfolio-pnl.util.ts` (or a sibling util) gains:

- `isUpdatableStopOrder(order): boolean` — `isProtectiveStopOrder(order) && order.type !== 'stop_limit'`. `isProtectiveStopOrder` already covers `stop_market`/`stop_limit` plus `market`/`limit`-typed sells carrying `stopPrice`; the updatable set removes `stop_limit` (updating would silently downgrade it to stop-market).
- `updatableStopsBySymbol(orders, positions): Map<string, BrokerOrder[]>` — groups updatable stops by symbol for the picker and the batch.
- `computeStopUpdateCandidates(positions, orders, trailPct): StopUpdateCandidate[]` — one row per updatable stop: `{ order, symbol, currentStopPrice, computedStopPrice, disposition: 'update' | 'skip-tighter' }` where `computedStopPrice = position.currentPrice × (1 − trailPct / 100)` and `disposition = 'update'` only when `computed > current` (tighten-only).

### 6. `StopLossDialogComponent` update mode

`StopLossDialogData` gains an optional `update` field:

```ts
update?: {
  /** Updatable stops for the symbol; length > 1 renders the picker step first. */
  candidates: BrokerOrder[];
  /** Preselected order — set by the Open Orders entry point. */
  target?: BrokerOrder;
}
```

Dialog state machine gains `picking` before `editing`. In update mode:

- Title: "Update Stop Loss — {symbol}"; submit button reads "Update Stop".
- Picker step lists each candidate's stop price, quantity, state, and created date; selection sets the target order.
- Form prefills: `initialStopPrice = target.stopPrice`, `[(timeInForce)]`/`[(marketHours)]` initialized from `toEquityTimeInForce(target.timeInForce) ?? 'gtc'` / `toEquityMarketHours(target.marketHours) ?? 'regular_hours'`.
- Submit builds the ticket via `buildStopLossUpdateTicket` (emits the `stop_loss_update` sourceRef carrying the replaced order's id) with the form's emitted `timeInForce`/`marketHours`, then calls `updateEquityStopOrder` — not `submitEquityOrder`.
- Error state distinguishes phases: `phase === 'place' && unprotected` renders the explicit "previous stop was cancelled — position is unprotected" warning; its Retry calls `submitEquityOrder` on the retained ticket. `phase === 'cancel'` retries the full primitive.

### 7. Entry points

**Equity positions table:** unprotected rows keep "Add Stop" unchanged; protected rows show an enabled "Update Stop" button (replaces the disabled one) emitting a new `updateStopLoss` output. `PortfolioDashboardComponent.onUpdateStop(position)` resolves updatable stops for the symbol from the selected account's `openOrders` and opens the dialog in update mode with `candidates` (picker appears only when count > 1). If the candidate list is empty (e.g., only `stop_limit` stops), the button is disabled with a tooltip explaining why.

**Open orders table:** rows where `isUpdatableStopOrder(order)` get an "Update" action beside Cancel, emitting `updateOrder`. `onUpdateOrder(order)` finds the matching equity position (for quantity/price context) and opens the dialog with `update.target = order` — no picker.

### 8. Update All Stops

**`UpdateAllStopsService`** (portfolio-dashboard feature, `providedIn: 'root'`) owns the run:

- `run(candidates: StopUpdateCandidate[], ctx: { accountNumber, quantityBySymbol })` — sequential `for` loop; for each `disposition === 'update'` candidate it builds the ticket (GTC always; `marketHours` preserved from the original order; full truncated position quantity; `stop_loss_update` sourceRef) and calls `updateEquityStopOrder`, appending the outcome to a `results` signal. Skipped candidates are recorded as `'skipped'`.
- An unrecoverable per-order failure sets `status` to `'aborted'`, marks remaining candidates `'not-run'`, and stops the loop.
- Signals: `status: 'idle' | 'running' | 'done' | 'aborted'`, `results: StopUpdateOutcome[]`, `currentIndex`. Per-order retry: `retryOne(candidate)` re-invokes the primitive and patches that row's outcome.

**`UpdateAllStopsDialogComponent`**: four steps — (1) trail-% input; (2) preview list from `computeStopUpdateCandidates` (symbol, current stop, computed stop, update/skip-tighter); (3) executing view rendering the service's signals; (4) summary with per-order updated/skipped/failed/not-run, unprotected flags, and per-failed retry via `retryOne`.

**Toolbar:** "Update All Stops" button on the equity positions section header of the selected account, `agenticAllowed`-gated, disabled when `updatableStopsBySymbol` is empty.

## Tasks

### Task 1: BrokerOrder params + ticket builders

Add `timeInForce`/`marketHours` to `BrokerOrder` and `normalizeOrder`; add the params to `buildStopLossTicketBase`/`buildPositionStopLossTicket`/`buildStopLossTicket`; add the `stop_loss_update` sourceRef type.

### Task 2: Full params on StopLossFormComponent

`model()` inputs, `showOrderParams`, `initialStopPrice`, TIF/hours pills, truthful preview, enriched `placeStopLoss` payload; update `OrderTicketComponent` binding; update `StopLossDialogComponent`'s add-mode submit for the new payload shape.

### Task 3: `updateEquityStopOrder` primitive

Cancel → submit with bounded retry, phase/unprotected result, same-`refId` retries.

### Task 4: Update mode in the dialog + positions-table wiring

Picker step, prefill, update-mode submit path, "Update Stop" row action, `onUpdateStop`.

### Task 5: Open Orders Update action

`isUpdatableStopOrder` row gate, `updateOrder` output, `onUpdateOrder` targeting one order.

### Task 6: Update All Stops

`computeStopUpdateCandidates` + `updatableStopsBySymbol`, `UpdateAllStopsService`, `UpdateAllStopsDialogComponent`, toolbar button.

## Dependencies

```
Task 1 ──┬──→ Task 2 ──→ Task 4 ──→ Task 5
         └──→ Task 3 ──┘     └──→ Task 6
```

Task 1 is the foundation for everything. Tasks 2 and 3 are parallel after 1. Task 4 needs both (dialog uses the new payload + primitive). Task 5 reuses 4's dialog. Task 6 needs 3's primitive and the update-mode ticket path.

## Technical risks

- **Unprotected window:** inherent to cancel-first (PRD technical context). Surfaced in the UI via `unprotected` on place-phase failure; bounded auto-retry narrows it.
- **`stop_price` on 'market'/'limit' types:** the updatable set deliberately includes RH's market/limit-typed stop orders; replacements are always `stop_loss`-typed tickets — a type upgrade, accepted per PRD.
- **Extended-hours stops:** `extended_hours`/`all_day_hours` are offered matching the order ticket; RH acceptance on stop orders is unverified and surfaces through the normal failure path if rejected.
- **Multi-stop batch convergence:** per product decision, all eligible stops update to the computed level — same-symbol levels may converge.

## Refs

- [PRD: Portfolio Dashboard — Update Stop Loss](219-829-832-PRD-portfolio-portfolio-dashboard-update-stop-loss.md)
- [IMPL: Portfolio Dashboard — Order Placement](219-279-291-IMPL-portfolio-FE-portfolio-dashboard-order-placement.md) — precedent (dialog, form extraction, service patterns)
- `src/app/features/savant-trader/services/order-execution.service.ts`
- `src/app/features/savant-trader/utils/stop-loss-ticket.util.ts`
- `src/app/shared/components/stop-loss-form/stop-loss-form.component.ts`
- `src/app/features/portfolio-dashboard/utils/portfolio-pnl.util.ts`
- `src/app/core/robinhood-mcp/robinhood-mcp-client.service.ts` — `normalizeOrder`

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

`OrderTicketComponent` sets `[showOrderParams]="false"` and binds **neither** model — as built after UAT, the ticket's TIF/Hours pills govern only the ENTRY order (they're hidden once it fills anyway), so binding them would silently pin the stop to the entry's values: a `gfd` entry → a Day stop, and extended/all-day → a broker 400. `onPlaceStopLoss` uses `$event.stopPrice` and pins `{ timeInForce: 'gtc', marketHours: 'regular_hours' }`; the dialog pins `marketHours` at the same seam. The form's own models keep their `gtc`/`regular_hours` defaults, which is what its preview shows — honest again.

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

Where `UpdateStopResult` extends `ExecutionResult` with optional `phase?: 'cancel' | 'place'` and `unprotected?: boolean` — both absent on success; `unprotected` is true when cancel succeeded but the replacement never landed.

Flow:

0. Guard: `accountNumber !== ticket.accountNumber` → `{ success: false, unprotected: false, error: { retryable: false } }` with **no `phase`** — no broker phase ran — before touching the broker (a mismatch would cancel in one account and place in another).
1. `cancelEquityOrder(accountNumber, orderId)` — on failure, return `{ success: false, phase: 'cancel', unprotected: false, error }` and **do not place** (placing on an uncertain cancel risks a duplicate stop; if the order already filled/cancelled, the position state changed and the user should refresh anyway). Terminal cancel failures classify `retryable: false` so callers don't livelock retrying a cancel that can never succeed — the order-terminal pattern list is built from the committed capture corpus: "not found" (404), "Order cannot be cancelled at this time." (403, `mx-can-bid-403-filled`), "already cancelled", "already filled", "not enough shares" (400), "no longer available" (400). These patterns apply to tool-error text only — `isRetryableException` keeps them out of transport-exception classification so a transient HTTP 404 / "session not found" blip isn't misclassified as terminal (the ref-id-conflict pattern is the deliberate exception — it's an identity error, safe on the throw path). An explicit `data.accepted === false` on an otherwise-successful cancel envelope is a rejected cancel → `{ phase: 'cancel', unprotected: false, retryable: false }`; an *absent* field still proceeds to the confirm poll (the poll is the truth source; only `accepted:true` is capture-proven).
1b. **Cancel confirmation** — RH cancel is asynchronous: `cancel_equity_order` returns `{ data: { accepted: true } }`, which means the request was accepted, not that the order is terminal (guide note in the `mx-can-bid` captures). The primitive polls `get_equity_orders` in **single-order mode** (`order_id` arg — the list endpoint is paginated and GTC stops sit deep in history; `dep-eq-orders-id.json` shows the single-order envelope is the same `{data:{orders:[…]}}` shape), `CANCEL_CONFIRM_ATTEMPTS = 3` × `CANCEL_CONFIRM_DELAY_MS = 500`, until the order lands in a cancelled-family state (`cancelled`/`rejected`/`failed`/`voided`/`partially_filled_rest_cancelled` — the last named in the captured cancel guide and added to the `OrderState` union). **Fill-adjacent abort** — `filled`, `partially_filled`, any `cumulativeQuantity > 0`, any recorded `executions`, or a fill-capable cancelled state (`cancelled`, `partially_filled_rest_cancelled`) with `cumulative_quantity` absent (ambiguous — cancelled-with-fills is real; `rejected`/`failed`/`voided` never fill so a missing field there is unremarkable) → `{ phase: 'cancel', unprotected: false, error: { retryable: false } }`: the position exited or shrank under us and the replacement ticket's original quantity would oversell; the caller must refresh. **Unconfirmed after the budget** (live/absent/unknown/poll-error) → `{ phase: 'place', unprotected: true, error: { retryable: true } }` — NOT a cancel-phase failure: the cancel was *accepted*, so the old order is past the point of return; the error message directs the caller to reconcile the order's state and re-place the retained ticket via `submitEquityOrder` — never re-cancel.
2. `submitEquityOrder(ticket)` — retried up to `MAX_PLACE_ATTEMPTS = 3` total attempts while the error is `retryable`, with `RETRY_DELAY_MS = 500` between attempts. The same ticket object is resubmitted so the same `refId` is reused — RH idempotency makes a retry safe. Non-retryable errors return immediately.
3. `submitEquityOrder` itself requires a parseable broker order id — a success envelope with no order id returns `{ success: false, error: { code: 'PLACEMENT_UNCONFIRMED', message: 'placement unconfirmed — no order id in response', retryable: true } }` (shipped callers must not persist a phantom SUBMITTED ticket with no id — it would be uncancellable from the UI). In the update loop such an attempt sets `placementUnconfirmed` (keyed on `error.code`, not message text); the retry reuses the same refId and the subsequent 409 proves the first attempt landed. A success envelope whose order id parses but whose `state` is already dead (`rejected`/`failed`/`voided`/`cancelled`/`partially_filled_rest_cancelled`) returns `{ success: false, error: { code: 'PLACEMENT_DEAD', retryable: false }, result }` — the order exists but is not live, and its refId is likely consumed. `filled` stays a success on the standalone path (a market order can fill synchronously), but inside `updateEquityStopOrder` a synchronously-`filled` replacement is treated as fill-adjacent — `{ phase: 'cancel', unprotected: false }` refresh-first — because it means the position just exited, not that a protective stop is resting. In the update loop a `PLACEMENT_DEAD` failure splits on fills: `filledQuantity > 0` OR an absent/unparseable fill field on a fill-capable state (`cancelled`/`partially_filled_rest_cancelled`) → the same refresh-first `{ phase: 'cancel', unprotected: false }` (the dead replacement shrank the position — ambiguous is never assumed zero); clean-dead → `{ phase: 'place', unprotected: true }` with `result.orderId` forwarded for reconciliation and the message directing the caller to mint a **fresh** ticket (the retained refId would 409). Place-response state handling is a live-denylist: `new`/`queued`/`confirmed`/`unconfirmed`/`pending_cancelled`/`partially_filled` are live; `filled` is the sync-fill case; `DEAD_ORDER_STATES` → `PLACEMENT_DEAD`; **any other value (novel or absent state) → `PLACEMENT_UNCONFIRMED` retryable** — the registered order's state is ambiguous, never a phantom success, and the same-refId retry converges on the 409. Exhausted → `{ success: false, phase: 'place', unprotected: true, error }`. **Exception — ref_id conflict:** RH enforces `ref_id` uniqueness with a 409 ("Reference ID must be unique"), which can only occur if an earlier attempt with that refId was registered broker-side (the response was lost). A ref-id-conflict (or unconfirmed-placement) place failure returns `{ phase: 'place', unprotected: false }` — the replacement likely exists; the caller must reconcile open orders rather than re-place (a manual re-place would create the real duplicate).

Also hardened in review (#887): `cancelOrder`/`submitEquityOrder` now detect tool-level rejections on all three wire channels — the executor's `toolError` field (the only carrier when the error text parses as JSON), plus `isError` envelopes under `parsed`/`redacted`. Without this, a rejected cancel returned `success: true` and the update placed a second live stop. Two adjacent live-path fixes shipped with it: `OrderTicketStore.submitTicket` splits `PLACEMENT_DEAD` reverts — clean-dead mints **and persists** a fresh `refId` + records the dead orderId (the dead order consumed the refId; persisting prevents a reload restoring the burned one and wedging on 409s), while dead-with-fills or fill-ambiguous dead keeps the burned refId (a retry 409s harmlessly — the ticket's stale quantity must not resubmit over a shrunken position) and tells the user to refresh + re-stage; `PLACEMENT_UNCONFIRMED`/ref-id-conflict failures also keep the refId (a same-refId retry converges instead of duplicating); and both order dialogs set `disableClose` permanently once a submission attempt runs (ESC/backdrop stay blocked through in-flight *and* post-completion states — only Cancel/Done close, both returning `true` so the dashboard refreshes), closing the stale-view → duplicate-order vector.

Manual retry after a place-phase failure must not re-cancel (the order is already gone): the dialog retries by calling `submitEquityOrder` directly on the retained ticket, not the primitive. The primitive's caller-side contract: `phase === 'cancel'` → retry the whole update only while `error.retryable`; `phase === 'place'` → retry placement only — with `error.code === 'PLACEMENT_DEAD'` that means a **fresh** ticket (refId burned), otherwise the retained ticket (`unprotected === false` → reconcile instead, never re-place).

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
- **Extended-hours stops:** VERIFIED during #886 UAT — RH rejects them: `400 {"non_field_errors":["Extended hours orders cannot have stop price."]}`. The form locks Hours to Regular (Extended/All Day pills disabled) and the order ticket's `marketHours` is deliberately *not* bound into the stop form — an extended-hours entry must not poison its stop. `marketHours` remains in the payload/prefill contract (always `'regular_hours'` for stops in practice) so update mode can round-trip the original order's value.
- **Multi-stop batch convergence:** per product decision, all eligible stops update to the computed level — same-symbol levels may converge.

## Refs

- [PRD: Portfolio Dashboard — Update Stop Loss](219-829-832-PRD-portfolio-portfolio-dashboard-update-stop-loss.md)
- [IMPL: Portfolio Dashboard — Order Placement](219-279-291-IMPL-portfolio-FE-portfolio-dashboard-order-placement.md) — precedent (dialog, form extraction, service patterns)
- `src/app/features/savant-trader/services/order-execution.service.ts`
- `src/app/features/savant-trader/utils/stop-loss-ticket.util.ts`
- `src/app/shared/components/stop-loss-form/stop-loss-form.component.ts`
- `src/app/features/portfolio-dashboard/utils/portfolio-pnl.util.ts`
- `src/app/core/robinhood-mcp/robinhood-mcp-client.service.ts` — `normalizeOrder`

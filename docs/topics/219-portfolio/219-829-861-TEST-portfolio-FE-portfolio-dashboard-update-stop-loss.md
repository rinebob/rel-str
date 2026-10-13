**Topic:** Portfolio Dashboard  
**Topic Slug:** portfolio-dashboard  
**Thread:** Portfolio Dashboard — Update Stop Loss  
**Thread Slug:** update-stop-loss  
**Issue:** #861  
**Thread Parent:** #829  
**Topic Parent:** #219  
**Domain:** PORTFOLIO  
**Type:** TEST  
**Status:** Draft  
**Created:** 2026-10-07  
**Last Updated:** 2026-10-07  

## E2E User Journeys

- Update from positions table: protected equity row → "Update Stop" → dialog prefilled with current stop + original TIF/hours → change price → confirm → old order cancelled, new stop at new price → dashboard refreshes showing the new stop.
- Update from Open Orders: eligible stop row → "Update" → dialog targeted at that order (no picker) → submit → row's stop replaced.
- Multi-stop pick: symbol with two updatable stops → "Update Stop" → picker lists both → pick one → only that order is replaced; the other is untouched.
- Batch ratchet: "Update All Stops" → enter trail % → preview shows per-order dispositions → confirm → sequential updates → summary (updated / skipped / failed / not-run, unprotected flags).
- Unprotected failure: place fails after cancel → error states the old stop is gone and the position is unprotected → manual retry re-places the same ticket (same `refId`).

## Integration Tests

- `StopLossDialogComponent` + `OrderExecutionService` mocked: update-mode data → calls `updateEquityStopOrder` with the target order id and a ticket carrying the form's `timeInForce`/`marketHours`; add mode still calls `submitEquityOrder`.
- `UpdateAllStopsDialogComponent` + `UpdateAllStopsService` with `OrderExecutionService` mocked: preview → confirm → per-order call order (sequential), abort on failure, retry-one patching.
- `PortfolioDashboardComponent` wiring: `updateStopLoss` resolves candidates and opens the dialog in update mode; `updateOrder` opens it targeted; "Update All Stops" opens the batch dialog; dismissal with success triggers `refresh()`.
- `OrderTicketComponent` + `StopLossFormComponent`: ticket pills two-way bind; form pills hidden; preview reflects ticket selections.

## Unit Tests

- `isUpdatableStopOrder`: stop_market yes; `stop_limit` no; `market`/`limit` sell with `stopPrice` yes; buy side no; terminal states no.
- `updatableStopsBySymbol`: grouping, empty sets, stop_limit exclusion.
- `computeStopUpdateCandidates`: `computed = price × (1 − pct/100)`; tighten-only disposition (`computed > current` → update, else skip-tighter); missing/null price handling.
- `updateEquityStopOrder`: cancel success → confirm poll → place called once; cancel failure → place never called, `phase: 'cancel'`; retryable place error → up to 3 attempts, same `refId`; non-retryable → single attempt; place exhausted → `phase: 'place'`, `unprotected: true`; accountNumber/ticket mismatch → rejected before any broker call, no `phase`; `ref_id` 409 conflict → `phase: 'place'`, `unprotected: false` (replacement likely exists — reconcile); accepted-but-unconfirmed cancel → polls `get_equity_orders` (single-order `order_id` mode), places only after a cancelled-family state, aborts non-retryably on `filled`/partial-fill/`cumulativeQuantity>0`, and when still unconfirmed → `phase: 'place'`, `unprotected: true` (cancel was accepted — reconcile + re-place, never re-cancel); dead-state place response (e.g. `rejected`) → `phase: 'place'`, `unprotected: true`, non-retryable, dead order id forwarded on `result`; `partially_filled_rest_cancelled` with absent `cumulative_quantity` → fill-adjacent abort (ambiguous, do not assume zero fills); plain `cancelled` with absent `cumulative_quantity` or with recorded `executions` → same abort (`rejected`/`failed`/`voided` never fill, so their missing field is unremarkable); cancel rejections on all three wire channels (`toolError`, `parsed.isError`, `redacted.isError`) → `phase: 'cancel'`, no place; captured 403 "Order cannot be cancelled at this time." → non-retryable; success envelope without an order id → unconfirmed attempt, converges on `unprotected: false` via the 409; dead-state place response with fills (`cancelled` + `filled_quantity>0`) → refresh-first `phase: 'cancel'`, `unprotected: false`; dead-state with zero fills → `phase: 'place'`, `unprotected: true`, `PLACEMENT_DEAD`, dead order id forwarded; synchronously-`filled` place response → fill-adjacent `phase: 'cancel'`, not success; thrown exception carrying "Reference ID must be unique" → non-retryable single attempt.
- `buildStopLossTicketBase`: accepts/defaults TIF/hours; `stop_loss_update` sourceRef carries replaced order id.
- `normalizeOrder`: parses `time_in_force`/`market_hours` onto `BrokerOrder`.
- `StopLossFormComponent`: `model()` writes flow into preview and emitted payload; `initialStopPrice` seeds price + derives percent; `showOrderParams=false` hides pills.
- `UpdateAllStopsService`: sequential order, skip recording, abort marks remainder `not-run`, `retryOne` patches outcome.
- `OrderTicketStore.submitTicket`: clean `PLACEMENT_DEAD` reverts to STAGED with a **fresh** `refId` + dead orderId recorded; `PLACEMENT_DEAD`-with-fills (or fill-ambiguous `cancelled`/`rest_cancelled`) keeps the **burned** `refId` (retry 409s harmlessly — a fresh-refId resubmit would carry the stale quantity over a shrunken position) and tells the user to refresh + re-stage; `PLACEMENT_UNCONFIRMED`/ref-id-conflict failure reverts with the **same** `refId` (converging retry).
- `ClosePositionDialogComponent`/`StopLossDialogComponent`: `disableClose` stays on once a submission runs (in-flight and post-completion); `onCancel` closes `true` once a submission attempt ran (refresh on possible registration).

## Test Seams

- **Highest seam:** component TestBed specs with `OrderExecutionService` mocked (dialog states, payloads, row actions) — matches existing `stop-loss-dialog` / `equity-positions-table` / `open-orders-table` harnesses.
- **Service seam:** `OrderExecutionService` / `UpdateAllStopsService` specs with `RobinhoodMcpObservationService` mocked — call sequences, retry counts, phase results.
- **Lowest seam:** pure utils (`isUpdatableStopOrder`, `computeStopUpdateCandidates`, ticket builders) — direct function specs.

## Existing Test Coverage

- `stop-loss-form.component.spec.ts` — preview + `placeStopLoss` emit; extended for new payload/inputs.
- `stop-loss-dialog.component.spec.ts` — submit/retry/state flow; extended for update mode + picker.
- `equity-positions-table.component.spec.ts` — Add Stop gating; extended for Update Stop on protected rows.
- `open-orders-table.component.spec.ts` — Cancel action; extended for Update on eligible stops.
- `portfolio-dashboard.store.selectors.spec.ts` — `protectedSymbols`; extended for updatable-stop selectors.
- `portfolio-pnl.util.spec.ts` — `isProtectiveStopOrder` matrix; extended for the updatable subset.
- `robinhood-mcp-client.service.spec.ts` — `normalizeOrder` fixtures; extended for new fields.

## Edge Cases

- Position with multiple stops — picker shows, only chosen order replaced.
- `stop_limit`-only protection — no updatable candidates; row action disabled.
- Cancel succeeds, all place attempts fail — `unprotected` state + warning + manual retry does not re-cancel.
- Cancel fails — nothing placed, `phase: 'cancel'` (no duplicate risk).
- Order already gone at cancel time (filled/cancelled elsewhere) — cancel failure surfaces; user refreshes.
- Order fills *after* the cancel is accepted but before it lands (async cancel race) — confirm poll sees `filled`, update aborts non-retryably, no replacement placed against the exited position.
- Order *partially* fills before/during the cancel (`partially_filled`, `cancelled` with fills, `partially_filled_rest_cancelled` with fills) — same non-retryable abort; the retained ticket's original quantity would oversell the shrunken position.
- Cancel accepted but order stays live/absent through the confirm budget — no place; `phase: 'place'`, `unprotected: true` tells the caller to reconcile + re-place the retained ticket, never re-cancel.
- Cancel envelope returns `accepted: false` — cancel-phase failure, non-retryable, no place.
- Place returns a known order id with an unknown/absent state — `PLACEMENT_UNCONFIRMED`, retryable; same-refId retry converges on the ref-id conflict.
- Dead replacement with absent/unparseable `cumulativeQuantity` on a fill-capable state (`cancelled`/`partially_filled_rest_cancelled`) — refresh-first abort; absent is never assumed zero.
- Store on clean `PLACEMENT_DEAD` — mints and persists a fresh refId; on dead-with-fills/ambiguous — keeps the burned refId so a retry 409s harmlessly.
- Batch: symbol already tighter than computed — skipped, never loosened.
- Batch: failure mid-run — remaining orders `not-run`, completed ones reported.
- `stopPrice`/`currentPrice` null or stale — candidate skips or shows the stale basis in preview.
- gfd original order — prefill shows Day; Update All writes GTC regardless.
- Original order missing TIF/hours in payload — prefill defaults `gtc`/`regular_hours`.

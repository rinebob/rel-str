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
- `updateEquityStopOrder`: cancel success → place called once; cancel failure → place never called, `phase: 'cancel'`; retryable place error → up to 3 attempts, same `refId`; non-retryable → single attempt; place exhausted → `phase: 'place'`, `unprotected: true`.
- `buildStopLossTicketBase`: accepts/defaults TIF/hours; `stop_loss_update` sourceRef carries replaced order id.
- `normalizeOrder`: parses `time_in_force`/`market_hours` onto `BrokerOrder`.
- `StopLossFormComponent`: `model()` writes flow into preview and emitted payload; `initialStopPrice` seeds price + derives percent; `showOrderParams=false` hides pills.
- `UpdateAllStopsService`: sequential order, skip recording, abort marks remainder `not-run`, `retryOne` patches outcome.

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
- Batch: symbol already tighter than computed — skipped, never loosened.
- Batch: failure mid-run — remaining orders `not-run`, completed ones reported.
- `stopPrice`/`currentPrice` null or stale — candidate skips or shows the stale basis in preview.
- gfd original order — prefill shows Day; Update All writes GTC regardless.
- Original order missing TIF/hours in payload — prefill defaults `gtc`/`regular_hours`.

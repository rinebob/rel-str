**Topic:** Savant Trader — order execution layer, persistence fixes, and rh-agent → savant-trader rename  
**Issue:** #180  
**Topic Parent:** #176  
**Domain:** SAVANT-TRADER  
**Type:** Test Plan  
**Area:** FE  
**Status:** Draft  
**Created:** 2026-08-24  
**Last Updated:** 2026-08-24  

---

# Test Plan: FE — persistence fixes, staging store, workspace, wiring

## E2E User Journeys

- **Journey 1 — Signal to order:** User opens signal-review → accepts a signal → clicks "Stage Accepted" → navigates to order workspace → sees the staged intent in the queue → selects it → configures order parameters → confirms → order is submitted → status updates to SUBMITTED → eventually FILLED.
- **Journey 2 — Persistence across refresh:** User accepts signals → refreshes browser → accepted signals still show as accepted (derived from durable store) → review flags still present.
- **Journey 3 — Stop loss staging:** User stages an entry order → stages a stop loss sell intent → stages a target exit sell intent → submits all three individually.
- **Journey 4 — Retry after failure:** User submits an order → it fails → user clicks retry → same `refId` is used → order succeeds (no duplicate).
- **Journey 5 — Account selection:** User opens order workspace for the first time → no account configured → prompted to select → selects account → stored → future orders auto-filled.

## Integration Tests

- **TriageStore + TriageService wiring:** spy on `TriageService` methods, call `TriageStore.markForReview()`, verify `setReviewFlag()` is called. Same for `unmarkFromReview`, `markGroupForReview`, `clearReviewFlags`. Verify optimistic update + error rollback.
- **OccurrenceDecisionStore as single source of truth:** call `acceptSignals()`, verify `statusForSymbol()` returns ACCEPT. Call `resetSymbol()`, verify `statusForSymbol()` returns PENDING. Verify `statusCounts` derived correctly.
- **OrderStagingStore + OrderIntentService:** mock `OrderIntentService`, call `stageIntent()`, verify Firestore write. Call `submitIntent()`, verify status transitions STAGED → SUBMITTING → SUBMITTED. Call `retryIntent()`, verify same `refId` reused.
- **OrderStagingStore lifecycle:** test full lifecycle: stage → update → submit → fill. Test error path: submit → fail → retry → fill. Test cancel: submit → cancel. Test remove: stage → remove.
- **SignalOrderComponent + OrderStagingStore:** TestBed render with mocked store. Verify queue displays intents grouped by status. Verify selecting a row loads it into the ticket. Verify submit button triggers confirmation dialog. Verify confirm calls `submitIntent()`.
- **SignalReviewFacade staging:** mock `OrderStagingStore`, call `stageAcceptedOrders()`, verify one `EquityOrderIntent` per accepted decision with correct `signalContext` and `source: SIGNAL_PIPELINE`.
- **Account preference service:** mock Firestore, call `loadConfig()`, verify doc read. Call `saveConfig()`, verify doc write. Call `getAccounts()`, verify MCP tool called and filtered to `agentic_allowed: true`.

## Unit Tests

- **Order intent utils:**
  - `refId` generation: unique across multiple calls, deterministic when reused for retry
  - Validation: `EquityOrderIntent` requires `symbol`; `OptionOrderIntent` requires `legs`
  - Stop loss intent builder: produces `side: 'sell'`, `orderType: 'stop_market'`, `timeInForce: 'gtc'`
  - Target exit intent builder: produces `side: 'sell'`, `orderType: 'limit'`, `timeInForce: 'gtc'`
- **Order execution service:**
  - `submitEquityOrder`: calls `review_equity_order` (simulation) first, then `place_equity_order` with `ref_id`. Classifies network error as retryable. Classifies insufficient funds as non-retryable.
  - `cancelEquityOrder`: calls `cancel_equity_order` with order ID.
  - `reconcileOrder`: calls `get_equity_orders` with `ref_id`, maps response to reconciliation result.

## Test Seams

- Highest seam: TestBed component harness for `SignalOrderComponent` (verifies queue + ticket + submit flow)
- Mid seam: store + service integration with mocked Firestore service (verifies lifecycle state machine)
- Low seam: pure function tests for `order-intent.utils.ts` (refId, validation, builders)

## Existing Test Coverage

- `signal-review-ui.store.spec.ts` — covers the UI store for signal review. The staging wiring changes the facade, not the UI store, so this test should still pass.
- `occurrence-decision.store` has no dedicated spec — the persistence fix adds tests for the new `statusForSymbol()` and `statusCounts` computed.
- `triage.store` has no dedicated spec — the persistence fix adds tests for the Firestore wiring.
- Prior art for store + service mocking: `options-strategy-dashboard.store.spec.ts`, `spread-viewer.store.spec.ts`.
- Prior art for component TestBed: `signal-list.component.spec.ts`, `options-strategy-dashboard.component.spec.ts`.

## Edge Cases

- **Empty queue:** order workspace with no staged intents — shows empty state message.
- **Stuck intent reconciliation:** intent in SUBMITTING state on page reload — reconciliation queries Robinhood, determines actual state, updates accordingly.
- **Network failure during submit:** intent transitions to SUBMITTING, network fails, transitions to FAILED with `retryable: true`. User can retry.
- **Robinhood rejection:** order rejected for insufficient funds — intent transitions to FAILED with `retryable: false`. Retry button disabled.
- **No account configured:** order workspace prompts for account selection. Intents cannot be submitted until account is set.
- **Multiple intents same symbol:** queue shows multiple rows for the same symbol (entry + stop loss + target exit). Each is independent.
- **Refresh during submission:** intent stuck in SUBMITTING — reconciliation on next load determines actual state.
- **Review flag rollback:** `markForReview` succeeds in-memory but Firestore write fails — in-memory state reverts, snackbar shows error.

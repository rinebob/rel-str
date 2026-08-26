**Topic:** Savant Trader — order execution layer, persistence fixes, and rh-agent → savant-trader rename  
**Issue:** #180  
**Topic Parent:** #176  
**Domain:** SAVANT-TRADER  
**Type:** Implementation Plan  
**Area:** FE  
**Status:** Draft  
**Created:** 2026-08-24  
**Last Updated:** 2026-08-24  

---

## Scope

The FE area covers persistence fixes, the order staging store, the order workspace screen, signal pipeline wiring, account number preference, and order execution. Depends on SHARED completing first (rename + type model + collection paths).

## Modules

### 1. Persistence fix — collapse ephemeral decision status

**Problem:** `TriageStore` holds an ephemeral `statuses` map for ACCEPT/REJECT/CONSIDER/WATCH/PENDING. This map is never rehydrated from Firestore on page refresh. The durable decisions live in `OccurrenceDecisionStore` (Firestore-backed), but the UI reads from the ephemeral map.

**Solution:** Remove the `statuses` map from `TriageStore`. All decision status is derived from `OccurrenceDecisionStore`. The `TriageStore` retains only genuinely ephemeral UI state: review flags (now properly persisted), viewport mode, active list filter.

**Changes to TriageStore:**
- Remove `statuses` from state interface and initial state
- Remove `setStatus`, `setStatuses`, `setGroupStatus`, `acceptSymbol`, `considerSymbol`, `rejectSymbol`, `watchSymbol`, `resetSymbolStatus` methods
- Remove `acceptedSymbols`, `acceptedCount`, `statusCounts` computed values (these move to `OccurrenceDecisionStore` which already has `acceptedSymbols`, `acceptedCount`, `activeOrderDecisions`)
- Remove `clearEphemeralScreeningState` and `resetForRun` (or simplify to only clear review flags)
- Keep: `reviewFlags`, `reviewSymbols`, `reviewCount`, `loading`, `viewportMode`, `activeViewportList`, and all review flag methods (fixed in module 2)

**Changes to OccurrenceDecisionStore:**
- Add `statusCounts` computed (derives counts from `occurrenceDecisions` map)
- Add `statusForSymbol(symbol)` method — returns the decision type for a symbol from the durable store
- The store already has `acceptedSymbols`, `acceptedCount`, `activeOrderDecisions`, `activeOrderSymbols`

**Changes to consumers:**
- `SignalReviewFacade`: remove `triageStore.setStatus()` calls in `acceptSymbol`/`rejectSymbol`/`resetSymbol` — the durable store is already updated via `occurrenceStore.acceptSignals()`/`rejectSignals()`/`resetSymbol()`. Remove `statusCounts` delegation to triage store — use `occurrenceStore.statusCounts()` instead. Remove `considerSymbol`/`watchSymbol` ephemeral actions or convert them to durable decisions if needed (CONSIDER and WATCH are screening states, not durable decisions — they should stay ephemeral but not in the statuses map; they can be review flags or a separate ephemeral set).
- `ChartReviewComponent`: replace `triageStore.statuses()[symbol]` with `occurrenceStore.statusForSymbol(symbol)`. Replace `triageStore.setStatus()` calls with `occurrenceStore.acceptSignals()` / `rejectSignals()`.
- `GroupStore`: replace `triageStore.statuses()` reference with `occurrenceStore` derived status. The group store reads statuses to decorate rows — it should read from `OccurrenceDecisionStore` instead.
- `agent-order.component` (being deleted): no fix needed, replaced by order workspace.

**CONSIDER/WATCH handling:** These are ephemeral screening states, not durable decisions. They don't belong in `OccurrenceDecisionStore`. Options: (a) keep them as a separate ephemeral map in `TriageStore` (just not the `statuses` map that mixes durable and ephemeral), or (b) map CONSIDER to review flags. I recommend (a) — a separate `screeningStatuses` map in `TriageStore` for CONSIDER/WATCH only, clearly labeled as ephemeral. ACCEPT/REJECT/PENDING come from the durable store.

### 2. Persistence fix — wire review flag mutations to Firestore

**Problem:** `TriageStore.markForReview()`, `unmarkFromReview()`, `markGroupForReview()`, and `clearReviewFlags()` only update in-memory state. They bypass `TriageService` which has working Firestore methods (`setReviewFlag`, `clearReviewFlag`, `setReviewFlagsBatch`).

**Solution:** Wire each mutation method to call the corresponding Firestore service method. Optimistic update pattern: update in-memory first, then call the service; on error, revert and show snackbar.

**Changes:**
- `markForReview(symbol)`: patch state + call `triageService.setReviewFlag(symbol)`. On error, revert.
- `unmarkFromReview(symbol)`: patch state + call `triageService.clearReviewFlag(symbol)`. On error, revert.
- `markGroupForReview(symbols)`: patch state + call `triageService.setReviewFlagsBatch(symbols, true)`. On error, revert.
- `clearReviewFlags()`: patch state + call `triageService.setReviewFlagsBatch(allFlaggedSymbols, false)`. On error, revert.

**Review list storage change:** The review flags change from a collection (`rh-agent-review-flags/{symbol}`) to a single doc (`savant-trader/data/review-list`) with a symbols map. The `TriageService` methods must be updated to read/write the single doc instead of individual docs. The service interface stays the same (`setReviewFlag`, `clearReviewFlag`, `setReviewFlagsBatch`, `loadReviewFlags`); only the internal Firestore implementation changes.

### 3. Order staging store

**New module:** NgRx signal store, Firestore-backed, mirroring the `OccurrenceDecisionStore` pattern.

**State:**
```typescript
interface OrderStagingState {
  intents: Record<string, OrderIntent>;
  loading: boolean;
  error: string | null;
}
```

**Computed:**
- `stagedIntents` — intents with status STAGED or READY
- `submittingIntents` — intents with status SUBMITTING
- `activeIntents` — intents with status SUBMITTED (awaiting fill)
- `terminalIntents` — intents with status FILLED, FAILED, CANCELLED
- `intentsBySymbol` — grouped by symbol

**Methods:**
- `loadIntents()` — hydrate from Firestore on page load (all non-terminal intents)
- `stageIntent(intent: OrderIntent)` — write to Firestore + update store
- `updateIntent(id, partial)` — update Firestore + store (for configuration changes)
- `removeIntent(id)` — delete from Firestore + store (discard)
- `submitIntent(id)` — transition to SUBMITTING, call execution service, transition to SUBMITTED or FAILED
- `retryIntent(id)` — re-submit with same `refId`
- `cancelIntent(id)` — call execution service cancel, transition to CANCELLED
- `reconcileStuckIntents()` — on load, find intents stuck in SUBMITTING, query Robinhood order history to determine actual state

**Firestore:** `savant-trader/data/order-intents/{intentId}`. Each intent is a document. The store is the in-memory projection; Firestore is the durable source of truth. Optimistic updates with error rollback, same pattern as `OccurrenceDecisionStore`.

### 4. Order intent service

**New module:** Firestore CRUD service for order intents.

**Methods:**
- `createIntent(intent: OrderIntent): Observable<void>` — write to `savant-trader/data/order-intents/{id}`
- `updateIntent(id: string, partial: Partial<OrderIntent>): Observable<void>` — merge update
- `deleteIntent(id: string): Observable<void>` — delete doc
- `loadAllIntents(): Observable<OrderIntent[]>` — load all non-terminal intents
- `loadIntent(id: string): Observable<OrderIntent | null>` — load single intent

Uses the same `requireUserId` + injection context pattern as `TriageService`.

### 5. Order execution service

**New module:** Wraps `RobinhoodMcpObservationService` for order placement and cancellation.

**Methods:**
- `submitEquityOrder(intent: EquityOrderIntent): Promise<ExecutionResult>` — calls `place_equity_order` MCP tool with `ref_id` idempotency. Calls `review_equity_order` (simulation) as preflight first. Classifies errors as retryable vs. non-retryable.
- `cancelEquityOrder(orderId: string): Promise<void>` — calls `cancel_equity_order` MCP tool.
- `reconcileOrder(refId: string): Promise<ReconciliationResult>` — queries `get_equity_orders` with `ref_id` to determine actual state of a stuck intent.

**Error classification:** Parse Robinhood error responses to determine if retry is safe (network error, timeout → retryable; insufficient funds, invalid symbol → non-retryable). The existing `robinhood-tools.ts` catalog has mutation/simulation/financial-mutation classification that can inform this.

**Confirmation:** The service does NOT handle confirmation — that's the UI's responsibility. The service is called only after the user confirms in the ticket dialog.

### 6. Order workspace screen

**New module:** Master-detail screen at route `/signal-order`.

**Components:**
- `SignalOrderComponent` — top-level container, master-detail layout
- `OrderQueueComponent` — left panel, lists all staged intents grouped by status. Each row: source badge, symbol, side, order type, quantity, status. Clicking loads into ticket. Batch select + remove.
- `OrderTicketComponent` — right panel, full order configuration for selected intent. All Robinhood parameters editable (order type, quantity/dollar amount, limit price, stop price, time in force, market hours). Live preview of what will be sent. Submit button with confirmation dialog. Execution status feedback. Retry button on failure. Cancel button for submitted orders.

**Layout:** Same master-detail pattern as chart-review (split panel, queue on left, ticket on right).

**Account number display:** Shows the currently configured account number. If none configured, prompts the user to select one (calls `get_accounts`, filters to `agentic_allowed: true`, stores selection).

**"New Manual Order" button:** Placeholder only — opens a snackbar saying "Manual order entry coming soon". Dialog not built this Topic.

### 7. Account number preference

**New module:** Service to read/write the trading-config doc.

**Methods:**
- `loadConfig(): Observable<TradingConfig | null>` — read `savant-trader/data/trading-config`
- `saveConfig(config: TradingConfig): Observable<void>` — write to `savant-trader/data/trading-config`
- `getAccounts(): Observable<AccountInfo[]>` — calls `get_accounts` MCP tool, filters to `agentic_allowed: true`

**TradingConfig type:** `{ accountNumber: string, updatedAt: timestamp }`

The order workspace reads the config on load and pre-fills the account number in new intents. If no config exists, the workspace prompts the user to select an account.

### 8. Signal pipeline wiring

**Changes to SignalReviewFacade:**
- Replace `goToOrder()` navigation with `stageAcceptedOrders()` — pushes all accepted occurrence decisions as equity `OrderIntent`s into the staging store, then navigates to `/signal-order`.
- Each accepted decision becomes an `EquityOrderIntent` with:
  - `source: SIGNAL_PIPELINE`
  - `signalContext` populated from the occurrence decision
  - `side: 'buy'` (from direction — long = buy, short = sell)
  - `accountNumber` from trading-config preference
  - `status: STAGED`
  - `orderType`, `quantity`, `limitPrice`, etc. left undefined for user to configure
- The "Stage Accepted" action replaces the current "goToOrder" button.

**Changes to ChartReviewComponent:**
- Same "Stage Accepted" action available from chart-review. When the user accepts a signal in chart-review, it stages an intent in addition to persisting the durable decision.

### 9. Delete old code

- Rename `pages/agent-order/` → `pages/signal-order/` (the old `RhAgentOrderComponent` was rewritten in-place during FE-C1a/C1b/D1 as the new signal-order screen; directory name aligned to match the `/signal-order` route)
- Delete the `RhAgentService` facade (`rh-agent.service.ts` / `service.ts` after rename) — already removed during S1 rename tasks. No consumers remain.

## Dependencies

- Blocked by SHARED (rename + type model + collection paths must complete first)

## Risks

- **CONSIDER/WATCH handling:** These ephemeral screening states need a clear home after the `statuses` map is removed. The recommendation is a separate `screeningStatuses` map in `TriageStore`, but this needs validation during implementation.
- **GroupStore coupling:** `GroupStore` reads `triageStore.statuses()` to decorate rows. Changing this to read from `OccurrenceDecisionStore` changes the data flow — need to verify the group store's reactivity still works.
- **Stuck intent reconciliation:** Querying Robinhood order history by `ref_id` assumes the MCP tool supports filtering by `ref_id`. Needs verification against the tool catalog.
- **Simultaneous resting orders:** Open question from PRD — verify via `review_equity_order` simulation before relying on it.

**Topic:** Savant Trader — order execution layer, persistence fixes, and rh-agent → savant-trader rename  
**Issue:** #177  
**Topic Parent:** #176  
**Domain:** SAVANT-TRADER  
**Type:** PRD  
**Status:** Approved  
**Created:** 2026-08-23  
**Last Updated:** 2026-08-23  

---

## Problem Statement

The signal-review → chart-review → order pipeline is broken. Accepted signals dead-end at the order page with no execution buttons. The ephemeral triage status store (ACCEPT/REJECT/CONSIDER) is never rehydrated from the durable Firestore decisions on page refresh, so the UI loses all decision state on reload. Review flags are similarly broken — the store methods that add/remove flags bypass the Firestore service entirely, so flags never persist. The existing `rh-agent` nomenclature is outdated — the app has grown beyond its agent-driven origins into a full trading platform. Six root-level Firestore collections proliferate without structure. There is no central place to review and execute orders before placement, no fault-tolerant staging layer for order intents, and no way to place stop loss or target exit orders alongside entry orders.

## Solution

Build a durable, Firestore-backed order execution layer on top of the existing Robinhood MCP tool surface. Rename the `rh-agent` feature area to `savant-trader` (code, collections, routes, domain label). Fix the persistence breakages by collapsing ephemeral decision status into the durable decision store and wiring review flag mutations to their Firestore service. Create a unified `OrderIntent` model (discriminated union on `InstrumentType` enum) backed by a Firestore staging store with `ref_id` idempotency for crash recovery. Build an Order Workspace screen (queue + ticket, master-detail) where all staged intents are reviewed, configured, confirmed, and executed through the existing Robinhood MCP tools. Wire the signal pipeline to stage equity order intents on accept. Consolidate all Firestore data under a single `savant-trader/data/` container with subcollections. Migrate existing data last, after implementation is complete and the user has reviewed the data.

## User Stories

### Signal pipeline and persistence

1. As a trader, I want accepted signals to persist across page refreshes, so that I don't lose my review work when the browser reloads.

2. As a trader, I want review-flagged symbols to persist across page refreshes, so that my review queue survives a crash or reload.

3. As a trader, I want the ACCEPT/REJECT status I see in the UI to always reflect the durable Firestore decisions, so that there is never a discrepancy between what I see and what is saved.

4. As a trader, I want to accept a signal in signal-review or chart-review and have it appear in the order workspace queue, so that the pipeline flows end-to-end from signal discovery to order execution.

5. As a trader, I want the signal context (symbol, direction, signal type, bar date, timeframe) to pre-fill the order ticket, so that I don't re-enter information the signal already captured.

6. As a developer, I want decision status to come from a single durable Firestore-backed store, so that there is one source of truth and no ephemeral/durable divergence.

7. As a developer, I want review flag mutations to call the existing Firestore service, so that flags actually persist instead of being lost on refresh.

### Order staging and execution

8. As a trader, I want staged order intents to persist in Firestore, so that a page reload or browser crash doesn't lose the orders I've spent time configuring.

9. As a trader, I want each order intent to have a stable idempotency key (`ref_id`), so that a retry after a crash doesn't result in duplicate orders.

10. As a trader, I want to see all staged order intents in a queue on the left side of the order workspace, so that I can see the full picture of pending orders from all sources.

11. As a trader, I want to select an intent from the queue and see its full details in a ticket on the right side, so that I can review and configure the order before execution.

12. As a trader, I want to configure all Robinhood order parameters in the ticket (order type, quantity or dollar amount, limit price, stop price, time in force, market hours), so that I have full control over the order being placed.

13. As a trader, I want a confirmation dialog before any order is submitted, so that I never accidentally place a real-money order.

14. As a trader, I want to see the execution status of each order intent (staged → ready → submitting → submitted → filled / failed), so that I know where each order is in its lifecycle.

15. As a trader, I want to retry a failed order with the same `ref_id`, so that Robinhood deduplicates and I don't get double orders.

16. As a trader, I want to cancel a submitted order, so that I can pull back an order that hasn't filled yet.

17. As a trader, I want to remove a staged intent from the queue without executing it, so that I can discard orders I've decided not to place.

18. As a trader, I want to stage a stop loss order as a separate sell intent (stop_market or stop_limit, GTC) after my entry order, so that I can protect my position with a broker-held stop.

19. As a trader, I want to stage a target exit order as a separate sell intent (limit, GTC) after my entry order, so that I can take profit at a target price.

20. As a trader, I want to submit stop loss and target exit orders individually, so that I'm not dependent on order group support that Robinhood may not provide.

### Account selection

21. As a trader, I want to select my Robinhood account number once and have it stored as a preference, so that I don't have to re-enter it for every order.

22. As a trader, I want the stored account number to be used automatically in order placement, so that the workflow is seamless.

23. As a developer, I want the account number stored in Firestore (not source code), so that it's not committed to the repo and can be changed without a redeploy.

### Rename and structure

24. As a developer, I want the `rh-agent` feature area renamed to `savant-trader` throughout the codebase (directories, files, classes, routes, labels), so that the nomenclature reflects what the app actually is.

25. As a developer, I want all Firestore collections consolidated under `savant-trader/data/` with subcollections, so that root-level collection proliferation is eliminated.

26. As a developer, I want the rename to happen first before new feature code is written, so that new code lives in the correct directory from the start and there are no cross-feature-area imports.

27. As a developer, I want the data migration from old `rh-agent-*` collections to `savant-trader/data/*` to happen last, so that I can review the data and delete anything I don't want migrated before the move.

28. As a developer, I want old `rh-agent-*` collections deleted after migration is verified, so that there is no hybrid state with data in two places.

29. As a developer, I want file and class names inside `savant-trader/` to have no prefix (the directory is the namespace), so that names are clean and not triple-namespaced.

30. As a developer, I want the domain label to be `SAVANT-TRADER` (replacing both `RH-AGENT` and `RH-ACTUAL`), so that the domain, code directory, and collection namespace are consistent.

## Implementation Decisions

### Feature area rename

- Rename `src/app/features/rh-agent/` → `src/app/features/savant-trader/`.
- Rename files: drop `rh-agent-` prefix entirely. No `st-` prefix either — the directory is the namespace. Examples: `rh-agent-triage.service.ts` → `triage.service.ts`, `RhAgentTriageService` → `TriageService`, `rh-agent.types.ts` → `types.ts`.
- Rename classes: drop `RhAgent` prefix. Examples: `RhAgentOccurrenceDecisionStore` → `OccurrenceDecisionStore`, `RhAgentGroupStore` → `GroupStore`.
- Rename component selectors where they contain `rh-agent` or `agent`. Generic selectors (`app-signal-list`, `app-trade-row`) stay unchanged.
- Rename routes: `/rh-agent` → `/run-dashboard`, `/rh-agent-order` → `/signal-order`, `/rh-agent-triage-report` → `/signal-action-report`, `/rh-agent-observation` → `/rh-account-inquiry`, `/rh-agent-backtest` → `/strategy-backtest`.
- Rename page directories: `agent-dashboard/` → `run-dashboard/`, `agent-triage-report/` → `triage-report/`, `observation-dashboard/` → `rh-account-inquiry/`.
- Rename the domain label from `RH-AGENT` (and `RH-ACTUAL`) to `SAVANT-TRADER` in `project-config.json` and on GitHub.
- The rename is mechanical (find-and-replace on import paths, route definitions, selectors). No logic changes. Done first, verified with existing test suite, before any new feature code.

### Persistence fixes

- **Collapse ephemeral decision status into the durable store.** The `TriageStore` no longer holds an ephemeral `statuses` map for ACCEPT/REJECT/CONSIDER. All decision status comes from the `OccurrenceDecisionStore` (Firestore-backed). The `TriageStore` retains only genuinely ephemeral UI state: review flags (now properly persisted), viewport mode, active list filter.
- **Fix review flag persistence.** The `TriageStore` mutation methods (`markForReview`, `unmarkFromReview`, `markGroupForReview`, `clearReviewFlags`) must call the corresponding `TriageService` Firestore methods (`setReviewFlag`, `clearReviewFlag`, `setReviewFlagsBatch`). The service methods already exist — the store just bypasses them. This is a wiring fix.
- **Rehydrate on page load.** Pages that display decision status (signal-review, chart-review) load durable decisions from Firestore on entry via `OccurrenceDecisionStore.loadDecisionsForRun()`, and derive UI status from them. No ephemeral status map to rehydrate — the durable store is the source of truth.

### Order intent model

- `OrderIntent` is a discriminated union with an `InstrumentType` enum discriminant:

```typescript
enum InstrumentType { EQUITY = 'equity', ETF = 'etf', OPTION = 'option' }
enum OrderIntentStatus { Staged, Ready, Submitting, Submitted, Filled, Failed, Cancelled }
enum OrderSource { SignalPipeline, Manual, PositionManagement }

interface BaseOrderIntent {
  id: string;                    // UUID
  refId: string;                 // Robinhood idempotency key — generated at staging, reused on retry
  source: OrderSource;
  sourceRef?: { type: string; id: string };  // link to origin (e.g., occurrence decision id)
  status: OrderIntentStatus;
  accountNumber: string;
  side: 'buy' | 'sell';
  orderType: 'market' | 'limit' | 'stop_market' | 'stop_limit';
  timeInForce: 'gfd' | 'gtc';
  marketHours: 'regular_hours' | 'extended_hours' | 'all_day_hours';
  signalContext?: {              // present when source = SignalPipeline
    signalType: string;
    barDate: string;
    timeframe: string;
    direction: string;
    decisionId: string;
  };
  createdAt: string;
  updatedAt: string;
  error?: { message: string; code?: string; retryable: boolean };
  result?: { orderId?: string; state?: string; fillPrice?: string; filledQuantity?: string };
}

interface EquityOrderIntent extends BaseOrderIntent {
  instrumentType: InstrumentType.EQUITY;
  symbol: string;
  quantity?: string;             // shares (decimal string)
  dollarAmount?: string;         // notional (market only)
  limitPrice?: string;
  stopPrice?: string;
  taxLots?: TaxLotSelection[];
}

interface EtfOrderIntent extends BaseOrderIntent {
  instrumentType: InstrumentType.ETF;
  symbol: string;
  quantity?: string;
  dollarAmount?: string;
  limitPrice?: string;
  stopPrice?: string;
  taxLots?: TaxLotSelection[];
}

interface OptionOrderIntent extends BaseOrderIntent {
  instrumentType: InstrumentType.OPTION;
  legs: OptionLeg[];
  quantity: string;              // contracts (positive integer string)
  price?: string;                // limit price per contract
  stopPrice?: string;
}

type OrderIntent = EquityOrderIntent | EtfOrderIntent | OptionOrderIntent;
```

- `EquityOrderIntent` and `EtfOrderIntent` are implemented in this Topic. `OptionOrderIntent` is defined but not wired — extension point for future option order work. ETFs and equities share the same order schema (same `place_equity_order` MCP tool) but are distinct instrument types — ETFs have no company fundamentals (earnings, filings, analysts).
- Stop loss intents: `EquityOrderIntent` with `side: 'sell'`, `orderType: 'stop_market' | 'stop_limit'`, `stopPrice: X`, `timeInForce: 'gtc'`.
- Target exit intents: `EquityOrderIntent` with `side: 'sell'`, `orderType: 'limit'`, `limitPrice: X`, `timeInForce: 'gtc'`.

### Order staging store

- NgRx signal store, Firestore-backed, mirroring the proven pattern from `OccurrenceDecisionStore`.
- Firestore collection: `savant-trader/data/order-intents/{intentId}`.
- Each intent is a Firestore document. The NgRx store is the in-memory projection; Firestore is the durable source of truth.
- `refId` is generated at staging time (UUID) and persisted. Reused on every retry — never regenerated.
- Lifecycle transitions update both the NgRx store (optimistic) and Firestore (durable).
- On page load, the store hydrates from Firestore — all non-terminal intents are loaded.
- Intents stuck in `Submitting` on reload are flagged for reconciliation (query Robinhood order history with `ref_id` to determine actual state).

### Order workspace screen

- Single route: `/signal-order`.
- Master-detail layout: order queue on the left, order ticket on the right (same pattern as chart-review).
- **Order queue (left):** lists all staged intents grouped by status and/or instrument type. Each row shows source badge, symbol, side, order type, quantity, status. Clicking a row loads it into the ticket. Batch actions: select multiple → remove.
- **Order ticket (right):** full order configuration for the selected intent. All Robinhood parameters editable. Live preview of what will be sent. Confirmation dialog before execution. Execution status feedback with error display and retry button.
- "New Manual Order" button placeholder (dialog not built this Topic — future task).

### Signal pipeline wiring

- Signal-review and chart-review "accept" actions stage an equity `OrderIntent` in the staging store with `source: SignalPipeline` and `signalContext` populated from the accepted occurrence decision.
- The intent starts with `status: Staged` and pre-filled fields (symbol, side from direction, account number from stored preference). Order type, quantity, limit price, etc. are left for the user to configure in the ticket.
- A "Stage Accepted" action (replacing or augmenting the current "goToOrder" navigation) pushes all accepted decisions as intents.
- The existing `/rh-agent-order` page (`agent-order/`) is replaced by the order workspace. The old page is deleted.

### Execution

- Calls the existing Robinhood MCP tools (`place_equity_order`, `cancel_equity_order`) through the existing `/api/rh/tools/{name}` endpoints via `RobinhoodMcpObservationService`.
- `order-execution.service.ts` wraps the MCP service, handling the `ref_id` idempotency, error classification (retryable vs. non-retryable), and status updates to the staging store.
- Confirmation dialog before any financial mutation (the Robinhood tool description requires explicit user confirmation).
- `review_equity_order` (simulation) is called as a preflight check before `place_equity_order` to surface pre-trade alerts.

### Account number storage

- Stored in Firestore at `savant-trader/data/trading-config` as a single document: `{ accountNumber: string, updatedAt: timestamp }`.
- User selects it once (from `get_accounts` results, filtered to `agentic_allowed: true`). Stored as a preference.
- The order workspace reads it on load and pre-fills it in order intents.
- Not a credential — the Robinhood OAuth credential bundle is handled separately via environment variables.
- Future extension: `accounts` array with `activeAccountNumber` for multi-account support.
- Redacted in logs per the existing `robinhood-response-redactor.ts`.

### Collection structure

```
savant-trader/                              (root collection)
  data/                                     (container doc)
    occurrence-decisions/                   (subcollection — migrated from rh-agent-occurrence-decisions)
    order-intents/                          (subcollection — NEW)
    review-list                             (doc — single doc with symbols map, replaces rh-agent-review-flags)
    symbol-lists/                           (subcollection — migrated from rh-agent-symbol-lists)
    symbol-meta/                            (subcollection — migrated from rh-agent-symbol-meta)
    runs/                                   (subcollection — migrated from rh-agent-runs)
    trading-config                          (doc — account number preference)
```

- `rh-agent-triage-decisions` collection is deleted (ephemeral triage was never persisted; the durable decisions are in `occurrence-decisions`).
- Review flags change from a collection (`rh-agent-review-flags/{symbol}`) to a single doc (`savant-trader/data/review-list`) with a symbols map. Simpler, fewer documents, no collection proliferation.
- Migration script runs last, after implementation is complete. User reviews data and deletes anything unwanted before migration. Old collections deleted after migration is verified.

### Domain label

- `SAVANT-TRADER` replaces `RH-AGENT` and `RH-ACTUAL` in `project-config.json` `domainLabels` and on GitHub.
- The `RH-AGENT-OBSERVATION` domain label is also replaced by `SAVANT-TRADER`.

## Testing Decisions

- **What makes a good test:** test external behavior, not implementation details. The staging store's public API (stage, update, submit, retry, cancel, remove) is the test boundary. The order execution service's API (submit, cancel, reconcile) is the test boundary.
- **Staging store:** test the lifecycle state machine — stage → configure → submit → fill, and the error/retry path — submit → fail → retry → fill. Verify `ref_id` is preserved across retries. Verify Firestore persistence (mock the Firestore service, verify write calls). Prior art: `OccurrenceDecisionStore` tests, `signal-review-ui.store.spec.ts`.
- **Persistence fix:** test that review flag mutations call the Firestore service (spy on the service, verify method calls). Test that decision status is derived from the durable store, not an ephemeral map. Prior art: existing store spec patterns in `stores/`.
- **Order intent utils:** test `ref_id` generation (uniqueness, determinism on retry), validation (required fields per instrument type), and the stop loss / target exit intent builders.
- **Order workspace component:** test queue rendering (grouping by status), ticket rendering (parameter display), and the confirm → submit flow. Prior art: `chart-review.component` test patterns.
- **Rename verification:** the existing test suite must pass after the rename with no logic changes. This is the primary verification that the rename is purely mechanical.

## Out of Scope

The following are explicitly out of scope for this Topic but are tracked as follow-up tasks to be picked up once this implementation is stable:

1. **Positions screen** — manage existing positions (close, adjust stops/targets). The `OrderIntent` model and staging store support it, but no UI is built.
2. **Manual new order dialog** — a global button + dialog for ad-hoc order entry from anywhere in the app. Button placeholder exists on the order workspace; dialog not built.
3. **Option orders from strategy builder** — stage option intents from strategy instances with full review. `OptionOrderIntent` type is defined but not wired.
4. **Option orders from signal pipeline** — extend signal acceptance to allow choosing option instrument type in the ticket. Deferred until equity flow is stable.
5. **Portfolio results page** — performance reporting and P&L visualization. Extension point left open in the data model and feature area structure.

## Further Notes

### Open question: Robinhood simultaneous resting orders

Robinhood MCP does not expose order groups (OCO/OTO/bracket). Stop loss and target exit orders are staged as separate individual `OrderIntent`s. Whether Robinhood allows multiple resting orders (e.g., a GTC stop sell AND a GTC limit sell) on the same symbol simultaneously is not confirmed from the tool catalog or existing documentation. The `RH-AGENT-DIRECT-MCP-EXECUTION-WORKFLOW` doc lists "one order at a time" as a Phase A system constraint, not a confirmed Robinhood platform limitation.

**Verification step:** before relying on simultaneous resting orders, test with `review_equity_order` (simulation — safe, no real order placed) for two sell orders on the same symbol. If Robinhood rejects the second, the user submits them one at a time as described in the user stories.

### Existing code reuse

- `RobinhoodMcpObservationService` — reused as-is for tool execution.
- `robinhood-tools.ts` tool catalog — reused as-is (mutation/simulation/financial-mutation classification already exists).
- `TradeRowComponent` — may be reused or adapted for the order queue display.
- `OccurrenceDecisionStore` pattern — the staging store mirrors its Firestore-backed NgRx signal store pattern (optimistic updates, error rollback, durable persistence).
- `TriageService` — the Firestore methods for review flags already exist and work; only the store wiring is broken.

### Existing code to delete

- `pages/agent-order/` (the old `RhAgentOrderComponent`) — replaced by `signal-order/`.
- The facade `rh-agent.service.ts` (`RhAgentService`) — thin delegation layer with no unique logic. Consumers inject focused services directly.
- `rh-agent-triage-decisions` Firestore collection — ephemeral triage was never persisted to this collection in practice.

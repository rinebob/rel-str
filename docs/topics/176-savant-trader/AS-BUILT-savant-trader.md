**Topic:** Robinhood Trading UI  
**Issue:** #176  
**Topic Parent:** #176  
**Status:** Complete  
**Created:** 2026-09-08  
**Last Updated:** 2026-09-08  

---

## As-Built: Savant Trader Order Placement

### What was built

The Savant Trader order placement system allows users to accept trading signals, configure orders, submit them to Robinhood, and track their lifecycle through to fill and protection.

### Architecture

**Order Ticket (write-once model per ADR-008):**
- One Firestore document per accepted signal/order proposal in `savant-trader/data/order-intents`
- Stores signal context, refId (idempotency key), proposed order terms, and the initial RH order ID
- After submission, Robinhood is authoritative for order state, fills, positions, and stops
- No local lifecycle tracking after submission — no reconciliation, no broker order mirrors

**Signal Order Page (`/signal-order`):**
- Left panel: `OrderQueueComponent` — lists all tickets grouped by status (Staged, Submitting, Submitted, Queued, Resting, Open Positions, Failed, Cancelled)
- Right panel: `OrderTicketComponent` — full order configuration with live preview, submit with confirmation dialog, stop-loss placement, fractional close
- Merges local ticket state with live RH order state for display (read-only merge, never persisted)

**Key services:**
- `OrderTicketService` — Firestore CRUD for tickets, generic `undefined`→`deleteField()` deletion
- `OrderExecutionService` — submits equity orders to RH via MCP (preflight review + place with ref_id idempotency)
- `OrderTicketStore` — NgRx signal store with optimistic updates and submit concurrency guard
- `SignalReviewFacade` — connects signal acceptance/rejection to ticket staging

**Shared utilities:**
- `broker-order.util.ts` — shared RH order parsing, normalization to `BrokerOrderSnapshot`, active stop-loss detection
- `stop-loss-ticket.util.ts` — builds stop-loss and fractional-close ticket objects
- `order-guardrails.util.ts` — preflight order validation

### Architecture decisions

- **ADR-006:** Order Ticket single-collection model (one Firestore collection for all tickets)
- **ADR-007:** Broker-authoritative order reconciliation (superseded by ADR-008)
- **ADR-008:** Order Ticket write-once model — replaces the Trading Case aggregate with a lightweight provenance document. RH is authoritative for all post-submission lifecycle state.

### Deviations from original design

1. **Trading Case aggregate removed:** The original design (PRD-savant-trader-broker-authoritative-order-reconciliation.md) called for a full Trading Case aggregate with broker order mirrors, reconciliation module, and projection adapter. This was superseded by ADR-008's write-once model after the user determined that lifecycle duplication with Robinhood was unnecessary.

2. **Reconciliation removed:** The broker-authoritative reconciliation architecture (ADR-007) was removed. RH state is read directly at display time via `mergeWithRhOrder` — a read-only merge that never persists back to Firestore.

3. **Nomenclature changed:** `OrderIntent` was renamed to `OrderTicket` throughout. The physical Firestore collection `st_order_intents` retains its name for backward compatibility.

4. **Pre-submission transitions allowed:** ADR-008 was updated to document that `STAGED → SUBMITTING → SUBMITTED` transitions are persisted, and cancel-and-modify can revert a submitted ticket to STAGED.

### Deferred items

- Component decomposition: `order-ticket.component.ts` (893 lines) and `order.component.ts` (446 lines) exceed the 400-line smell threshold
- View model separation: `OrderTicket` is overloaded as a UI view model for broker positions and stop orders
- Deduplicate `parseBrokerOrder` in `order-execution.service.ts` with shared `normalizeToBrokerOrderSnapshot`
- Dead `ticketStaged` output in `order-ticket.component.ts`
- `saveEdits` quantity-zero edge case in `onRetry`
- Residual staged stop-loss submit path (`onSubmitStopLossTicket`)

### Commits

- `6bcd38b` 176-241_SHARED-IMPL-SAVANT-TRADER: Remove Trading Case contracts, add broker-types
- `7141152` 176-241_BE-IMPL-SAVANT-TRADER: Update broker normalizer/adapter for broker-types
- `92fbabc` 176-241_FE-IMPL-SAVANT-TRADER: Order Ticket write-once model + intent→ticket rename
- `577e0c7` 176-241_BE-CHORE-SAVANT-TRADER: Add broker MCP verification scripts
- `c86fe0d` 176-241_CONFIG-CONFIG-SAVANT-TRADER: Remove trading-case alias, exclude scripts/verify
- `35ce8a1` 176-241_DOCS-DOCS-SAVANT-TRADER: Add ADR-008, review docs, and update domain model
- `afff7cd` 176-241_DOCS-DOCS-SAVANT-TRADER: Add changelog entries for #241 ship

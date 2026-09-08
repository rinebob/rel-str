# ADR-008: Order Ticket replaces Trading Case aggregate

**status:** accepted  
**issue:** #241  
**topic parent:** #176  
**date:** 2026-09-07  
**decision owners:** savant-trader  
**supersedes:** ADR-007 (broker-authoritative order reconciliation — Trading Case model)

## context

ADR-007 introduced Trading Cases as the lifecycle aggregate for one accepted signal. The model included:

- a root Order Ticket with proposed terms and provenance;
- a mutable Case Summary tracking entry state, fill state, and protective-stop state;
- Broker Order mirrors stored in a subcollection per case;
- a reconciliation module merging Firestore cases with RH orders and positions;
- a projection adapter mapping the reconciliation snapshot back to the legacy OrderIntent shape;
- broker-position adoption for unmatched positions;
- migration from `st_order_intents` to Trading Cases.

The goal was sound: preserve signal provenance and keep RH authoritative for broker state. But the implementation introduced significant complexity:

- two sources of truth (Firestore Trading Cases + RH orders/positions) requiring reconciliation;
- a projection adapter translating between the snapshot and the legacy queue shape;
- competing position hydration paths (`hydrateBrokerPositions` vs reconciliation module);
- duplicate row suppression logic at the UI merge layer;
- migration logic to convert legacy intents into cases;
- adoption logic to create cases for broker positions with no local signal;
- Case Summary lifecycle tracking that duplicated state RH already provides.

The intermediate state — maintaining both legacy `st_order_intents` and Trading Cases through a projection adapter — created sustained churn without delivering value. The reconciliation merge was the root cause of duplicate rows, vanishing positions, and stale failures.

## decision

Replace the Trading Case aggregate with a lightweight **Order Ticket** — one Firestore document per accepted signal that results in an order submission. RH remains authoritative for orders, positions, fills, and stops. Firestore stores only the signal-to-order link for provenance.

### Order Ticket

```text
st_signal_entries/{entryId}
{
  id:           "SCHB-ENTRY-2026-09-04-FRI",
  refId:        "uuid",              // idempotency key for RH submission
  rhOrderId:    "rh-order-123",      // filled in once after submission, then never updated
  symbol:       "SCHB",
  side:         "buy",
  accountNumber: "...",
  signalContext: { signalType, barDate, timeframe, direction, decisionId },
  submittedAt:  null,
  createdAt:    "..."
}
```

One collection. One record per accepted signal that results in an order. Written at staging, updated for pre-submission workflow transitions (`STAGED → SUBMITTING → SUBMITTED`, or revert to `STAGED` on failure/cancel-and-modify), then immutable after `rhOrderId` is recorded. No post-submission lifecycle tracking, no fill results, no stop order IDs. The doc sits in Firestore as a permanent provenance record for signal success analysis.

**No separate docs for stops, fractional closes, or other child orders.** RH is authoritative for all order state. The UI reads RH directly for order lifecycle, positions, fills, and stops.

### source-of-truth matrix (revised)

| fact | authoritative source | firestore role |
|---|---|---|
| signal acceptance | Order Ticket | durable local decision |
| signal context / provenance | Order Ticket | preserve why the order was placed |
| proposed terms before submission | Order Ticket | editable terms |
| order lifecycle (queued, filled, cancelled) | Robinhood | not tracked locally |
| current position (quantity, avg cost) | Robinhood | not stored locally |
| protective stop existence and terms | Robinhood | not tracked locally |
| fill price and quantity | Robinhood | not stored locally |
| signal success analysis | derived from entry records + RH order history | query entry records by signal type, date, symbol |

### page responsibilities

**Signal Order page** (signal processing):
- Shows staged entries (local, not yet submitted) and submitted entries (waiting for fill or stop placement).
- An entry graduates off this page only after the entry order is filled AND a protective stop is placed (and in the future, a target exit is placed). The entry is "supported" when all post-fill orders are in place.
- Once supported, the entry remains in Firestore as a provenance record but no longer appears in the active signal-order queue.

**Position Management page** (new, future task):
- Reads RH positions directly (authoritative).
- Reads RH open orders directly (authoritative) — including stops and queued orders.
- Joins Order Tickets by symbol + rhOrderId to display provenance: "This SCHB position was opened by TREND_RIDER_V2 on 2026-09-04."
- Manages stops, fractional closes, and future target exits against RH directly.

### what is removed

- Trading Case aggregate and root Order Ticket model.
- Case Summary lifecycle tracking.
- Broker Order Mirror repository and subcollections.
- Reconciliation module (`ReconciliationModuleService`).
- Projection adapter (`snapshotToIntents`).
- `hydrateBrokerPositions` legacy position hydration.
- Broker-position adoption workflow.
- Migration from `st_order_intents` to Trading Cases.
- Local lifecycle status tracking on entry docs after submission (no `submitted → filled → cancelled` transitions — RH is authoritative for post-submission state).
- Local docs for stop-loss orders, fractional-close orders, and other child orders.
- `applyReconciliationResult` and `reconcileIntent` — the UI reads RH directly for order state.

### what is kept

- Signal provenance link (Order Ticket) — written at staging, updated for pre-submission workflow transitions, then immutable after `rhOrderId` is recorded.
- RH as authoritative for orders, positions, fills, and stops.
- `st_order_intents` collection (renamed conceptually to Order Tickets; physical collection name stays).
- Order submission flow (stage → submit → record RH order ID → done).

## consequences

### positive

- One source of truth for broker state (RH). No reconciliation merge.
- No projection adapter or translation layer.
- No duplicate rows from competing position hydration paths.
- Signal provenance is preserved in a simple, queryable collection.
- Signal success analysis is straightforward: query entry records, cross-reference RH order/position history.
- Add-on positions are trivial — multiple entry records for the same symbol, RH handles aggregation.
- Significantly less code to maintain and test.
- The signal-order page has a clear graduation criterion: filled + stop placed = supported = graduates.

### negative

- No per-signal lifecycle tracking beyond the entry record. If you want to know "signal A's stop was triggered on date X," you derive it from RH order history, not from a local case summary.
- No local mirror of broker orders. If RH is unavailable, you cannot see order history. Acceptable — RH unavailability is rare and temporary.
- No "case" concept for grouping an entry, its stop, and future exits. They are linked by symbol and RH order IDs, not by a parent document. Acceptable — the link is sufficient for analysis.
- Existing `st_order_intents` records need to be treated as Order Tickets going forward. The shape is close enough that a rename + field additions are sufficient; no migration script is needed.

## rejected alternatives

### full trading case aggregate (ADR-007)

Rejected because the lifecycle aggregate, broker order mirrors, case summaries, and reconciliation projection introduced complexity that exceeded the value of per-signal lifecycle tracking. The intermediate state of maintaining both legacy intents and trading cases through a projection adapter created sustained churn without delivering the intended broker-authoritative UX.

### robinhood-only with no local records

Rejected because signal provenance — "I bought this because of signal X" — does not exist at RH. Without a local record, signal success analysis is impossible.

### trading cases without reconciliation

Rejected because keeping the case aggregate but removing reconciliation still requires matching cases to RH orders/positions for display. The matching logic is the complexity; removing the reconciliation module but keeping cases just moves the problem.

## invariants

1. One Order Ticket per accepted signal that results in an order submission.
2. RH is authoritative for order state, position state, fills, and stops.
3. The Order Ticket stores the signal-to-order link and a minimal pre-submission status. It does not track broker lifecycle after submission, fill results, or stop order IDs.
4. The Order Ticket is written once at staging and updated for pre-submission workflow transitions only (`STAGED → SUBMITTING → SUBMITTED`, or revert to `STAGED` on failure/cancel-and-modify). After `SUBMITTED` is persisted with the `rhOrderId`, the record is not updated again. RH is authoritative for all subsequent state.
5. No separate Firestore docs are created for stop-loss orders, fractional-close orders, or other child orders. RH is the sole source for these.
6. Multiple entry records for the same symbol are independent. RH handles position aggregation.
7. The Order Ticket's `refId` is the idempotency key for RH submission. It is immutable.
8. The `rhOrderId` (stored as `result.orderId`) is filled in after successful submission. It is immutable once set.

## migration

The existing `st_order_intents` collection is close in shape to the Order Ticket. The migration is conceptual, not physical:

- Treat `st_order_intents` as Order Tickets going forward.
- Stop writing post-submission lifecycle status updates, fill results, and child-order docs to Firestore.
- Stop reading from Firestore for order state — read RH directly.
- Remove the Trading Case repository, broker order mirror repository, reconciliation module, and projection adapter from the codebase.
- Remove `hydrateBrokerPositions` from the staging store.
- Remove `applyReconciliationResult` and `reconcileIntent` from the staging store.
- The signal-order page reads Order Tickets (for provenance) and RH (for order/position state) directly.

No data migration script is needed. Existing records remain valid as historical provenance. New records use the same collection with the simplified shape.

## references

- `CONTEXT.md` — Order Ticket, Broker Order, Fill, Position, Protective Stop
- `docs/adr/ADR-006_order-ticket-single-collection.md` (superseded by ADR-007, now effectively restored in spirit)
- `docs/adr/ADR-007_broker-authoritative-order-reconciliation.md` (superseded by this ADR)
- `docs/topics/176-savant-trader/PRD-savant-trader-broker-authoritative-order-reconciliation.md` (to be updated)
- `docs/topics/176-savant-trader/IMPL-savant-trader-broker-authoritative-order-reconciliation-fe.md` (to be updated)

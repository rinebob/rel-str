# ADR-007: Broker-authoritative order reconciliation

**status:** accepted  
**issue:** #212  
**topic parent:** #176  
**date:** 2026-09-05  
**decision owners:** savant-trader

## context

Savant Trader has three different kinds of trading data:

1. local decisions and proposed order terms created when a signal is accepted;
2. Robinhood Broker Orders created after explicit Order Authorization;
3. current Robinhood Positions held in the configured account.

The current implementation stores local order intents in Firestore and also hydrates broker positions into the same queue map. Robinhood order responses are then copied into those local records. Because these records have different identities and authorities, asynchronous loading can replace one source's rows with another source's rows. This has caused filled positions to disappear, stale failed states to survive, and duplicate stop-loss rows to represent one broker transaction.

The domain glossary already defines an Order Ticket as the local accepted-signal record and a Broker Order as the Robinhood instruction. The implementation must preserve that distinction.

## decision

Use a split source-of-truth model:

- Firestore is authoritative for the local Order Ticket until a broker order ID exists.
- Robinhood is authoritative for Broker Order identity, broker lifecycle, accepted terms, fills, and current Positions after submission.
- Firestore stores a durable mirror of every observed Broker Order and retains local metadata that Robinhood does not provide.
- The queue is built from a reconciliation projection that merges the two authorities and current Positions.

A Broker Order is keyed by account plus broker order ID. A Position is keyed by account plus symbol. Symbol alone is never a Broker Order identity.

## consequences

### positive

- Robinhood state cannot be overwritten by stale local Firestore status.
- Filled positions remain visible regardless of source completion order.
- Broker responses can be audited and reprocessed.
- A broker order discovered without a local ticket can be surfaced instead of silently ignored.
- Local signal context, authorization, and parent/child metadata remain durable.
- Protective Stops can be displayed once as Broker Orders while the parent Position shows protection metadata.
- Reconciliation becomes one deep module and one test seam rather than logic distributed across page components and stores.

### negative

- The system needs separate local-ticket, broker-order, and position models.
- The queue requires a reconciliation projection instead of reading one Firestore collection directly.
- Some records can temporarily be unmatched or ambiguous.
- Existing `order-intents` documents require migration or an adapter.
- Broker snapshots increase Firestore storage and require retention rules.

## rejected alternatives

### firestore as permanent lifecycle authority

Rejected because Firestore can contain stale optimistic states after network loss, browser termination, or a broker response that was accepted but not persisted.

### robinhood-only queue

Rejected because staged Order Tickets, signal context, user authorization, and local parent relationships do not exist at Robinhood.

### one merged document with no authority distinction

Rejected because placing local metadata, optimistic state, broker state, and current positions in one undifferentiated record creates ambiguity about which field wins.

### symbol-keyed orders

Rejected because one symbol can have multiple entries, exits, Protective Stops, retries, and historical Broker Orders.

## invariants

1. A broker order ID is immutable once assigned.
2. A Broker Order mirror is upserted by account plus broker order ID.
3. A local Order Ticket may exist without a Broker Order.
4. A Broker Order may exist without a local Order Ticket and must be marked unmatched.
5. A Position is not a Broker Order.
6. A missing broker response does not prove submission failure.
7. A retry never generates a new ref ID unless a new user-authorized order is intentionally created.
8. One queue row represents one Broker Order or one Position projection.
9. A Protective Stop is rendered once as a Broker Order; the parent Position displays a protected indicator.
10. Raw broker state is retained even when a derived domain state is used for UI grouping.

## migration

The first implementation may adapt the existing `order-intents` collection while introducing normalized Broker Order mirrors. The long-term target is:

```text
savant-trader/data/trading-cases/{caseId}
savant-trader/data/trading-cases/{caseId}/broker-orders/{humanReadableBrokerOrderId}
```

The case document holds the root Order Ticket and mutable Case Summary. Broker Order documents hold one durable mirror per actual Robinhood order; the mirror repository upserts by account plus the immutable external broker order ID even though the Firestore document ID is human-readable.

Existing records must be reviewed and reconciled against Robinhood before legacy records are archived or deleted.

## references

- `CONTEXT.md` — Order Ticket, Broker Order, Fill, Position, Protective Stop
- `docs/adr/ADR-006_order-ticket-single-collection.md`
- `docs/topics/176-savant-trader/PRD-savant-trader-broker-authoritative-order-reconciliation.md`
- `docs/topics/176-savant-trader/IMPL-savant-trader-broker-authoritative-order-reconciliation.md`

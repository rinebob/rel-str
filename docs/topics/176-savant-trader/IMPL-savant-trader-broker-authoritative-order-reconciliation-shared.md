**topic:** savant trader — broker-authoritative order reconciliation  
**issue:** #225  
**topic parent:** #176  
**domain:** savant-trader  
**type:** implementation plan  
**area:** shared  
**status:** approved  
**created:** 2026-09-05  
**last updated:** 2026-09-06

---

## scope

Define the shared domain model, lifecycle states, collection paths, identity rules, and normalized interfaces used by the broker adapter and frontend reconciliation module.

## modules

### Trading Case model

Add types for:

- `TradingCase`
- `OrderTicket`
- `CaseSummary`
- `SymbolPosition`
- `BrokerOrder`
- `BrokerOrderMirror`
- `ReconciliationSnapshot`
- unmatched broker-order rows

The root case is created for each root Order Ticket. Child Broker Orders are keyed by broker order ID. Symbol Positions are aggregate account/symbol projections and are not Broker Orders.

### lifecycle model

Define shared derived states:

```text
local_only
submitting
submitted
queued
resting
partially_filled
filled
cancelled
expired
rejected
failed
pending
unclassified
```

Preserve raw Robinhood state separately. Partial fills preserve requested, cumulative, and remaining quantities without introducing a full equity/ETF partial-fill workflow.

### broker order roles

Define roles for:

```text
entry
protective_stop
fractional_close
replacement
future_target_exit
unmatched
```

Target exits remain a stub in this milestone.

### identity rules

- Trading Case: `caseId`
- Root Order Ticket: ticket ID within the case
- Broker Order authority: account plus immutable broker order ID
- Firestore Broker Order document: human-readable local document ID
- Position: account plus symbol
- Local-to-broker linkage: broker order ID, ref ID, and case ID

The human-readable document ID is for console/UI traceability. The broker order ID is the idempotent authority for upsert and reconciliation. Symbol must never be used as a Broker Order identity.

### Firestore paths

Target paths:

```text
savant-trader/data/trading-cases/{caseId}
savant-trader/data/trading-cases/{caseId}/broker-orders/{humanReadableBrokerOrderId}
```

The case document holds the root ticket and mutable Case Summary. Broker Order documents hold one durable mirror per actual Robinhood order; the mirror repository must query/upsert by account plus broker order ID even though the document ID is human-readable.

## interfaces

Define small shared interfaces for:

```text
BrokerOrderAdapter
OrderTicketRepository
BrokerOrderMirrorRepository
ReconciliationModule
```

The reconciliation interface returns one immutable `ReconciliationSnapshot` containing order rows, position rows, unmatched orders, and source-health metadata.

## migration

No legacy migration or compatibility adapter is planned. The remaining legacy records will be deleted manually before the new flow starts. New accepted tickets create fresh Trading Cases.

## dependencies

- PRD: `PRD-savant-trader-broker-authoritative-order-reconciliation.md`
- ADR: `ADR-007_broker-authoritative-order-reconciliation.md`
- Existing `order-intent.types.ts` is a temporary compatibility reference and must not remain the long-term domain model.

**topic:** savant trader — broker-authoritative order reconciliation  
**issue:** #225  
**topic parent:** #176  
**domain:** savant-trader  
**type:** implementation plan  
**area:** fe  
**status:** superseded by ADR-008 (Signal Entry Record model)  
**created:** 2026-09-05  
**last updated:** 2026-09-07

---

> **⚠ SUPERSEDED by [ADR-008](../../adr/ADR-008_signal-entry-record.md)**
>
> The Trading Case repository, broker order mirror repository, reconciliation module, and projection adapter described in this plan were superseded on 2026-09-07. The replacement model uses a lightweight Signal Entry Record and reads RH directly for positions and orders.
>
> The sections below remain as historical context. New implementation follows ADR-008 and the updated task #241 scope.

---

## scope

Introduce the frontend reconciliation module and connect the existing order workspace to its projection without rewriting the page shell.

## repositories

### Trading Case repository

Owns user-scoped Firestore records for:

- Trading Case root documents;
- root Order Ticket metadata;
- Case Summary progress;
- local authorization and source context.

### Broker Order mirror repository

Owns one child record per broker order:

```text
savant-trader/data/trading-cases/{caseId}/broker-orders/{humanReadableBrokerOrderId}
```

Writes are idempotent by account plus the immutable external broker order ID. The human-readable document ID is for Firestore keying and UI traceability. The latest normalized and raw broker response replaces the previous mirror version.

## reconciliation module

The frontend consumes normalized broker output from the BE adapter. It must not infer Robinhood state semantics from raw response strings. The FE mapping layer may derive queue labels only from the evidence-backed shared lifecycle contract; unknown raw states remain visible as pending/source-state information.

Create a deep frontend module with a small interface:

```text
reconcile(accountNumber, options) → ReconciliationSnapshot
```

The implementation will:

1. load local Trading Cases;
2. call the backend broker adapter;
3. merge by case ID, broker order ID, ref ID, and position identity;
4. classify unmatched Broker Orders;
5. produce Symbol Position projections;
6. calculate protection coverage and drift;
7. persist broker mirrors and Case Summary updates;
8. return one immutable queue projection.

No page component may independently replace the shared queue map from Firestore or Robinhood data.

## queue projection

The existing queue/ticket UI should consume the new projection through an adapter during the transition.

Rows include:

- root Order Tickets;
- Broker Orders grouped by lifecycle;
- aggregate Symbol Positions;
- unmatched Broker Orders;
- protection indicators;
- source-health and stale-data indicators.

A Broker Order appears exactly once. A Symbol Position is not rendered as a duplicate Broker Order.

## position management

The frontend supports:

- aggregate quantity and exposure display;
- fractional-close actions where broker rules allow;
- aggregate Protective Stop coverage;
- `PROTECTED` and protection-drift indicators;
- explicit Update Protective Stop cancel-and-replace flow;
- Create Trading Case adoption for unmatched Broker Orders.

Target exits remain a visible TBD extension and are not executable in this milestone.

## rollout

1. Add shared projection types and adapter interfaces.
2. Implement repositories and reconciliation module.
3. Keep the current page shell and replace the current combined intent map at the data seam.
4. Validate current UAT journeys against the merged projection.
5. Remove synthetic Position-as-Order behavior.
6. Remove legacy order-intent usage after fresh-start verification.

## frontend tests

Cover:

- Firestore-first and Robinhood-first loading;
- delayed position/order responses;
- unmatched orders;
- queued/resting/filled/cancelled states;
- duplicate prevention by broker order ID;
- multiple cases for one symbol;
- aggregate Symbol Position rows;
- Protective Stop coverage and drift;
- adoption workflow;
- partial-fill quantity preservation;
- source-health and stale-state display.

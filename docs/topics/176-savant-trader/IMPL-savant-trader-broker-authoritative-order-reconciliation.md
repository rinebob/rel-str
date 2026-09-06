**topic:** savant trader — broker-authoritative order reconciliation  
**issue:** #212  
**topic parent:** #176  
**domain:** savant-trader  
**type:** implementation plan  
**area:** shared, fe, be  
**status:** approved  
**created:** 2026-09-05  
**last updated:** 2026-09-06

---

## scope

Replace the current shared `OrderIntent` queue map with a reconciliation module that merges local Order Tickets, Firestore Broker Order mirrors, live Robinhood Broker Orders, and Robinhood Positions.

The external interface should be small and deep:

```text
reconcile(accountNumber, options) → ReconciliationSnapshot
```

The implementation owns loading order, identity matching, state precedence, stale handling, mirror writes, and projection construction. Page components must not merge Firestore and Robinhood records themselves.

## target modules

### broker adapter

The adapter wraps Robinhood MCP tools and returns normalized results:

```text
listOrders(accountNumber, query) → BrokerOrderPage
getOrder(accountNumber, brokerOrderId) → RawBrokerOrder | null
listPositions(accountNumber, query) → RawSymbolPositionPage
```

The adapter must:

- preserve raw broker responses for diagnostics;
- normalize nested response shapes such as `parsed.data.order`;
- distinguish MCP transport success from tool-level `isError` responses;
- expose cursors and pagination;
- apply request timeouts;
- never classify a missing order as failed without reconciliation policy input.

### order ticket repository

The repository owns local Order Ticket persistence:

```text
loadTickets(accountNumber) → OrderTicket[]
saveTicket(ticket) → void  (upsert; archive via archivedAt)
```

It owns local metadata and proposed terms. It does not decide broker lifecycle.

### broker order mirror repository

The mirror repository owns durable normalized broker observations:

```text
upsert(order) → void
load(accountNumber) → BrokerOrderMirror[]
```

Writes must be idempotent by account plus broker order ID.

### reconciliation module

The reconciliation module is the external seam consumed by the page/store:

```text
reconcile(accountNumber, options) → ReconciliationSnapshot
```

`ReconciliationSnapshot` contains:

```text
orderRows
positionRows
unmatchedBrokerOrders
ambiguousLocalTickets
syncMetadata
```

The module performs parallel source reads, identity matching, state precedence, broker mirror writes, and queue projection construction.

## data model

### order ticket document

Target collection:

```text
savant-trader/data/trading-cases/{caseId}
```

Fields:

```text
id
caseId
accountNumber
refId
entryBrokerOrderId
source
sourceRef
signalContext
proposedTerms
authorization
createdAt
updatedAt
archivedAt
```

The ticket may retain a derived lifecycle for display, but that lifecycle is not authoritative after `entryBrokerOrderId` exists.

### broker order mirror document

Target collection:

```text
savant-trader/data/trading-cases/{caseId}/broker-orders/{humanReadableBrokerOrderId}
```

Fields:

```text
id
accountNumber
caseId
refId
brokerOrderId
role
parentBrokerOrderId
replacesBrokerOrderId
rawState
derivedState
instrumentType
instrumentId
symbol
side
type
requestedQuantity
cumulativeQuantity
remainingQuantity
price
averageFillPrice
stopPrice
fees
dollarBasedAmount
timeInForce
marketHours
trigger
triggeredAt
placedAgent
createdAt
lastTransactionAt
executions
rawResponse
updatedAt
lastObservedAt
mirrorVersion
instrumentSpecific
```

Sensitive account identifiers must follow the existing storage rules. UI previews must redact them.

### broker position projection

Positions are not Broker Orders. Normalize them separately:

```text
accountNumber
symbol
quantity
intradayQuantity
averageBuyPrice
sharesAvailableForSells
sharesHeldForSells
positionType
observedAt
```

A Position row may reference an entry ticket or broker order, but it does not inherit the broker order's identity.

## identity and merge rules

Priority order:

1. account number plus broker order ID;
2. local ticket entryBrokerOrderId;
3. local refId matched against broker order history;
4. explicit parent/child links for Protective Stops;
5. account number plus symbol only for Position records, never Broker Orders.

A symbol match must never merge two Broker Orders.

## state precedence

When broker data exists:

```text
Robinhood raw state → derived broker state → queue row state
```

When broker data is unavailable:

```text
last known mirror + stale/ambiguous marker
```

Never convert an absent broker row directly to FAILED. Use a reconciliation grace period, recent-order query, broker ID lookup, and retry-safe ambiguity handling.

Suggested derived mapping:

| broker state | domain treatment |
|---|---|
| queued | queued |
| confirmed for a verified trigger-based order | resting |
| filled with verified fill evidence | filled |
| cancelled | cancelled |
| new/unconfirmed | preserve raw state; no derived assumption |
| rejected/failed/voided | preserve raw state; derive terminal UI state only through verified policy |
| partially_filled | preserve raw state, cumulative quantity, and remaining quantity |
| canceled | compatibility spelling alias for `cancelled`; map to `cancelled` and preserve raw state |

The raw state must remain available for support and audit.

## initial reconciliation sequence

1. Load account configuration.
2. Fetch Order Tickets and Broker Order mirrors from Firestore.
3. Fetch recent Agentic Broker Orders from Robinhood, following cursors.
4. Fetch current Robinhood Positions, following cursors.
5. Merge by identity.
6. Upsert Broker Order mirrors.
7. Build one immutable reconciliation projection.
8. Publish the projection to the queue store.
9. Mark the snapshot complete with timestamp and source status.

No source may replace the full shared map independently.

## incremental reconciliation

Refresh paths:

- explicit Refresh from Broker;
- after an order submission;
- after cancellation or modification;
- after fractional close submission;
- periodic refresh while queued/resting orders exist;
- page activation when the last sync is stale.

Each refresh must merge/upsert rather than reset unrelated rows.

## execution flow

1. Save the Order Ticket and stable ref ID.
2. Run preflight for exact proposed terms.
3. Require explicit Order Authorization.
4. Dispatch the broker order.
5. Detect transport success versus embedded MCP `isError`.
6. Parse nested broker response shapes.
7. Persist broker order ID and complete normalized snapshot.
8. Derive queued/resting/submitted state from the broker state and order type.
9. Reconcile by broker order ID after dispatch.
10. Never retry an ambiguous request with a new ref ID.

## queue projection rules

The queue consumes `ReconciliationSnapshot` rows:

- local staged ticket with no broker ID → Staged;
- broker request in flight → Submitting;
- broker processed state not yet classified → Submitted;
- broker queued state → Queued;
- accepted trigger-based order → Resting;
- filled Broker Order or open Position → Filled/Position view;
- failed/rejected broker order → Failed;
- cancelled broker order → excluded or historical, according to retention policy.

A Protective Stop appears exactly once as a Broker Order row. The protected Position or entry row receives a `protected` indicator.

## migration plan

### phase 1 — introduce normalized types

Add `OrderTicket`, `BrokerOrder`, `BrokerOrderMirror`, `BrokerPosition`, and `ReconciliationSnapshot` types. Keep adapters for current `OrderIntent` documents.

### phase 2 — add mirror repository

Persist normalized Broker Order snapshots by broker order ID. Backfill from recent `get_equity_orders` responses.

### phase 3 — introduce reconciliation module

Move source loading and merge precedence out of `OrderComponent` and `OrderStagingStore`.

### phase 4 — migrate queue

Make the queue consume the reconciliation projection. Remove synthetic broker-position Order Intents and represent positions as explicit Position rows.

### phase 5 — migrate collections

Move local intent data into `savant-trader/data/trading-cases/{caseId}` and broker snapshots into `.../broker-orders/{humanReadableBrokerOrderId}`. Preserve legacy IDs and parent links during migration. Delete legacy records only after verification.

## test plan

Test through the reconciliation interface:

- Firestore resolves before Robinhood;
- Robinhood resolves before Firestore;
- broker position hydration is delayed;
- broker order hydration is delayed;
- queued response with nested `data.order`;
- tool-level `isError` with transport success;
- broker order without local ticket;
- local ticket without broker order;
- duplicate symbol with two broker orders;
- filled position with no entry ticket;
- Protective Stop linked to a filled entry;
- fractional position with no stop-loss capability;
- stale local failure with broker-confirmed position;
- timeout after broker accepted an order;
- repeated reconciliation is idempotent.

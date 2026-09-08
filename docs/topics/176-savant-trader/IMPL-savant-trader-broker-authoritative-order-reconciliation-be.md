**topic:** savant trader — broker-authoritative order reconciliation  
**issue:** #225  
**topic parent:** #176  
**domain:** savant-trader  
**type:** implementation plan  
**area:** be  
**status:** implemented (task #240, LIVE) — BE normalization remains valid under ADR-008  
**created:** 2026-09-05  
**last updated:** 2026-09-07

---

> **Note on ADR-008:** The BE normalization work described in this plan (task #240) is **still valid** and remains LIVE. ADR-008 supersedes the Trading Case / reconciliation module model on the frontend, but the BE broker adapter that normalizes RH order and position responses is independent of that model and continues to be used.
>
> The only BE-side change implied by ADR-008 is that the FE no longer sends Trading Case IDs or reconciliation context to the BE. The BE normalization adapter is called the same way — it normalizes RH responses and returns them to the FE.

---

## scope

Deepen the Robinhood MCP adapter so broker response normalization, tool-level error handling, pagination, timeouts, and raw response preservation are owned in one backend module.

## broker adapter

Create a normalized broker-order adapter around the observation API and MCP tool executor.

The adapter must support:

- `get_equity_orders` with account, broker order ID, state, symbol, agent, date, and cursor filters;
- `get_equity_positions` with cursor pagination;
- normalized nested responses such as `parsed.data.order`;
- order-list responses under supported `results`/`orders` containers;
- tool responses where transport success contains `redacted.isError === true`;
- broker errors with original text and category;
- bounded request and MCP call timeouts;
- raw response retention in the normalized result.

## normalized broker order

The backend adapter exposes:

```text
brokerOrderId
instrument identity
side
type
rawState
requestedQuantity
cumulativeQuantity
remainingQuantity
price
averageFillPrice
stopPrice
fees
timeInForce
marketHours
trigger
triggeredAt
placedAgent
createdAt
lastTransactionAt
executions
rawResponse
instrumentSpecific
```

The adapter does not decide local case ownership. It returns broker facts and optional correlation fields such as `refId`.

## error semantics

Transport success is not tool success. The adapter must treat an embedded MCP tool error as a rejected operation even when the outer response has `success: true`.

A failed call must never produce a successful broker-order result with an undefined broker ID.

## pagination and freshness

- Follow all order and position cursors before declaring a snapshot complete.
- Return source-health and freshness metadata.
- Preserve the latest raw response only; do not create an observation collection.
- Repeated identical responses may update `lastObservedAt` but must not create duplicate broker mirrors.

## state discovery gate

Before implementing derived lifecycle mappings, capture real responses for each supported equity/ETF order type:

- market;
- limit;
- stop-market;
- stop-limit;
- Protective Stop.

The fixtures must record the exact response nesting, raw state, fill fields, trigger fields, timestamps, and execution shape. The adapter must preserve unknown raw states rather than mapping them speculatively. The `confirmed → resting` mapping is valid only for order types and responses verified by live evidence.

## validation

Add backend tests for:

- direct and nested order responses;
- queued, confirmed, filled, cancelled, rejected, and failed states;
- embedded tool errors;
- missing/invalid broker IDs;
- cursor pagination;
- timeout behavior;
- response redaction;
- position quantity and held-for-sale fields.

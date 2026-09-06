**topic:** savant trader — broker-authoritative order reconciliation  
**issue:** #240  
**topic parent:** #176  
**domain:** savant-trader  
**type:** research note  
**status:** draft  
**created:** 2026-09-05  
**last updated:** 2026-09-05

---

## scope

Verify Robinhood MCP equity order states, response shapes, and order-type lifecycle evidence before implementing the broker adapter.

## confirmed tool schema

`functions/.rh-mcp-tool-catalog.json` is generated from Robinhood MCP tool definitions and explicitly states that it contains schemas only, not tool results.

`get_equity_orders` lists these state filter values:

```text
new
queued
confirmed
unconfirmed
partially_filled
filled
cancelled
rejected
failed
voided
```

`place_equity_order` and `review_equity_order` list these equity order types:

```text
market
limit
stop_market
stop_limit
```

## confirmed response evidence

The recovered KMEM fractional-close response provides a concrete nested order shape:

```text
parsed.data.order
```

It contains:

```text
id
instrument_id
symbol
side
type
state
quantity
cumulative_quantity
price
stop_price
fees
dollar_based_amount
time_in_force
market_hours
trigger
placed_agent
created_at
last_transaction_at
executions
```

The observed response was:

```text
state = queued
quantity = 0.107278
cumulative_quantity = 0.000000
executions = []
```

This confirms that a market fractional sell can be queued without being filled immediately.

The existing live verification document confirms that GTC limit and stop-market orders returned `confirmed` while resting simultaneously:

```text
docs/topics/176-savant-trader/VERIFY-savant-trader-176-203-simultaneous-resting-orders.md
```

Therefore `confirmed → resting` is supported for the tested trigger/price-based order types. It must not be applied universally to every order type without further evidence.

## state evidence matrix

| raw state | evidence | implementation posture |
|---|---|---|
| `queued` | concrete live KMEM response | preserve and display as queued |
| `confirmed` | concrete live verification for GTC limit and stop-market orders | derive resting only for verified trigger/price order types |
| `filled` | state value and synthetic fixtures; complete live coverage remains open | preserve; require verified fill evidence |
| `cancelled` | equity state value confirmed | preserve and normalize as cancelled |
| `canceled` | not confirmed as an equity API state | compatibility spelling only; do not claim as evidence |
| `rejected` | state value confirmed, semantics need live capture | preserve raw state; do not equate automatically to failed |
| `failed` | state value confirmed, semantics need live capture | preserve raw state; do not equate automatically to rejected |
| `new` | schema value only | preserve raw state; semantics unknown |
| `unconfirmed` | schema value only | preserve raw state; semantics unknown |
| `voided` | schema value only | preserve raw state; semantics unknown |
| `partially_filled` | schema value and design documentation, no live fixture | preserve raw state and quantities; do not claim full fill |

## evidence gaps

The repository does not yet contain live fixtures for:

- `get_equity_orders` list response nesting and pagination;
- placement responses for market, limit, stop-market, and stop-limit orders;
- stop-market trigger transitions;
- stop-limit trigger-to-limit transitions;
- partial-fill response fields and executions;
- `new`, `unconfirmed`, and `voided` semantics;
- `review_equity_order` output;
- cursor retention and rate limits.

These gaps are BE task acceptance criteria. Until they are resolved, the adapter must retain raw responses and avoid speculative mappings.

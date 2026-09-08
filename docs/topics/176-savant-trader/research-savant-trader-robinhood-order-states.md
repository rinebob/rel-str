**topic:** savant trader — broker-authoritative order reconciliation  
**issue:** #240  
**topic parent:** #176  
**domain:** savant-trader  
**type:** research note  
**status:** draft  
**created:** 2026-09-05  
**last updated:** 2026-09-07

---

## scope

Verify Robinhood MCP equity order states, response shapes, and order-type lifecycle evidence before implementing the broker adapter.

## full toolbox sampling

On 2026-09-07, all 29 safe observation tools were exercised against the live
Robinhood MCP server using the agentic account. The full responses
—including the `guide` text embedded in every response— are captured in:

```text
scripts/verify/samples/rh-observation-tools-samples.json
```

The sampling script is:

```text
scripts/verify/sample-all-observation-tools.ts
```

Re-run with:

```text
npx tsx scripts/verify/sample-all-observation-tools.ts <accountNumber>
```

### key: the `guide` property

Every Robinhood MCP response includes a `guide` string that documents how to
interpret the response fields. This is essentially embedded API documentation.
**Always read the guide text when processing a new response shape.**

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

## response shapes

### place_equity_order — `data.order` (singular object)

The `place_equity_order` response nests a single order under `data.order`:

```json
{
  "success": true,
  "parsed": {
    "data": {
      "order": {
        "id": "6a9e3317-...",
        "instrument_id": "a30e4e27-...",
        "symbol": "QQQM",
        "side": "buy",
        "type": "market",
        "state": "queued",
        "quantity": "1.000000",
        "cumulative_quantity": "0.000000",
        "price": "295.650000",
        "stop_price": null,
        "average_price": null,
        "fees": "0.000000",
        "dollar_based_amount": null,
        "time_in_force": "gfd",
        "market_hours": "regular_hours",
        "trigger": "immediate",
        "placed_agent": "agentic",
        "created_at": "2026-09-07T03:44:23.232525Z",
        "last_transaction_at": "2026-09-07T03:44:23.232525Z",
        "executions": []
      }
    },
    "guide": "The order has been submitted — not necessarily filled. Describe with state. Tell the user the order was placed and summarize symbol, side, type, quantity (or dollar_based_amount), and limit/stop prices; remind them it may not have filled yet and that they can check status or cancel via id. On error, the order was NOT placed — report the error verbatim."
  },
  "redacted": { ... same shape ... },
  "tool": "place_equity_order"
}
```

**Guide summary:** The order has been submitted — not necessarily filled. Remind
the user it may not have filled yet and that they can check status or cancel via id.

### get_equity_orders — `data.orders` (array)

The `get_equity_orders` response nests an array under `data.orders`:

```json
{
  "success": true,
  "parsed": {
    "data": {
      "orders": [ { ...same order object shape as place_equity_order... }, ... ]
    },
    "guide": "For dollar-based orders (dollar_based_amount populated, quantity sometimes null) describe in dollars until cumulative_quantity is meaningful. Mention placed_agent when it is not 'user'. Recover the user-facing order type from type+trigger or from price/stop_price. Present symbol, side, type, state, quantity (or dollar_based_amount), cumulative_quantity when partially filled, price for limit orders, average_price once filled, last_transaction_at (or created_at), and id when cancellation may follow; suppress other fields unless asked."
  },
  "redacted": { ... same shape ... },
  "tool": "get_equity_orders"
}
```

**Guide summary:**
- Recover the user-facing order type from **type+trigger** or from price/stop_price.
- For dollar-based orders (`dollar_based_amount` populated), describe in dollars
  until `cumulative_quantity` is meaningful.
- Mention `placed_agent` when it is not `'user'`.
- Present: symbol, side, type, state, quantity (or dollar_based_amount),
  cumulative_quantity when partially filled, price for limit orders,
  average_price once filled, last_transaction_at (or created_at), and id
  when cancellation may follow.

### order object fields

Every order object (from both `place_equity_order` and `get_equity_orders`)
contains these fields:

| Field | Type | Description |
|-------|------|-------------|
| `id` | string (UUID) | Broker order ID — immutable RH identifier |
| `instrument_id` | string (UUID) | RH instrument URL/ID |
| `symbol` | string | Ticker symbol |
| `side` | string | `buy` or `sell` |
| `type` | string | `market`, `limit`, `stop_market`, `stop_limit` |
| `state` | string | See state evidence matrix below |
| `quantity` | string (decimal) | Requested quantity |
| `cumulative_quantity` | string (decimal) | Filled so far (0 = not filled) |
| `price` | string\|null | Limit price (null for market orders) |
| `stop_price` | string\|null | Stop trigger price (null for non-stop orders) |
| `average_price` | string\|null | Fill price (null until filled) |
| `fees` | string (decimal) | Commission |
| `dollar_based_amount` | object\|null | `{amount, currency_code}` for dollar-based orders |
| `time_in_force` | string | `gfd`, `gtc`, `ioc`, `opg` |
| `market_hours` | string | `regular_hours`, `extended_hours` |
| `trigger` | string | `immediate` (market/limit) or `stop` (stop orders) |
| `placed_agent` | string | `agentic` (ST-placed) or `user` |
| `created_at` | string (ISO) | RH creation timestamp |
| `last_transaction_at` | string (ISO) | Last state change timestamp |
| `executions` | array | Fill details: `[{id, price, quantity, timestamp, fees}]` |

### order type recovery (type + trigger)

The `type` field alone is misleading. The real order type is the combination
of `type` + `trigger`:

| type | trigger | Real type | stop_price | price | Notes |
|------|---------|-----------|------------|-------|-------|
| market | immediate | Market | null | null* | Immediate execution |
| market | stop | Stop-market | populated | null | Protective stop, triggers market when price hits stop |
| limit | immediate | Limit | null | populated | Resting limit, executes when price reaches limit |
| limit | stop | Stop-limit | populated | populated | Triggers limit order when price hits stop |

*Market orders may show a reference price in `price` but it's not a limit price.

### get_equity_positions — `data.positions` (array)

```json
{
  "success": true,
  "parsed": {
    "data": {
      "positions": [
        {
          "symbol": "SNDK",
          "quantity": "0.049734",
          "intraday_quantity": "0.000000",
          "average_buy_price": "2010.700000",
          "shares_available_for_sells": "0.049734",
          "shares_held_for_sells": "0.000000",
          "shares_held_for_stock_grants": "0.000000",
          "shares_held_for_options_events": "0.000000",
          "shares_held_for_asset_transfer": "0.000000",
          "shares_pending_from_options_events": "0.000000",
          "type": "long"
        }
      ]
    },
    "guide": "Sellable shares: use shares_available_for_sells, not quantity. Yesterday's quantity = quantity - intraday_quantity. average_buy_price is the average cost per share shown in the Robinhood app (it already reflects partial sells) — use it as the user's average cost; it may be omitted for positions still reconciling. No market price here — for current value or PnL, call get_equity_quotes and multiply by quantity. Present symbol, quantity, average_buy_price, and type when not 'long'; suppress other fields unless asked."
  },
  "redacted": { ... same shape ... },
  "tool": "get_equity_positions"
}
```

**Guide summary:**
- **Sellable shares:** use `shares_available_for_sells`, not `quantity`.
- **Yesterday's quantity:** `quantity - intraday_quantity`.
- **`average_buy_price`:** the average cost per share shown in the Robinhood app
  (already reflects partial sells) — use as the user's average cost.
- **No market price here** — for current value or PnL, call `get_equity_quotes`
  and multiply by `quantity`.

**Position filter rule:** A position is an open position if `type` is `"long"`
or `"short"` AND `quantity > 0`. If `type` is `"empty"` or `quantity` is `"0"`,
there is no position.

### get_equity_quotes — `data.results` (array)

```json
{
  "success": true,
  "parsed": {
    "data": {
      "results": [
        {
          "quote": {
            "symbol": "KMEM",
            "last_trade_price": "19.800000",
            "venue_last_trade_time": "...",
            "last_non_reg_trade_price": "19.880000",
            "venue_last_non_reg_trade_time": "...",
            "adjusted_previous_close": "18.520000",
            "previous_close": "18.520000",
            "previous_close_date": "2026-09-03",
            "bid_price": "16.700000",
            "venue_bid_time": "...",
            "ask_price": "21.800000",
            "venue_ask_time": "...",
            "has_traded": true,
            "state": "active"
          },
          "close": {
            "symbol": "KMEM",
            "date": "2026-09-03",
            "price": "18.52",
            "interpolated": false,
            "source": "sip-list-exchange-close"
          }
        }
      ]
    },
    "guide": "Each entry in results pairs the live quote with the official prior-session close for the same symbol. Current price: pick whichever of quote.last_trade_price / quote.last_non_reg_trade_price has the more recent timestamp, then verify that timestamp is recent before calling it \"current\" — otherwise phrase as \"as of <time>\". Daily change uses quote.adjusted_previous_close. \"Yesterday's close\" uses results[].close.price (official settled close); when a result is missing close — either closes_error is set tool-wide, or this symbol had no close in an otherwise-successful batch — fall back to quote.previous_close and tell the user the official close lookup is unavailable. Drop bid/ask when zero. Surface has_traded=false or any non-'active' state before quoting a price."
  },
  "redacted": { ... same shape ... },
  "tool": "get_equity_quotes"
}
```

**Guide summary:**
- **Current price:** pick whichever of `last_trade_price` / `last_non_reg_trade_price`
  has the more recent timestamp. Verify the timestamp is recent before calling
  it "current".
- **Daily change:** uses `adjusted_previous_close`.
- **Yesterday's close:** uses `results[].close.price` (official settled close).
  Fall back to `previous_close` if close is missing.
- **Drop bid/ask when zero.**
- **Surface** `has_traded=false` or any non-`active` state before quoting a price.

**Note:** `symbols` parameter must be an **array**, not a comma-separated string.

### get_portfolio — `data` (flat object)

```json
{
  "success": true,
  "parsed": {
    "data": {
      "total_value": "...",
      "equity_value": "...",
      "options_value": "...",
      "futures_value": "...",
      "event_contracts_value": "...",
      "crypto_value": "...",
      "cash": "...",
      "pending_deposits": "...",
      "mutual_funds_value": "...",
      "fixed_income_value": "...",
      "currency": "USD",
      "buying_power": "...",
      "crypto_buying_power": "..."
    },
    "guide": "Show total_value as \"account value\" or \"portfolio value\". The breakdown fields show how value is distributed across asset classes..."
  }
}
```

### get_accounts — `data.accounts` (array)

```json
{
  "data": {
    "accounts": [
      {
        "account_number": "<redacted>",
        "rhs_account_number": "<redacted>",
        "type": "margin",
        "unsettled_funds": "0.0000",
        "brokerage_account_type": "individual",
        "is_default": true,
        "agentic_allowed": false,
        "option_level": "option_level_3",
        "management_type": "self_directed",
        "affiliate": "rhf",
        "state": "active",
        "deactivated": false,
        "permanently_deactivated": false
      }
    ]
  },
  "guide": "Sort the list deterministically: default account first, agentic accounts (agentic_allowed=true) second, then other individual accounts, then retirement (IRA) accounts..."
}
```

**Key field:** `agentic_allowed` — only accounts with `true` can place orders
via ST. The agentic account is used for all ST order placement.

### get_equity_tax_lots — `data.tax_lots` (array)

```json
{
  "data": {
    "symbol": "AAPL",
    "tax_lots": [ ... ]
  },
  "guide": "Lots are newest-acquired first by default. quantity is per-lot, not the whole position — sum quantity across lots for total..."
}
```

### get_pnl_trade_history — `data.trades` (array)

```json
{
  "data": {
    "account_number": "...",
    "span": "...",
    "trades": [ ... ],
    "next_cursor": null
  },
  "guide": "trades are returned most-recent-first. Each entry is a closed/realizing trade with the realized gain/loss on it..."
}
```

### get_realized_pnl — `data.data_points` (array)

```json
{
  "data": {
    "account_number": "...",
    "window": "...",
    "display_currency": "USD",
    "data_points": [ ... ],
    "total_returns": "...",
    "total_rate_of_return": "..."
  },
  "guide": "This is realized profit & loss only — gains/losses from positions closed within the window; it excludes unrealized profit..."
}
```

### review_equity_order (simulation) — `data` (flat object)

```json
{
  "data": {
    "symbol": "AAPL",
    "side": "buy",
    "type": "market",
    "quantity": "1",
    "order_checks": [ ... ],
    "quote_data": { ... },
    "market_data_disclosure": "..."
  },
  "guide": "This tool does NOT place the order — it returns a preview for the user to review..."
}
```

### place_equity_order — order type variations

On 2026-09-07, four test orders were placed on DRAM to capture response shapes
for each order type. Full responses in
`scripts/verify/samples/rh-mutation-tools-samples.json`.

**Fractional market buy ($1):**
- `type: "market"`, `trigger: "immediate"`, `state: "queued"`
- `dollar_based_amount: {amount: "1.000000", currency_code: "USD"}`
- `quantity: "0.016800"` (computed from dollar amount)
- `price: "59.500000"` (reference price, not a limit)

**Limit buy @ $1 (GTC):**
- `type: "limit"`, `trigger: "immediate"`, `state: "unconfirmed"`
- `price: "1.000000"` (limit price)
- `stop_price: null`
- **`unconfirmed` is the transient state before RH accepts the order.**
  This is the only live observation of `unconfirmed`.

**Stop-market buy @ $1000 (GTC):**
- `type: "market"`, `trigger: "stop"`, `state: "queued"`
- `stop_price: "1000.000000"`
- `price: "1000.000000"` (same as stop_price for stop-market)
- **Note:** `type` is `"market"` even though we placed it as `stop_market`.
  The real type is recovered from `type + trigger`.

**Market buy 2 shares (GFD):**
- `type: "market"`, `trigger: "immediate"`, `state: "queued"`
- `quantity: "2.000000"`
- `price: "59.530000"` (reference price)
- Left on the books (not cancelled).

### cancel_equity_order — `data.accepted`

```json
{
  "data": {
    "accepted": true
  },
  "guide": "accepted=true means the broker accepted the cancel request, NOT that the order is already cancelled (cancellation is asynchronous). For the final state, call get_equity_orders: state 'pending_cancelled' = in flight; 'cancelled' or 'partially_filled_rest_cancelled' = succeeded; any filled state = a fill raced the cancel. Offer to check the final state. On error, the cancel was rejected outright — report verbatim."
}
```

**Guide summary:**
- `accepted=true` means the broker accepted the cancel request, NOT that the
  order is already cancelled.
- Cancellation is asynchronous — check `get_equity_orders` for final state.
- **New states discovered from the guide:**
  - `pending_cancelled` = cancel in flight
  - `partially_filled_rest_cancelled` = partially filled, rest cancelled
- Any filled state = a fill raced the cancel.

**Cancel failure:** When cancelling an order in `unconfirmed` state, RH returns
HTTP 403: "Order cannot be cancelled at this time." You cannot cancel an order
RH hasn't confirmed yet.

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
**Additional context:** fractional orders can only be processed during regular market
hours. A fractional sell placed outside regular hours will sit in `queued` until the
market opens. This is NOT the same as a resting order (which waits for a trigger price).

## queued vs resting distinction

These are fundamentally different states that must not be conflated:

**Queued** = order accepted by RH, waiting for an execution window.
- Example: fractional orders waiting for regular market hours.
- No trigger condition — will execute when the window opens.
- RH state: `queued`

**Resting** = order accepted by RH, waiting for a trigger event.
- Example: stop order waiting for price to hit `stop_price`.
- Example: limit order waiting for price to reach `price`.
- Won't execute until the market hits that price.
- RH state: `confirmed` (with `trigger: stop` or `type: limit`)

**Submitted** = transient state between "ST clicked submit" and "RH accepted".
- Should never persist more than 5-10 seconds.
- If an order sits in submitted longer, something is wrong.
- RH state: `unconfirmed` (confirmed live on 2026-09-07 with DRAM limit order)

**`unconfirmed` state investigation (2026-09-07):**

A limit buy at $1 (way below DRAM's ~$60 market price) came back as `unconfirmed`.
Polled immediately after placement — it had already transitioned to `rejected`
in ~137ms (created_at to last_transaction_at).

Subsequent test orders placed outside market hours:
- Fractional market buy ($1): `queued`
- Limit buy at 90% of market ($53.78): `queued`
- Limit buy at 99% of market ($59.00): `queued`
- Stop-market buy at $65: `queued`
- Stop-market buy at $1000: `queued`
- Market buy 2 shares: `queued`

All came back as `queued` directly — none went through `unconfirmed`.

**Hypothesis (needs market-hours verification):**
- `unconfirmed` is a pre-acceptance validation state that RH processes in milliseconds.
- If the order passes validation → `queued` (market/fractional) or `confirmed` (resting GTC limit/stop during market hours).
- If the order fails validation → `rejected` (e.g., limit price too far from market).
- Outside market hours, valid orders go directly to `queued` because they can't rest on the book yet.
- During market hours, valid limit/stop orders would go to `confirmed` (resting on the book).
- The `confirmed` SCHB stop order in the live data was placed during market hours and rests as `confirmed`.
- We cannot catch the `unconfirmed → confirmed` transition outside market hours because
  valid orders go straight to `queued`.

**To fully document `unconfirmed → confirmed`:**
- Place a GTC limit order at a reasonable price during regular market hours.
- Poll immediately to catch the transition.
- This is a future verification task.

The existing live verification document confirms that GTC limit and stop-market orders returned `confirmed` while resting simultaneously:

```text
docs/topics/176-savant-trader/VERIFY-savant-trader-176-203-simultaneous-resting-orders.md
```

Therefore `confirmed → resting` is supported for the tested trigger/price-based order types. It must not be applied universally to every order type without further evidence.

## state evidence matrix

| raw state | evidence | implementation posture |
|---|---|---|
| `queued` | concrete live KMEM, DRAM, QQQM responses; confirmed for fractional sells and market buys outside market hours | preserve and display as queued (waiting for execution window) |
| `confirmed` | concrete live verification for GTC limit and stop-market orders | derive resting only for verified trigger/price order types (type+trigger or stop_price/price populated) |
| `unconfirmed` | concrete live DRAM limit order response (2026-09-07); transitioned to `rejected` in ~137ms | transient submitted state — RH received but hasn't accepted; maps to Submitted queue group; cannot be cancelled in this state; RH validates in milliseconds |
| `rejected` | concrete live DRAM limit order (2026-09-07); limit at $1 rejected (too far from market) | preserve raw state; order failed validation — hide from active queue; report reason if available |
| `filled` | concrete live responses for SCHB, KMEM, AAPL, BTSG, SNDK; `cumulative_quantity > 0` and `average_price` populated | preserve; filled orders are represented by open positions from get_equity_positions |
| `cancelled` | concrete live responses for AAPL stop/limit orders; DRAM test orders | preserve and normalize as cancelled; hide from active queue |
| `pending_cancelled` | documented in cancel_equity_order guide; not yet observed in live order data | preserve raw state; cancel in flight — will transition to cancelled |
| `partially_filled_rest_cancelled` | documented in cancel_equity_order guide; not yet observed in live order data | preserve raw state and quantities; partial fill + rest cancelled |
| `rejected` | concrete live DRAM limit order (2026-09-07); limit at $1 rejected (too far from market) | preserve raw state; order failed validation — hide from active queue; report reason if available |
| `failed` | state value confirmed, semantics need live capture | preserve raw state; do not equate automatically to rejected |
| `new` | schema value only | preserve raw state; semantics unknown — likely transient submitted state |
| `voided` | schema value only | preserve raw state; semantics unknown |
| `partially_filled` | schema value and design documentation, no live fixture | preserve raw state and quantities; do not claim full fill |

## queue group mapping

| Queue group | Source | Filter | RH state |
|-------------|--------|--------|----------|
| Staged | Local Order Tickets | STAGED/READY, no broker order yet | (none) |
| Queued | Broker orders | waiting for execution window | `queued` |
| Submitted | Broker orders | transient — ST sent, RH hasn't accepted | `unconfirmed`, `new` (5-10s max) |
| Resting | Broker orders | waiting for trigger price | `confirmed` + (stop or limit) |
| Open Positions | get_equity_positions | type long/short, quantity > 0 | (positions, not orders) |
| (hidden) | Broker orders | historical terminal states | `filled`, `cancelled`, `rejected`, `failed`, `voided` |

## evidence gaps

The repository does not yet contain live fixtures for:

- `unconfirmed → confirmed` transition (requires placing a GTC limit/stop during regular market hours);
- stop-market trigger transitions (confirmed → filled when stop_price is hit);
- stop-limit trigger-to-limit transitions;
- partial-fill response fields and executions;
- `new`, `voided`, `pending_cancelled`, and `partially_filled_rest_cancelled` states in live order data;
- cursor retention and rate limits.

These gaps are BE task acceptance criteria. Until they are resolved, the adapter must retain raw responses and avoid speculative mappings.

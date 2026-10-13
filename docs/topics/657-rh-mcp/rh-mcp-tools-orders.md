# Robinhood MCP — Orders

> Part of the [canonical tool discovery](rh-mcp-tool-discovery-canonical-657-658-689.md) — 10 tools in this group.

### cancel_equity_order

**Safety:** financial mutation · **Status:** probed

Cancel an open equity order by order_id. Always confirm with the user before calling. Resolve order_id via get_equity_orders if the user refers to it by symbol or description; pass the same account_number. Requires an agentic_allowed=true account; non-agentic accounts are rejected — do not call. Cancellation may be rejected if the order has already filled, was already cancelled, or is otherwise ineligible.

**Parameters (live inputSchema):**

| param | type | required | description |
|---|---|---|---|
| account_number | string | yes | Brokerage account that owns the order. Must come from the user or be clearly implied — never default from get_accounts. Must be agentic_allowed=true. The ups… |
| order_id | string | yes | Order UUID from get_equity_orders. Must live in account_number. |

**Response shape** (union over 10 success capture(s)):

```
data: object
data.accepted: boolean
guide: string
```

**Errors observed:** 3 capture(s), 3 distinct shape(s)

**Captures:**

- [err-cancel-bad-order](captures/err-cancel-bad-order.json) — error — Deliberate error: well-formed nonexistent order UUID — approve to capture API not-found.
- [err-cancel-malformed-order](captures/err-cancel-malformed-order.json) — error — Deliberate error: malformed order_id — approve to capture validation/not-found path.
- [mx-can-bid-403-filled](captures/mx-can-bid-403-filled.json) — error — Hand capture: cancel on a FILLED order -> 403 "Order cannot be cancelled at this time." (paired with mx-buy-lim-bid-filled).
- [mx-can-bid](captures/mx-can-bid.json) — success — cancel the resting E3 bid-limit — set OOMA_ORDER_ID from the preceding place capture before running
- [mx-can-cleanup](captures/mx-can-cleanup.json) — success — Ad-hoc cleanup — cancels a matrix-created resting order that has no paired can-probe (e.g. mx-sell-stp-hi's queued sell-stop-above-market).
- [mx-can-gtc](captures/mx-can-gtc.json) — success — cancel the resting E8 gtc limit — proves gtc cancel path — set OOMA_ORDER_ID from the preceding place capture before running
- [mx-can-stp-hi](captures/mx-can-stp-hi.json) — success — cancel the resting E4 buy-stop — set OOMA_ORDER_ID from the preceding place capture before running
- [mx-can-stplim](captures/mx-can-stplim.json) — success — cancel the resting E6 stop-limit — set OOMA_ORDER_ID from the preceding place capture before running
- [mx-can-trail-a](captures/mx-can-trail-a.json) — success — cancel trail leg A — set OOMA_ORDER_ID from the preceding place capture before running
- [mx-can-trail-b](captures/mx-can-trail-b.json) — success — cancel trail leg B — set OOMA_ORDER_ID from the preceding place capture before running
- [mx-can-x1](captures/mx-can-x1.json) — success — cancel the resting X1 sell limit — set OOMA_ORDER_ID from the preceding place capture before running
- [mx-can-x2](captures/mx-can-x2.json) — success — cancel the resting X2 sell stop — set OOMA_ORDER_ID from the preceding place capture before running
- [mx-can-x3](captures/mx-can-x3.json) — success — cancel the resting X3 sell stop-limit — set OOMA_ORDER_ID from the preceding place capture before running

**Notes:**

- cancel the resting E3 bid-limit — set OOMA_ORDER_ID from the preceding place capture before running
- cancel the resting E4 buy-stop — set OOMA_ORDER_ID from the preceding place capture before running
- cancel the resting E6 stop-limit — set OOMA_ORDER_ID from the preceding place capture before running
- cancel the resting E8 gtc limit — proves gtc cancel path — set OOMA_ORDER_ID from the preceding place capture before running
- cancel the resting X1 sell limit — set OOMA_ORDER_ID from the preceding place capture before running
- cancel the resting X2 sell stop — set OOMA_ORDER_ID from the preceding place capture before running
- cancel the resting X3 sell stop-limit — set OOMA_ORDER_ID from the preceding place capture before running
- cancel trail leg A — set OOMA_ORDER_ID from the preceding place capture before running
- cancel trail leg B — set OOMA_ORDER_ID from the preceding place capture before running
- cancel the resting X6 specified-lot sell — set OOMA_ORDER_ID from the preceding place capture before running
- Deliberate error: well-formed nonexistent order UUID — approve to capture API not-found.
- Deliberate error: malformed order_id — approve to capture validation/not-found path.
- Ad-hoc cleanup — cancels a matrix-created resting order that has no paired can-probe (e.g. mx-sell-stp-hi's queued sell-stop-above-market).

### cancel_option_exercise

**Safety:** financial mutation · **Status:** error-only

Cancel all queued exercise requests for an option position. Pass the same account_number and option_id used for exercise_option. Internally looks up all queued exercise events for that option and cancels each one. Typically there is one; multiple means the user submitted separate exercise batches. Only cancels events in state=queued — events already processing are rejected by the broker. Always confirm with the user before calling.

**Parameters (live inputSchema):**

| param | type | required | description |
|---|---|---|---|
| account_number | string | yes | Brokerage account that owns the exercise. Must be agentic_allowed=true. |
| option_id | string | yes | Option instrument UUID — the same option_id used for exercise_option. The tool looks up the queued exercise for this option and cancels it. |

**Errors observed:** 1 capture(s), 1 distinct shape(s)

**Captures:**

- [ox-cancel-ex](captures/ox-cancel-ex.json) — error — Cancel an exercise request that doesn't exist — captures the verbatim reject.

**Notes:**

- Cancel an exercise request that doesn't exist — captures the verbatim reject.

### cancel_option_order

**Safety:** financial mutation · **Status:** probed

Cancel an open option order by account_number + order_id. Always confirm with the user before calling. Resolve order_id via get_option_orders if the user refers to it by description; pass the same account_number you used there. Requires an agentic_allowed=true account; non-agentic accounts are rejected. Cancellation may be rejected if the order has already filled, was already cancelled, or is otherwise ineligible.

**Parameters (live inputSchema):**

| param | type | required | description |
|---|---|---|---|
| account_number | string | yes | Brokerage account that owns the order. Must come from the user or be clearly implied — never default from get_accounts. Must be agentic_allowed=true. Mismatc… |
| order_id | string | yes | Order UUID from get_option_orders. Must live in account_number. |

**Response shape** (union over 4 success capture(s)):

```
data: object
data.accepted: boolean
guide: string
```

**Captures:**

- [opt-can-csp](captures/opt-can-csp.json) — success — Cancel the resting CSP STO if it placed — set NFLX_OPT_ORDER_ID6; skip if opt-place-csp rejected.
- [opt-can-lim](captures/opt-can-lim.json) — success — Cancel the resting opt-place-lim order — set NFLX_OPT_ORDER_ID from its capture.
- [opt-can-stc](captures/opt-can-stc.json) — success — Cancel the resting STC limit — set NFLX_OPT_ORDER_ID2 from opt-sell-lim.
- [opt-can-stplim](captures/opt-can-stplim.json) — success — Cancel resting stop_limit open — set NFLX_OPT_ORDER_ID4.

**Notes:**

- Cancel the resting opt-place-lim order — set NFLX_OPT_ORDER_ID from its capture.
- Intentionally skipped — opt-place-spread rejected with 400 'Multi-leg options orders aren't supported in the Robinhood Trading MCP yet.' Nothing live to cancel; kept in manifest for symmetry/re-arm.
- Cancel the resting STC limit — set NFLX_OPT_ORDER_ID2 from opt-sell-lim.
- Cancel resting stop_market open — set NFLX_OPT_ORDER_ID3. Intentionally skipped: opt-place-stop rejected 400 (stop_market BTO unsupported), nothing live.
- Cancel resting stop_limit open — set NFLX_OPT_ORDER_ID4.
- Intentionally skipped — opt-place-naked rejected 400 'infinite risk', nothing live to cancel; kept in manifest for symmetry/re-arm.
- Cancel the resting CSP STO if it placed — set NFLX_OPT_ORDER_ID6; skip if opt-place-csp rejected.

### exercise_option

**Safety:** financial mutation · **Status:** error-only

Exercise a long options position — a call exercises the right to buy the underlying shares at the strike price; a put exercises the right to sell. Exercise is irrevocable once state moves past queued.

Never call this tool without asking the user to explicitly confirm the specific exercise first: state the option, quantity, and expected cash impact (debit for calls, credit for puts), then wait for their affirmative reply before calling. The user's original request to exercise is NOT itself sufficient confirmation — a generic "exercise my calls" does not confirm a specific option and quantity.

Position requirements: confirm via get_option_positions that the position type=long and quantity > 0.

Account requirements: confirm via get_accounts that the chosen account is agentic_allowed=true AND has option_level_2 or option_level_3. If agentic_allowed=false do NOT call. If option_level is empty or option_level_0, do NOT call; follow the get_accounts guide for how to direct the user to enroll.

Index options cannot be manually exercised and will be rejected. Exercises submitted during market hours execute the same day; requests submitted after market close — including on late-close trading days — are queued for overnight processing.

Parameter rules:
- quantity must be a positive integer and cannot exceed the position's available contracts.
- allow_shorts=true only applies to PUT exercises where the account does not own enough shares to deliver. Require explicit user confirmation before setting this — it creates a short equity position in the underlying stock.
- reason is optional but recommended; collect it from the user when they volunteer a motivation.
- ref_id: use the same UUID on retries of the same logical exercise; use a new UUID for a new exercise.

**Parameters (live inputSchema):**

| param | type | required | description |
|---|---|---|---|
| account_number | string | yes | Brokerage account number. Must be agentic_allowed=true with option_level_2 or option_level_3. |
| option_id | string | yes | Option instrument UUID from get_option_positions or get_option_instruments. The position must be type=long. |
| quantity | integer | yes | Number of contracts to exercise (positive integer, minimum 1). |
| ref_id | string | no | Idempotency key (UUID). Generate once per logical exercise and re-send on retry. Omitting falls back to a server-generated key. |
| reason | string | no | Optional exercise reason: covering_early_assignment \| buying_stocks \| not_enough_liquidity_or_spread_too_wide \| hedging_position. |
| allow_shorts | boolean | no | When true, allows a PUT exercise to proceed even when the account does not own enough shares to deliver — creating a short equity position. Requires explicit… |

**Errors observed:** 1 capture(s), 1 distinct shape(s)

**Captures:**

- [ox-exercise](captures/ox-exercise.json) — error — Exercise NFLX 70C with NO position held — captures the verbatim reject.

**Notes:**

- Exercise NFLX 70C with NO position held — captures the verbatim reject.

### get_equity_orders

**Safety:** read-only · **Status:** probed

Fetch equity orders for an account — list mode (newest first; open and closed, including fills, cancellations, rejections) or single-order mode by passing order_id. When the user asks broadly for "orders" or "my orders" without naming an asset class or order type, call get_equity_orders, get_option_orders, get_crypto_orders, and get_advanced_orders in parallel so OCO groups are not omitted.

Filtering tips:
- Prefer narrow queries: combine state, symbol, and/or created_at_gte for specific questions (e.g. "my filled AAPL orders this week") — the per-page cap is fixed.
- created_at_gte: interpret relative times in the user's timezone, convert to UTC before sending.
- symbol forces a symbol→instrument lookup; omit it if you don't need it.

**Parameters (live inputSchema):**

| param | type | required | description |
|---|---|---|---|
| account_number | string | yes | Brokerage account number. Must come from the user or be clearly implied — never default from get_accounts. |
| order_id | string | no | Filter to a single order by UUID. The response shape is unchanged (orders[] with at most one entry); empty when the order does not belong to account_number. |
| state | string | no | Filter by single state: new, queued, confirmed, unconfirmed, partially_filled, filled, cancelled, rejected, failed, voided. |
| symbol | string | no | Filter to one symbol (triggers a symbol→instrument lookup before the orders call). |
| created_at_gte | string | no | Lower bound (inclusive). ISO 8601 UTC or YYYY-MM-DD; naive values are interpreted as UTC. |
| placed_agent | string | no | Filter to one source: 'user', 'agentic' (MCP), 'recurring', 'drip', etc. |
| cursor | string | no | Pagination cursor. Omit for the first page; for the next page, pass the prior response's next value back verbatim. |

**Response shape** (union over 11 success capture(s)):

```
data: object
data.orders: array<object>
data.orders[].id: string
data.orders[].ref_id: string
data.orders[].instrument_id: string
data.orders[].symbol: string
data.orders[].side: string
data.orders[].type: string
data.orders[].state: string
data.orders[].quantity: string
data.orders[].cumulative_quantity: string
data.orders[].price: null | string
data.orders[].stop_price: null | string
data.orders[].average_price: null | string
data.orders[].fees: string
data.orders[].dollar_based_amount: null | object
data.orders[].dollar_based_amount.amount: string
data.orders[].dollar_based_amount.currency_code: string
data.orders[].time_in_force: string
data.orders[].market_hours: string
data.orders[].trigger: string
data.orders[].placed_agent: string
data.orders[].created_at: string
data.orders[].last_transaction_at: string
data.orders[].executions: array<object>
data.orders[].executions[].id: string
data.orders[].executions[].price: string
data.orders[].executions[].quantity: string
data.orders[].executions[].timestamp: string
data.orders[].executions[].fees: string
guide: string
```

**Captures:**

- [dep-eq-orders-id](captures/dep-eq-orders-id.json) — success — order_id lookup - newest order id harvested from get_equity_orders (62 orders exist).
- [mx-orders-confirmed](captures/mx-orders-confirmed.json) — success — Resting-order inventory — 'confirmed' is the resting/live state (open/queued return [] even with ~23 resting orders). Run first at session start and again in abort path.
- [ro-eq-orders-01](captures/ro-eq-orders-01.json) — success — Base - full order history page 1.
- [ro-eq-orders-02](captures/ro-eq-orders-02.json) — success — symbol filter (triggers symbol->instrument lookup).
- [ro-eq-orders-03](captures/ro-eq-orders-03.json) — success — state=filled. Other states (new,queued,confirmed,unconfirmed,partially_filled,voided) excluded - same filter path, identical empty-ledger envelope.
- [ro-eq-orders-04](captures/ro-eq-orders-04.json) — success — state=cancelled. Other states (new,queued,confirmed,unconfirmed,partially_filled,voided) excluded - same filter path, identical empty-ledger envelope.
- [ro-eq-orders-05](captures/ro-eq-orders-05.json) — success — state=rejected. Other states (new,queued,confirmed,unconfirmed,partially_filled,voided) excluded - same filter path, identical empty-ledger envelope.
- [ro-eq-orders-06](captures/ro-eq-orders-06.json) — success — state=failed. Other states (new,queued,confirmed,unconfirmed,partially_filled,voided) excluded - same filter path, identical empty-ledger envelope.
- [ro-eq-orders-07](captures/ro-eq-orders-07.json) — success — placed_agent=user.
- [ro-eq-orders-08](captures/ro-eq-orders-08.json) — success — placed_agent=agentic (MCP-placed). Other agents (recurring,drip,...) deferred - open set.
- [ro-eq-orders-09](captures/ro-eq-orders-09.json) — success — created_at_gte lower bound (YYYY-MM-DD form).

**Notes:**

- Base - full order history page 1.
- symbol filter (triggers symbol->instrument lookup).
- state=filled. Other states (new,queued,confirmed,unconfirmed,partially_filled,voided) excluded - representative state subset - the account has 62 orders so some states return rows; remaining values share the same filter path.
- state=cancelled. Other states (new,queued,confirmed,unconfirmed,partially_filled,voided) excluded - representative state subset - the account has 62 orders so some states return rows; remaining values share the same filter path.
- state=rejected. Other states (new,queued,confirmed,unconfirmed,partially_filled,voided) excluded - representative state subset - the account has 62 orders so some states return rows; remaining values share the same filter path.
- state=failed. Other states (new,queued,confirmed,unconfirmed,partially_filled,voided) excluded - representative state subset - the account has 62 orders so some states return rows; remaining values share the same filter path.
- placed_agent=user.
- placed_agent=agentic (MCP-placed). Other agents (recurring,drip,...) deferred - open set.
- created_at_gte lower bound (YYYY-MM-DD form).
- order_id lookup - newest order id harvested from get_equity_orders (62 orders exist).
- Resting-order inventory — 'confirmed' is the resting/live state (open/queued return [] even with ~23 resting orders). Run first at session start and again in abort path.

### get_option_orders

**Safety:** read-only · **Status:** probed

Fetch options orders for an account — list mode (newest first; open and closed, including fills, cancellations, and rejections) or single-order mode by passing order_id. When the user asks broadly for "orders" or "my orders" without naming an asset class or order type, call get_equity_orders, get_option_orders, get_crypto_orders, and get_advanced_orders in parallel so OCO groups are not omitted.

Filtering tips:
- Prefer narrow queries: combine state and/or created_at_gte for specific questions — the per-page cap is fixed.
- chain_ids filters by underlying chain UUID (from get_option_chains).
- created_at_gte: interpret relative times in the user's timezone, convert to UTC before sending.

**Parameters (live inputSchema):**

| param | type | required | description |
|---|---|---|---|
| account_number | string | yes | Brokerage account number. Must come from the user or be clearly implied — never default from get_accounts. |
| order_id | string | no | Filter to a single order by UUID. The response shape is unchanged (orders[] with at most one entry); empty when the order does not belong to account_number. |
| state | string | no | Filter by single state: queued, confirmed, partially_filled, filled, rejected, cancelled, failed, voided, pending_cancelled. |
| created_at_gte | string | no | Lower bound (inclusive). ISO 8601 UTC or YYYY-MM-DD; naive values are interpreted as UTC. |
| chain_ids | string | no | Comma-separated chain UUIDs (from get_option_chains) to filter by underlying. |
| underlying_type | string | no | 'equity' or 'index'. |
| placed_agent | string | no | Filter to one source: 'user', 'agentic' (MCP), 'recurring', 'drip', etc. |
| cursor | string | no | Pagination cursor. Omit for the first page; for the next page, pass the prior response's next value back verbatim. |

**Response shape** (union over 14 success capture(s)):

```
data: object
data.orders: array<object>
data.orders[].id: string
data.orders[].chain_id: string
data.orders[].chain_symbol: string
data.orders[].state: string
data.orders[].type: string
data.orders[].trigger: string
data.orders[].direction: string
data.orders[].quantity: string
data.orders[].processed_quantity: string
data.orders[].pending_quantity: string
data.orders[].canceled_quantity: string
data.orders[].price: string
data.orders[].stop_price: null | string
data.orders[].premium: string
data.orders[].processed_premium: string
data.orders[].trade_value_multiplier: string
data.orders[].time_in_force: string
data.orders[].market_hours: string
data.orders[].opening_strategy: null | string
data.orders[].closing_strategy: null | string
data.orders[].placed_agent: string
data.orders[].created_at: string
data.orders[].updated_at: string
data.orders[].last_transaction_at: null
data.orders[].is_replaceable: boolean
data.orders[].legs: array<object>
data.orders[].legs[].id: string
data.orders[].legs[].option_id: string
data.orders[].legs[].side: string
data.orders[].legs[].position_effect: string
data.orders[].legs[].ratio_quantity: number
data.orders[].legs[].expiration_date: string
data.orders[].legs[].strike_price: string
data.orders[].legs[].option_type: string
data.orders[].legs[].executions: array<object>
data.orders[].legs[].executions[].id: string
data.orders[].legs[].executions[].price: string
data.orders[].legs[].executions[].quantity: string
data.orders[].legs[].executions[].settlement_date: string
data.orders[].legs[].executions[].trade_date: string
data.orders[].legs[].executions[].timestamp: string
guide: string
```

**Captures:**

- [dep-opt-orders-13](captures/dep-opt-orders-13.json) — success — order_id param exercised w/ an equity order id (no option orders exist to harvest) - expect not-found/empty.
- [dep-opt-orders-chain](captures/dep-opt-orders-chain.json) — success — chain_ids filter (harvested chain). Account has 0 option orders - expect empty list.
- [opt-orders-confirmed](captures/opt-orders-confirmed.json) — success — Resting option-order inventory — mirrors the equity confirmed-state finding; expected empty.
- [opt-orders-final](captures/opt-orders-final.json) — success — Final resting-order check — UNFILTERED (resting option orders report state 'unconfirmed', not 'confirmed' — a state filter would be blind to a leak). Expect orders:[].
- [ro-opt-orders-01](captures/ro-opt-orders-01.json) — success — Base option order history.
- [ro-opt-orders-02](captures/ro-opt-orders-02.json) — success — underlying_type=equity.
- [ro-opt-orders-03](captures/ro-opt-orders-03.json) — success — underlying_type=index.
- [ro-opt-orders-04](captures/ro-opt-orders-04.json) — success — placed_agent=user.
- [ro-opt-orders-05](captures/ro-opt-orders-05.json) — success — placed_agent=agentic.
- [ro-opt-orders-06](captures/ro-opt-orders-06.json) — success — created_at_gte bound.
- [ro-opt-orders-07](captures/ro-opt-orders-07.json) — success — state=filled. Others (queued,confirmed,partially_filled,failed,pending_cancelled) excluded - same filter path.
- [ro-opt-orders-08](captures/ro-opt-orders-08.json) — success — state=cancelled. Others (queued,confirmed,partially_filled,failed,pending_cancelled) excluded - same filter path.
- [ro-opt-orders-09](captures/ro-opt-orders-09.json) — success — state=rejected. Others (queued,confirmed,partially_filled,failed,pending_cancelled) excluded - same filter path.
- [ro-opt-orders-10](captures/ro-opt-orders-10.json) — success — state=voided. Others (queued,confirmed,partially_filled,failed,pending_cancelled) excluded - same filter path.

**Notes:**

- Base option order history.
- underlying_type=equity.
- underlying_type=index.
- placed_agent=user.
- placed_agent=agentic.
- created_at_gte bound.
- state=filled. Others (queued,confirmed,partially_filled,failed,pending_cancelled) excluded - same filter path.
- state=cancelled. Others (queued,confirmed,partially_filled,failed,pending_cancelled) excluded - same filter path.
- state=rejected. Others (queued,confirmed,partially_filled,failed,pending_cancelled) excluded - same filter path.
- state=voided. Others (queued,confirmed,partially_filled,failed,pending_cancelled) excluded - same filter path.
- chain_ids filter (harvested chain). Account has 0 option orders - expect empty list.
- order_id param exercised w/ an equity order id (no option orders exist to harvest) - expect not-found/empty.
- Resting option-order inventory — mirrors the equity confirmed-state finding; expected empty.
- Final resting-order check — UNFILTERED (resting option orders report state 'unconfirmed', not 'confirmed' — a state filter would be blind to a leak). Expect orders:[].

### place_equity_order

**Safety:** financial mutation · **Status:** probed

Place a real equity order with real money. Parameters mirror review_equity_order plus the optional ref_id. Requires an agentic_allowed=true account; non-agentic accounts are rejected — do not call.

Idempotency: pass a fresh UUID as ref_id on the first call for each logical order, and re-send the SAME ref_id on retries of transient transport failures. Use a new ref_id only when the user wants a new order.

Parameter rules:
- If the user has not specified type, ask. For immediate fills with price protection, prefer a marketable limit at the current ask over a plain market.
- Outside regular hours, only limit orders execute. For an immediate fill during extended or overnight/24-hour sessions, place a limit order (a marketable limit at the current ask) with market_hours set to that session — not a market order. Market and stop orders are regular_hours-only; placed after hours as regular_hours they queue for the next regular open.
- Provide exactly one of quantity or dollar_amount, and take the value from the user — if they did not say how much, ask. Never substitute a default such as 1 share or $100. dollar_amount requires type=market (server computes shares from last_trade_price).
- Fractional shares: only on type=market with market_hours=regular_hours, eligible accounts, up to 6 decimal places, no short sells.
- limit_price required for limit/stop_limit; stop_price required for stop_market/stop_limit.
- Fractional and dollar-based orders only place in regular_hours; the tool rejects them in other sessions.
- tax_lots (specified-lot selling, sell only): to sell specific lots, first call get_equity_tax_lots for the symbol, then pass tax_lots as {open_lot_id, quantity} pairs whose quantities sum to the order quantity. Omit for default (FIFO) cost basis. US accounts only; not allowed with dollar_amount, stop orders, all_day_hours, or fractional limit orders.

**Parameters (live inputSchema):**

| param | type | required | description |
|---|---|---|---|
| account_number | string | yes | Brokerage account number. Must come from the user or be clearly implied — never default from get_accounts. Must be agentic_allowed=true; non-agentic accounts… |
| symbol | string | yes | Stock symbol. |
| side | string | yes | 'buy' or 'sell'. |
| type | string | yes | 'market', 'limit', 'stop_market', or 'stop_limit'. |
| quantity | string | no | Number of shares. Decimals (fractional) allowed for market + regular_hours only. |
| dollar_amount | string | no | USD notional (e.g. '100.00'). Only valid with type=market. |
| limit_price | string | no | Limit price; required for limit or stop_limit. |
| stop_price | string | no | Stop trigger price; required for stop_market or stop_limit. |
| time_in_force | string | no | 'gfd' or 'gtc'. Default: gfd. |
| market_hours | string | no | 'regular_hours' (default, 9:30–16:00 ET), 'extended_hours' (pre-/post-market), or 'all_day_hours' (the 24 Hour Market / overnight session). extended_hours an… |
| tax_lots | null \| array | no | Optional specified-lot selection for a SELL order. To sell specific tax lots instead of the default FIFO cost basis, pass the exact lots as {open_lot_id, qua… |
| ref_id | string | no | Idempotency key (UUID). Generate once per logical order and re-send on retry — the upstream deduplicates by ref_id. Omitting falls back to a server-generated… |

**Response shape** (union over 18 success capture(s)):

```
data: object
data.order: object
data.order.id: string
data.order.ref_id: string
data.order.instrument_id: string
data.order.symbol: string
data.order.side: string
data.order.type: string
data.order.state: string
data.order.quantity: string
data.order.cumulative_quantity: string
data.order.price: null | string
data.order.stop_price: null | string
data.order.average_price: null
data.order.fees: string
data.order.dollar_based_amount: null | object
data.order.dollar_based_amount.amount: string
data.order.dollar_based_amount.currency_code: string
data.order.time_in_force: string
data.order.market_hours: string
data.order.trigger: string
data.order.placed_agent: string
data.order.created_at: string
data.order.last_transaction_at: string
data.order.executions: array<unknown>
guide: string
```

**Errors observed:** 5 capture(s), 4 distinct shape(s)

**Captures:**

- [mut-eq-market-buy-01](captures/mut-eq-market-buy-01.json) — skipped — E1 — 1-share market GFD buy, expected fill. Settle poll uses defaults: new/queued/confirmed pending, 2s interval, 60s timeout.
- [mx-buy-dol5](captures/mx-buy-dol5.json) — success — E7 dollar_amount $5 market — fractional fill
- [mx-buy-gtc](captures/mx-buy-gtc.json) — success — E8 limit buy @ bid gtc — rests, then cancel
- [mx-buy-lim-ask](captures/mx-buy-lim-ask.json) — success — E2 limit buy @ ask — expected fill
- [mx-buy-lim-bid-409-refid](captures/mx-buy-lim-bid-409-refid.json) — error — Hand capture: re-placing a probe with an already-consumed ref_id -> 409 "Reference ID must be unique." — server-enforced idempotency on ref_id.
- [mx-buy-lim-bid-filled](captures/mx-buy-lim-bid-filled.json) — success — Hand capture: limit-buy placed at live bid (19.83) crossed and filled at 19.8299 — documents that at-bid can fill immediately in a tight book.
- [mx-buy-lim-bid](captures/mx-buy-lim-bid.json) — success — E3 limit buy @ bid — rests, then mx-can-bid ref_id is env-driven so the probe can be re-armed after a consumed-UUID rerun.
- [mx-buy-mkt-gfd](captures/mx-buy-mkt-gfd.json) — success — E1 market buy 1 gfd — expected fill
- [mx-buy-stp-hi](captures/mx-buy-stp-hi.json) — success — E4 stop_market buy, stop ABOVE market — rests, then cancel
- [mx-buy-stp-lo](captures/mx-buy-stp-lo.json) — success — E5 stop_market buy, stop BELOW market — fires or rejects (capture which)
- [mx-buy-stplim](captures/mx-buy-stplim.json) — success — E6 stop_limit buy — rests, then cancel
- [mx-sell-flat-xh](captures/mx-sell-flat-xh.json) — success — Post-close flat-out — market sells queue for next session after 16:00 ET; extended_hours executes limit only, so flat-out switches to limit@bid. Fractional remainder may reject or rest until regular hours.
- [mx-sell-flat](captures/mx-sell-flat.json) — success — X8 sell-all market — ends the session flat; set OOMA_ALL_QTY from get_equity_positions ref_id env-driven for re-arm after consumed UUID.
- [mx-sell-frac-flat](captures/mx-sell-frac-flat.json) — success — Residual close-out — the 0.252705 fractional remainder left by mx-sell-flat-xh (fractional is regular_hours-only). Run during regular hours; fills and finishes the flat AC.
- [mx-sell-lim-tgt](captures/mx-sell-lim-tgt.json) — success — X1 sell limit 1 @ +2% target — rests, then cancel
- [mx-sell-lots](captures/mx-sell-lots.json) — error — X6 sell limit w/ tax_lots (real open_lot_id) — rests, then cancel
- [mx-sell-oversell](captures/mx-sell-oversell.json) — error — X7 oversell — qty 999 vs ~2.4 held — capture rejection
- [mx-sell-short](captures/mx-sell-short.json) — error — S1 short probe — sell 1 zero-held symbol — capture short rejection
- [mx-sell-stp-hi](captures/mx-sell-stp-hi.json) — success — X5 sell stop_market ABOVE market — fires or rejects (capture which)
- [mx-sell-stp](captures/mx-sell-stp.json) — success — X2 sell stop_market @ -2% — rests, then cancel
- [mx-sell-stplim](captures/mx-sell-stplim.json) — success — X3 sell stop_limit — rests, then cancel
- [mx-sell-trail-a](captures/mx-sell-trail-a.json) — success — X4a trailing demo — sell stop @ -2%, then cancel+replace at -1.5%
- [mx-sell-trail-b](captures/mx-sell-trail-b.json) — success — X4b replace at -1.5% — the manual trailing-stop pattern
- [mx-sell-xh-frac](captures/mx-sell-xh-frac.json) — error — Deliberate reject — fractional qty in extended_hours. Re-captures the verbatim 'regular_hours-only' error lost when mx-sell-flat-xh attempt-1 was overwritten by its successful rerun. NOT expected to execute; if it ever fills, cancel via mx-can-cleanup pattern.

**Notes:**

- E1 — 1-share market GFD buy, expected fill. Settle poll uses defaults: new/queued/confirmed pending, 2s interval, 60s timeout.
- E1 market buy 1 gfd — expected fill
- E2 limit buy @ ask — expected fill
- E3 limit buy @ bid — rests, then mx-can-bid — ref_id is env-driven so the probe can be re-armed after a consumed-UUID rerun.
- E4 stop_market buy, stop ABOVE market — rests, then cancel
- E5 stop_market buy, stop BELOW market — fires or rejects (capture which)
- E6 stop_limit buy — rests, then cancel
- E7 dollar_amount $5 market — fractional fill
- E8 limit buy @ bid gtc — rests, then cancel
- X1 sell limit 1 @ +2% target — rests, then cancel
- X2 sell stop_market @ -2% — rests, then cancel
- X3 sell stop_limit — rests, then cancel
- X4a trailing demo — sell stop @ -2%, then cancel+replace at -1.5%
- X4b replace at -1.5% — the manual trailing-stop pattern
- X5 sell stop_market ABOVE market — fires or rejects (capture which)
- Executed 2026-10-07: tax_lots path reaches the API but rejects with 400 "Some of your selected lots are no longer available." — all lots report is_selectable:false. Paired mx-can-lots intentionally skipped.
- X7 oversell — qty 999 vs ~2.4 held — capture rejection
- X8 sell-all market — ends the session flat; set OOMA_ALL_QTY from get_equity_positions — ref_id env-driven for re-arm after consumed UUID.
- S1 short probe — sell 1 zero-held symbol — capture short rejection
- Post-close flat-out — market sells queue for next session after 16:00 ET; extended_hours executes limit only, so flat-out switches to limit@bid. Fractional remainder may reject or rest until regular hours.
- Deliberate reject — fractional qty in extended_hours. Re-captures the verbatim 'regular_hours-only' error lost when mx-sell-flat-xh attempt-1 was overwritten by its successful rerun. NOT expected to execute; if it ever fills, cancel via mx-can-cleanup pattern.
- Residual close-out — the 0.252705 fractional remainder left by mx-sell-flat-xh (fractional is regular_hours-only). Run during regular hours; fills and finishes the flat AC.

### place_option_order

**Safety:** financial mutation · **Status:** probed

Place a real options order with real money.

Capability: single-leg options orders — Level 2 strategies (covered calls, cash-secured puts, long calls and puts). Multi-leg spreads (Level 3 strategies) are supported on option_level_3 accounts.

Account requirements: confirm via get_accounts that the chosen account is agentic_allowed=true AND has option_level_2 or option_level_3. If agentic_allowed=false do NOT call. If option_level is empty or option_level_0, do NOT call; follow the get_accounts guide for how to direct the user to enroll.

Alert handling: pre-trade alerts surface only in review_option_order. After the user has acknowledged the reviewed alert, call this tool with the same parameters.

Idempotency: pass a fresh UUID as ref_id on the first call for each logical order, and re-send the SAME ref_id on retries of transient transport failures. Use a new ref_id only when the user wants a new order.

To find option_id: get_option_chains → get_option_instruments filtered by expiration_date/strike_price/type.

Parameter rules:
- Multi-leg leg layouts — vertical spread: two legs, same expiration, different strikes, opposite sides. Calendar: two legs, same strike, different expirations. Iron condor: four legs, a put spread plus a call spread. Roll: close the leg you hold (position_effect 'close', side opposite the position) plus open the replacement ('open').
- Get the net price from the user rather than inferring it from individual leg quotes.
- Multi-leg is not available on cash or retirement accounts through this tool.
- type: 'limit' (default), 'market', 'stop_limit', 'stop_market'. price for limit/stop_limit; stop_price for stop_market/stop_limit.
- market, stop_market, and stop_limit are single-leg only. market and stop_market are also regular_hours, GFD only. stop_market is sell-to-close only with stop_price below the current ask.

Not currently supported anywhere (including the Robinhood apps):
- combo orders. At Robinhood, "combo" specifically means a stock-option combo: one option leg paired with 100 shares of the underlying equity. In broader industry use, "combo" without qualifier sometimes refers to multi-leg option structures.

**Parameters (live inputSchema):**

| param | type | required | description |
|---|---|---|---|
| account_number | string | yes | Brokerage account number. Must come from the user or be clearly implied — never default from get_accounts. Must be agentic_allowed=true. |
| legs | null \| array | yes | 1 to 4 legs, all on the same underlying and each a different contract. Several legs are filled together as one strategy. Should match the legs the user revie… |
| direction | string | no | Net direction of the whole order: 'debit' (you pay the net premium) or 'credit' (you receive it). Required with 2 or more legs; for one leg it is derived fro… |
| type | string | no | 'limit' (default), 'market', 'stop_limit', or 'stop_market'. Should match the type the user reviewed. Only 'limit' is available with 2 or more legs. |
| quantity | string | yes | Positive integer contract count. With several legs it counts whole strategies — each leg fills quantity × its ratio_quantity contracts. |
| price | string | no | Limit price. Per contract for one leg; with several legs it is the net premium of the whole strategy per unit of quantity, always positive — direction says w… |
| stop_price | string | no | Stop trigger price per contract. Required for stop_limit/stop_market; must be omitted for limit/market. |
| time_in_force | string | no | 'gfd' (default) or 'gtc'. Market orders must be 'gfd'. |
| market_hours | string | no | 'regular_hours' (default), 'regular_curb_hours', or 'regular_curb_overnight_hours'. Non-limit-immediate orders only place in regular_hours. CURB requires an … |
| ref_id | string | no | Idempotency key (UUID). Generate once per logical order and re-send on retry. Omitting falls back to a server-generated key. |

**Response shape** (union over 6 success capture(s)):

```
data: object
data.order: object
data.order.id: string
data.order.chain_id: string
data.order.chain_symbol: string
data.order.state: string
data.order.type: string
data.order.trigger: string
data.order.direction: string
data.order.quantity: string
data.order.processed_quantity: string
data.order.pending_quantity: string
data.order.canceled_quantity: string
data.order.price: string
data.order.stop_price: null | string
data.order.premium: string
data.order.processed_premium: string
data.order.trade_value_multiplier: string
data.order.time_in_force: string
data.order.market_hours: string
data.order.opening_strategy: null | string
data.order.closing_strategy: null | string
data.order.placed_agent: string
data.order.created_at: string
data.order.updated_at: string
data.order.last_transaction_at: null
data.order.is_replaceable: boolean
data.order.legs: array<object>
data.order.legs[].id: string
data.order.legs[].option_id: string
data.order.legs[].side: string
data.order.legs[].position_effect: string
data.order.legs[].ratio_quantity: number
data.order.legs[].expiration_date: string
data.order.legs[].strike_price: string
data.order.legs[].option_type: string
guide: string
```

**Errors observed:** 3 capture(s), 3 distinct shape(s)

**Captures:**

- [opt-place-csp](captures/opt-place-csp.json) — success — STO far-OTM put (CSP) @ credit above mark — records the PLACE-level CSP constraint. Expect resting order or collateral reject.
- [opt-place-fill](captures/opt-place-fill.json) — success — BTO limit @ ask — expected fill (task AC). Settle polls get_option_orders account-wide.
- [opt-place-lim](captures/opt-place-lim.json) — success — Place single-leg buy limit FAR below market (NFLX_OPT_PRICE_LO ~ half the mark) — rests, harvest id → opt-can-lim. Expect permission reject if option_level stays empty.
- [opt-place-naked](captures/opt-place-naked.json) — error — STO 195C naked call @ credit 1.00 (mark ~0 — cannot fill). Records the PLACE-level naked-call constraint (review is advisory only). Expect either a resting order or a margin/collateral reject.
- [opt-place-spread](captures/opt-place-spread.json) — error — Place 2-leg vertical spread limit far below mid — rests; harvest id → opt-can-spread.
- [opt-place-stop](captures/opt-place-stop.json) — error — BTO stop_market, trigger above mark — rests, then opt-can-stop.
- [opt-place-stplim](captures/opt-place-stplim.json) — success — BTO stop_limit, trigger above mark — rests, then opt-can-stplim.
- [opt-sell-lim](captures/opt-sell-lim.json) — success — STC limit priced well above mark — rests, then opt-can-stc.
- [opt-sell-mkt](captures/opt-sell-mkt.json) — success — STC market — expected fill, position flat.

**Notes:**

- Place single-leg buy limit FAR below market (NFLX_OPT_PRICE_LO ~ half the mark) — rests, harvest id → opt-can-lim. Expect permission reject if option_level stays empty.
- LIVE FINDING: place_option_order rejects ALL multi-leg orders — 400 'Multi-leg options orders aren't supported in the Robinhood Trading MCP yet. You can still place multi-leg options orders through the app or on web.' The tool description still advertises level-3 spreads; place-time enforcement is the real boundary. opt-can-spread skipped (nothing live).
- BTO limit @ ask — expected fill (task AC). Settle polls get_option_orders account-wide. Disclosure: first attempt failed FORBIDDEN (wrong account number in operator env), capture overwritten by successful rerun — the error record was lost per the known overwrite hazard.
- STC limit priced well above mark — rests, then opt-can-stc.
- STC market — expected fill, position flat.
- LIVE FINDING: stop_market buy-to-open rejected — 400 'Stop market orders aren't supported when buying to open. Select another order type to place this order.' stop_limit BTO IS accepted (opt-place-stplim) — the restriction is stop_market-specific. opt-can-stop skipped (nothing live).
- BTO stop_limit, trigger above mark — rests, then opt-can-stplim.
- LIVE FINDING: naked STO call rejected at place time — 400 'This order introduces infinite risk.' Review sim (opt-rev-naked) surfaces the same constraint only as an advisory order_checks alert inside a success envelope — place is where it's enforced. opt-can-naked skipped (nothing live).
- CSP STO put (40P) @ credit above mark — ACCEPTED and rested (opening_strategy short_put), cancelled via opt-can-csp. Contrast with naked-call reject: cash-secured collateral (review showed cash debit 4000 = strike×100) clears the risk check.

### review_equity_order

**Safety:** simulation · **Status:** probed

Simulate a stock order without placing it. Returns the current quote plus pre-trade alerts (buying power, PDT, instrument halt, etc.). Call this by default before place_equity_order unless the user has very explicitly asked to skip review. Requires an agentic_allowed=true account; non-agentic accounts are rejected — do not call.

Parameter rules:
- If the user has not specified type, ask. For immediate fills with price protection, prefer a marketable limit at the current ask over a plain market.
- Outside regular hours, only limit orders execute. For an immediate fill during extended or overnight/24-hour sessions, place a limit order (a marketable limit at the current ask) with market_hours set to that session — not a market order. Market and stop orders are regular_hours-only; placed after hours as regular_hours they queue for the next regular open.
- Provide exactly one of quantity or dollar_amount, and take the value from the user — if they did not say how much, ask. Never substitute a default such as 1 share or $100. dollar_amount requires type=market (server computes shares from last_trade_price).
- Fractional shares: only on type=market with market_hours=regular_hours, eligible accounts, up to 6 decimal places, no short sells.
- limit_price required for limit/stop_limit; stop_price required for stop_market/stop_limit.
- Fractional and dollar-based orders only place in regular_hours; the tool rejects them in other sessions.
- tax_lots (specified-lot selling, sell only): to sell specific lots, first call get_equity_tax_lots for the symbol, then pass tax_lots as {open_lot_id, quantity} pairs whose quantities sum to the order quantity. Omit for default (FIFO) cost basis. US accounts only; not allowed with dollar_amount, stop orders, all_day_hours, or fractional limit orders.

**Parameters (live inputSchema):**

| param | type | required | description |
|---|---|---|---|
| account_number | string | yes | Brokerage account number. Must come from the user or be clearly implied — never default from get_accounts. Must be agentic_allowed=true; non-agentic accounts… |
| symbol | string | yes | Stock symbol. |
| side | string | yes | 'buy' or 'sell'. |
| type | string | yes | 'market', 'limit', 'stop_market', or 'stop_limit'. |
| quantity | string | no | Number of shares. Decimals (fractional) allowed for market + regular_hours only. |
| dollar_amount | string | no | USD notional (e.g. '100.00'). Only valid with type=market. |
| limit_price | string | no | Limit price; required for limit or stop_limit. |
| stop_price | string | no | Stop trigger price; required for stop_market or stop_limit. |
| time_in_force | string | no | 'gfd' (good for day) or 'gtc' (good till cancelled). Default: gfd. |
| market_hours | string | no | 'regular_hours' (default, 9:30–16:00 ET), 'extended_hours' (pre-/post-market), or 'all_day_hours' (the 24 Hour Market / overnight session). extended_hours an… |
| tax_lots | null \| array | no | Optional specified-lot selection for a SELL order. To sell specific tax lots instead of the default FIFO cost basis, pass the exact lots as {open_lot_id, qua… |

**Response shape** (union over 20 success capture(s)):

```
data: object
data.symbol: string
data.side: string
data.type: string
data.quantity: string
data.limit_price: string
data.order_checks: object
data.order_checks.alertType: string
data.order_checks.equityMaxSellSharesExceededAlertDetails: object
data.order_checks.equityMaxSellSharesExceededAlertDetails.instrumentId: string
data.order_checks.equityMaxSellSharesExceededAlertDetails.instrumentSymbol: string
data.order_checks.equityMaxSellSharesExceededAlertDetails.sharesCanSell: string
data.order_checks.equityMaxSellSharesExceededAlertDetails.sharesOptionsCollateral: string
data.order_checks.equityMaxSellSharesExceededAlertDetails.sharesOwned: string
data.order_checks.equityMaxSellSharesExceededAlertDetails.sharesPendingFromOptionsEvents: string
data.order_checks.equityMaxSellSharesExceededAlertDetails.sharesPendingSell: string
data.order_checks.equityMaxSellSharesExceededAlertDetails.sharesRewards: string
data.order_checks.equityAllDayTradingAlertDetails: object
data.order_checks.equityAllDayTradingAlertDetails.reason: string
data.quote_data: object
data.quote_data.symbol: string
data.quote_data.last_trade_price: string
data.quote_data.venue_last_trade_time: string
data.quote_data.last_non_reg_trade_price: null | string
data.quote_data.venue_last_non_reg_trade_time: null | string
data.quote_data.adjusted_previous_close: string
data.quote_data.previous_close: string
data.quote_data.previous_close_date: string
data.quote_data.bid_price: string
data.quote_data.venue_bid_time: string
data.quote_data.ask_price: string
data.quote_data.venue_ask_time: string
data.quote_data.has_traded: boolean
data.quote_data.state: string
data.market_data_disclosure: string
data.dollar_amount: string
data.stop_price: string
guide: string
```

**Captures:**

- [dep-rev-eq-09](captures/dep-rev-eq-09.json) — success — tax_lots specified-lot sell - open_lot_id harvested from dep-eq-taxlots-02 (MSFT, qty_available=1).
- [mx-rev-buy-dol](captures/mx-rev-buy-dol.json) — success — review: $5 dollar_amount market buy
- [mx-rev-buy-lim](captures/mx-rev-buy-lim.json) — success — review: limit buy @ ask
- [mx-rev-buy-mkt](captures/mx-rev-buy-mkt.json) — success — review: market buy 1 gfd
- [mx-rev-buy-stp](captures/mx-rev-buy-stp.json) — success — review: stop_market buy
- [mx-rev-buy-stplim](captures/mx-rev-buy-stplim.json) — success — review: stop_limit buy
- [mx-rev-sell-lim](captures/mx-rev-sell-lim.json) — success — review: sell limit @ target
- [mx-rev-sell-lots](captures/mx-rev-sell-lots.json) — success — review: sell limit w/ tax_lots
- [mx-rev-sell-mkt](captures/mx-rev-sell-mkt.json) — success — review: sell market
- [mx-rev-sell-short](captures/mx-rev-sell-short.json) — success — Review sim: sell a zero-held symbol — does the advisory layer flag a short sale, or return success like the options advisory divergences? Place side already captured: mx-sell-short 400 'Not enough shares to sell.'
- [mx-rev-sell-stp](captures/mx-rev-sell-stp.json) — success — review: sell stop_market
- [mx-rev-sell-stplim](captures/mx-rev-sell-stplim.json) — success — review: sell stop_limit
- [ro-rev-eq-01](captures/ro-rev-eq-01.json) — success — market + quantity - baseline review shape.
- [ro-rev-eq-02](captures/ro-rev-eq-02.json) — success — market + dollar_amount (notional path).
- [ro-rev-eq-03](captures/ro-rev-eq-03.json) — success — limit + limit_price + tif=gtc.
- [ro-rev-eq-04](captures/ro-rev-eq-04.json) — success — stop_market sell + stop_price (stop direction semantics data point).
- [ro-rev-eq-05](captures/ro-rev-eq-05.json) — success — stop_limit sell + stop+limit.
- [ro-rev-eq-06](captures/ro-rev-eq-06.json) — success — market_hours=extended_hours.
- [ro-rev-eq-07](captures/ro-rev-eq-07.json) — success — market_hours=all_day_hours (24h market session).
- [ro-rev-eq-08](captures/ro-rev-eq-08.json) — success — Explicit regular_hours + gfd defaults.

**Notes:**

- market + quantity - baseline review shape.
- market + dollar_amount (notional path).
- limit + limit_price + tif=gtc.
- stop_market sell + stop_price (stop direction semantics data point).
- stop_limit sell + stop+limit.
- market_hours=extended_hours.
- market_hours=all_day_hours (24h market session).
- Explicit regular_hours + gfd defaults.
- tax_lots specified-lot sell - open_lot_id harvested from dep-eq-taxlots-02 (MSFT, qty_available=1).
- review: market buy 1 gfd
- review: limit buy @ ask
- review: stop_market buy
- review: stop_limit buy
- review: $5 dollar_amount market buy
- review: sell limit @ target
- review: sell stop_market
- review: sell stop_limit
- review: sell limit w/ tax_lots
- review: sell market
- Review sim: sell a zero-held symbol — does the advisory layer flag a short sale, or return success like the options advisory divergences? Place side already captured: mx-sell-short 400 'Not enough shares to sell.'

### review_option_order

**Safety:** simulation · **Status:** probed

Simulate an options order without placing it. Returns the current quote plus pre-trade alerts. Call this by default before place_option_order or replace_option_order unless the user has very explicitly asked to skip review.

Capability: single-leg options orders — Level 2 strategies (covered calls, cash-secured puts, long calls and puts). Multi-leg spreads (Level 3 strategies) are supported on option_level_3 accounts.

Account requirements: confirm via get_accounts that the chosen account is agentic_allowed=true AND has option_level_2 or option_level_3. If agentic_allowed=false do NOT call. If option_level is empty or option_level_0, do NOT call; follow the get_accounts guide for how to direct the user to enroll.

Parameter rules:
- legs: option_id (from get_option_instruments), side, position_effect, optional ratio_quantity per leg.
- Multi-leg leg layouts — vertical spread: two legs, same expiration, different strikes, opposite sides. Calendar: two legs, same strike, different expirations. Iron condor: four legs, a put spread plus a call spread. Roll: close the leg you hold (position_effect 'close', side opposite the position) plus open the replacement ('open').
- Get the net price from the user rather than inferring it from individual leg quotes.
- Multi-leg is not available on cash or retirement accounts through this tool.
- type: 'limit' (default), 'market', 'stop_limit', 'stop_market'. If unspecified, ask. price for limit/stop_limit; stop_price for stop_market/stop_limit.
- market, stop_market, and stop_limit are single-leg only. market and stop_market are also GFD, regular_hours only. stop_market is sell-to-close only with stop_price below the current ask. Non-limit-immediate types are blocked in any extended-hours session.
- Surface order_checks alerts verbatim — the detail strings carry the actual time/contract/BP values for the user.

**Parameters (live inputSchema):**

| param | type | required | description |
|---|---|---|---|
| account_number | string | yes | Brokerage account number. Must come from the user or be clearly implied — never default from get_accounts. Must be agentic_allowed=true. |
| legs | null \| array | yes | 1 to 4 legs, all on the same underlying and each a different contract. Several legs are filled together as one strategy. |
| direction | string | no | Net direction of the whole order: 'debit' (you pay the net premium) or 'credit' (you receive it). Required with 2 or more legs; for one leg it is derived fro… |
| type | string | no | 'limit' (default), 'market', 'stop_limit', or 'stop_market'. Only 'limit' is available with 2 or more legs. |
| quantity | string | yes | Positive integer contract count. With several legs it counts whole strategies — each leg fills quantity × its ratio_quantity contracts. |
| price | string | no | Limit price (e.g. '1.50'). Per contract for one leg; with several legs it is the net premium of the whole strategy per unit of quantity, always positive — di… |
| stop_price | string | no | Stop trigger price per contract. Required for stop_limit/stop_market; must be omitted for limit/market. For sell-side stop_market, must be below the current … |
| time_in_force | string | no | 'gfd' (default) or 'gtc'. Market orders must be 'gfd'. |
| market_hours | string | no | 'regular_hours' (default), 'regular_curb_hours', or 'regular_curb_overnight_hours'. Extended-hours sessions only accept limit+immediate. CURB requires an ind… |
| chain_symbol | string | no | Underlying ticker (e.g. 'AAPL', 'SPXW'). Supply alongside underlying_type to include fees and collateral in the response — always do so when known. |
| underlying_type | string | no | 'equity' or 'index'. Required alongside chain_symbol to enable the fee + collateral fetch. |

**Response shape** (union over 23 success capture(s)):

```
data: object
data.account_number: string
data.type: string
data.direction: string
data.quantity: string
data.legs: array<object>
data.legs[].option_id: string
data.legs[].side: string
data.legs[].position_effect: string
data.legs[].ratio_quantity: number
data.order_checks: object
data.order_checks.alertType: string
data.order_checks.details: object
data.order_checks.details.isSingleLeg: boolean
data.order_checks.details.spread: object
data.order_checks.details.spread.amount: string
data.order_checks.details.spread.currency: string
data.order_checks.details.direction: string
data.order_checks.details.askPrice: object
data.order_checks.details.askPrice.amount: string
data.order_checks.details.askPrice.currency: string
data.order_checks.details.bidPrice: object
data.order_checks.details.bidPrice.amount: string
data.order_checks.details.bidPrice.currency: string
data.order_checks.details.orderTime: string
data.order_checks.details.stopPrice: object
data.order_checks.details.stopPrice.amount: string
data.order_checks.details.stopPrice.currency: string
data.order_checks.details.instruments: array<object>
data.order_checks.details.instruments[].symbol: string
data.order_checks.details.instruments[].strikePrice: string
data.order_checks.details.instruments[].type: string
data.order_checks.details.instruments[].expirationDate: string
data.order_checks.details.instruments[].underlyingType: string
data.order_checks.details.orderQuantity: string
data.order_checks.details.underlyingSymbols: array<string>
data.order_checks.details.underlyingType: string
data.option_quotes: array<object>
data.option_quotes[].instrument_id: string
data.option_quotes[].ask_price: string
data.option_quotes[].ask_size: number
data.option_quotes[].bid_price: string
data.option_quotes[].bid_size: number
data.option_quotes[].break_even_price: string
data.option_quotes[].adjusted_mark_price: string
data.option_quotes[].mark_price: string
data.option_quotes[].high_fill_rate_buy_price: string
data.option_quotes[].low_fill_rate_buy_price: string
data.option_quotes[].high_fill_rate_sell_price: string
data.option_quotes[].low_fill_rate_sell_price: string
data.option_quotes[].previous_close_price: string
data.option_quotes[].previous_close_date: string
data.option_quotes[].implied_volatility: null | string
data.option_quotes[].delta: null | string
data.option_quotes[].gamma: null | string
data.option_quotes[].rho: null | string
data.option_quotes[].theta: null | string
data.option_quotes[].vega: null | string
data.option_quotes[].open_interest: number
data.option_quotes[].volume: number
data.option_quotes[].chance_of_profit_long: null | string
data.option_quotes[].chance_of_profit_short: null | string
data.option_quotes[].updated_at: string
data.price: string
data.fees: object
data.fees.occ_fee: object
data.fees.occ_fee.fee_rate: string
data.fees.occ_fee.fee: string
data.fees.or_fee: object
data.fees.or_fee.fee_rate: string
data.fees.or_fee.fee: string
data.fees.contract_fee: object
data.fees.contract_fee.fee_rate: string
data.fees.contract_fee.fee: string
data.fees.exchange_fee: object
data.fees.exchange_fee.fee_rate: string
data.fees.exchange_fee.fee: string
data.fees.cat_fee: object
data.fees.cat_fee.fee_rate: string
data.fees.cat_fee.fee: string
data.fees.gold_fee_savings: object
data.fees.gold_fee_savings.fee_saving_rate: string
data.fees.gold_fee_savings.fee_total_savings: string
data.fees.sales_taxes: array<unknown>
data.fees.is_gold: boolean
data.fees.total_fee: string
data.collateral: object
data.collateral.account_number: string
data.collateral.cash: object
data.collateral.cash.amount: string
data.collateral.cash.direction: string
data.collateral.cash.infinite: boolean
data.collateral.equities: array<object>
data.collateral.equities[].instrument_id: string
data.collateral.equities[].instrument: string
data.collateral.equities[].symbol: string
data.collateral.equities[].quantity: string
data.collateral.equities[].direction: string
data.collateral.equities[].uncovered_shares: string
data.time_in_force: string
data.market_hours: string
data.stop_price: string
guide: string
```

**Errors observed:** 4 capture(s), 4 distinct shape(s)

**Captures:**

- [dep-rev-opt-01](captures/dep-rev-opt-01.json) — success — Single-leg buy-to-open market (market forces gfd). NFLX 2026-11-20 $2.5 call.
- [dep-rev-opt-02](captures/dep-rev-opt-02.json) — success — Single-leg limit, direction=debit.
- [dep-rev-opt-03](captures/dep-rev-opt-03.json) — success — Single-leg sell-to-open, direction=credit.
- [dep-rev-opt-04](captures/dep-rev-opt-04.json) — success — Multi-leg: NFLX Nov-20 $2.5/$5 call debit spread (buy 2.5c, sell 5c, same expiry).
- [dep-rev-opt-05](captures/dep-rev-opt-05.json) — success — chain_symbol + underlying_type=equity supplied - exercises the per-contract fee path.
- [dep-rev-opt-06](captures/dep-rev-opt-06.json) — success — position_effect=close with no open position - expect a refusal/error (discovery).
- [dep-rev-opt-07](captures/dep-rev-opt-07.json) — success — time_in_force=gtc on a limit.
- [dep-rev-opt-08](captures/dep-rev-opt-08.json) — error — market_hours=regular_market_hours explicit.
- [dep-rev-opt-10](captures/dep-rev-opt-10.json) — success — market_hours=regular_hours (valid enum; dep-rev-opt-08 captured the invalid regular_market_hours error).
- [dep-rev-opt-11](captures/dep-rev-opt-11.json) — error — stop_price on a single-leg buy stop - exercises stop order semantics.
- [dep-rev-opt-12](captures/dep-rev-opt-12.json) — success — type=stop_market + stop_price (valid enum per dep-rev-opt-11 error).
- [dep-rev-opt-13](captures/dep-rev-opt-13.json) — success — type=stop_limit (single-leg only per schema) + stop_price + price.
- [dep-rev-opt-14](captures/dep-rev-opt-14.json) — success — ratio_quantity exercised - 1x2 call ratio spread (buy 1x $2.5c, sell 2x $5c).
- [dep-rev-opt-15](captures/dep-rev-opt-15.json) — error — 4-leg order (mixed expiries Oct-16 puts + Nov-20 calls) - max legs bound.
- [dep-rev-opt-16](captures/dep-rev-opt-16.json) — success — 4-leg order, direction=debit (dep-rev-opt-15 captured the direction-mismatch error: live-pricing validation).
- [dep-rev-opt-17](captures/dep-rev-opt-17.json) — success — INDEX option leg (SPXW 2026-10-06 $3200p) + underlying_type=index + market_hours=regular_curb_hours.
- [dep-rev-opt-18](captures/dep-rev-opt-18.json) — success — market_hours=regular_curb_overnight_hours on the same SPXW leg.
- [opt-rev-close-nopos](captures/opt-rev-close-nopos.json) — success — Constraint probe: position_effect=close with no open position — capture the reject.
- [opt-rev-credit](captures/opt-rev-credit.json) — success — Review sim: single-leg sell-to-open (credit) — collateral/margin requirement surface; expect reject on a level-less cash acct.
- [opt-rev-csp](captures/opt-rev-csp.json) — success — Review sim: cash-secured STO put — collateral surface for CSP constraint (spec AC).
- [opt-rev-mkt-gtc](captures/opt-rev-mkt-gtc.json) — success — Constraint probe: market + gtc — schema says market must be gfd; captures the reject text.
- [opt-rev-naked](captures/opt-rev-naked.json) — success — Review sim: naked STO call (195C, max strike) WITH chain_symbol+underlying_type hints — the fee/collateral-fields variant inside opt-matrix (spec AC).
- [opt-rev-single-lim](captures/opt-rev-single-lim.json) — success — Review sim: single-leg buy-to-open limit debit — the baseline happy path. Captures fee/collateral fields.
- [opt-rev-single-mkt](captures/opt-rev-single-mkt.json) — success — Review sim: single-leg market — captures market-order envelope + any extended-hours constraint.
- [opt-rev-spread-lim](captures/opt-rev-spread-lim.json) — success — Review sim: 2-leg vertical debit spread — direction=debit, net-premium limit. The multi-leg baseline.
- [opt-rev-spread-mkt](captures/opt-rev-spread-mkt.json) — error — Constraint probe: multi-leg market — schema says limit-only with 2+ legs; captures reject text.
- [opt-rev-stop](captures/opt-rev-stop.json) — success — Review sim: stop_market single leg — stop_price semantics on options.

**Notes:**

- Single-leg buy-to-open market (market forces gfd). NFLX 2026-11-20 $2.5 call.
- Single-leg limit, direction=debit.
- Single-leg sell-to-open, direction=credit.
- Multi-leg: NFLX Nov-20 $2.5/$5 call debit spread (buy 2.5c, sell 5c, same expiry).
- chain_symbol + underlying_type=equity supplied - exercises the per-contract fee path.
- position_effect=close with no open position - review does NOT refuse it (observed success; no position check at review time).
- time_in_force=gtc on a limit.
- market_hours=regular_market_hours explicit.
- market_hours=regular_hours (valid enum; dep-rev-opt-08 captured the invalid regular_market_hours error).
- stop_price on a single-leg buy stop - exercises stop order semantics.
- type=stop_market + stop_price (valid enum per dep-rev-opt-11 error).
- type=stop_limit (single-leg only per schema) + stop_price + price.
- ratio_quantity exercised - 1x2 call ratio spread (buy 1x $2.5c, sell 2x $5c).
- 4-leg order (mixed expiries Oct-16 puts + Nov-20 calls) - max legs bound.
- 4-leg order, direction=debit (dep-rev-opt-15 captured the direction-mismatch error: live-pricing validation).
- INDEX option leg (SPXW 2026-10-06 $3200p) + underlying_type=index + market_hours=regular_curb_hours.
- market_hours=regular_curb_overnight_hours on the same SPXW leg.
- Review sim: single-leg buy-to-open limit debit — the baseline happy path. Captures fee/collateral fields.
- Review sim: single-leg market — captures market-order envelope + any extended-hours constraint.
- Constraint probe: market + gtc — schema says market must be gfd; captures the reject text.
- Review sim: 2-leg vertical debit spread — direction=debit, net-premium limit. The multi-leg baseline.
- Constraint probe: multi-leg market — schema says limit-only with 2+ legs; captures reject text.
- Review sim: single-leg sell-to-open (credit) — collateral/margin requirement surface; expect reject on a level-less cash acct.
- Review sim: stop_market single leg — stop_price semantics on options.
- Constraint probe: position_effect=close with no open position — capture the reject.
- Review sim: naked STO call (195C, max strike) WITH chain_symbol+underlying_type hints — the fee/collateral-fields variant inside opt-matrix (spec AC).
- Review sim: cash-secured STO put — collateral surface for CSP constraint (spec AC).


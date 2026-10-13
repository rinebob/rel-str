# Robinhood MCP — Crypto

> Part of the [canonical tool discovery](rh-mcp-tool-discovery-canonical-657-658-689.md) — 8 tools in this group.

### cancel_crypto_order

**Safety:** financial mutation · **Status:** error-only

Cancel an open crypto order by order_id. Always confirm with the user before calling. Resolve order_id via get_crypto_orders if the user refers to it by description; pass the same rhs_account_number that owns the order. Cancellation may be rejected if the order has already filled, was already canceled, or is otherwise ineligible.

**Parameters (live inputSchema):**

| param | type | required | description |
|---|---|---|---|
| rhs_account_number | string | yes | Numeric brokerage account number (the 'rhs_account_number' field on get_accounts entries — distinct from the alphanumeric 'account_number'). The order must b… |
| order_id | string | yes | Order UUID from get_crypto_orders. Must belong to rhs_account_number. Required. |

**Errors observed:** 1 capture(s), 1 distinct shape(s)

**Captures:**

- [cx-cancel](captures/cx-cancel.json) — error — Cancel a nil order_id — observes the tool's error envelope on this account (cx-place rejected 'no crypto account linked', so no live order exists to cancel). Re-arm with a real CX_ORDER_ID on a crypto-enabled account for a success-path capture.

**Notes:**

- Cancel a nil order_id — observes the tool's error envelope on this account (cx-place rejected 'no crypto account linked', so no live order exists to cancel). Re-arm with a real CX_ORDER_ID on a crypto-enabled account for a success-path capture.

### get_crypto_account_onboarding_info

**Safety:** read-only · **Status:** probed

Get the link a user opens to sign the crypto agreement and open a crypto account. Call when the user wants to trade crypto but has no crypto account.

**Parameters (live inputSchema):**

_No parameters._

**Response shape** (union over 1 success capture(s)):

```
data: object
data.already_onboarded: boolean
data.onboarding_url: string
guide: string
```

**Captures:**

- [ro-crypto-onboard-01](captures/ro-crypto-onboard-01.json) — success — Zero-param onboarding state.

**Notes:**

- Zero-param onboarding state.

### get_crypto_orders

**Safety:** read-only · **Status:** error-only

List crypto order history for an account — newest first. Open and closed orders, including fills, cancellations, and rejections. Pass order_id to retrieve a single order by UUID.

Filtering tips:
- Prefer narrow queries: combine state (or state_group), symbol, and/or created_at_gte for specific questions.
- created_at_gte: interpret relative times in the user's timezone, convert to UTC before sending.
- updated_at_gte: useful when polling for order fills or state transitions.
- symbol triggers a symbol→currency_pair_id lookup; omit it if you don't need it.

When the user asks broadly for "orders" or "my orders" without naming an asset class or order type, call get_equity_orders, get_option_orders, get_crypto_orders, and get_advanced_orders in parallel so OCO groups are not omitted.

For requests spanning all accounts, re-fetch the account list with get_accounts first — a list from earlier in the conversation may be missing newly created accounts.

**Parameters (live inputSchema):**

| param | type | required | description |
|---|---|---|---|
| rhs_account_number | string | yes | Numeric brokerage account number (the 'rhs_account_number' field on get_accounts entries — distinct from the alphanumeric 'account_number'). Required. |
| order_id | string | no | Filter to a single order by UUID. The response shape is unchanged (results[] with at most one entry); empty when the order does not belong to the account. |
| state | string | no | Filter by single state: queued, confirmed, partially_filled, filled, canceled, rejected, failed, voided. For open-vs-closed shortcuts, use state_group instead. |
| state_group | string | no | Filter by state group: 'open' or 'closed'. Quick shortcut — 'open' covers queued/confirmed/partially_filled, 'closed' covers filled/canceled/rejected/failed/… |
| side | string | no | Filter by side: 'buy' or 'sell'. |
| symbol | string | no | Filter by crypto symbol (e.g. 'BTC', 'ETH', or 'BTC-USD'). Triggers a symbol→currency_pair_id lookup before the orders call. |
| created_at_gte | string | no | Lower bound (inclusive) on created_at. ISO 8601 UTC; naive values are interpreted as UTC. |
| updated_at_gte | string | no | Lower bound (inclusive) on updated_at. ISO 8601 UTC. Useful for polling for fills — each state transition bumps updated_at. |
| cursor | string | no | Pagination cursor. Omit for the first page; for the next page, pass the prior response's next value back verbatim. |

**Errors observed:** 13 capture(s), 1 distinct shape(s)

**Captures:**

- [dep-crypto-orders-13](captures/dep-crypto-orders-13.json) — error — order_id param exercised (synthetic id) - will fail at crypto-account gate like the other crypto probes.
- [ro-crypto-orders-01](captures/ro-crypto-orders-01.json) — error — Base crypto orders.
- [ro-crypto-orders-02](captures/ro-crypto-orders-02.json) — error — symbol filter (symbol->pair lookup).
- [ro-crypto-orders-03](captures/ro-crypto-orders-03.json) — error — side=buy.
- [ro-crypto-orders-04](captures/ro-crypto-orders-04.json) — error — side=sell.
- [ro-crypto-orders-05](captures/ro-crypto-orders-05.json) — error — state_group=open.
- [ro-crypto-orders-06](captures/ro-crypto-orders-06.json) — error — state_group=closed.
- [ro-crypto-orders-07](captures/ro-crypto-orders-07.json) — error — state=filled. Others (queued,confirmed,partially_filled,failed) excluded - same filter path.
- [ro-crypto-orders-08](captures/ro-crypto-orders-08.json) — error — state=canceled. Others (queued,confirmed,partially_filled,failed) excluded - same filter path.
- [ro-crypto-orders-09](captures/ro-crypto-orders-09.json) — error — state=rejected. Others (queued,confirmed,partially_filled,failed) excluded - same filter path.
- [ro-crypto-orders-10](captures/ro-crypto-orders-10.json) — error — state=voided. Others (queued,confirmed,partially_filled,failed) excluded - same filter path.
- [ro-crypto-orders-11](captures/ro-crypto-orders-11.json) — error — created_at_gte bound.
- [ro-crypto-orders-12](captures/ro-crypto-orders-12.json) — error — updated_at_gte bound.

**Notes:**

- Base crypto orders.
- symbol filter (symbol->pair lookup).
- side=buy.
- side=sell.
- state_group=open.
- state_group=closed.
- state=filled. Others (queued,confirmed,partially_filled,failed) excluded - same filter path.
- state=canceled. Others (queued,confirmed,partially_filled,failed) excluded - same filter path.
- state=rejected. Others (queued,confirmed,partially_filled,failed) excluded - same filter path.
- state=voided. Others (queued,confirmed,partially_filled,failed) excluded - same filter path.
- created_at_gte bound.
- updated_at_gte bound.
- order_id param exercised (synthetic id) - will fail at crypto-account gate like the other crypto probes.

### get_crypto_positions

**Safety:** read-only · **Status:** probed

List open crypto positions for a specific brokerage account. Returns asset, quantity, transferable amount, and cost-basis breakdown.

**Parameters (live inputSchema):**

| param | type | required | description |
|---|---|---|---|
| rhs_account_number | string | yes | Numeric brokerage account number (the 'rhs_account_number' field on get_accounts entries — distinct from the alphanumeric 'account_number'). Required. Do NOT… |
| cursor | string | no | Pagination cursor. Omit for the first page; for the next page, pass the prior response's next value back verbatim. |

**Response shape** (union over 1 success capture(s)):

```
data: object
data.results: array<unknown>
guide: string
```

**Captures:**

- [ro-crypto-pos-01](captures/ro-crypto-pos-01.json) — success — Crypto positions.

**Notes:**

- Crypto positions.

### get_crypto_quotes

**Safety:** read-only · **Status:** probed

Get real-time bid/ask/mark prices plus the previous close for one or more crypto pair symbols (e.g. BTC-USD).

**Parameters (live inputSchema):**

| param | type | required | description |
|---|---|---|---|
| symbols | null \| array | yes | One or more crypto pair symbols (e.g. 'BTC-USD', 'ETH-USD'). Hyphenated and unhyphenated forms are both accepted on input; the response symbol field comes ba… |
| timezone | string | no | Optional IANA timezone name (e.g. 'America/New_York', 'America/Los_Angeles') that anchors the previous-close (open_price) day boundary to the user's local mi… |
| rhs_account_number | string | no | Optional numeric brokerage account number (the 'rhs_account_number' from get_accounts). When supplied, bid/ask/mark and the previous close are priced on this… |

**Response shape** (union over 4 success capture(s)):

```
data: object
data.results: array<object>
data.results[].symbol: string
data.results[].id: string
data.results[].bid_price: string
data.results[].bid_time: string
data.results[].ask_price: string
data.results[].ask_time: string
data.results[].mark_price: string
data.results[].open_price: string
data.results[].routing: string
data.results[].updated_at: string
guide: string
```

**Captures:**

- [err-crypto-bad-pair](captures/err-crypto-bad-pair.json) — success — Deliberate error: nonexistent currency pair.
- [ro-crypto-quotes-01](captures/ro-crypto-quotes-01.json) — success — Multi-pair quotes.
- [ro-crypto-quotes-02](captures/ro-crypto-quotes-02.json) — success — IANA timezone for prev-close anchoring.
- [ro-crypto-quotes-03](captures/ro-crypto-quotes-03.json) — success — With account context (bid/ask personalization).

**Notes:**

- Multi-pair quotes.
- IANA timezone for prev-close anchoring.
- With account context (bid/ask personalization).
- Deliberate error: nonexistent currency pair.

### get_currency_pairs

**Safety:** read-only · **Status:** probed

List Robinhood-supported crypto currency pairs (e.g. BTC-USD, ETH-USD), including any with an active trading halt. Catalog-only coins that Robinhood does not offer are excluded. Use this to discover symbols and per-pair order constraints before calling get_crypto_quotes or referencing positions.

**Parameters (live inputSchema):**

| param | type | required | description |
|---|---|---|---|
| cursor | string | no | Pagination cursor. Omit for the first page; for the next page, pass the prior response's next value back verbatim. |
| limit | integer | no | Maximum number of pairs to return on this page (clamped to [1, 700]). Defaults to 25 to keep the response sized for an agent's context window; raise it when … |

**Response shape** (union over 4 success capture(s)):

```
data: object
data.results: array<object>
data.results[].id: string
data.results[].symbol: string
data.results[].display_symbol: string
data.results[].name: string
data.results[].asset_currency: object
data.results[].asset_currency.id: string
data.results[].asset_currency.code: string
data.results[].asset_currency.name: string
data.results[].asset_currency.type: string
data.results[].quote_currency: object
data.results[].quote_currency.id: string
data.results[].quote_currency.code: string
data.results[].quote_currency.name: string
data.results[].quote_currency.type: string
data.results[].tradability: string
data.results[].tradability_by_account_type: object
data.results[].tradability_by_account_type.individual: string
data.results[].tradability_by_account_type.ira_roth: string
data.results[].tradability_by_account_type.ira_traditional: string
data.results[].display_only: boolean
data.results[].min_order_size: string
data.results[].max_order_size: string
data.results[].min_order_quantity_increment: string
data.results[].min_order_price_increment: string
data.results[].market_orders_only: boolean
data.results[].type: string
data.results[].halted: boolean
data.results[].halted_regions: array<string>
data.next: string
guide: string
```

**Captures:**

- [dep-pairs-cur-01](captures/dep-pairs-cur-01.json) — success — PAGINATION FOLLOW: cursor harvested from ro-crypto-pairs-02 data.next.
- [dep-pairs-cur-02](captures/dep-pairs-cur-02.json) — success — PAGINATION FOLLOW p3 - cursor from dep-pairs-cur-01 data.next.
- [ro-crypto-pairs-01](captures/ro-crypto-pairs-01.json) — success — Base pairs page (default limit 25).
- [ro-crypto-pairs-02](captures/ro-crypto-pairs-02.json) — success — limit=5 - should yield next_cursor for wave-2 follow.

**Notes:**

- Base pairs page (default limit 25).
- limit=5 - should yield next_cursor for wave-2 follow.
- PAGINATION FOLLOW: cursor harvested from ro-crypto-pairs-02 data.next.
- PAGINATION FOLLOW p3 - cursor from dep-pairs-cur-01 data.next.

### place_crypto_order

**Safety:** financial mutation · **Status:** error-only

Place a real crypto order with real money. Parameters mirror preview_crypto_order plus the optional ref_id. Requires an agentic-enabled crypto account.

Idempotency: pass a fresh UUID as ref_id on the first call for each logical order, and re-send the SAME ref_id on retries of transient failures. Use a new ref_id only when the user wants a new order.

Parameter rules:
- Provide exactly one of quantity or dollar_amount; dollar_amount works with every type.
- limit_price is required for limit and stop_limit; stop_price is required for stop_loss and stop_limit.
- symbol is resolved to a currency pair before placement; pass a bare asset symbol (e.g. 'BTC') or a pair ('BTC-USD').

**Parameters (live inputSchema):**

| param | type | required | description |
|---|---|---|---|
| rhs_account_number | string | yes | Numeric brokerage account number (the 'rhs_account_number' field on get_accounts entries — distinct from the alphanumeric 'account_number'). Must be an agent… |
| symbol | string | yes | Crypto symbol (e.g. 'BTC', 'ETH', or 'BTC-USD'). Resolved to a currency pair before the order is placed. Required. |
| side | string | yes | 'buy' or 'sell'. Required. |
| type | string | yes | 'market', 'limit', 'stop_loss', or 'stop_limit'. Required. 'stop_loss' is a stop-triggered market order — despite the name it applies to buy stops too; the e… |
| quantity | string | no | Asset quantity to trade (e.g. amount of BTC). Provide exactly one of quantity or dollar_amount. Crypto is measured in coins/units, not shares — when speaking… |
| dollar_amount | string | no | USD notional (e.g. '100.00'). Valid with every order type. Provide exactly one of quantity or dollar_amount. For market, quantity is derived server-side: a b… |
| limit_price | string | no | Limit price; required for limit and stop_limit. |
| stop_price | string | no | Stop trigger price; required for stop_loss and stop_limit. |
| time_in_force | string | no | Allowed values depend on type. market and limit: 'gtc' (good till canceled) only — market orders execute immediately so a bounded duration does not apply, an… |
| tax_lots | null \| array | no | Optional specified-lot selection for a SELL order. To sell specific tax lots instead of the default disposal, pass {open_lot_id, quantity} objects whose quan… |
| ref_id | string | no | Idempotency key (UUID). Generate once per logical order and re-send the SAME value on retries of transient failures — the upstream deduplicates by ref_id. Om… |

**Errors observed:** 1 capture(s), 1 distinct shape(s)

**Captures:**

- [cx-place](captures/cx-place.json) — error — $1 BTC limit buy far below mark — rests, harvest order_id -> cx-cancel.

**Notes:**

- $1 BTC limit buy far below mark — rests, harvest order_id -> cx-cancel.

### preview_crypto_order

**Safety:** simulation · **Status:** error-only

Simulate a crypto order without placing it — returns the transient order shape with the estimated cost/credit and fees resolved, plus any pre-trade validation errors. Call this by default before place_crypto_order unless the user has very explicitly asked to skip the preview. Requires an agentic-enabled crypto account.

Parameter rules:
- Provide exactly one of quantity or dollar_amount; dollar_amount works with every type.
- limit_price is required for limit and stop_limit; stop_price is required for stop_loss and stop_limit.
- symbol is resolved to a currency pair before the preview; pass a bare asset symbol (e.g. 'BTC') or a pair ('BTC-USD').

**Parameters (live inputSchema):**

| param | type | required | description |
|---|---|---|---|
| rhs_account_number | string | yes | Numeric brokerage account number (the 'rhs_account_number' field on get_accounts entries — distinct from the alphanumeric 'account_number'). Must be an agent… |
| symbol | string | yes | Crypto symbol (e.g. 'BTC', 'ETH', or 'BTC-USD'). Resolved to a currency pair before the preview. Required. |
| side | string | yes | 'buy' or 'sell'. Required. |
| type | string | yes | 'market', 'limit', 'stop_loss', or 'stop_limit'. Required. 'stop_loss' is a stop-triggered market order — despite the name it applies to buy stops too; the e… |
| quantity | string | no | Asset quantity to trade (e.g. amount of BTC). Provide exactly one of quantity or dollar_amount. Crypto is measured in coins/units, not shares — when speaking… |
| dollar_amount | string | no | USD notional (e.g. '100.00'). Valid with every order type. Provide exactly one of quantity or dollar_amount. For market, quantity is derived server-side: a b… |
| limit_price | string | no | Limit price; required for limit and stop_limit. |
| stop_price | string | no | Stop trigger price; required for stop_loss and stop_limit. |
| time_in_force | string | no | Allowed values depend on type. market and limit: 'gtc' (good till canceled) only — market orders execute immediately so a bounded duration does not apply, an… |
| tax_lots | null \| array | no | Optional specified-lot selection for a SELL order. To sell specific tax lots instead of the default disposal, pass {open_lot_id, quantity} objects whose quan… |

**Errors observed:** 6 capture(s), 2 distinct shape(s)

**Captures:**

- [dep-prev-crypto-05](captures/dep-prev-crypto-05.json) — error — tax_lots objects exercised (synthetic lot id - will fail at crypto-account gate like prior crypto probes).
- [dep-prev-crypto-06](captures/dep-prev-crypto-06.json) — error — time_in_force=gfm (last unprobed enum). Fails at crypto-account gate; param still exercised.
- [ro-prev-crypto-01](captures/ro-prev-crypto-01.json) — error — market + dollar_amount (unhyphenated symbol).
- [ro-prev-crypto-02](captures/ro-prev-crypto-02.json) — error — limit + quantity + limit_price (hyphenated symbol).
- [ro-prev-crypto-03](captures/ro-prev-crypto-03.json) — error — stop_loss sell + stop_price + tif=gfd (stop-only tif family).
- [ro-prev-crypto-04](captures/ro-prev-crypto-04.json) — error — stop_limit + tif=gfw.

**Notes:**

- market + dollar_amount (unhyphenated symbol).
- limit + quantity + limit_price (hyphenated symbol).
- stop_loss sell + stop_price + tif=gfd (stop-only tif family).
- stop_limit + tif=gfw.
- tax_lots objects exercised (synthetic lot id - will fail at crypto-account gate like prior crypto probes).
- time_in_force=gfm (last unprobed enum). Fails at crypto-account gate; param still exercised.


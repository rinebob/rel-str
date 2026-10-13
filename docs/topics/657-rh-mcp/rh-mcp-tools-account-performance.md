# Robinhood MCP — Account & Performance

> Part of the [canonical tool discovery](rh-mcp-tool-discovery-canonical-657-658-689.md) — 7 tools in this group.

### get_accounts

**Safety:** read-only · **Status:** probed

List the user's brokerage accounts. Each account includes an agentic_allowed field indicating whether it's tradable by you — accounts where it's false are read-only to you. Use this to look up account_number values needed by other tools. Exactly one account is tradable by you; when the user is choosing an account for a trade, use that account directly without asking. Does NOT return reliable buying power — route buying-power questions through get_portfolio.

**Parameters (live inputSchema):**

_No parameters._

**Response shape** (union over 1 success capture(s)):

```
data: object
data.accounts: array<object>
data.accounts[].account_number: string
data.accounts[].rhs_account_number: string
data.accounts[].type: string
data.accounts[].unsettled_funds: string
data.accounts[].brokerage_account_type: string
data.accounts[].is_default: boolean
data.accounts[].agentic_allowed: boolean
data.accounts[].option_level: string
data.accounts[].management_type: string
data.accounts[].affiliate: string
data.accounts[].state: string
data.accounts[].deactivated: boolean
data.accounts[].permanently_deactivated: boolean
data.accounts[].nickname: string
guide: string
```

**Captures:**

- [ro-accounts-01](captures/ro-accounts-01.json) — success — Zero-param call; confirms envelope + agentic_allowed flag.

**Notes:**

- Zero-param call; confirms envelope + agentic_allowed flag.

### get_equity_positions

**Safety:** read-only · **Status:** probed

List open equity positions for a specific brokerage account. Returns symbol, quantity, average cost, and per-position hold breakdowns.

**Parameters (live inputSchema):**

| param | type | required | description |
|---|---|---|---|
| account_number | string | yes | Brokerage account number. Must come from the user or be clearly implied — never default from get_accounts. |
| cursor | string | no | Pagination cursor. Omit for the first page; for the next page, pass the prior response's next value back verbatim. |

**Response shape** (union over 3 success capture(s)):

```
data: object
data.positions: array<object>
data.positions[].symbol: string
data.positions[].quantity: string
data.positions[].intraday_quantity: string
data.positions[].average_buy_price: string
data.positions[].shares_available_for_sells: string
data.positions[].shares_held_for_sells: string
data.positions[].shares_held_for_stock_grants: string
data.positions[].shares_held_for_options_events: string
data.positions[].shares_held_for_asset_transfer: string
data.positions[].shares_pending_from_options_events: string
data.positions[].type: string
guide: string
```

**Errors observed:** 1 capture(s), 1 distinct shape(s)

**Captures:**

- [err-positions-bad-acct](captures/err-positions-bad-acct.json) — error — Deliberate error: invalid account number — account-layer vs tool-layer error.
- [mx-pos-postflat](captures/mx-pos-postflat.json) — success — Post-session end-state evidence — OOMA residual after mx-sell-flat-xh fill. (unfiltered — schema has no symbol param; OOMA row read from the full list)
- [mx-pos-preflat](captures/mx-pos-preflat.json) — success — Harvest OOMA_ALL_QTY before the final sell-all
- [ro-eq-pos-01](captures/ro-eq-pos-01.json) — success — Base positions page.

**Notes:**

- Base positions page.
- Harvest OOMA_ALL_QTY before the final sell-all
- Deliberate error: invalid account number — account-layer vs tool-layer error.
- Post-session end-state evidence — OOMA residual after mx-sell-flat-xh fill. (unfiltered — schema has no symbol param; OOMA row read from the full list)

### get_equity_tax_lots

**Safety:** read-only · **Status:** probed

List the open tax lots for one equity holding in an account — each lot is a separate acquisition with its own quantity, cost basis, acquisition date, and long/short-term status. Requires a symbol (tax lots are tracked per instrument). Use it for cost-basis, holding-period, or which-lots-would-sell questions.

**Parameters (live inputSchema):**

| param | type | required | description |
|---|---|---|---|
| account_number | string | yes | Brokerage account number. Must come from the user or be clearly implied — never default from get_accounts. |
| symbol | string | yes | Ticker symbol of the holding whose tax lots you want, e.g. AAPL. Tax lots are tracked per instrument — one symbol per call. |
| cursor | string | no | Pagination cursor. Omit for the first page; for the next page, pass the prior response's next value back verbatim. |

**Response shape** (union over 3 success capture(s)):

```
data: object
data.symbol: string
data.tax_lots: array<object>
data.tax_lots[].open_lot_id: string
data.tax_lots[].open_tran_type: string
data.tax_lots[].order_id: string
data.tax_lots[].quantity: string
data.tax_lots[].quantity_available: string
data.tax_lots[].is_selectable: boolean
data.tax_lots[].cost_per_share: string
data.tax_lots[].tax_cost_basis: string
data.tax_lots[].open_date: string
data.tax_lots[].term: string
guide: string
```

**Captures:**

- [dep-eq-taxlots-02](captures/dep-eq-taxlots-02.json) — success — MSFT is held (ro-eq-pos-01: 1 share) - source of open_lot_id for review_equity_order.tax_lots.
- [mx-taxlots](captures/mx-taxlots.json) — success — Harvest OOMA_LOT_ID (open_lot_id) before mx-sell-lots
- [ro-eq-taxlots-01](captures/ro-eq-taxlots-01.json) — success — Tax lots per instrument; empty expected if OOMA not held.

**Notes:**

- Tax lots per instrument; empty expected if OOMA not held.
- MSFT is held (ro-eq-pos-01: 1 share) - source of open_lot_id for review_equity_order.tax_lots.
- Harvest OOMA_LOT_ID (open_lot_id) before mx-sell-lots

### get_limited_margin_upgrade_info

**Safety:** read-only · **Status:** probed

Check whether a cash account is eligible to upgrade to limited margin and return the links (web and mobile) that start the upgrade flow. Limited margin lets the account trade with unsettled funds — proceeds from a sale can go into a new order before that sale settles — while adding no borrowing or leverage. Call when the user asks about that capability, about trading with unsettled funds, or about enabling limited margin.

**Parameters (live inputSchema):**

| param | type | required | description |
|---|---|---|---|
| account_number | string | yes | Brokerage account number to check. Obtain from get_accounts. |

**Response shape** (union over 1 success capture(s)):

```
data: object
data.account_number: string
data.eligible: boolean
data.current_account_type: string
data.web_upgrade_url: string
data.mobile_upgrade_url: string
data.upgrade_fallback: string
guide: string
```

**Captures:**

- [ro-limited-margin-01](captures/ro-limited-margin-01.json) — success — Margin-upgrade eligibility for the agentic cash account.

**Notes:**

- Margin-upgrade eligibility for the agentic cash account.

### get_pnl_trade_history

**Safety:** read-only · **Status:** probed

Get a customer's per-trade realized profit & loss — a chronological, paginated list of closed/realizing trades (equities, options, crypto, prediction markets) with symbol, side, quantity, price, and realized gain/loss. This is the same data behind the app's PnL hub ("Realized profit & loss"). Read-only. Trades only. Use get_realized_pnl for aggregate/bucketed totals.

**Parameters (live inputSchema):**

| param | type | required | description |
|---|---|---|---|
| account_number | string | yes | Brokerage account number (the rhs_account_number from get_accounts). Obtain it from get_accounts. |
| span | string | no | Preset window: week (default), month, 3month, ytd, or all. Wormhole offers preset spans only (no arbitrary date range). |
| symbol | string | no | Optional single stock symbol filter (trimmed + uppercased). Omit for all symbols; one symbol per call. |
| cursor | string | no | Pagination cursor from a previous response's next_cursor. Omit for the first page. |

**Response shape** (union over 7 success capture(s)):

```
data: object
data.account_number: string
data.span: string
data.trades: array<object>
data.trades[].timestamp: string
data.trades[].symbol: string
data.trades[].side: string
data.trades[].quantity: string
data.trades[].price: string
data.trades[].realized_gain: string
data.next_cursor: string
guide: string
```

**Captures:**

- [ro-pnl-hist-01](captures/ro-pnl-hist-01.json) — success — Base - default span (week), no symbol filter.
- [ro-pnl-hist-02](captures/ro-pnl-hist-02.json) — success — span=week - one of five preset windows.
- [ro-pnl-hist-03](captures/ro-pnl-hist-03.json) — success — span=month - one of five preset windows.
- [ro-pnl-hist-04](captures/ro-pnl-hist-04.json) — success — span=3month - one of five preset windows.
- [ro-pnl-hist-05](captures/ro-pnl-hist-05.json) — success — span=ytd - one of five preset windows.
- [ro-pnl-hist-06](captures/ro-pnl-hist-06.json) — success — span=all - one of five preset windows.
- [ro-pnl-hist-07](captures/ro-pnl-hist-07.json) — success — symbol filter - one symbol per call.

**Notes:**

- Base - default span (week), no symbol filter.
- span=week - one of five preset windows.
- span=month - one of five preset windows.
- span=3month - one of five preset windows.
- span=ytd - one of five preset windows.
- span=all - one of five preset windows.
- symbol filter - one symbol per call.

### get_portfolio

**Safety:** read-only · **Status:** probed

Get the account's portfolio market value breakdown by asset type and buying power. Use for "how much is my account worth?", "what's my portfolio breakdown?", "how much do I have in options?", and "how much can I spend / afford?" questions.

**Parameters (live inputSchema):**

| param | type | required | description |
|---|---|---|---|
| account_number | string | yes | Brokerage account number. Obtain from get_accounts. |

**Response shape** (union over 1 success capture(s)):

```
data: object
data.total_value: string
data.equity_value: string
data.options_value: string
data.futures_value: string
data.event_contracts_value: string
data.crypto_value: string
data.cash: string
data.pending_deposits: string
data.mutual_funds_value: string
data.fixed_income_value: string
data.currency: string
data.buying_power: object
data.buying_power.buying_power: string
data.buying_power.unleveraged_buying_power: string
data.buying_power.display_currency: string
data.crypto_buying_power: object
data.crypto_buying_power.buying_power: string
guide: string
```

**Captures:**

- [ro-portfolio-01](captures/ro-portfolio-01.json) — success — Portfolio snapshot for the agentic account.

**Notes:**

- Portfolio snapshot for the agentic account.

### get_realized_pnl

**Safety:** read-only · **Status:** probed

Get a customer's realized profit & loss for an account over a time window — per-bucket realized gain ($ and %) and the number of closing trades, plus window totals. Read-only. Aggregate, bucketed numbers only (not individual trades). Use for post-trade analysis like "how did my last 90 days of trades do?".

**Parameters (live inputSchema):**

| param | type | required | description |
|---|---|---|---|
| account_number | string | yes | Brokerage account number (the rhs_account_number from get_accounts). Obtain it from get_accounts. |
| span | string | no | Preset window: day, week, month, 3month, year, or all. Defaults to 3month ('last 90 days'). Mutually exclusive with start_date/end_date. |
| start_date | string | no | Custom window start, YYYY-MM-DD, inclusive — interpreted at midnight in timezone (default US Eastern). Use with end_date instead of span; must be on or befor… |
| end_date | string | no | Custom window end, YYYY-MM-DD, inclusive — the entire end_date is covered (through 23:59:59 in timezone). Use with start_date instead of span; an end_date be… |
| asset_classes | null \| array | no | Filter to one or more of equity, option, crypto. Omit for all asset classes available on the account. |
| display_currency | string | no | Currency for returned amounts. Currently USD only; defaults to USD. |
| timezone | string | no | IANA timezone for bucket day-boundaries (e.g. America/New_York). Defaults to the account timezone (US Eastern). |

**Response shape** (union over 10 success capture(s)):

```
data: object
data.account_number: string
data.window: string
data.display_currency: string
data.data_points: array<object>
data.data_points[].start_time: string
data.data_points[].end_time: string
data.data_points[].realized_gain: null | string
data.data_points[].rate_of_realized_gain: null | string
data.data_points[].number_of_trades: number
data.total_returns: string
data.total_rate_of_return: string
guide: string
```

**Errors observed:** 1 capture(s), 1 distinct shape(s)

**Captures:**

- [err-pnl-inverted](captures/err-pnl-inverted.json) — error — Deliberate error: end_date before start_date.
- [ro-rpnl-01](captures/ro-rpnl-01.json) — success — Base - default span (3month) + only supported display_currency.
- [ro-rpnl-02](captures/ro-rpnl-02.json) — success — span=day - six preset windows.
- [ro-rpnl-03](captures/ro-rpnl-03.json) — success — span=week - six preset windows.
- [ro-rpnl-04](captures/ro-rpnl-04.json) — success — span=month - six preset windows.
- [ro-rpnl-05](captures/ro-rpnl-05.json) — success — span=3month - six preset windows.
- [ro-rpnl-06](captures/ro-rpnl-06.json) — success — span=year - six preset windows.
- [ro-rpnl-07](captures/ro-rpnl-07.json) — success — span=all - six preset windows.
- [ro-rpnl-08](captures/ro-rpnl-08.json) — success — Custom date window (start_date+end_date, mutually exclusive with span).
- [ro-rpnl-09](captures/ro-rpnl-09.json) — success — asset_classes array - all three documented classes in one filter.
- [ro-rpnl-10](captures/ro-rpnl-10.json) — success — Explicit timezone for bucket day-boundaries.

**Notes:**

- Base - default span (3month) + only supported display_currency.
- span=day - six preset windows.
- span=week - six preset windows.
- span=month - six preset windows.
- span=3month - six preset windows.
- span=year - six preset windows.
- span=all - six preset windows.
- Custom date window (start_date+end_date, mutually exclusive with span).
- asset_classes array - all three documented classes in one filter.
- Explicit timezone for bucket day-boundaries.
- Deliberate error: end_date before start_date.


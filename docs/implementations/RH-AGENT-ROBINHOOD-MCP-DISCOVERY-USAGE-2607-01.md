# Robinhood Trading MCP Discovery and Usage Guide

**Date:** 2026-07-17
**Status:** Initial inventory complete; response-shape discovery in progress
**Server:** `https://agent.robinhood.com/mcp/trading`
**Inventory source:** Authenticated MCP tool definitions exported from Claude Code
**Tool count:** 49

## Purpose

This guide documents the complete discovered Robinhood Trading MCP tool inventory, safe operating rules, common call patterns, and practical use cases. It is intended for:

- RH Agent broker synchronization.
- Interactive Robinhood research through Claude Code.
- Read-only account and trading-history discovery.
- Future direct typed MCP integration.
- Controlled exercises of non-financial and financial tools.

The inventory describes tool schemas, not observed result contracts. Read-only calls must still be exercised and redacted before production parsers are designed.

## Scope and operating principle

Robinhood is the source of truth for broker orders, positions, tax lots, and realized trades. RH Agent should consume those facts rather than infer position effects from a sequence of buy and sell instructions.

An equity order side does not state whether the eventual fill opens, adds to, reduces, closes, or changes a position. Determine the actual effect from Robinhood orders, fills, positions, lots, and trade history.

## Connection and authentication

### Claude Code registration

```powershell
claude mcp add --transport http --scope user robinhood-trading https://agent.robinhood.com/mcp/trading
```

### Interactive authentication

```powershell
claude
```

Inside Claude Code:

```text
/mcp
```

Select `robinhood-trading`, complete Robinhood authorization, and verify the server reports connected.

### Verify registration

```powershell
claude mcp list
```

Expected entry:

```text
robinhood-trading: https://agent.robinhood.com/mcp/trading (HTTP) - Connected
```

### Tool naming

Claude exposes tools with the full name:

```text
mcp__robinhood-trading__<tool_name>
```

The inventory below uses the shorter `<tool_name>` form.

## Safety classification

### Read-only

Read-only tools retrieve account, market, order, position, scanner, and watchlist data. They can still expose sensitive financial information. Do not persist raw responses without redaction.

### Simulation

`review_equity_order` and `review_option_order` simulate an order and return quotes and pre-trade alerts. They do not place an order, but they must use the intended account and exact proposed terms.

### Non-financial account writes

Scanner and watchlist mutations change saved Robinhood account configuration. Confirm user intent before calling them even though they do not trade securities.

### Financial mutations

The following can alter real orders or use real money:

- `place_equity_order`
- `cancel_equity_order`
- `place_option_order`
- `cancel_option_order`

Never exercise them merely for discovery. Require explicit authorization for the exact account, instrument, side, size, order type, price conditions, and batch.

## Universal usage rules

### Account selection

Tools requiring `account_number` explicitly warn against silently defaulting from `get_accounts`.

1. Call `get_accounts` when account identity is unknown.
2. Present masked choices if more than one account exists.
3. Obtain or rely on an explicit user selection.
4. Pass the same account to downstream calls.
5. Never write account numbers to documentation, fixtures, or logs.

### Pagination

Tools with `cursor` return paginated data.

```text
first call: omit cursor
next call: pass returned next_cursor
stop: next_cursor is absent or empty
```

Do not assume the first page is complete. Preserve filters identically while advancing the cursor.

### Dates and times

- Use ISO 8601 UTC for timestamps.
- Use `YYYY-MM-DD` only where the schema explicitly allows it.
- Treat Robinhood timestamps as authoritative.
- Record the timezone used for P&L buckets.

### Numeric values

Order quantities, dollar amounts, and prices are often schema-defined as decimal strings. Do not coerce through binary floating point before validation or submission.

Examples:

```json
{
  "quantity": "1.25",
  "dollar_amount": "100.00",
  "limit_price": "185.50"
}
```

### Idempotency

`place_equity_order` and `place_option_order` accept `ref_id`:

```text
UUID generated once per logical order
```

Persist the UUID before submission and reuse the same UUID on retry. Never generate a fresh `ref_id` merely because the first response was ambiguous.

### Response handling

- Treat schemas in this guide as input schemas only.
- Capture actual response shapes from read-only calls.
- Validate required broker identifiers and states.
- Redact account numbers, URLs, tokens, and personal data.
- Do not treat Claude prose as a typed broker contract.
- Do not label estimates as actual fills.

### Request limits and throttling

No global requests-per-second or requests-per-minute quota is documented in the exported schemas or Robinhood's public Agentic Trading documentation. Do not interpret the absence of a published quota as permission to load-test the brokerage API.

Known per-call limits:

| Tool or capability | Conservative limit |
|---|---|
| Equity quotes | 20 symbols; the schema says larger requests may omit prior closes |
| Equity fundamentals | 10 symbols |
| Equity historicals | 10 symbols |
| Equity tradability | 10 symbols |
| Equity price book | 4 symbols |
| Financials | 20 symbols and at most 40 periods |
| Search | 20 results |
| Earnings calendar | 31-day window |
| Earnings results | One symbol and up to 8 quarters |
| Technical indicators | One symbol |
| Equity tax lots | One symbol per read |
| Specified-lot sell | At most 30 lots |
| Orders, positions, lots, options, and trade history | Follow cursor pagination |

Initial client policy until measured evidence replaces it:

- Allow at most two concurrent read-only calls.
- Fetch cursor pages sequentially with identical filters.
- Poll unresolved orders no more frequently than every 30 seconds during a focused reconciliation window.
- Prefer user-triggered or scheduled snapshot refreshes over continuous polling.
- Batch symbols within each tool's documented limit.
- Fetch positions as a complete paginated snapshot rather than per-symbol requests.
- Filter incremental history by date, placement source, and a safely overlapping synchronization watermark.
- Avoid duplicate identical account snapshots in a short interval.

For HTTP `429`, MCP resource-exhaustion errors, timeouts, and temporary transport failures:

```text
honor Retry-After when present
otherwise wait with jitter: 1s, 2s, 4s, 8s, 16s, 30s
stop after a bounded number of attempts
```

Read-only calls may use at most five attempts. A mutating order call must never be blindly retried: first reconcile order history, then retry only with the original persisted `ref_id` when safe. Never generate a replacement `ref_id` for an ambiguous submission.

Instrument every call with redacted operational metadata:

- Tool name and safety classification.
- Start time and latency.
- Success, HTTP status, or MCP error category.
- `Retry-After` when present.
- Attempt count and backoff duration.
- Requested item count and returned item count.
- Page count, page size, and cursor presence.
- Whether calls were concurrent.

Do not record arguments containing account identifiers or raw tool results in operational logs.

## Complete inventory

## 1. Account, order, position, and performance tools

| Tool | Required inputs | Optional inputs | Use |
|---|---|---|---|
| `get_accounts` | None | None | List brokerage accounts and obtain account identifiers for explicit selection. Buying power is not reliable here. |
| `get_portfolio` | `account_number` | None | Get portfolio market-value breakdown and buying power. |
| `get_equity_orders` | `account_number` | `order_id`, `state`, `symbol`, `created_at_gte`, `placed_agent`, `cursor` | Fetch newest-first open and closed equity orders, including fills, cancellations, rejections, or one order by UUID. |
| `get_equity_positions` | `account_number` | `cursor` | List current open equity positions with quantity, average cost, and hold breakdowns. |
| `get_equity_tax_lots` | `account_number`, `symbol` | `cursor` | List open acquisition lots for one equity holding, including quantity, cost basis, acquisition date, and holding period. |
| `get_pnl_trade_history` | `account_number` | `span`, `symbol`, `cursor` | Get chronological closed/realizing trades with symbol, side, quantity, price, and realized gain/loss. |
| `get_realized_pnl` | `account_number` | `span`, `start_date`, `end_date`, `asset_classes`, `display_currency`, `timezone` | Get aggregate realized-P&L buckets, totals, and closing-trade counts. |

### `get_equity_orders` states

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

### `get_equity_orders` placement sources

The schema describes values including:

```text
user
agentic
recurring
drip
```

Use `placed_agent: "agentic"` to focus RH Agent synchronization on MCP-originated equity orders.

### `get_pnl_trade_history` spans

```text
week
month
3month
ytd
all
```

### `get_realized_pnl` spans

```text
day
week
month
3month
year
all
```

A custom `start_date` and `end_date` may be used instead of `span`.

## 2. Equity and market-research tools

| Tool | Required inputs | Optional inputs | Use |
|---|---|---|---|
| `search` | `query` | `asset_type`, `limit` | Resolve names or partial names to stocks/ETFs, crypto pairs, or market indexes. |
| `get_equity_quotes` | `symbols` | None | Get real-time quotes and official prior-session closes. |
| `get_equity_price_book` | `symbols` | None | Get Level 2 bid/ask depth for up to four equity symbols. |
| `get_equity_fundamentals` | `symbols` | `bounds` | Get valuation, capitalization, session OHLCV, volume, 52-week range, dividends, and company profile. |
| `get_financials` | `symbols` | `period`, `limit` | Get reported revenue, gross profit, net income, and net margin over quarterly or annual periods. |
| `get_earnings_calendar` | None | `start_date`, `days`, `filter` | Discover market-wide earnings events over a window of up to 31 days. |
| `get_earnings_results` | `symbol` | None | Get up to eight recent/upcoming earnings quarters for one symbol. |
| `get_equity_historicals` | `symbols`, `start_time` | `end_time`, `interval`, `bounds`, `adjustment_type` | Get equity OHLCV bars over an explicit range. |
| `get_equity_technical_indicators` | `symbol`, `type`, `interval`, `start_time` | `end_time`, indicator parameters, `output`, `bounds`, `adjustment_type` | Compute supported technical indicators over Robinhood OHLCV bars. |
| `get_equity_tradability` | `account_number`, `symbols` | None | Check session and fractional-order eligibility for up to ten symbols. |
| `get_indexes` | None | `symbols` | Resolve market indexes such as SPX, NDX, and DJI to index data and IDs. |
| `get_index_quotes` | `instrument_ids` | None | Get current index levels, states, and timestamps by index instrument ID. |

### Search asset types

```text
instrument
currency_pair
market_index
```

### Historical intervals

Intraday:

```text
15second
30second
minute
5minute
10minute
30minute
hour
4hour
```

Interday:

```text
day
week
month
3month
6month
year
5year
10year
20year
50year
```

### Historical bounds

```text
regular
extended
trading
24_5
24_7
hyper_trading
```

Availability can depend on instrument and interval.

### Price adjustments

```text
none
split
all
```

`all` includes split and dividend adjustment and has interval restrictions.

### Technical indicators

```text
ema
sma
rsi
momentum
roc
cci
williams_r
atr
mfi
adx
donchian_channels
bollinger_bands
macd
keltner_channels
supertrend
vwap
obv
pivot_points
```

Indicator-specific inputs include `period`, `num_std`, `fast_period`, `slow_period`, `signal_period`, `multiplier`, and `method`.

Output control:

```text
series
latest
last:N
```

## 3. Equity order tools

| Tool | Safety | Required inputs | Optional inputs |
|---|---|---|---|
| `review_equity_order` | Simulation | `account_number`, `symbol`, `side`, `type` | `quantity`, `dollar_amount`, `limit_price`, `stop_price`, `time_in_force`, `market_hours`, `tax_lots` |
| `place_equity_order` | Real-money mutation | `account_number`, `symbol`, `side`, `type` | Same order terms plus `ref_id` and `tax_lots` |
| `cancel_equity_order` | Real-order mutation | `account_number`, `order_id` | None |

### Equity sides

```text
buy
sell
```

Do not infer position effect from side alone.

### Equity order types

```text
market
limit
stop_market
stop_limit
```

Rules:

- `dollar_amount` is valid only for market orders.
- `limit_price` is required for limit and stop-limit orders.
- `stop_price` is required for stop-market and stop-limit orders.
- Fractional `quantity` is allowed only where Robinhood permits it.
- `quantity` and `dollar_amount` are alternative sizing modes.

### Time in force

```text
gfd
gtc
```

### Market hours

```text
regular_hours
extended_hours
all_day_hours
```

### Specified-lot sells

Optional `tax_lots` entries contain:

```json
{
  "open_lot_id": "<ID_FROM_GET_EQUITY_TAX_LOTS>",
  "quantity": "1.25"
}
```

Use at most 30 lots. Fetch lot IDs through `get_equity_tax_lots`; do not invent them.

## 4. Options tools

| Tool | Safety | Required inputs | Optional inputs | Use |
|---|---|---|---|---|
| `get_option_chains` | Read-only | One of `underlying_symbol` or `ids` | The alternate lookup field | Resolve option chains and expirations for equity or index underlyings. |
| `get_option_instruments` | Read-only | One of `chain_symbol`, `chain_id`, or `ids` | `expiration_dates`, `strike_price`, `type`, `state`, `tradability`, `cursor` | Resolve individual option contract UUIDs. |
| `get_option_quotes` | Read-only | `instrument_ids` | None | Get live option quotes and prior-session closes. |
| `get_option_orders` | Read-only | `account_number` | `order_id`, `state`, `chain_ids`, `underlying_type`, `created_at_gte`, `placed_agent`, `cursor` | Get open/closed option orders, fills, cancellations, and rejections. |
| `get_option_positions` | Read-only | `account_number` | `nonzero`, `option_type`, `type`, expiration filters, chain/option IDs, `cursor` | Get open or open-and-closed option positions. |
| `get_option_level_upgrade_info` | Read-only account link | `account_number` | None | Get the Robinhood URL for applying for options access. |
| `review_option_order` | Simulation | `account_number`, `legs`, `quantity` | `type`, `price`, `stop_price`, `time_in_force`, `market_hours`, `chain_symbol`, `underlying_type` | Simulate a single-leg option order and return alerts. |
| `place_option_order` | Real-money mutation | `account_number`, `legs`, `quantity` | `type`, `price`, `stop_price`, `time_in_force`, `market_hours`, `ref_id` | Place a real single-leg option order. |
| `cancel_option_order` | Real-order mutation | `account_number`, `order_id` | None | Cancel an eligible open option order. |
| `get_option_watchlist` | Read-only | None | None | List single-leg contracts in the options watchlist. |
| `add_option_to_watchlist` | Non-financial write | `option_ids` | `position_type` | Add option contracts to the options watchlist. |
| `remove_option_from_watchlist` | Non-financial write | `option_ids` | `position_type` | Remove option contracts using the same watchlist position type. |

### Option order states

```text
queued
confirmed
partially_filled
filled
rejected
cancelled
failed
voided
pending_cancelled
```

### Option position filters

- `nonzero: true` returns currently open positions.
- `option_type` is `call` or `put`.
- `type` is `long` or `short`.
- Expiration filters support exact, lower-bound, and upper-bound dates.

### Option legs

Single-leg only:

```json
{
  "option_id": "<OPTION_INSTRUMENT_UUID>",
  "side": "buy",
  "position_effect": "open",
  "ratio_quantity": 1
}
```

`position_effect` is explicit for options:

```text
open
close
```

### Option order types

```text
limit
market
stop_limit
stop_market
```

Option market orders must use `gfd`. Price requirements depend on order type.

## 5. Scanner tools

| Tool | Safety | Required inputs | Optional inputs | Use |
|---|---|---|---|---|
| `get_scanner_filter_specs` | Read-only | None | None | Get valid filter types, predicates, and compatible parameter shapes. |
| `get_scans` | Read-only | None | None | List saved scans, filters, columns, sorting, and Cortex-managed status. |
| `create_scan` | Account write | None | `preset`, `filters`, `title` | Create a saved scanner and return initial live results. |
| `run_scan` | Read-only execution | `scan_id` | None | Evaluate a saved scan against current market data. |
| `update_scan_config` | Account write | `scan_id`, `sorting_column`, `sorting_direction` | None | Change scan result sorting only. |
| `update_scan_filters` | Account write | `scan_id`, `filters` | None | Replace the scan's entire filter set. |

### Scanner presets

```text
INITIAL
DAILY_GAINERS
DAILY_LOSERS
HIGH_OPTIONS_VOLUME_IV
UPCOMING_EARNINGS
```

### Safe scanner workflow

```text
get_scanner_filter_specs
→ get_scans
→ choose or create scan
→ run_scan
→ optionally update sorting or full filter set
```

`update_scan_filters` uses replacement semantics. Read existing filters first, then send the complete desired set. Sending an incomplete set discards omitted filters.

Cortex-managed scans are read-only through update tools.

## 6. General watchlist tools

| Tool | Safety | Required inputs | Optional inputs | Use |
|---|---|---|---|---|
| `get_watchlists` | Read-only | None | None | List custom and followed curated watchlists. |
| `get_watchlist_items` | Read-only | `list_id` | None | List non-option items in a watchlist. |
| `get_popular_watchlists` | Read-only | None | None | Discover Robinhood-curated lists available to follow. |
| `create_watchlist` | Account write | `display_name` | `display_description`, `icon_emoji` | Create a custom watchlist. |
| `update_watchlist` | Account write | `list_id` | `display_name`, `display_description`, `icon_emoji` | Rename or change a custom watchlist. |
| `add_to_watchlist` | Account write | `list_id` | Exactly one of `symbols`, `currency_pair_ids`, `index_ids` | Add stocks, crypto pairs, or indexes. |
| `remove_from_watchlist` | Account write | `list_id` | Exactly one of `symbols`, `currency_pair_ids`, `index_ids` | Remove stocks, crypto pairs, or indexes. |
| `follow_watchlist` | Account write | `list_id` | None | Follow a Robinhood-curated list. |
| `unfollow_watchlist` | Account write | `list_id` | None | Stop following a curated list without deleting it. |

Options use the dedicated option-watchlist tools, not `get_watchlist_items`, `add_to_watchlist`, or `remove_from_watchlist`.

## Direct MCP call pattern

After an authenticated SDK client is connected:

```typescript
const result = await client.callTool({
  name: 'get_equity_orders',
  arguments: {
    account_number: '<EXPLICITLY_SELECTED_ACCOUNT>',
    created_at_gte: '2026-07-17',
    placed_agent: 'agentic',
  },
});
```

Do not copy this placeholder into a live call without explicit account selection.

## Primary use cases

## Use case 1 — Reconcile one submitted equity order

Purpose: determine what happened after a queued, pending, or ambiguous submission.

```text
Known broker order UUID
→ get_equity_orders(account_number, order_id)
→ validate state and fill fields
→ update the primary RH Agent order record
→ if filled, refresh positions and trade history
```

This is the preferred first discovery call for the already-submitted order.

## Use case 2 — Refresh all RH Agent equity orders

```text
get_equity_orders(
  account_number,
  placed_agent="agentic",
  created_at_gte=<sync watermark>
)
→ follow every cursor
→ upsert by broker order UUID
→ retain rejected/cancelled/failed orders as orders
→ never convert queued or confirmed orders into fills
```

The sync watermark reduces volume but must overlap safely to tolerate delayed updates. Broker UUID upserts make overlap idempotent.

## Use case 3 — Refresh current equity positions

```text
get_equity_positions(account_number)
→ follow every cursor
→ replace or reconcile the current-position projection
→ mark locally cached positions absent from the complete broker snapshot as no longer open
```

Do not use order side alone to calculate current quantity.

## Use case 4 — Import closed/realizing trade history

```text
get_pnl_trade_history(account_number, span="all")
→ follow every cursor
→ filter or classify equity rows from returned asset metadata
→ upsert stable broker trade identities
→ expose closed history independently of RH Agent run ID
```

Actual response identity and retention behavior remain discovery questions.

## Use case 5 — Daily broker synchronization

A minimal daily sequence:

```text
1. get_equity_orders for recent agentic orders
2. get_equity_positions for current holdings
3. get_pnl_trade_history for recent or all closed activity
4. upsert typed broker records
5. surface discrepancies and unresolved orders
```

A user-triggered refresh can run through the local authenticated MCP connection. An unattended early-morning poll requires an authenticated backend connection; a browser or localhost bridge cannot be assumed to be running.

## Use case 6 — Portfolio and buying-power review

```text
get_portfolio(account_number)
→ show market-value breakdown and buying power
get_equity_positions(account_number)
→ show current holdings
get_realized_pnl(account_number, span="month")
→ show recent realized performance
```

Avoid using `get_accounts` as a buying-power source.

## Use case 7 — Research one stock

```text
search(query=<company name>) when ticker is unknown
→ get_equity_quotes(symbols)
→ get_equity_fundamentals(symbols)
→ get_financials(symbols, period="quarterly")
→ get_earnings_results(symbol)
```

Optional depth and tradability checks:

```text
get_equity_price_book(symbols)
get_equity_tradability(account_number, symbols)
```

## Use case 8 — Chart and indicator analysis

```text
get_equity_historicals(symbols, start_time, interval, bounds)
→ inspect broker OHLCV
get_equity_technical_indicators(symbol, type, interval, start_time)
→ request latest or bounded output
```

Keep interval, bounds, date range, and adjustment type aligned when comparing calculated values.

## Use case 9 — Discover earnings risk

For a specific holding:

```text
get_earnings_results(symbol)
```

For market-wide discovery:

```text
get_earnings_calendar(start_date, days, filter="high_market_cap")
```

## Use case 10 — Exercise scanners safely

Start read-only:

```text
get_scanner_filter_specs
get_scans
run_scan(scan_id)
```

Only after reviewing actual specs and obtaining confirmation:

```text
create_scan
update_scan_config
update_scan_filters
```

## Use case 11 — Review and place an equity order

Safe order flow:

```text
1. Explicitly choose account.
2. get_equity_tradability.
3. Generate and persist ref_id.
4. review_equity_order with exact terms.
5. Display quote, alerts, and exact order terms.
6. Obtain explicit final authorization.
7. place_equity_order with the same terms and persisted ref_id.
8. Persist returned broker order UUID and state.
9. Reconcile through get_equity_orders.
```

If submission returns ambiguously, do not create a new `ref_id`. Retry with the original UUID or reconcile by broker history first.

## Use case 12 — Cancel an equity order

```text
get_equity_orders(account_number, order_id)
→ verify it is the intended order and remains cancellable
→ obtain explicit cancellation authorization
→ cancel_equity_order(account_number, order_id)
→ get_equity_orders(account_number, order_id)
```

Cancellation may lose a race with a fill. Treat the later broker state as authoritative.

## Use case 13 — Sell specified equity lots

```text
get_equity_tax_lots(account_number, symbol)
→ display lot quantities, cost bases, and holding periods
→ user explicitly selects lots and quantities
→ review_equity_order(..., tax_lots=[...])
→ confirm
→ place_equity_order(..., same tax_lots, ref_id)
```

Do not select lots automatically unless a separately approved policy exists.

## Use case 14 — Research and trade one option contract

```text
get_option_chains(underlying_symbol)
→ get_option_instruments(chain/expiration/type/strike)
→ get_option_quotes(instrument_ids)
→ review_option_order(single leg)
→ explicit confirmation
→ place_option_order(same leg and persisted ref_id)
→ get_option_orders(order_id)
```

The current MCP supports single-leg options orders only.

## Use case 15 — Manage watchlists

Read-only exploration:

```text
get_watchlists
get_watchlist_items(list_id)
get_popular_watchlists
get_option_watchlist
```

Writes require confirmation:

```text
create_watchlist
update_watchlist
add_to_watchlist
remove_from_watchlist
follow_watchlist
unfollow_watchlist
add_option_to_watchlist
remove_option_from_watchlist
```

## Exercise plan

## Phase 1 — Schema inventory

- [x] Export all 49 tool definitions.
- [x] Confirm no tokens, account data, or tool results are in the export.
- [x] Categorize read-only, simulation, account-write, and financial-mutation tools.
- [x] Identify broker-sync and idempotency capabilities.

## Phase 2 — Read-only broker synchronization

Exercise one tool at a time and record redacted result shapes:

1. `get_accounts`
2. `get_portfolio`
3. `get_equity_orders` for the existing order UUID
4. `get_equity_orders` in paginated list mode with `placed_agent: "agentic"`
5. `get_equity_positions`
6. `get_equity_tax_lots` for an existing holding
7. `get_pnl_trade_history`
8. `get_realized_pnl`

Do not persist raw account responses in Git.

## Phase 3 — Read-only market data

Exercise:

1. `search`
2. `get_equity_quotes`
3. `get_equity_fundamentals`
4. `get_financials`
5. `get_earnings_results`
6. `get_earnings_calendar`
7. `get_equity_historicals`
8. `get_equity_technical_indicators`
9. `get_equity_price_book`
10. `get_equity_tradability`
11. `get_indexes`
12. `get_index_quotes`

Capture limits, nullability, timestamps, and error shapes. Exercise normal usage only; do not deliberately trigger throttling. Record latency, page size, cursor behavior, HTTP or MCP error category, `Retry-After`, and whether conservative concurrency encounters any limit.

## Phase 4 — Read-only options discovery

Exercise only if options work is desired:

1. `get_option_chains`
2. `get_option_instruments`
3. `get_option_quotes`
4. `get_option_positions`
5. `get_option_orders`
6. `get_option_watchlist`

Do not place an option order for discovery.

## Phase 5 — Scanner and watchlist reads

Exercise read-only tools first:

- `get_scanner_filter_specs`
- `get_scans`
- `run_scan`
- `get_watchlists`
- `get_watchlist_items`
- `get_popular_watchlists`

Account-write tools should be tested only with an explicitly disposable scan or watchlist and separate approval.

## Phase 6 — Simulations

Use order-review tools with explicitly approved hypothetical terms:

- `review_equity_order`
- `review_option_order`

A simulation is not authority to place an order.

## Phase 7 — Financial mutations

Do not run as part of general discovery. Exercise only during a separately authorized legitimate transaction:

- `place_equity_order`
- `cancel_equity_order`
- `place_option_order`
- `cancel_option_order`

Capture redacted input/output shapes after the legitimate action.

## Response-discovery template

For each exercised tool, document:

```text
Tool:
Date exercised:
Read-only / simulation / mutation:
Redacted request shape:
Redacted success shape:
Pagination fields:
Stable broker identifiers:
State enum values observed:
Timestamp fields and formats:
Decimal/string fields:
Nullable or omitted fields:
Sensitive fields to discard:
Error shape:
Rate or size limits observed:
Integration consequence:
```

## RH Agent integration recommendation

Based on schema discovery, prefer this minimal architecture:

```text
Order submission
→ persist unique local attempt ID and ref_id before submission
→ submit through typed MCP executor
→ persist broker order UUID and state

On-demand refresh
→ get_equity_orders placed_agent=agentic
→ get_equity_positions
→ get_pnl_trade_history
→ upsert typed broker records by stable broker identity

Optional backend poll
→ run only when an authenticated unattended MCP path is proven
→ reconcile unresolved orders
```

Avoid building a local event ledger, tax-lot engine, or position-effect classifier unless response discovery proves Robinhood cannot provide the required facts.

## Known unknowns

- Exact success and error response shapes for each tool.
- Stable identity fields returned by `get_pnl_trade_history`.
- Exact fill fields returned by `get_equity_orders`.
- Retention horizon for order and trade history.
- Page size and cursor lifetime.
- Global rate limits and throttling behavior; no request-rate quota is currently published, so conservative defaults apply until normal usage provides evidence.
- Whether `placed_agent: "agentic"` includes every RH Agent order consistently.
- Whether `get_pnl_trade_history` exposes sufficient asset metadata for clean equity-only filtering.
- Whether the cloud environment can authenticate read-only MCP calls for unattended polling.
- Robinhood behavior when an equity sell exceeds the current long position.

## Redaction and artifact policy

Never commit:

- Account numbers.
- OAuth tokens.
- Session tokens.
- Account-specific URLs.
- Raw portfolio responses.
- Raw order responses containing personal or account data.

Safe documentation may include:

- Tool names.
- Public descriptions.
- Input schemas.
- Redacted structural response fixtures.
- Synthetic test fixtures.

The exported schema catalog is a discovery artifact. This Markdown guide is the durable human-readable inventory; production code should use canonical typed contracts and tests rather than reading the exported catalog at runtime.

# Bonus use case — Operate a wheel options strategy over time

## Objective

Operate a single-underlying wheel as a broker-reconciled state machine:

```text
cash available
→ sell a cash-secured put
→ put expires or is closed: sell another put
→ put assignment confirmed: hold shares
→ sell a covered call
→ call expires or is closed: sell another covered call
→ call assignment confirmed: shares leave the account
→ return to cash-secured puts
```

This appendix describes mechanics and data flow, not a recommendation to use the strategy or a guarantee of profit. A wheel retains substantial downside exposure when the stock falls, caps upside while a covered call is open, can be assigned early, and can incur tax and dividend consequences.

The MCP supports the necessary single-leg option-order shapes, but response discovery must prove how Robinhood reports expiration, assignment, exercise, collateral, and released holds before unattended lifecycle transitions are implemented.

## Core operating rule

Broker facts control lifecycle state. Do not transition merely because an expiration date passed or an option quote appears out of the money.

Examples:

- Do not assume a put expired until Robinhood no longer reports an open short-put position and its order/position history explains the terminal state.
- Do not assume assignment until the equity position or tax lots show the acquired shares and the short put is no longer open.
- Do not assume shares were called away until the equity position and tax lots show the reduction and the short call is no longer open.
- Do not infer assignment from option moneyness alone.

## Capability boundary

The discovered MCP inventory provides:

- Option-chain and contract discovery.
- Option quotes.
- Single-leg option review and placement.
- Option order history and lookup.
- Open and closed option positions.
- Equity positions and tax lots.
- Portfolio value and buying power.
- Equity and option order cancellation.
- Realized P&L and per-trade realized history.
- Earnings, fundamentals, historical prices, indicators, and tradability.

No dedicated assignment or exercise-history tool was discovered. Assignment recognition therefore requires correlated read-only observations from `get_option_orders`, `get_option_positions`, `get_equity_positions`, `get_equity_tax_lots`, and performance history. Keep assignment representation as an explicit discovery question.

The MCP supports single-leg option orders only. A roll is not atomic: it is a close order followed by a separate open order, with fill, price, and exposure risk between them.

## Strategy state machine

Use explicit states rather than deriving the phase from UI labels:

```text
READY_FOR_PUT
PUT_OPEN_ORDER_PENDING
SHORT_PUT_OPEN
PUT_CLOSE_ORDER_PENDING
PUT_TERMINAL_RECONCILIATION
SHARES_HELD
CALL_OPEN_ORDER_PENDING
SHORT_CALL_OPEN
CALL_CLOSE_ORDER_PENDING
CALL_TERMINAL_RECONCILIATION
PAUSED
ERROR_REQUIRES_REVIEW
```

### State meanings

| State | Broker evidence required | Permitted next financial action |
|---|---|---|
| `READY_FOR_PUT` | No active wheel put/call and collateral snapshot is current | Review one cash-secured put |
| `PUT_OPEN_ORDER_PENDING` | Submitted put order is nonterminal | Cancel or wait; do not submit another opening put |
| `SHORT_PUT_OPEN` | Filled sell-to-open order and open short-put position | Hold, buy to close, or begin a non-atomic roll |
| `PUT_CLOSE_ORDER_PENDING` | Buy-to-close order is nonterminal | Cancel or wait |
| `PUT_TERMINAL_RECONCILIATION` | Put disappeared, expired, closed, or may have been assigned | Read-only reconciliation only |
| `SHARES_HELD` | Sufficient unencumbered Robinhood-reported shares exist | Review a covered call |
| `CALL_OPEN_ORDER_PENDING` | Submitted call order is nonterminal | Cancel or wait; do not submit another opening call |
| `SHORT_CALL_OPEN` | Filled sell-to-open order and open short-call position | Hold, buy to close, or begin a non-atomic roll |
| `CALL_CLOSE_ORDER_PENDING` | Buy-to-close order is nonterminal | Cancel or wait |
| `CALL_TERMINAL_RECONCILIATION` | Call disappeared, expired, closed, or may have been assigned | Read-only reconciliation only |
| `PAUSED` | User or risk policy stopped new orders | Read-only refresh and explicitly authorized risk-reducing actions |
| `ERROR_REQUIRES_REVIEW` | Broker facts conflict, are incomplete, or cannot be parsed | No new opening order |

A state transition should store the evidence timestamp and broker identifiers that justified it.

## Wheel instance data

A local wheel record is orchestration state, not a replacement for Robinhood records. Minimum candidate fields:

```text
wheelId
userId
accountRef
symbol
status
strategyPhase
contracts
sharesPerContract
policyVersion
createdAt
updatedAt
pausedAt?

activeOptionOrderId?
activeOptionPositionId?
activeOptionInstrumentId?
activeRefId?
activeExpiration?
activeStrike?
activeOptionType?
activePositionEffect?
activeSide?

lastOrderSyncAt?
lastOptionPositionSyncAt?
lastEquityPositionSyncAt?
lastTaxLotSyncAt?
lastPortfolioSyncAt?
lastReconciledAt?
reconciliationError?
```

`accountRef` must be an internal secret-safe reference, not an account number exposed to the browser. Broker order and position records should remain separate typed records and preserve stable Robinhood identities.

## Wheel policy inputs

The system needs an explicit policy before selecting a contract. Candidate fields include:

```text
symbol
contractCount
allowedExpirations or targetDaysToExpiration
putStrikeRule
callStrikeRule
minimumPremium?
minimumOpenInterest?
maximumBidAskSpread?
avoidEarningsWindow?
allowEarlyClose?
earlyCloseProfitTarget?
allowRoll?
rollWindow?
minimumCallStrikeAboveCostBasis?
maximumCapitalAllocation?
```

Tool definitions do not prove that every selection metric, such as open interest or Greeks, is present in quote results. Record actual `get_option_quotes` output before making those fields mandatory or automating contract selection.

## Safety invariants

Before every opening order:

- There must be exactly one active wheel phase for the account and symbol.
- No unresolved opening or closing order may exist for that wheel leg.
- The chosen contract UUID must come from a current `get_option_instruments` response.
- A current quote must be available and its timestamp must be acceptable.
- `review_option_order` must succeed with no unresolved collateral, permissions, or tradability alert.
- The reviewed terms and submitted terms must match exactly.
- A new UUID `ref_id` must be persisted before the first submission.
- The same `ref_id` must be reused for an ambiguous retry.
- Explicit authorization must cover the exact account, symbol, option contract, side, position effect, quantity, type, price, expiration, and batch.

Additional put invariant:

```text
required secured cash must be confirmed by Robinhood review/collateral data
```

Do not calculate available collateral solely as `strike × 100 × contracts`; account holds, unsettled funds, existing orders, and Robinhood rules remain authoritative.

Additional call invariant:

```text
covered contracts <= floor(unencumbered eligible shares / contract multiplier)
```

Do not calculate coverage from total shares alone. Existing option positions and order holds may already encumber shares. Require Robinhood review to confirm coverage.

Never open a naked short option as a wheel action. If broker evidence cannot prove cash security or share coverage, pause.

## Information needed and MCP source

| Information | Primary tool | Why it is needed |
|---|---|---|
| Explicit account choice and permissions | `get_accounts` | Select the intended agentic account without silently defaulting |
| Buying power and portfolio allocation | `get_portfolio` | Initial cash and concentration context |
| Current shares and average cost | `get_equity_positions` | Determine whether the wheel is in the stock phase |
| Share lots and acquisition costs | `get_equity_tax_lots` | Cost-basis context and post-assignment evidence |
| Existing equity orders | `get_equity_orders` | Detect pending share transactions or assignment-related evidence if represented |
| Existing option orders | `get_option_orders` | Prevent duplicate/conflicting orders and reconcile order state |
| Existing option positions | `get_option_positions` | Detect open short puts/calls and closed zero-quantity positions |
| Chain IDs and expirations | `get_option_chains` | Find candidate expiration cycles |
| Contract UUID, strike, type, state | `get_option_instruments` | Select the exact put or call contract |
| Option bid/ask and timestamp | `get_option_quotes` | Choose and review a limit price |
| Equity quote and prior close | `get_equity_quotes` | Underlying-price context |
| Earnings date | `get_earnings_results` | Apply an earnings-window policy |
| Fundamentals and financial trend | `get_equity_fundamentals`, `get_financials` | Support the decision that the stock is acceptable to own |
| Price history and indicators | `get_equity_historicals`, `get_equity_technical_indicators` | Optional systematic strike/timing inputs |
| Equity tradability | `get_equity_tradability` | Confirm account/session eligibility |
| Exact pre-trade alerts and collateral | `review_option_order` | Final broker-side validation before submission |
| Closed-trade and aggregate P&L | `get_pnl_trade_history`, `get_realized_pnl` | Strategy reporting and reconciliation |

## Initial reconciliation before starting or resuming

Run these read-only calls before selecting a new leg:

```text
1. get_accounts and use the explicitly selected account
2. get_portfolio
3. get_equity_positions through all cursors
4. get_option_positions through all cursors, including zero-quantity history when useful
5. get_equity_orders through all relevant cursors
6. get_option_orders through all relevant cursors
7. get_equity_tax_lots when shares are held
8. get_pnl_trade_history for the reporting window
```

Classify only after the complete snapshots are available:

- Open short put exists: `SHORT_PUT_OPEN`.
- Put order is unresolved: `PUT_OPEN_ORDER_PENDING` or `PUT_CLOSE_ORDER_PENDING`.
- Sufficient uncovered shares exist and no short put is active: `SHARES_HELD`.
- Open covered call exists: `SHORT_CALL_OPEN`.
- Call order is unresolved: `CALL_OPEN_ORDER_PENDING` or `CALL_CLOSE_ORDER_PENDING`.
- No option exposure and no wheel shares: `READY_FOR_PUT`.
- Multiple contradictory states: `ERROR_REQUIRES_REVIEW`.

Do not automatically cancel or replace orders discovered during startup.

## Underlying and contract selection

The wheel should be run only on a symbol the user is willing and financially able to own through a significant decline.

Read-only candidate sequence:

```text
get_equity_quotes
→ get_equity_fundamentals
→ get_financials
→ get_earnings_results
→ optional get_equity_historicals and get_equity_technical_indicators
→ get_option_chains
→ get_option_instruments
→ get_option_quotes
```

Contract-selection output must identify:

- Underlying symbol and current price timestamp.
- Option contract UUID.
- Put or call.
- Strike.
- Expiration.
- Bid, ask, and proposed limit price.
- Contract count and multiplier when returned.
- Maximum secured purchase obligation for a put.
- Maximum shares potentially delivered for a call.
- Earnings or corporate-event context known to the system.
- Why the candidate satisfies the configured policy.

Do not use a market option order as the default. Option spreads can widen materially; use an explicitly authorized limit price unless the user intentionally selects another supported type.

## Cash-secured put opening sequence

### 1. Confirm cash phase

Require:

- `READY_FOR_PUT` after full reconciliation.
- No active short call or wheel shares requiring management.
- No unresolved option order for the same wheel.
- Current portfolio and option-position snapshots.

### 2. Resolve the contract

```text
get_option_chains(underlying_symbol)
→ choose an allowed expiration
→ get_option_instruments(chain_symbol or chain_id, expiration, strike, type="put", state="active", tradability="tradable")
→ get_option_quotes(instrument_ids)
```

Never reuse a stale contract UUID without confirming it remains active and tradable.

### 3. Build the review request

The single leg is:

```json
{
  "option_id": "<PUT_CONTRACT_UUID>",
  "side": "sell",
  "position_effect": "open",
  "ratio_quantity": 1
}
```

Typical review shape:

```json
{
  "account_number": "<EXPLICITLY_SELECTED_ACCOUNT>",
  "legs": ["<SELL_TO_OPEN_PUT_LEG>"],
  "quantity": "<CONTRACT_COUNT>",
  "type": "limit",
  "price": "<LIMIT_CREDIT>",
  "time_in_force": "gfd",
  "market_hours": "regular_hours",
  "chain_symbol": "<SYMBOL>",
  "underlying_type": "equity"
}
```

The actual `legs` value is an object array; the placeholder keeps account and contract data out of documentation.

### 4. Review and authorize

Call `review_option_order` and display:

- Exact contract description.
- Sell-to-open position effect.
- Contracts.
- Limit credit.
- Estimated proceeds and fees when returned.
- Secured cash or collateral information when returned.
- Buying-power effect.
- Every alert.

Do not place while an alert is unexplained. Obtain final authorization for these exact reviewed terms.

### 5. Persist intent before submission

Persist:

- Wheel ID and expected phase.
- Unique execution-attempt ID.
- Newly generated `ref_id`.
- Exact reviewed terms.
- Contract UUID, strike, expiration, and quantity.
- Authorization timestamp and policy version.

Transition to `PUT_OPEN_ORDER_PENDING` before or atomically with dispatch so a process restart cannot submit another opening put.

### 6. Place and reconcile

Call `place_option_order` with the exact reviewed terms and persisted `ref_id`.

On a successful response:

- Persist broker order UUID and broker state.
- Do not mark the put open until fill evidence exists.
- Query `get_option_orders(account_number, order_id)` until terminal or filled.
- Refresh `get_option_positions` after a fill.

On an ambiguous timeout or transport failure:

- Do not create another `ref_id`.
- Query option orders with account, date, placement source, and known identifiers.
- Retry only when reconciliation proves it safe, using the original `ref_id`.

### 7. Handle order outcomes

- Filled: require the open short-put position, then transition to `SHORT_PUT_OPEN`.
- Partially filled: preserve filled and remaining quantities; do not submit a duplicate remainder.
- Queued or confirmed: remain pending and poll conservatively.
- Rejected, failed, cancelled, or voided: preserve the terminal order and return to `READY_FOR_PUT` only after positions confirm no exposure.
- Pending cancellation: remain pending until Robinhood reports the final result.

## Manage the open short put

While `SHORT_PUT_OPEN`, periodically refresh:

```text
get_option_orders(account_number, active order_id)
get_option_positions(account_number, option_ids=<active contract>)
get_option_quotes(instrument_ids=<active contract>)
get_equity_positions(account_number)
get_portfolio(account_number)
```

Use option quotes for decision support, not lifecycle truth. The position and order responses determine whether exposure remains open.

Monitor:

- Days and hours to expiration in the applicable market timezone.
- Underlying price relative to strike.
- Current bid/ask and spread.
- Broker-reported option quantity and direction.
- Order holds and buying-power impact when exposed.
- Upcoming earnings, dividends, and corporate actions when available.
- Whether an early-assignment indicator is exposed by actual response data.
- Any unexpected equity-position change.

A strategy policy may recommend holding, closing, or rolling, but every financial action still follows review, exact authorization, persisted `ref_id`, placement, and reconciliation.

## Buy a short put to close

A close may be used to realize a profit, limit further loss, avoid assignment risk, or begin a roll.

### Close sequence

1. Confirm `SHORT_PUT_OPEN` from a current option-position snapshot.
2. Confirm no unresolved order already targets the same short position.
3. Refresh the contract quote.
4. Build one leg:

```json
{
  "option_id": "<OPEN_SHORT_PUT_UUID>",
  "side": "buy",
  "position_effect": "close",
  "ratio_quantity": 1
}
```

5. Call `review_option_order` using the intended quantity and limit debit.
6. Display the exact debit, estimated fees, quantity, and alerts.
7. Obtain explicit authorization.
8. Persist a new execution attempt and `ref_id`.
9. Transition to `PUT_CLOSE_ORDER_PENDING`.
10. Call `place_option_order`.
11. Reconcile through `get_option_orders` and `get_option_positions`.
12. Return to `READY_FOR_PUT` only when the close is filled and no short-put quantity remains.

A cancellation or failed close leaves the short put open unless broker positions prove otherwise.

## Put expiration and assignment reconciliation

Expiration processing must tolerate delayed overnight broker updates. At or after expiration:

1. Transition to `PUT_TERMINAL_RECONCILIATION`; do not open another option.
2. Query the active option order and position.
3. Query current equity positions.
4. Query tax lots for the underlying if shares appear.
5. Query recent option and equity orders.
6. Query recent realized trade history when useful.
7. Repeat with conservative backoff while Robinhood records are still settling.

### Expired or otherwise closed without assignment

Require all of the following:

- No open short-put quantity remains.
- No unresolved option order remains.
- No corresponding assignment-sized share increase is observed.
- Available collateral or buying power reflects release when that field is available.

Then preserve the closed option history and transition to `READY_FOR_PUT`.

### Assigned

Assignment evidence should include:

- The short-put position is terminal or absent from open positions.
- Equity quantity increased consistently with the assigned contracts and multiplier.
- New Robinhood tax lots appear with broker acquisition dates and costs.
- No unresolved option order contradicts the conclusion.

Then:

- Persist the assignment reconciliation evidence.
- Refresh portfolio and buying power.
- Use Robinhood tax-lot cost basis as authoritative.
- Transition to `SHARES_HELD`.
- Do not immediately sell a covered call until the share position and coverage are stable and reviewable.

If the option disappeared but shares and lots have not appeared, remain in reconciliation. Do not classify it as expiration merely to advance the wheel.

### Partial assignment or unexpected quantity

Do not assume every contract follows the same outcome. Reconcile contract and share quantities independently:

```text
assigned contracts inferred from broker evidence
remaining short-put contracts from option positions
acquired shares from equity positions and lots
```

If both a residual short put and assigned shares exist, pause new opening orders and require review. The wheel may need separate sub-lots or per-contract lifecycle tracking.

## Covered-call readiness

Before selecting a call, obtain:

```text
get_equity_positions
get_equity_tax_lots
get_option_positions
get_option_orders
get_portfolio
get_equity_quotes
```

Determine:

- Broker-reported total shares.
- Existing share holds or encumbrances when exposed.
- Existing short calls.
- Existing pending call orders.
- Robinhood average cost and lot costs.
- Eligible unencumbered shares.
- Current underlying price.

The maximum candidate contract count is bounded by broker-confirmed coverage. A local `floor(shares / 100)` calculation is only a preliminary check; the order review is authoritative.

The call-strike policy may consider:

- Assignment-lot cost basis.
- Net wheel basis after realized premiums, if reported separately and clearly labeled.
- Desired upside participation.
- Expiration window.
- Earnings and ex-dividend risk.
- Bid/ask spread and premium.

Do not relabel premium-adjusted strategy basis as Robinhood tax basis.

## Covered-call opening sequence

### 1. Confirm stock phase

Require:

- `SHARES_HELD` after complete reconciliation.
- Sufficient broker-confirmed eligible shares.
- No open short put requiring management.
- No existing short call consuming the same shares.
- No unresolved call order.

### 2. Resolve the call contract

```text
get_option_chains(underlying_symbol)
→ choose an allowed expiration
→ get_option_instruments(chain_symbol or chain_id, expiration, strike, type="call", state="active", tradability="tradable")
→ get_option_quotes(instrument_ids)
```

The selected strike and expiration must satisfy the configured covered-call policy and be displayed for authorization.

### 3. Build the review request

The single leg is:

```json
{
  "option_id": "<CALL_CONTRACT_UUID>",
  "side": "sell",
  "position_effect": "open",
  "ratio_quantity": 1
}
```

Typical review terms:

```json
{
  "account_number": "<EXPLICITLY_SELECTED_ACCOUNT>",
  "legs": ["<SELL_TO_OPEN_CALL_LEG>"],
  "quantity": "<COVERED_CONTRACT_COUNT>",
  "type": "limit",
  "price": "<LIMIT_CREDIT>",
  "time_in_force": "gfd",
  "market_hours": "regular_hours",
  "chain_symbol": "<SYMBOL>",
  "underlying_type": "equity"
}
```

### 4. Review coverage and authorize

Call `review_option_order` and require:

- No naked-call or insufficient-collateral alert.
- Exact shares potentially delivered.
- Exact contract, strike, expiration, count, and limit credit.
- Any fee, dividend, exercise, or assignment information returned.
- Reviewed terms that exactly match the intended placement.

If Robinhood cannot confirm the call is covered, do not place it.

### 5. Persist, place, and reconcile

1. Persist a new call execution attempt and `ref_id`.
2. Transition to `CALL_OPEN_ORDER_PENDING`.
3. Call `place_option_order` with the reviewed terms.
4. Persist broker order UUID and state.
5. Poll `get_option_orders` conservatively.
6. After a fill, require `get_option_positions` to show the open short call.
7. Refresh equity positions to ensure share quantity is still present.
8. Transition to `SHORT_CALL_OPEN` only after both option and share evidence agree.

Handle queued, partially filled, rejected, failed, cancelled, voided, pending-cancelled, and ambiguous outcomes in the same broker-reconciled manner as the put leg.

## Manage the open covered call

While `SHORT_CALL_OPEN`, refresh:

```text
get_option_orders(account_number, active order_id)
get_option_positions(account_number, option_ids=<active contract>)
get_option_quotes(instrument_ids=<active contract>)
get_equity_positions(account_number)
get_equity_tax_lots(account_number, symbol)
get_equity_quotes(symbols=<underlying>)
```

Monitor:

- Remaining short-call quantity.
- Underlying price relative to strike.
- Time to expiration.
- Current call bid/ask.
- Equity quantity and share holds.
- Ex-dividend date when discoverable, because early assignment risk can increase.
- Earnings and corporate events.
- Unexpected share reduction or option-position change.

Do not sell the covered shares through a separate equity order while the call remains open unless a separately reviewed action first removes or safely accounts for the call obligation.

## Buy a covered call to close

A close may lock in option profit, remove delivery risk, free shares, or begin a roll.

The leg is:

```json
{
  "option_id": "<OPEN_SHORT_CALL_UUID>",
  "side": "buy",
  "position_effect": "close",
  "ratio_quantity": 1
}
```

Sequence:

1. Confirm the short-call position and quantity.
2. Confirm the covering shares still exist.
3. Confirm no unresolved close or replacement order exists.
4. Refresh the call quote.
5. Review the buy-to-close limit order.
6. Display exact debit, fees, quantity, and alerts.
7. Obtain explicit authorization.
8. Persist a new execution attempt and `ref_id`.
9. Transition to `CALL_CLOSE_ORDER_PENDING`.
10. Place and reconcile through order and option-position reads.
11. Refresh equity positions and tax lots.
12. Return to `SHARES_HELD` only when no short-call quantity remains and the shares remain in the account.

## Call expiration and assignment reconciliation

At or after expiration:

1. Transition to `CALL_TERMINAL_RECONCILIATION`.
2. Query the active option order and position.
3. Query equity positions and tax lots.
4. Query recent equity and option orders.
5. Query realized trade history when useful.
6. Wait for delayed broker settlement when facts remain incomplete.

### Expired or closed without assignment

Require:

- No open short-call quantity remains.
- No unresolved call order remains.
- Covering shares remain in the account.
- Share holds are released when hold data is available.

Transition to `SHARES_HELD`, then begin a new call-selection cycle only after a fresh quote, contract lookup, review, and authorization.

### Assigned or called away

Evidence should include:

- Short-call position is terminal or absent from open positions.
- Equity quantity decreased consistently with assigned contracts and multiplier.
- Tax lots reflect the broker-selected or specified disposition.
- No unresolved option order contradicts assignment.

Then:

- Persist assignment/call-away evidence.
- Refresh portfolio, buying power, and realized P&L.
- Preserve Robinhood-reported lot and sale information.
- Transition to `READY_FOR_PUT` only when no residual wheel shares or short-call quantity remain.

If some shares remain, transition to `SHARES_HELD` or `ERROR_REQUIRES_REVIEW` according to whether they form a valid covered-call unit under policy.

### Early assignment

Do not wait until expiration to detect assignment. Every monitoring refresh should compare:

```text
prior option quantity vs current option quantity
prior equity quantity vs current equity quantity
prior tax lots vs current tax lots
```

An unexpected correlated change should trigger terminal reconciliation immediately. Do not place a replacement leg until broker state stabilizes.

## Rolling a put or call

Because only single-leg orders are supported, rolling requires two independent transactions:

```text
buy existing short option to close
→ confirm close fill and absence of old short position
→ discover and quote replacement contract
→ review replacement sell-to-open order
→ obtain new authorization
→ place replacement with a new ref_id
```

Rules:

- Never describe the two calls as an atomic roll.
- Do not submit the opening leg while the closing leg is unresolved.
- Use a distinct persisted `ref_id` for each logical order.
- Recalculate collateral or coverage after the close.
- Re-fetch the replacement quote; market prices may change between legs.
- Re-run `review_option_order` for the replacement.
- Accept that the replacement may no longer meet the policy after the close fills.
- If the replacement is rejected or unattractive, remain safely unoptioned in `READY_FOR_PUT` or `SHARES_HELD`.

A policy may suggest rolling before expiration, but the exact close and open orders each require their own review and authorization.

## Cancelling a pending wheel order

For a pending put or call:

```text
get_option_orders(account_number, order_id)
→ verify exact order and current cancellability
→ obtain explicit cancellation authorization
→ cancel_option_order(account_number, order_id)
→ poll get_option_orders until terminal
→ refresh get_option_positions
```

A cancellation request can race with a fill. Never assume cancellation succeeded from the request alone. If a fill occurred, transition to the corresponding open-position state.

## Scheduling and refresh cadence

Suggested conservative operation:

### User-triggered refresh

Run the full relevant reconciliation whenever the user opens the wheel dashboard or presses **Refresh from Robinhood**.

### Pending orders

Poll an unresolved order no more frequently than the guide's initial 30-second interval. Stop frequent polling when the order becomes terminal.

### Open positions

Use periodic snapshots appropriate to the product and configured risk policy. Quotes may refresh more frequently than account history, but quotes do not cause lifecycle transitions.

### Expiration window

Increase read-only reconciliation attention near expiration and during the following settlement period without exceeding conservative limits. Do not place a next-cycle order until assignment or expiration is confirmed.

### Unattended operation

An unattended scheduler requires:

- Authenticated backend MCP access proven to refresh reliably.
- Secret-safe account selection.
- Durable state and idempotency keys.
- Distributed locking or transactional lease per wheel.
- Bounded retries and throttling.
- A kill switch.
- Alerting for unresolved and contradictory state.

Even with unattended reads, financial writes must follow the configured authorization model and Robinhood product requirements. Do not assume a prior strategy approval authorizes every future order unless that delegation is explicit, durable, bounded, and supported.

## Concurrency and duplicate prevention

Use one execution lease per `userId + accountRef + symbol + wheelId`.

Before any financial write, transactionally verify:

```text
expected strategy phase still matches
no active execution lease exists
no unresolved local attempt exists
latest broker reconciliation is recent enough
ref_id is persisted
```

After acquiring the lease, refresh the specific order and position again before dispatch. Release the lease only after the response is durably recorded or the attempt is marked ambiguous for reconciliation.

Do not rely on symbol/date fingerprints. Every order has a unique attempt ID, `ref_id`, and broker order UUID when returned.

## Failure and discrepancy handling

Transition to `ERROR_REQUIRES_REVIEW` and block new opening orders when:

- More short contracts exist than expected.
- A covered call appears without sufficient shares.
- Shares changed without explainable option or equity activity.
- An option disappeared but assignment/expiration cannot be distinguished.
- A submitted order cannot be found after an ambiguous response.
- Local and broker quantities disagree after complete pagination.
- A response omits identity, state, quantity, or contract information required for safe interpretation.
- Pagination fails before a complete snapshot is obtained.
- Authentication expires during reconciliation.
- A rate-limit condition persists after bounded backoff.

Recovery sequence:

```text
pause wheel
→ stop new financial writes
→ fetch complete broker snapshots
→ preserve conflicting evidence
→ notify user with redacted identifiers
→ require explicit resolution
→ resume only from a broker-supported state
```

Never repair a discrepancy by submitting a compensating trade automatically.

## Performance and accounting view

Keep broker tax basis separate from strategy analytics.

Broker-authoritative facts:

- Equity tax lots and acquisition dates.
- Equity sale proceeds and realized gains when returned.
- Option order fills and fees when returned.
- Realized trade history.

Derived wheel analytics may include:

```text
put premiums received
call premiums received
option close debits
net option premium
assigned share basis from broker
share sale proceeds from broker
realized wheel P&L
open stock unrealized P&L
capital committed over time
annualized return metrics
```

Label derived values clearly and retain the source broker record IDs. Do not combine unrealized stock loss with realized option premium into a broker-reported P&L field.

Use `get_pnl_trade_history` and `get_realized_pnl` to compare local analytics with Robinhood. Differences must be surfaced, not silently overwritten.

## Wheel dashboard requirements

A usable wheel view should show:

- Account alias and symbol.
- Current strategy phase and last reconciliation time.
- Current shares, average cost, and relevant lots.
- Active option contract, type, strike, expiration, and quantity.
- Option order state, filled quantity, and average fill price when returned.
- Current underlying and option quotes with timestamps.
- Secured cash or covered shares.
- Pending action and whether authorization is required.
- Upcoming earnings and expiration.
- Realized premiums, stock P&L, and combined derived strategy P&L with clear labels.
- Broker discrepancy, stale-data, throttling, or authentication alerts.
- **Refresh from Robinhood**, **Pause**, **Review close**, **Review roll**, and context-specific **Review next leg** actions.

Never display a pending option as an open short position until fill and position evidence exist.

## End-to-end sequence summary

```text
START OR RESUME
→ reconcile accounts, orders, option positions, equity positions, lots, and P&L

NO SHARES / NO SHORT OPTION
→ discover put
→ quote
→ review sell-to-open put
→ authorize
→ persist ref_id
→ place
→ reconcile

SHORT PUT
→ monitor
→ expire/close: return to put selection
→ assignment confirmed: reconcile shares and lots

SHARES HELD
→ discover call
→ quote
→ review sell-to-open covered call
→ authorize
→ persist ref_id
→ place
→ reconcile

SHORT CALL
→ monitor
→ expire/close: return to call selection
→ assignment confirmed: reconcile shares removed and P&L

NO RESIDUAL SHARES / NO SHORT OPTION
→ return to put selection
→ repeat
```

## Wheel-specific discovery checklist

Before implementing wheel automation, capture redacted response evidence for:

- [ ] `get_option_chains` expiration and chain identity fields.
- [ ] `get_option_instruments` contract UUID, strike, type, expiration, multiplier, state, and tradability.
- [ ] `get_option_quotes` bid, ask, timestamps, Greeks, volume, and open interest when available.
- [ ] `review_option_order` sell-to-open put collateral and alert shape.
- [ ] `review_option_order` sell-to-open call coverage and alert shape.
- [ ] `get_option_orders` queued, partial, filled, rejected, cancelled, and terminal field shapes.
- [ ] `get_option_positions` open short put and open short call shapes.
- [ ] `get_option_positions` expired or zero-quantity shape.
- [ ] Robinhood representation of put assignment.
- [ ] Robinhood representation of call assignment or exercise.
- [ ] Timing between option terminal state and equity/tax-lot updates.
- [ ] Partial assignment behavior for multiple contracts.
- [ ] Buying-power and hold release timing.
- [ ] Option fill fees and premium fields.
- [ ] Stable identities for closed option trades and P&L rows.
- [ ] Early-assignment evidence and timestamps.
- [ ] Ex-dividend information availability.
- [ ] History retention and pagination limits for multi-month wheels.
- [ ] Behavior when an attempted put is not cash-secured.
- [ ] Behavior when an attempted call is not fully covered.
- [ ] Behavior when closing and replacement legs are submitted separately.

Do not place an option order solely to complete this checklist. Gather mutation evidence from future legitimate, explicitly authorized wheel actions and use synthetic fixtures for automated tests.

# Robinhood MCP — Canonical Tool Discovery

> **Generated draft** (2026-10-07T22:59:52.059Z) — assembled from `probe-manifest.json` × `captures/` × live `tools/list`. Hand-finished by task #689: safety notes, gap callouts, curated samples.

## Coverage matrix

| tool | category | params (req/total) | probes | outcomes | status |
|---|---|---|---|---|---|
| add_option_to_watchlist | Watchlists | 1/2 | — | — | missing |
| add_to_watchlist | Watchlists | 1/4 | — | — | missing |
| cancel_crypto_order | Crypto | 2/2 | — | — | missing |
| cancel_equity_order | Orders | 2/2 | 13 | 10 success, 3 error | probed |
| cancel_option_exercise | Orders | 2/2 | — | — | missing |
| cancel_option_order | Orders | 2/2 | 2 | — | unprobed |
| create_alert | Alerts | 2/5 | — | — | missing |
| create_scan | Scanners | 0/5 | — | — | missing |
| create_watchlist | Watchlists | 1/3 | — | — | missing |
| delete_alert | Alerts | 1/2 | — | — | missing |
| exercise_option | Orders | 3/6 | — | — | missing |
| follow_watchlist | Watchlists | 1/1 | — | — | missing |
| get_accounts | Account & Performance | 0/0 | 1 | 1 success | probed |
| get_alert_log | Alerts | 0/4 | 4 | 4 success | probed |
| get_alerts | Alerts | 0/3 | 5 | 4 success, 1 error | probed |
| get_crypto_account_onboarding_info | Crypto | 0/0 | 1 | 1 success | probed |
| get_crypto_orders | Crypto | 1/9 | 13 | 13 error | error-only |
| get_crypto_positions | Crypto | 1/2 | 1 | 1 success | probed |
| get_crypto_quotes | Crypto | 1/3 | 4 | 4 success | probed |
| get_currency_pairs | Crypto | 0/2 | 4 | 4 success | probed |
| get_earnings_calendar | Market Data & Research | 0/3 | 3 | 3 success | probed |
| get_earnings_results | Market Data & Research | 1/1 | 1 | 1 success | probed |
| get_equity_analyst_ratings | Market Data & Research | 1/1 | 1 | 1 success | probed |
| get_equity_fundamentals | Market Data & Research | 1/2 | 4 | 4 success | probed |
| get_equity_historicals | Market Data & Research | 2/6 | 13 | 11 success, 2 error | probed |
| get_equity_orders | Orders | 1/7 | 11 | 11 success | probed |
| get_equity_positions | Account & Performance | 1/2 | 4 | 3 success, 1 error | probed |
| get_equity_price_book | Market Data & Research | 1/1 | 1 | 1 success | probed |
| get_equity_quotes | Market Data & Research | 1/1 | 5 | 4 success, 3 error | probed |
| get_equity_tax_lots | Account & Performance | 2/3 | 3 | 3 success | probed |
| get_equity_technical_indicators | Market Data & Research | 4/15 | 20 | 20 success | probed |
| get_equity_tradability | Market Data & Research | 2/2 | 1 | 1 success | probed |
| get_financials | Market Data & Research | 1/3 | 2 | 2 success | probed |
| get_index_historicals | Market Data & Research | 3/4 | 3 | 2 success, 1 error | probed |
| get_index_quotes | Market Data & Research | 1/1 | 1 | 1 success | probed |
| get_indexes | Market Data & Research | 0/1 | 2 | 2 success | probed |
| get_limited_margin_upgrade_info | Account & Performance | 1/1 | 1 | 1 success | probed |
| get_option_chains | Options | 0/2 | 5 | 5 success | probed |
| get_option_historicals | Options | 2/5 | 3 | 3 success | probed |
| get_option_instruments | Options | 0/9 | 12 | 11 success, 1 error | probed |
| get_option_level_upgrade_info | Options | 1/1 | 2 | 2 success | probed |
| get_option_orders | Orders | 1/8 | 13 | 13 success | probed |
| get_option_positions | Options | 1/10 | 11 | 11 success | probed |
| get_option_quotes | Options | 1/1 | 3 | 3 success | probed |
| get_option_watchlist | Options | 0/0 | 1 | 1 success | probed |
| get_pnl_trade_history | Account & Performance | 1/4 | 7 | 7 success | probed |
| get_politician_trades | Market Data & Research | 0/2 | 3 | 3 success | probed |
| get_popular_watchlists | Watchlists | 0/0 | 1 | 1 success | probed |
| get_portfolio | Account & Performance | 1/1 | 1 | 1 success | probed |
| get_realized_pnl | Account & Performance | 1/7 | 11 | 10 success, 1 error | probed |
| get_scanner_datapoints | Scanners | 1/1 | 9 | 9 success | probed |
| get_scanner_filter_specs | Scanners | 0/0 | 1 | 1 success | probed |
| get_scans | Scanners | 0/0 | 1 | 1 success | probed |
| get_sec_filing | SEC Filings | 1/2 | 3 | 2 success, 1 error | probed |
| get_sec_filing_facts | SEC Filings | 2/2 | 1 | 1 success | probed |
| get_sec_filing_facts_catalog | SEC Filings | 1/4 | 5 | 5 success | probed |
| get_sec_filing_index | SEC Filings | 1/5 | 5 | 5 success | probed |
| get_watchlist_items | Watchlists | 1/1 | 2 | 1 success, 1 error | probed |
| get_watchlists | Watchlists | 0/0 | 1 | 1 success | probed |
| mark_alerts_read | Alerts | 0/2 | 1 | 1 success | probed |
| place_crypto_order | Crypto | 4/11 | — | — | missing |
| place_equity_order | Orders | 4/12 | 21 | 17 success, 5 error, 1 skipped | probed |
| place_option_order | Orders | 3/10 | 2 | — | unprobed |
| preview_crypto_order | Crypto | 4/10 | 6 | 6 error | error-only |
| preview_scan | Scanners | 1/2 | 7 | 5 success, 2 error | probed |
| remove_from_watchlist | Watchlists | 1/4 | — | — | missing |
| remove_option_from_watchlist | Watchlists | 1/2 | — | — | missing |
| review_equity_order | Orders | 4/11 | 19 | 19 success | probed |
| review_option_order | Orders | 3/11 | 25 | 21 success, 4 error | probed |
| run_scan | Scanners | 1/1 | 1 | 1 error | error-only |
| search | Market Data & Research | 1/3 | 6 | 4 success, 2 error | probed |
| unfollow_watchlist | Watchlists | 1/1 | — | — | missing |
| update_alert | Alerts | 1/5 | — | — | missing |
| update_scan_config | Scanners | 1/4 | — | — | missing |
| update_scan_filters | Scanners | 2/2 | — | — | missing |
| update_watchlist | Watchlists | 1/4 | — | — | missing |

## Drift — bundled catalog vs live tools/list

- Live tools: **76** · catalog: **49** · generated 2026-09-30T07:02:17.783Z
- Added on live: `cancel_crypto_order`, `cancel_option_exercise`, `create_alert`, `delete_alert`, `exercise_option`, `get_alert_log`, `get_alerts`, `get_crypto_account_onboarding_info`, `get_crypto_orders`, `get_crypto_positions`, `get_crypto_quotes`, `get_currency_pairs`, `get_equity_analyst_ratings`, `get_index_historicals`, `get_limited_margin_upgrade_info`, `get_option_historicals`, `get_politician_trades`, `get_scanner_datapoints`, `get_sec_filing`, `get_sec_filing_facts`, `get_sec_filing_facts_catalog`, `get_sec_filing_index`, `mark_alerts_read`, `place_crypto_order`, `preview_crypto_order`, `preview_scan`, `update_alert`
- Changed schemas: `add_to_watchlist`, `cancel_equity_order`, `cancel_option_order`, `create_scan`, `create_watchlist`, `get_accounts`, `get_earnings_calendar`, `get_earnings_results`, `get_equity_fundamentals`, `get_equity_historicals`, `get_equity_orders`, `get_equity_positions`, `get_equity_tax_lots`, `get_equity_technical_indicators`, `get_equity_tradability`, `get_financials`, `get_indexes`, `get_option_instruments`, `get_option_level_upgrade_info`, `get_option_orders`, `get_option_positions`, `get_option_watchlist`, `get_pnl_trade_history`, `get_realized_pnl`, `get_scanner_filter_specs`, `get_scans`, `get_watchlist_items`, `place_equity_order`, `place_option_order`, `remove_from_watchlist`, `remove_option_from_watchlist`, `review_equity_order`, `review_option_order`, `run_scan`, `search`, `update_scan_config`, `update_scan_filters`

## Account & Performance

### get_accounts

**Safety:** read-only · **Status:** probed

List the user's brokerage accounts. Each account includes an agentic_allowed field indicating whether it's tradable by you — accounts where it's false are read-only to you. Use this to look up account_number values needed by other tools. Exactly one account is tradable by you; when the user is choosing an account for a trade, use that account directly without asking. Does NOT return reliable buying power — route buying-power questions through get_portfolio.

**Parameters (live inputSchema):**

_No parameters._

**Response field tree** (union over 1 success capture(s)):

- `data`: object
  - `accounts`: array<object>
    - `account_number`[]: string
    - `rhs_account_number`[]: string
    - `type`[]: string
    - `unsettled_funds`[]: string
    - `brokerage_account_type`[]: string
    - `is_default`[]: boolean
    - `agentic_allowed`[]: boolean
    - `option_level`[]: string
    - `management_type`[]: string
    - `affiliate`[]: string
    - `state`[]: string
    - `deactivated`[]: boolean
    - `permanently_deactivated`[]: boolean
    - `nickname`[]: string
- `guide`: string

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

**Response field tree** (union over 3 success capture(s)):

- `data`: object
  - `positions`: array<object>
    - `symbol`[]: string
    - `quantity`[]: string
    - `intraday_quantity`[]: string
    - `average_buy_price`[]: string
    - `shares_available_for_sells`[]: string
    - `shares_held_for_sells`[]: string
    - `shares_held_for_stock_grants`[]: string
    - `shares_held_for_options_events`[]: string
    - `shares_held_for_asset_transfer`[]: string
    - `shares_pending_from_options_events`[]: string
    - `type`[]: string
- `guide`: string

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

**Response field tree** (union over 3 success capture(s)):

- `data`: object
  - `symbol`: string
  - `tax_lots`: array<object>
    - `open_lot_id`[]: string
    - `open_tran_type`[]: string
    - `order_id`[]: string
    - `quantity`[]: string
    - `quantity_available`[]: string
    - `is_selectable`[]: boolean
    - `cost_per_share`[]: string
    - `tax_cost_basis`[]: string
    - `open_date`[]: string
    - `term`[]: string
- `guide`: string

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

**Response field tree** (union over 1 success capture(s)):

- `data`: object
  - `account_number`: string
  - `eligible`: boolean
  - `current_account_type`: string
  - `web_upgrade_url`: string
  - `mobile_upgrade_url`: string
  - `upgrade_fallback`: string
- `guide`: string

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

**Response field tree** (union over 7 success capture(s)):

- `data`: object
  - `account_number`: string
  - `span`: string
  - `trades`: array<object>
    - `timestamp`[]: string
    - `symbol`[]: string
    - `side`[]: string
    - `quantity`[]: string
    - `price`[]: string
    - `realized_gain`[]: string
  - `next_cursor`: string
- `guide`: string

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

**Response field tree** (union over 1 success capture(s)):

- `data`: object
  - `total_value`: string
  - `equity_value`: string
  - `options_value`: string
  - `futures_value`: string
  - `event_contracts_value`: string
  - `crypto_value`: string
  - `cash`: string
  - `pending_deposits`: string
  - `mutual_funds_value`: string
  - `fixed_income_value`: string
  - `currency`: string
  - `buying_power`: object
    - `buying_power`: string
    - `unleveraged_buying_power`: string
    - `display_currency`: string
  - `crypto_buying_power`: object
    - `buying_power`: string
- `guide`: string

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

**Response field tree** (union over 10 success capture(s)):

- `data`: object
  - `account_number`: string
  - `window`: string
  - `display_currency`: string
  - `data_points`: array<object>
    - `start_time`[]: string
    - `end_time`[]: string
    - `realized_gain`[]: null | string
    - `rate_of_realized_gain`[]: null | string
    - `number_of_trades`[]: number
  - `total_returns`: string
  - `total_rate_of_return`: string
- `guide`: string

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

## Market Data & Research

### get_earnings_calendar

**Safety:** read-only · **Status:** probed

List earnings reports scheduled across the market over a date window (up to 31 days), optionally limited to high-market-cap names. Returns one entry per report event — estimated/actual EPS, report date and timing (am/pm), and company-verification status. Use this for market-wide discovery ("what large-caps report this week?"). For a specific known ticker, use get_earnings_results instead. Read-only.

**Parameters (live inputSchema):**

| param | type | required | description |
|---|---|---|---|
| start_date | string | no | Window anchor, YYYY-MM-DD. Defaults to today (US/Eastern) when omitted. |
| days | integer | no | Window length in days, measured from start_date. Defaults to 7. Positive = forward window (e.g. 7 = the next 7 days, inclusive of start_date); negative = loo… |
| filter | string | no | Optional result filter. Set to 'high_market_cap' to limit the calendar to high-market-cap names (market cap over $1B) — useful for 'what large-caps report th… |

**Response field tree** (union over 3 success capture(s)):

- `data`: object
  - `results`: array<object>
    - `symbol`[]: string
    - `year`[]: number
    - `quarter`[]: number
    - `eps`[]: object
      - `estimate`: null | string
      - `actual`: null | string
    - `report`[]: object
      - `date`: string
      - `timing`: null | string
      - `verified`: boolean
- `guide`: string

**Captures:**

- [ro-earn-cal-01](captures/ro-earn-cal-01.json) — success — Default 7-day window from today.
- [ro-earn-cal-02](captures/ro-earn-cal-02.json) — success — filter=high_market_cap.
- [ro-earn-cal-03](captures/ro-earn-cal-03.json) — success — Explicit 14-day window.

**Notes:**

- Default 7-day window from today.
- filter=high_market_cap.
- Explicit 14-day window.

### get_earnings_results

**Safety:** read-only · **Status:** probed

Get recent and upcoming earnings for ONE equity symbol — estimated/actual EPS, report date and timing (am/pm), and company-verification status. Returns the trailing up to 8 quarters. Use this for earnings-timing questions ("does AAPL report this week?"), EPS surprise analysis, and screening for upcoming earnings risk on a specific stock. For market-wide earnings calendar queries across many symbols, use get_earnings_calendar. Read-only.

**Parameters (live inputSchema):**

| param | type | required | description |
|---|---|---|---|
| symbol | string | yes | Stock symbol to look up (one symbol per call). Exact-ticker match — no name or partial-ticker resolution. Lowercase and whitespace-padded input is normalized… |

**Response field tree** (union over 1 success capture(s)):

- `data`: object
  - `results`: array<object>
    - `symbol`[]: string
    - `year`[]: number
    - `quarter`[]: number
    - `eps`[]: object
      - `estimate`: string
      - `actual`: null | string
    - `report`[]: object
      - `date`: string
      - `timing`: string
      - `verified`: boolean
- `guide`: string

**Captures:**

- [ro-earn-res-01](captures/ro-earn-res-01.json) — success — Single-symbol earnings history.

**Notes:**

- Single-symbol earnings history.

### get_equity_analyst_ratings

**Safety:** read-only · **Status:** probed

Get analyst price targets (high, low, average) and the Buy/Hold/Sell ratings breakdown for one or more equity symbols. Use for consensus/sentiment checks and comparing the current price to the analyst target range. Read-only.

**Parameters (live inputSchema):**

| param | type | required | description |
|---|---|---|---|
| symbols | null \| array | yes | One or more equity symbols (max 75 per call). Exact-ticker match — no name or partial-ticker resolution. Lowercase and whitespace-padded input is normalized … |

**Response field tree** (union over 1 success capture(s)):

- `data`: object
  - `results`: array<object>
    - `symbol`[]: string
    - `ratings`[]: object
      - `num_buy_ratings`: number
      - `num_hold_ratings`: number
      - `num_sell_ratings`: number
      - `high_price_target`: string
      - `low_price_target`: string
      - `mean_price_target`: string
      - `updated_at`: string
- `guide`: string

**Captures:**

- [ro-analyst-01](captures/ro-analyst-01.json) — success — Multi-symbol ratings (max 75).

**Notes:**

- Multi-symbol ratings (max 75).

### get_equity_fundamentals

**Safety:** read-only · **Status:** probed

Get today's fundamentals for one or more stock symbols — valuation ratios (PE, P/B), capitalization (market cap, shares outstanding, float), today's session OHLCV, trailing volume averages, 52-week range, dividend schedule, and company profile. For real-time quotes use get_equity_quotes; for time-series price history use get_equity_historicals.

**Parameters (live inputSchema):**

| param | type | required | description |
|---|---|---|---|
| symbols | null \| array | yes | One or more stock symbols (max 10 per call). Exact-ticker match — no name or partial-ticker resolution. Lowercase and whitespace-padded input is normalized t… |
| bounds | string | no | Trading session the day-level fields (open / high / low / volume / overnight_volume) are drawn from. One of 'regular' (regular trading hours), 'trading' (reg… |

**Response field tree** (union over 4 success capture(s)):

- `data`: object
  - `results`: array<object>
    - `symbol`[]: string
    - `open`[]: string
    - `high`[]: string
    - `low`[]: string
    - `volume`[]: string
    - `overnight_volume`[]: string
    - `bounds`[]: string
    - `market_date`[]: string
    - `average_volume_2_weeks`[]: string
    - `average_volume`[]: string
    - `average_volume_30_days`[]: string
    - `high_52_weeks`[]: string
    - `high_52_weeks_date`[]: string
    - `low_52_weeks`[]: string
    - `low_52_weeks_date`[]: string
    - `float`[]: string
    - `market_cap`[]: string
    - `pb_ratio`[]: string
    - `pe_ratio`[]: string
    - `shares_outstanding`[]: string
    - `dividend_yield`[]: null
    - `dividend_per_share`[]: null
    - `distribution_frequency`[]: null
    - `payable_date`[]: null
    - `ex_dividend_date`[]: null
    - `record_date`[]: null
    - `thirty_day_sec_yield`[]: null
    - `description`[]: string
    - `ceo`[]: string
    - `headquarters_city`[]: string
    - `headquarters_state`[]: string
    - `sector`[]: string
    - `industry`[]: string
    - `num_employees`[]: number
    - `year_founded`[]: number
    - `financial_status_indicator`[]: string
    - `financial_status_description`[]: string
- `guide`: string

**Captures:**

- [ro-eq-fund-01](captures/ro-eq-fund-01.json) — success — bounds=regular (default session).
- [ro-eq-fund-02](captures/ro-eq-fund-02.json) — success — bounds=extended.
- [ro-eq-fund-03](captures/ro-eq-fund-03.json) — success — bounds=trading.
- [ro-eq-fund-04](captures/ro-eq-fund-04.json) — success — bounds=24_5 - overnight_volume only populates here.

**Notes:**

- bounds=regular (default session).
- bounds=extended.
- bounds=trading.
- bounds=24_5 - overnight_volume only populates here.

### get_equity_historicals

**Safety:** read-only · **Status:** probed

Get OHLCV bars for one or more equity symbols across an explicit time range. Use this for charting, "recent activity" questions, and backtesting. The server auto-selects an interval when one is not provided. If the bar's interpolated field is true, bar was synthesized to fill a gap and carry no new information.

Parameter rules:
- interval is optional; when omitted, the server auto-selects an interval that targets ~2,500 bars across the requested range. Provide an explicit interval only when you need a specific granularity.
- interval values are fixed; the server does NOT aggregate intermediate bars. For a custom interval (e.g. 3-minute), request the next-finer fixed interval and aggregate client-side.
- bounds defaults to 'regular' (RTH only). Use 'extended' or '24_5' only when the user explicitly asks about extended-hours activity.
- adjustment_type defaults to 'split' (split-adjusted, the right default for backtesting). Use 'none' for raw prices, 'all' for split + dividend adjustment.
- If the range would produce more bars than the upstream allows at the explicitly requested interval, narrow the range or coarsen the interval — the call is rejected before reaching upstream. The cap does not apply when interval is auto-selected.

**Parameters (live inputSchema):**

| param | type | required | description |
|---|---|---|---|
| symbols | null \| array | yes | One or more stock symbols (uppercase). Up to 10 per call. |
| start_time | string | yes | Start of the range (RFC3339 UTC, e.g. '2026-01-01T00:00:00Z'). Required. |
| end_time | string | no | End of the range (RFC3339 UTC). Optional — when omitted, defaults to the current time. |
| interval | string | no | Bar interval. Optional — when omitted, the server picks an interval that targets ~2,500 bars across the requested range. Intraday: 15second, 30second, minute… |
| bounds | string | no | Session bounds. One of 'regular' (RTH, default), 'extended', 'trading', '24_5', '24_7', 'hyper_trading'. |
| adjustment_type | string | no | Corporate-action adjustment: 'none' (raw prices), 'split' (default; right for backtesting), or 'all' (split + dividend; intraday only). |

**Response field tree** (union over 11 success capture(s)):

- `data`: object
  - `results`: array<object>
    - `symbol`[]: string
    - `interval`[]: string
    - `bounds`[]: string
    - `bars`[]: array<object>
      - `begins_at`[]: string
      - `open_price`[]: string
      - `close_price`[]: string
      - `high_price`[]: string
      - `low_price`[]: string
      - `volume`[]: number
      - `session`[]: string
      - `interpolated`[]: boolean
- `guide`: string

**Errors observed:** 2 capture(s), 2 distinct shape(s)

**Captures:**

- [err-hist-bad-interval](captures/err-hist-bad-interval.json) — error — Deliberate error: invalid interval value (schema is plain string — reaches server).
- [err-hist-bad-time](captures/err-hist-bad-time.json) — error — Deliberate error: malformed timestamp — server parse error?
- [ro-eq-hist-01](captures/ro-eq-hist-01.json) — success — Auto interval + explicit end_time + split adjustment (default).
- [ro-eq-hist-02](captures/ro-eq-hist-02.json) — success — interval=minute on a 2-day window (30-day range exceeds the 5000-bar cap — error captured on first pass).
- [ro-eq-hist-03](captures/ro-eq-hist-03.json) — success — interval=day. Remaining intervals (15s..4hour, month..50year) excluded - same decimation path.
- [ro-eq-hist-04](captures/ro-eq-hist-04.json) — success — interval=week. Remaining intervals (15s..4hour, month..50year) excluded - same decimation path.
- [ro-eq-hist-05](captures/ro-eq-hist-05.json) — success — bounds=extended on a short window.
- [ro-eq-hist-06](captures/ro-eq-hist-06.json) — success — bounds=trading on a short window.
- [ro-eq-hist-07](captures/ro-eq-hist-07.json) — success — bounds=24_5 on a short window.
- [ro-eq-hist-08](captures/ro-eq-hist-08.json) — success — bounds=24_7 on a short window.
- [ro-eq-hist-09](captures/ro-eq-hist-09.json) — success — bounds=hyper_trading on a short window.
- [ro-eq-hist-10](captures/ro-eq-hist-10.json) — success — adjustment_type=none (raw prices).
- [ro-eq-hist-11](captures/ro-eq-hist-11.json) — success — adjustment_type=all requires interval>=day (400 captured on first pass w/ minute).

**Notes:**

- Auto interval + explicit end_time + split adjustment (default).
- interval=minute on a 2-day window (30-day range exceeds the 5000-bar cap — error observed on first pass (capture overwritten by corrected rerun)).
- interval=day. Remaining intervals (15s..4hour, month..50year) excluded - same decimation path.
- interval=week. Remaining intervals (15s..4hour, month..50year) excluded - same decimation path.
- bounds=extended on a short window.
- bounds=trading on a short window.
- bounds=24_5 on a short window.
- bounds=24_7 on a short window.
- bounds=hyper_trading on a short window.
- adjustment_type=none (raw prices).
- adjustment_type=all requires interval>=day (400 observed on first pass w/ minute (capture overwritten by corrected rerun)).
- Deliberate error: invalid interval value (schema is plain string — reaches server).
- Deliberate error: malformed timestamp — server parse error?

### get_equity_price_book

**Safety:** read-only · **Status:** probed

Get a real-time bid/ask order book (Level 2) snapshot for one or more equity symbols (max 4), showing the ladder of price levels and resting share size on each side. Use to read supply/demand depth before entering or exiting a position.

**Parameters (live inputSchema):**

| param | type | required | description |
|---|---|---|---|
| symbols | null \| array | yes | One or more stock symbols, max 4 per call. |

**Response field tree** (union over 1 success capture(s)):

- `data`: object
  - `books`: array<object>
    - `symbol`[]: string
    - `updated_at`[]: string
    - `asks`[]: array<object>
      - `price`[]: string
      - `quantity`[]: number
    - `bids`[]: array<object>
      - `price`[]: string
      - `quantity`[]: number
- `guide`: string

**Captures:**

- [ro-eq-book-01](captures/ro-eq-book-01.json) — success — Level-2 price book at the 4-symbol max.

**Notes:**

- Level-2 price book at the 4-symbol max.

### get_equity_quotes

**Safety:** read-only · **Status:** probed

Get real-time stock quotes and the official last-completed-session close for one or more symbols.

**Parameters (live inputSchema):**

| param | type | required | description |
|---|---|---|---|
| symbols | null \| array | yes | One or more stock symbols. Above 20 symbols, quotes still return but closes is omitted with closes_error set. |

**Response field tree** (union over 4 success capture(s)):

- `data`: object
  - `results`: array<object>
    - `quote`[]: object
      - `symbol`: string
      - `last_trade_price`: string
      - `venue_last_trade_time`: string
      - `last_non_reg_trade_price`: null
      - `venue_last_non_reg_trade_time`: null
      - `adjusted_previous_close`: string
      - `previous_close`: string
      - `previous_close_date`: string
      - `bid_price`: string
      - `venue_bid_time`: string
      - `ask_price`: string
      - `venue_ask_time`: string
      - `has_traded`: boolean
      - `state`: string
    - `close`[]: object
      - `symbol`: string
      - `date`: string
      - `price`: string
      - `interpolated`: boolean
      - `source`: string
  - `closes_error`: string
- `guide`: string

**Errors observed:** 3 capture(s), 3 distinct shape(s)

**Captures:**

- [err-quote-bad-symbol](captures/err-quote-bad-symbol.json) — error — Deliberate error: nonexistent ticker — error vs empty results?
- [err-quote-missing-param](captures/err-quote-missing-param.json) — error — Deliberate error: required field omitted. Captured via run-tool-observation.ts (manifest runner can't express schema-invalid args — Ajv rejects them pre-flight). Executor-level VALIDATION reject; the MCP server never sees the call.
- [err-quote-wrong-type](captures/err-quote-wrong-type.json) — error — Deliberate error: wrong JSON type for symbols. Captured via run-tool-observation.ts (manifest runner can't express schema-invalid args — Ajv rejects them pre-flight). Executor-level VALIDATION reject; the MCP server never sees the call.
- [mx-quote-start](captures/mx-quote-start.json) — success — Session start — harvest live OOMA quote; operator derives OOMA_ASK/BID + stop targets
- [opt-quote-start](captures/opt-quote-start.json) — success — Underlying quote for NFLX — harvest context for strike selection (pick nearest monthly exp, ~ATM strike).
- [ro-eq-quotes-01](captures/ro-eq-quotes-01.json) — success — Multi-symbol quotes.
- [ro-eq-quotes-02](captures/ro-eq-quotes-02.json) — success — 21 symbols - documents the >20 path (closes omitted + closes_error).

**Notes:**

- Multi-symbol quotes.
- 21 symbols - documents the >20 path (closes omitted + closes_error).
- Session start — harvest live OOMA quote; operator derives OOMA_ASK/BID + stop targets
- Underlying quote for NFLX — harvest context for strike selection (pick nearest monthly exp, ~ATM strike).
- Deliberate error: nonexistent ticker — error vs empty results?

### get_equity_technical_indicators

**Safety:** read-only · **Status:** probed

Compute a technical indicator (RSI, MACD, Bollinger Bands, moving averages, ATR, VWAP, and more) over one equity symbol's OHLCV bars across a time range. For the raw OHLCV bars themselves, use get_equity_historicals.

Parameter rules:
- The parameters an indicator accepts depend on type:
  - period only: ema/sma (default 9); rsi/cci/atr/mfi (default 14); williams_r/adx (default 10); momentum (default 12); roc (default 14); donchian_channels (default 20).
  - bollinger_bands: period (default 20) + num_std (default 2).
  - macd: fast_period (12), slow_period (26), signal_period (9).
  - keltner_channels: period (default 20) + multiplier (default 2).
  - supertrend: period (default 10) + multiplier (default 3).
  - pivot_points: method (only 'classic').
  - vwap, obv: no parameters.
  Omit a parameter to use its default. Passing a parameter the chosen type does not accept is rejected.
- interval is REQUIRED — indicator periods are counted in bars, so there is no auto-selection.
- adjustment_type defaults to 'split'; 'all' (split + dividend) requires a day-or-coarser interval.
- If the requested range plus the indicator's warm-up exceeds the per-request bar cap, narrow the range or coarsen the interval.

**Parameters (live inputSchema):**

| param | type | required | description |
|---|---|---|---|
| symbol | string | yes | Stock symbol (uppercase). Exactly one symbol per call. |
| type | string | yes | Indicator to compute. One of: ema, sma, rsi, momentum, roc, cci, williams_r, atr, mfi, adx, donchian_channels, bollinger_bands, macd, keltner_channels, super… |
| interval | string | yes | Required bar interval the indicator is computed on. Intraday: 15second, 30second, minute, 5minute, 10minute, 30minute, hour, 4hour. Interday: day, week, mont… |
| start_time | string | yes | Start of the range (RFC3339 UTC, e.g. '2026-01-01T00:00:00Z'). Required. |
| end_time | string | no | End of the range (RFC3339 UTC). Optional — defaults to the current time when omitted. |
| bounds | string | no | Session bounds. One of 'regular' (RTH, default) or 'extended'. |
| adjustment_type | string | no | Corporate-action adjustment: 'none' (raw prices), 'split' (default), or 'all' (split + dividend; requires a day-or-coarser interval). |
| output | string | no | How much of the series to return: 'series' (default, full range), 'latest' (most recent bar only), or 'last:N' (most recent N bars). The indicator is always … |
| period | null \| integer | no | Lookback period in bars. Applies to ema, sma, rsi, momentum, roc, cci, williams_r, atr, mfi, adx, donchian_channels, bollinger_bands, keltner_channels, super… |
| num_std | null \| number | no | Number of standard deviations for the bands. bollinger_bands only (default 2). |
| fast_period | null \| integer | no | Fast EMA period. macd only (default 12). |
| slow_period | null \| integer | no | Slow EMA period. macd only (default 26). |
| signal_period | null \| integer | no | Signal EMA period. macd only (default 9). |
| multiplier | null \| number | no | Band/offset multiplier. keltner_channels (default 2) and supertrend (default 3) only. |
| method | string | no | Calculation method. pivot_points only; currently only 'classic'. |

**Response field tree** (union over 20 success capture(s)):

- `data`: object
  - `symbol`: string
  - `interval`: string
  - `bounds`: string
  - `indicators`: array<object>
    - `type`[]: string
    - `params`[]: object
      - `period`: number
      - `num_std`: number
      - `fast_period`: number
      - `signal_period`: number
      - `slow_period`: number
      - `multiplier`: number
    - `series`[]: array<object>
      - `begins_at`[]: string
      - `value`[]: number
      - `lower`[]: number
      - `middle`[]: number
      - `upper`[]: number
      - `histogram`[]: number
      - `macd`[]: number
      - `signal`[]: number
      - `direction`[]: number
      - `pivot`[]: number
      - `r1`[]: number
      - `r2`[]: number
      - `r3`[]: number
      - `s1`[]: number
      - `s2`[]: number
      - `s3`[]: number
- `guide`: string

**Captures:**

- [dep-eq-ti-20](captures/dep-eq-ti-20.json) — success — end_time param exercised (only remaining unprobed param on this tool).
- [ro-ind-01](captures/ro-ind-01.json) — success — type=ema - one of 18 indicator types (each has distinct output fields).
- [ro-ind-02](captures/ro-ind-02.json) — success — type=sma - one of 18 indicator types (each has distinct output fields).
- [ro-ind-03](captures/ro-ind-03.json) — success — type=rsi - one of 18 indicator types (each has distinct output fields).
- [ro-ind-04](captures/ro-ind-04.json) — success — type=momentum - one of 18 indicator types (each has distinct output fields).
- [ro-ind-05](captures/ro-ind-05.json) — success — type=roc - one of 18 indicator types (each has distinct output fields).
- [ro-ind-06](captures/ro-ind-06.json) — success — type=cci - one of 18 indicator types (each has distinct output fields).
- [ro-ind-07](captures/ro-ind-07.json) — success — type=williams_r - one of 18 indicator types (each has distinct output fields).
- [ro-ind-08](captures/ro-ind-08.json) — success — type=atr - one of 18 indicator types (each has distinct output fields).
- [ro-ind-09](captures/ro-ind-09.json) — success — type=mfi - one of 18 indicator types (each has distinct output fields).
- [ro-ind-10](captures/ro-ind-10.json) — success — type=adx - one of 18 indicator types (each has distinct output fields).
- [ro-ind-11](captures/ro-ind-11.json) — success — type=donchian_channels - one of 18 indicator types (each has distinct output fields).
- [ro-ind-12](captures/ro-ind-12.json) — success — type=bollinger_bands - one of 18 indicator types (each has distinct output fields).
- [ro-ind-13](captures/ro-ind-13.json) — success — type=macd - one of 18 indicator types (each has distinct output fields).
- [ro-ind-14](captures/ro-ind-14.json) — success — type=keltner_channels - one of 18 indicator types (each has distinct output fields).
- [ro-ind-15](captures/ro-ind-15.json) — success — type=supertrend - one of 18 indicator types (each has distinct output fields).
- [ro-ind-16](captures/ro-ind-16.json) — success — type=vwap - one of 18 indicator types (each has distinct output fields).
- [ro-ind-17](captures/ro-ind-17.json) — success — type=obv - one of 18 indicator types (each has distinct output fields).
- [ro-ind-18](captures/ro-ind-18.json) — success — type=pivot_points - one of 18 indicator types (each has distinct output fields).
- [ro-ind-19](captures/ro-ind-19.json) — success — bounds=extended (vs default regular).

**Notes:**

- type=ema - one of 18 indicator types (each has distinct output fields).
- type=sma - one of 18 indicator types (each has distinct output fields).
- type=rsi - one of 18 indicator types (each has distinct output fields).
- type=momentum - one of 18 indicator types (each has distinct output fields).
- type=roc - one of 18 indicator types (each has distinct output fields).
- type=cci - one of 18 indicator types (each has distinct output fields).
- type=williams_r - one of 18 indicator types (each has distinct output fields).
- type=atr - one of 18 indicator types (each has distinct output fields).
- type=mfi - one of 18 indicator types (each has distinct output fields).
- type=adx - one of 18 indicator types (each has distinct output fields).
- type=donchian_channels - one of 18 indicator types (each has distinct output fields).
- type=bollinger_bands - one of 18 indicator types (each has distinct output fields).
- type=macd - one of 18 indicator types (each has distinct output fields).
- type=keltner_channels - one of 18 indicator types (each has distinct output fields).
- type=supertrend - one of 18 indicator types (each has distinct output fields).
- type=vwap - one of 18 indicator types (each has distinct output fields).
- type=obv - one of 18 indicator types (each has distinct output fields).
- type=pivot_points - one of 18 indicator types (each has distinct output fields).
- bounds=extended (vs default regular).
- end_time param exercised (only remaining unprobed param on this tool).

### get_equity_tradability

**Safety:** read-only · **Status:** probed

Check tradability for up to 10 equity symbols on a given account: per-session eligibility and fractional. Call before placing an order to surface restrictions. Exact-ticker match — no name or partial-ticker resolution.

**Parameters (live inputSchema):**

| param | type | required | description |
|---|---|---|---|
| account_number | string | yes | Brokerage account number. Must come from the user or be clearly implied — never default from get_accounts. |
| symbols | null \| array | yes | Stock symbols, max 10 per call. With more than 10, split across multiple calls of 10 or fewer. Exact-ticker match only. |

**Response field tree** (union over 1 success capture(s)):

- `data`: object
  - `results`: array<object>
    - `symbol`[]: string
    - `name`[]: string
    - `simple_name`[]: string
    - `state`[]: string
    - `country`[]: string
    - `tradeable`[]: boolean
    - `fractional_tradability`[]: string
    - `extended_hours_fractional_tradability`[]: boolean
    - `all_day_tradability`[]: string
    - `short_selling_tradability`[]: string
    - `account_type_tradabilities`[]: array<object>
      - `account_type`[]: string
      - `account_type_tradability`[]: string
- `guide`: string

**Captures:**

- [ro-eq-tradability-01](captures/ro-eq-tradability-01.json) — success — Per-symbol tradability flags (max 10/call honored).

**Notes:**

- Per-symbol tradability flags (max 10/call honored).

### get_financials

**Safety:** read-only · **Status:** probed

Get a company's reported financial metrics over time — revenue, gross profit, net income, and net margin — by fiscal period (annual or quarterly), for one or more symbols. Use this for fundamental analysis like revenue-growth and margin-trend tracking, profitability screens, and period-over-period comparisons. Read-only.

**Parameters (live inputSchema):**

| param | type | required | description |
|---|---|---|---|
| symbols | null \| array | yes | One or more stock symbols (max 20 per call). Exact-ticker match — no name or partial-ticker resolution. Lowercase and whitespace-padded input is normalized t… |
| period | string | no | Reporting period: 'quarterly' or 'annual'. Defaults to 'quarterly' when omitted. |
| limit | integer | no | Number of most-recent periods to return per symbol (e.g. 8 for the last 8 quarters or years). Defaults to 4; values above 40 are capped to 40. |

**Response field tree** (union over 2 success capture(s)):

- `data`: object
  - `results`: array<object>
    - `symbol`[]: string
    - `period`[]: string
    - `financials`[]: array<object>
      - `fiscal_year`[]: number
      - `fiscal_quarter`[]: null | number
      - `period_end_date`[]: string
      - `revenue`[]: string
      - `gross_profit`[]: string
      - `net_income`[]: string
      - `net_margin`[]: string
- `guide`: string

**Captures:**

- [ro-fins-01](captures/ro-fins-01.json) — success — quarterly (default).
- [ro-fins-02](captures/ro-fins-02.json) — success — annual + limit=2.

**Notes:**

- quarterly (default).
- annual + limit=2.

### get_index_historicals

**Safety:** read-only · **Status:** probed

Get OHLC value bars for one or more market indexes (by instrument UUID) across an explicit time range. Use this for charting an index's history and "recent movement" questions. If the bar's interpolated field is true, bar was synthesized to fill a gap and carry no new information.

Parameter rules:
- instrument_ids are index instrument UUIDs from get_indexes. Resolve symbols there first; this tool does not accept ticker symbols.
- interval is required; pick the coarsest interval that answers the question. If the requested interval would produce too many bars for the range, the call is rejected — narrow the range or coarsen the interval.

**Parameters (live inputSchema):**

| param | type | required | description |
|---|---|---|---|
| instrument_ids | null \| array | yes | Index instrument UUIDs (from get_indexes). Up to 10 per call. |
| start_time | string | yes | Start of the range (RFC3339 UTC, e.g. '2026-01-01T00:00:00Z'). Required. |
| end_time | string | no | End of the range (RFC3339 UTC). Optional — when omitted, defaults to the current time. |
| interval | string | yes | Bar interval. Required — there is no server auto-select for indexes. Intraday: 5second, 15second, 30second, minute, 5minute, 10minute, 30minute, hour, 4hour.… |

**Response field tree** (union over 2 success capture(s)):

- `data`: object
  - `results`: array<object>
    - `instrument_id`[]: string
    - `symbol`[]: string
    - `interval`[]: string
    - `bars`[]: array<object>
      - `begins_at`[]: string
      - `open_value`[]: string
      - `high_value`[]: string
      - `low_value`[]: string
      - `close_value`[]: string
      - `interpolated`[]: boolean
- `guide`: string

**Errors observed:** 1 capture(s), 1 distinct shape(s)

**Captures:**

- [dep-idx-hist-01](captures/dep-idx-hist-01.json) — success — SPX daily bars, ~1 month.
- [dep-idx-hist-02](captures/dep-idx-hist-02.json) — error — SPX minute bars, 2-day window.
- [dep-idx-hist-03](captures/dep-idx-hist-03.json) — success — interval=hour retry after minute rejected with "granularity too small" (dep-idx-hist-02).

**Notes:**

- SPX daily bars, ~1 month.
- SPX minute bars, 2-day window.
- interval=hour retry after minute rejected with "granularity too small" (dep-idx-hist-02).

### get_index_quotes

**Safety:** read-only · **Status:** probed

Get real-time values for one or more market indexes by instrument ID. Returns current index level, state, and timestamps.

**Parameters (live inputSchema):**

| param | type | required | description |
|---|---|---|---|
| instrument_ids | null \| array | yes | One or more index instrument IDs (UUIDs) to fetch current values for. Obtain IDs from the get_indexes tool. |

**Response field tree** (union over 1 success capture(s)):

- `data`: object
  - `quotes`: array<object>
    - `instrument_id`[]: string
    - `symbol`[]: string
    - `value`[]: string
    - `state`[]: string
    - `venue_timestamp`[]: string
    - `updated_at`[]: string
- `guide`: string

**Captures:**

- [dep-idx-quotes-01](captures/dep-idx-quotes-01.json) — success — instrument_ids harvested from get_indexes (SPX + NDX).

**Notes:**

- instrument_ids harvested from get_indexes (SPX + NDX).

### get_indexes

**Safety:** read-only · **Status:** probed

Get index data for market indexes by symbol.
Optionally pass a comma-separated list of symbols (e.g. 'SPX,NDX,DJI') to filter results. Omit symbols to return all available indexes.

**Parameters (live inputSchema):**

| param | type | required | description |
|---|---|---|---|
| symbols | string | no | Comma-separated list of index symbols to look up (e.g. 'SPX,NDX'). Omit to return all available indexes. |

**Response field tree** (union over 2 success capture(s)):

- `data`: object
  - `indexes`: array<object>
    - `id`[]: string
    - `symbol`[]: string
    - `name`[]: string
    - `current_value`[]: string
    - `trade_halted`[]: boolean
    - `updated_at`[]: string
- `guide`: string

**Captures:**

- [ro-indexes-01](captures/ro-indexes-01.json) — success — All indexes - source of instrument_ids.
- [ro-indexes-02](captures/ro-indexes-02.json) — success — Symbol-filtered lookup.

**Notes:**

- All indexes - source of instrument_ids.
- Symbol-filtered lookup.

### get_politician_trades

**Safety:** read-only · **Status:** probed

Get disclosed trading activity of US politicians from Tip Ranks. Use when the user asks about politician/congressional trades - either for a specific stock ("which politicians traded NVDA?") or a specific politician. Data comes from public STOCK Act disclosures; amounts are ranges, not exact values, and disclosures lag the actual trade by up to 45 days.

**Parameters (live inputSchema):**

| param | type | required | description |
|---|---|---|---|
| politician_name | string | no | Full or partial name of a US politician, e.g. 'Nancy Pelosi'. Case-insensitive. Optional when equity_symbol is provided. |
| equity_symbol | string | no | One active US equity ticker, e.g. NVDA. Exact ticker only; lowercase and surrounding whitespace are normalized. Optional when politician_name is provided. |

**Response field tree** (union over 3 success capture(s)):

- `data`: object
  - `trades`: array<object>
    - `politician_name`[]: string
    - `party`[]: string
    - `position`[]: string
    - `asset_type`[]: string
    - `symbol`[]: string
    - `transaction_type`[]: string
    - `amount_range`[]: object
      - `min`: string
      - `max`: string
    - `transaction_date`[]: string
    - `disclosure_date`[]: string
    - `source`[]: string
  - `has_more`: boolean
- `guide`: string

**Captures:**

- [ro-poli-01](captures/ro-poli-01.json) — success — Name lookup.
- [ro-poli-02](captures/ro-poli-02.json) — success — Symbol lookup.
- [ro-poli-03](captures/ro-poli-03.json) — success — Both filters together.

**Notes:**

- Name lookup.
- Symbol lookup.
- Both filters together.

### search

**Safety:** read-only · **Status:** probed

Resolve a natural-language query to Robinhood instruments (stocks/ETFs), crypto pairs, or market indexes. Use when the user names an asset by name (or partial name) instead of a ticker/pair/index symbol, or when you need an instrument_id / currency-pair UUID / market-index id for a downstream tool. Defaults to instrument search; pass asset_type="currency_pair" for crypto or asset_type="market_index" for indexes (SPX, NDX, DJI, etc.). Instrument results carry symbol + instrument_id (use with get_equity_quotes / get_equity_tradability / place_equity_order or any instrument_id-based tool). Crypto results carry hyphenated symbol (e.g. BTC-USD) + id — the symbol routes to crypto quote/order tools, the id routes to watchlist tools as currency_pair_ids. Market-index results carry symbol + id — pass id to index quote tools for current values, or in the index_ids array of watchlist tools.

**Parameters (live inputSchema):**

| param | type | required | description |
|---|---|---|---|
| query | string | yes | Natural-language search query: company name, partial name, or ticker (e.g. "apple", "tesla motors", "AAPL"). Required. |
| asset_type | string | no | Asset category to search. Supported: "instrument" (US-listed stocks/ETFs), "currency_pair" (crypto pairs like BTC-USD), and "market_index" (e.g. SPX, NDX, DJ… |
| limit | integer | no | Max results to return. Defaults to 10; clamped to 20. |

**Response field tree** (union over 4 success capture(s)):

- `data`: object
  - `results`: array<object>
    - `instrument_id`[]: string
    - `symbol`[]: string
    - `name`[]: string
    - `simple_name`[]: string
  - `currency_pairs`: array<object>
    - `id`[]: string
    - `symbol`[]: string
    - `name`[]: string
  - `market_indexes`: array<object>
    - `id`[]: string
    - `symbol`[]: string
    - `name`[]: string
    - `description`[]: string
- `guide`: string

**Errors observed:** 2 capture(s), 2 distinct shape(s)

**Captures:**

- [err-search-bad-asset](captures/err-search-bad-asset.json) — error — Deliberate error: invalid asset_type (plain-string schema).
- [err-search-empty](captures/err-search-empty.json) — error — Deliberate error: empty query string.
- [ro-search-01](captures/ro-search-01.json) — success — Default asset_type (instrument).
- [ro-search-02](captures/ro-search-02.json) — success — asset_type=currency_pair.
- [ro-search-03](captures/ro-search-03.json) — success — asset_type=market_index.
- [ro-search-04](captures/ro-search-04.json) — success — limit=3.

**Notes:**

- Default asset_type (instrument).
- asset_type=currency_pair.
- asset_type=market_index.
- limit=3.
- Deliberate error: empty query string.
- Deliberate error: invalid asset_type (plain-string schema).

## Options

### get_option_chains

**Safety:** read-only · **Status:** probed

List option chains for one or more underlyings. A chain describes the full set of expiration dates and contracts for a given underlying. One of underlying_symbol or ids is required.

**Parameters (live inputSchema):**

| param | type | required | description |
|---|---|---|---|
| ids | string | no | Comma-separated chain UUIDs. |
| underlying_symbol | string | no | Ticker filter; covers equity and index underlyings (e.g. 'AAPL', 'SPX'). |

**Response field tree** (union over 5 success capture(s)):

- `data`: object
  - `chains`: array<object>
    - `id`[]: string
    - `symbol`[]: string
    - `can_open_position`[]: boolean
    - `cash_component`[]: null
    - `expiration_dates`[]: array<string>
    - `trade_value_multiplier`[]: string
    - `underlying_instruments`[]: array<object>
      - `instrument`[]: string
      - `symbol`[]: string
    - `min_ticks`[]: object
      - `above_tick`: string
      - `below_tick`: string
      - `cutoff_price`: string
    - `late_close_state`[]: string
    - `extended_hours_state`[]: string
    - `settle_on_open`[]: boolean
    - `sellout_time_to_expiration`[]: number
- `guide`: string

**Captures:**

- [dep-opt-chains-03](captures/dep-opt-chains-03.json) — success — ids CSV lookup (NFLX chain_id harvested from get_option_chains).
- [err-chain-bad-symbol](captures/err-chain-bad-symbol.json) — success — Deliberate error: nonexistent underlying.
- [opt-chains-nflx](captures/opt-chains-nflx.json) — success — Chain inventory — harvest chain_id + expiration list; sets up instrument selection.
- [ro-opt-chains-01](captures/ro-opt-chains-01.json) — success — NFLX chain - source of chain_id for wave-2 probes.
- [ro-opt-chains-02](captures/ro-opt-chains-02.json) — success — Index chain - extended_hours_state field for curb-market-hours discovery.

**Notes:**

- NFLX chain - source of chain_id for wave-2 probes.
- Index chain - extended_hours_state field for curb-market-hours discovery.
- ids CSV lookup (NFLX chain_id harvested from get_option_chains).
- Chain inventory — harvest chain_id + expiration list; sets up instrument selection.
- Deliberate error: nonexistent underlying.

### get_option_historicals

**Safety:** read-only · **Status:** probed

Get OHLC price bars for one or more option contracts (by instrument UUID) across an explicit time range. Use this for charting an option's price history and "recent activity" questions. The server auto-selects an interval when one is not provided. If the bar's interpolated field is true, bar was synthesized to fill a gap and carry no new information.

Parameter rules:
- instrument_ids are option contract UUIDs from get_option_instruments. Resolve underlying -> get_option_chains -> get_option_instruments first; this tool does not accept ticker symbols.
- interval is optional; when omitted the server auto-selects an interval that targets a bounded bar count across the range. Provide an explicit interval only when you need a specific granularity.
- bounds defaults to 'regular' (regular hours). Use '24_5'/'24_7' only when the user explicitly asks about extended-hours or overnight option activity.
- If an explicitly requested interval would produce more bars than the upstream allows for the range, the call is rejected — narrow the range or coarsen the interval. The cap does not apply when interval is auto-selected.

**Parameters (live inputSchema):**

| param | type | required | description |
|---|---|---|---|
| instrument_ids | null \| array | yes | Option contract instrument UUIDs (from get_option_instruments). Up to 10 per call. |
| start_time | string | yes | Start of the range (RFC3339 UTC, e.g. '2026-01-01T00:00:00Z'). Required. |
| end_time | string | no | End of the range (RFC3339 UTC). Optional — when omitted, defaults to the current time. |
| interval | string | no | Bar interval. Optional — when omitted, the server auto-selects an interval that targets a bounded bar count across the range. Intraday: 15second, 30second, m… |
| bounds | string | no | Session bounds. One of 'regular' (regular hours, default), '24_5', or '24_7'. Use '24_5'/'24_7' only when the user explicitly asks about extended-hours or ov… |

**Response field tree** (union over 3 success capture(s)):

- `data`: object
  - `results`: array<object>
    - `instrument_id`[]: string
    - `occ_symbol`[]: string
    - `symbol`[]: string
    - `interval`[]: string
    - `bounds`[]: string
    - `bars`[]: array<object>
      - `begins_at`[]: string
      - `open_price`[]: string
      - `high_price`[]: string
      - `low_price`[]: string
      - `close_price`[]: string
      - `session`[]: string
      - `interpolated`[]: boolean
- `guide`: string

**Captures:**

- [dep-opt-hist-01](captures/dep-opt-hist-01.json) — success — NFLX option daily bars ~3 weeks.
- [dep-opt-hist-02](captures/dep-opt-hist-02.json) — success — bounds=24_5 (option extended-hours grid) + interval=minute.
- [dep-opt-hist-03](captures/dep-opt-hist-03.json) — success — bounds=24_7 (last unprobed enum on this tool).

**Notes:**

- NFLX option daily bars ~3 weeks.
- bounds=24_5 (option extended-hours grid) + interval=minute.
- bounds=24_7 (last unprobed enum on this tool).

### get_option_instruments

**Safety:** read-only · **Status:** probed

List option contracts. One of chain_symbol, chain_id, or ids is required; narrow further with expiration_dates, strike_price, type, state. When looking up contracts for a specific expiration, call this in parallel for every chain whose expiration_dates (from get_option_chains) includes the date. For AM/PM/morning/evening preferences, first check settle_on_open on each chain via get_option_chains and only query matching chains.

**Parameters (live inputSchema):**

| param | type | required | description |
|---|---|---|---|
| chain_id | string | no | Chain UUID. |
| chain_symbol | string | no | Underlying ticker (e.g. 'AAPL'). |
| expiration_dates | string | no | Comma-separated YYYY-MM-DD expirations. |
| strike_price | string | no | Exact strike (e.g. '150.0000'). |
| type | string | no | 'call' or 'put'. |
| state | string | no | 'active' (default), 'expired', or 'inactive'. Use 'expired' to find option contracts whose expiration date has passed; 'inactive' is for delisted/withdrawn c… |
| tradability | string | no | 'tradable' or 'untradable' (untradable is rejected at the tool layer). |
| ids | string | no | Comma-separated instrument UUIDs. |
| cursor | string | no | Pagination cursor. Omit for the first page; for the next page, pass the prior response's next value back verbatim. |

**Response field tree** (union over 11 success capture(s)):

- `data`: object
  - `instruments`: array<object>
    - `id`[]: string
    - `chain_id`[]: string
    - `chain_symbol`[]: string
    - `underlying_type`[]: string
    - `expiration_date`[]: string
    - `sellout_datetime`[]: string
    - `strike_price`[]: string
    - `type`[]: string
    - `state`[]: string
    - `tradability`[]: string
    - `trade_value_multiplier`[]: string
    - `min_ticks`[]: object
      - `above_tick`: string
      - `below_tick`: string
      - `cutoff_price`: string
  - `next`: string
- `guide`: string

**Errors observed:** 1 capture(s), 1 distinct shape(s)

**Captures:**

- [dep-opt-instr-06](captures/dep-opt-instr-06.json) — success — chain_id path (harvested from get_option_chains).
- [dep-opt-instr-07](captures/dep-opt-instr-07.json) — success — ids CSV lookup path.
- [dep-opt-instr-08](captures/dep-opt-instr-08.json) — success — strike_price filter (last unexercised param).
- [dep-opt-instr-09](captures/dep-opt-instr-09.json) — success — state=inactive (last unprobed enum on this tool).
- [dep-opt-instr-10](captures/dep-opt-instr-10.json) — success — SPXW index-option instruments - source of index option_id for curb-hours review (chain extended_hours_state=enabled).
- [dep-opt-instr-cur-01](captures/dep-opt-instr-cur-01.json) — success — PAGINATION FOLLOW: cursor harvested from ro-opt-instr-01 data.next.
- [opt-instr-harvest](captures/opt-instr-harvest.json) — success — Harvest leg instruments — set NFLX_CHAIN_ID + NFLX_EXP from opt-chains-nflx; pick ~ATM call (NFLX_OPT_ID) + one strike up (NFLX_OPT_ID2).
- [ro-opt-instr-01](captures/ro-opt-instr-01.json) — success — Base instruments page - source of option instrument UUIDs.
- [ro-opt-instr-02](captures/ro-opt-instr-02.json) — success — type=call + expiration filter.
- [ro-opt-instr-03](captures/ro-opt-instr-03.json) — success — type=put + expiration filter.
- [ro-opt-instr-04](captures/ro-opt-instr-04.json) — success — state=expired (vs default active).
- [ro-opt-instr-05](captures/ro-opt-instr-05.json) — error — tradability=untradable.

**Notes:**

- Base instruments page - source of option instrument UUIDs.
- type=call + expiration filter.
- type=put + expiration filter.
- state=expired (vs default active).
- tradability=untradable.
- chain_id path (harvested from get_option_chains).
- ids CSV lookup path.
- PAGINATION FOLLOW: cursor harvested from ro-opt-instr-01 data.next.
- strike_price filter (last unexercised param).
- SPXW index-option instruments - source of index option_id for curb-hours review (chain extended_hours_state=enabled).
- state=inactive (last unprobed enum on this tool).
- Harvest leg instruments — set NFLX_CHAIN_ID + NFLX_EXP from opt-chains-nflx; pick ~ATM call (NFLX_OPT_ID) + one strike up (NFLX_OPT_ID2).

### get_option_level_upgrade_info

**Safety:** read-only · **Status:** probed

Get the upgrade URL to apply for — or raise — options access on an account. The returned link routes the customer into the correct application for their target tier, including upgrading an existing option_level_2 account to option_level_3. Call when the user requests an options level their account doesn't yet have: option_level_2 enables long calls/puts, covered calls, and cash-secured puts; option_level_3 adds spreads and other multi-leg/complex strategies. option_level_3 additionally requires a margin or limited-margin account. If the account type is cash, do NOT call this tool for an L3 request — the customer must first switch to a margin/limited-margin account via get_limited_margin_upgrade_info, then re-fetch get_accounts; call this tool for L3 only once the account type is margin or limited margin. option_level_2 has no account-type requirement and is available on cash accounts. Map the user's requested strategy to its required level and call this tool if the account is below it — null/empty/option_level_0 for any options, or option_level_2 for an L3-only strategy such as a spread. Do NOT call when the account already has the required level or higher.

**Parameters (live inputSchema):**

| param | type | required | description |
|---|---|---|---|
| account_number | string | yes | Brokerage account number to generate the upgrade URL for. Obtain from get_accounts. |

**Response field tree** (union over 2 success capture(s)):

- `data`: object
  - `upgrade_url`: string
  - `account_number`: string
- `guide`: string

**Captures:**

- [opt-level](captures/opt-level.json) — success — Agentic acct option_level is empty — captures the upgrade path + expected reject context for everything below.
- [ro-option-level-01](captures/ro-option-level-01.json) — success — Option-level upgrade URL/info; agentic acct reports empty option_level.

**Notes:**

- Option-level upgrade URL/info; agentic acct reports empty option_level.
- Agentic acct option_level is empty — captures the upgrade path + expected reject context for everything below.

### get_option_positions

**Safety:** read-only · **Status:** probed

List options positions for an account. Returns open and closed (zero-quantity) positions. Pass nonzero=true for "what options do I have" / "show me my positions" — the common case.

**Parameters (live inputSchema):**

| param | type | required | description |
|---|---|---|---|
| account_number | string | yes | Brokerage account number. Must come from the user or be clearly implied — never default from get_accounts. |
| nonzero | boolean | no | True to return only currently-open positions; omit/false to include closed ones. |
| chain_ids | string | no | Comma-separated chain UUIDs (from get_option_chains). |
| option_ids | string | no | Comma-separated instrument UUIDs. |
| type | string | no | 'long' or 'short'. |
| option_type | string | no | 'call' or 'put'. |
| expiration_date | string | no | Exact expiration (YYYY-MM-DD). |
| expiration_date_lte | string | no | Upper bound on expiration (YYYY-MM-DD). |
| expiration_date_gte | string | no | Lower bound on expiration (YYYY-MM-DD). |
| cursor | string | no | Pagination cursor. Omit for the first page; for the next page, pass the prior response's next value back verbatim. |

**Response field tree** (union over 11 success capture(s)):

- `data`: object
  - `positions`: array<unknown>
- `guide`: string

**Captures:**

- [dep-opt-pos-chain](captures/dep-opt-pos-chain.json) — success — chain_ids filter on positions.
- [dep-opt-pos-ids](captures/dep-opt-pos-ids.json) — success — option_ids CSV filter on positions.
- [opt-positions](captures/opt-positions.json) — success — Open option positions — expected empty on this acct; verifies the nonzero filter shape.
- [ro-opt-pos-01](captures/ro-opt-pos-01.json) — success — Base.
- [ro-opt-pos-02](captures/ro-opt-pos-02.json) — success — nonzero=true (open only).
- [ro-opt-pos-03](captures/ro-opt-pos-03.json) — success — type=long.
- [ro-opt-pos-04](captures/ro-opt-pos-04.json) — success — type=short.
- [ro-opt-pos-05](captures/ro-opt-pos-05.json) — success — option_type=call.
- [ro-opt-pos-06](captures/ro-opt-pos-06.json) — success — option_type=put.
- [ro-opt-pos-07](captures/ro-opt-pos-07.json) — success — expiration_date_gte+lte window.
- [ro-opt-pos-08](captures/ro-opt-pos-08.json) — success — expiration_date exact.

**Notes:**

- Base.
- nonzero=true (open only).
- type=long.
- type=short.
- option_type=call.
- option_type=put.
- expiration_date_gte+lte window.
- expiration_date exact.
- chain_ids filter on positions.
- option_ids CSV filter on positions.
- Open option positions — expected empty on this acct; verifies the nonzero filter shape.

### get_option_quotes

**Safety:** read-only · **Status:** probed

Get real-time quotes for one or more option contracts by instrument UUID, plus the official prior-session close for each.

**Parameters (live inputSchema):**

| param | type | required | description |
|---|---|---|---|
| instrument_ids | null \| array | yes | Option instrument UUIDs. Above 20, quotes still return but closes is omitted with closes_error set. |

**Response field tree** (union over 3 success capture(s)):

- `data`: object
  - `results`: array<object>
    - `quote`[]: object
      - `instrument_id`: string
      - `ask_price`: string
      - `ask_size`: number
      - `bid_price`: string
      - `bid_size`: number
      - `break_even_price`: string
      - `adjusted_mark_price`: string
      - `mark_price`: string
      - `high_fill_rate_buy_price`: string
      - `low_fill_rate_buy_price`: string
      - `high_fill_rate_sell_price`: string
      - `low_fill_rate_sell_price`: string
      - `previous_close_price`: string
      - `previous_close_date`: string
      - `implied_volatility`: null | string
      - `delta`: null | string
      - `gamma`: null | string
      - `rho`: null | string
      - `theta`: null | string
      - `vega`: null | string
      - `open_interest`: number
      - `volume`: number
      - `chance_of_profit_long`: null | string
      - `chance_of_profit_short`: null | string
      - `updated_at`: string
    - `close`[]: object
      - `instrument_id`: string
      - `symbol`: string
      - `date`: string
      - `price`: string
      - `interpolated`: boolean
      - `source`: string
  - `closes_error`: string
- `guide`: string

**Captures:**

- [dep-opt-quotes-01](captures/dep-opt-quotes-01.json) — success — instrument_ids harvested from get_option_instruments (NFLX Nov-20 $2.5 call + Oct-16 $2.5 put).
- [err-optq-bad-id](captures/err-optq-bad-id.json) — success — Deliberate error: malformed option instrument id.
- [opt-optq](captures/opt-optq.json) — success — Leg quotes — harvest mark for a below-market limit price (NFLX_OPT_PRICE).

**Notes:**

- instrument_ids harvested from get_option_instruments (NFLX Nov-20 $2.5 call + Oct-16 $2.5 put).
- Leg quotes — harvest mark for a below-market limit price (NFLX_OPT_PRICE).
- Deliberate error: malformed option instrument id.

### get_option_watchlist

**Safety:** read-only · **Status:** probed

List the single-leg option contracts on the user's options watchlist. Use this instead of get_watchlist_items for the options watchlist — get_watchlist_items returns a generic shape that drops the option-specific title and the upstream rejects it with 400 anyway. Works for both equity options (AAPL, NVDA) and index options (SPX, NDX, RUT). Multi-leg strategies (verticals, condors, etc.) that may exist in the user's watchlist from app-side order placement are not shown — direct the user to the Robinhood app to view those.

**Parameters (live inputSchema):**

_No parameters._

**Response field tree** (union over 1 success capture(s)):

- `data`: object
  - `items`: array<unknown>
  - `list_id`: string
- `guide`: string

**Captures:**

- [ro-optwl-01](captures/ro-optwl-01.json) — success — Zero-param option watchlist.

**Notes:**

- Zero-param option watchlist.

## Crypto

### cancel_crypto_order

**Safety:** financial mutation · **Status:** missing

Cancel an open crypto order by order_id. Always confirm with the user before calling. Resolve order_id via get_crypto_orders if the user refers to it by description; pass the same rhs_account_number that owns the order. Cancellation may be rejected if the order has already filled, was already canceled, or is otherwise ineligible.

**Parameters (live inputSchema):**

| param | type | required | description |
|---|---|---|---|
| rhs_account_number | string | yes | Numeric brokerage account number (the 'rhs_account_number' field on get_accounts entries — distinct from the alphanumeric 'account_number'). The order must b… |
| order_id | string | yes | Order UUID from get_crypto_orders. Must belong to rhs_account_number. Required. |

_No captures — missing probes._

### get_crypto_account_onboarding_info

**Safety:** read-only · **Status:** probed

Get the link a user opens to sign the crypto agreement and open a crypto account. Call when the user wants to trade crypto but has no crypto account.

**Parameters (live inputSchema):**

_No parameters._

**Response field tree** (union over 1 success capture(s)):

- `data`: object
  - `already_onboarded`: boolean
  - `onboarding_url`: string
- `guide`: string

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

**Response field tree** (union over 1 success capture(s)):

- `data`: object
  - `results`: array<unknown>
- `guide`: string

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

**Response field tree** (union over 4 success capture(s)):

- `data`: object
  - `results`: array<object>
    - `symbol`[]: string
    - `id`[]: string
    - `bid_price`[]: string
    - `bid_time`[]: string
    - `ask_price`[]: string
    - `ask_time`[]: string
    - `mark_price`[]: string
    - `open_price`[]: string
    - `routing`[]: string
    - `updated_at`[]: string
- `guide`: string

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

**Response field tree** (union over 4 success capture(s)):

- `data`: object
  - `results`: array<object>
    - `id`[]: string
    - `symbol`[]: string
    - `display_symbol`[]: string
    - `name`[]: string
    - `asset_currency`[]: object
      - `id`: string
      - `code`: string
      - `name`: string
      - `type`: string
    - `quote_currency`[]: object
      - `id`: string
      - `code`: string
      - `name`: string
      - `type`: string
    - `tradability`[]: string
    - `tradability_by_account_type`[]: object
      - `individual`: string
      - `ira_roth`: string
      - `ira_traditional`: string
    - `display_only`[]: boolean
    - `min_order_size`[]: string
    - `max_order_size`[]: string
    - `min_order_quantity_increment`[]: string
    - `min_order_price_increment`[]: string
    - `market_orders_only`[]: boolean
    - `type`[]: string
    - `halted`[]: boolean
    - `halted_regions`[]: array<string>
  - `next`: string
- `guide`: string

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

**Safety:** financial mutation · **Status:** missing

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

_No captures — missing probes._

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

## Alerts

### create_alert

**Safety:** account write · **Status:** missing

Create a price or indicator alert on an equity or crypto symbol. Confirm the symbol and condition with the user before calling — this is a real write; when it fires the user gets their usual Robinhood notification.

Parameter rules:
- price_above / price_below / price_crosses: threshold is the trigger price. Do not send indicator.
- sma_above, sma_below, sma_crosses, ema_above, ema_below, ema_crosses, vwap_above, vwap_below, vwap_crosses, rsi_above, rsi_below, rsi_crosses (the indicator's own value vs your target): threshold is the target indicator value AND indicator is required.
- price_above_sma, price_below_sma, price_crosses_sma, price_above_ema, price_below_ema, price_crosses_ema, price_above_vwap, price_below_vwap, price_crosses_vwap, price_above_boll_upper, price_below_boll_lower, price_crosses_boll_mid, macd_above_signal, macd_below_signal, macd_crosses_signal (price vs indicator line): indicator only — do not send threshold.
- Pick the family by WHAT crosses WHAT: sma_crosses means the SMA's own value crosses your numeric threshold; price_crosses_sma means the market price crosses the SMA line and takes no threshold. "Alert me when the price crosses the 50-day SMA" is price_crosses_sma, never sma_crosses — a mixed-up sibling still creates a well-formed but wrong alert.
- indicator fields: period + interval_secs for sma/ema/rsi; interval_secs only for vwap (must be 300 / 5m bars); fast_period + slow_period + signal_period + interval_secs for macd; period + std_dev + ma_type + interval_secs for boll.
- Crypto symbols support price conditions only.

**Parameters (live inputSchema):**

| param | type | required | description |
|---|---|---|---|
| symbol | string | yes | The equity symbol or crypto asset the alert watches, e.g. AAPL or BTC. |
| asset_class | string | no | Optional: equity or crypto, pinning which asset the symbol names. When omitted the symbol is resolved as an equity first, then as crypto. |
| condition_type | string | yes | The alert condition: price_above, price_below, price_crosses, sma_above, sma_below, sma_crosses, ema_above, ema_below, ema_crosses, vwap_above, vwap_below, v… |
| threshold | string | no | Decimal string: the trigger price for price conditions, or the target indicator value for sma_above-style conditions. Not used for price-vs-indicator-line co… |
| indicator | null \| object | no | Indicator configuration. Required for every indicator condition; not used for price conditions. |

_No captures — missing probes._

### delete_alert

**Safety:** account write · **Status:** missing

Permanently delete a price or indicator alert, with a server-enforced confirmation step: a call without confirm deletes nothing and returns a preview of exactly what would be deleted; show that preview to the user, and only after they approve call again with confirm=true. There is no undo. If the user only wants to stop notifications for a while, disable the alert with update_alert (enabled=false) instead of deleting it.

**Parameters (live inputSchema):**

| param | type | required | description |
|---|---|---|---|
| alert_id | string | yes | The alert to delete — take it from get_alerts or create_alert; never construct one. |
| confirm | boolean | no | Set true only after the user approved the preview returned by a prior call without confirm. Omitted or false = preview only: nothing is deleted. |

_No captures — missing probes._

### get_alert_log

**Safety:** read-only · **Status:** probed

Read the log of fired alerts — what fired, when, and at what price or indicator value — with read/unread state. Poll this to learn whether any alert has fired; alert events are not pushed to the agent.

**Parameters (live inputSchema):**

| param | type | required | description |
|---|---|---|---|
| asset_class | string | no | Optional: equity or crypto, limiting the log to one asset class. Omitted = all classes. |
| since | string | no | Optional RFC3339 timestamp: only events triggered at or after this instant. Omitted = the full retention window. |
| cursor | string | no | Opaque pagination token from a prior response's next_cursor. Omit for the first page. When passing a cursor, repeat the same asset_class, since, and limit as… |
| limit | integer | no | Max events per page, 1-100. Omitted = 20. Raise it (e.g. to 100) to collect a full mark_alerts_read batch in one page. |

**Response field tree** (union over 4 success capture(s)):

- `data`: object
  - `events`: array<unknown>
  - `total_unread_count`: number
- `guide`: string

**Captures:**

- [ro-alertlog-01](captures/ro-alertlog-01.json) — success — Alert log, default page (20).
- [ro-alertlog-02](captures/ro-alertlog-02.json) — success — asset_class=equity.
- [ro-alertlog-03](captures/ro-alertlog-03.json) — success — asset_class=crypto.
- [ro-alertlog-04](captures/ro-alertlog-04.json) — success — since bound + limit=5 (min-page for cursor discovery).

**Notes:**

- Alert log, default page (20).
- asset_class=equity.
- asset_class=crypto.
- since bound + limit=5 (min-page for cursor discovery).

### get_alerts

**Safety:** read-only · **Status:** probed

List the price/indicator alerts the user currently has configured (equities and crypto only), optionally filtered to one symbol. Use to look up alert_id values for update_alert/delete_alert, or to check what's currently being watched.

**Parameters (live inputSchema):**

| param | type | required | description |
|---|---|---|---|
| symbol | string | no | Filter to one asset's alerts, e.g. AAPL or BTC. Omit for all alerts. |
| asset_class | string | no | Only alongside symbol: equity or crypto, pinning which asset the symbol names. When omitted the symbol is resolved as an equity first, then as crypto. Cannot… |
| cursor | string | no | Pagination cursor from a previous response's next_cursor. Omit for the first page. |

**Response field tree** (union over 4 success capture(s)):

- `data`: object
  - `alerts`: array<unknown>
  - `alert_limit_reached`: boolean
- `guide`: string

**Errors observed:** 1 capture(s), 1 distinct shape(s)

**Captures:**

- [dep-alerts-03](captures/dep-alerts-03.json) — error — asset_class WITHOUT symbol - schema says "cannot be used without symbol"; expect validation error.
- [ro-alerts-01](captures/ro-alerts-01.json) — success — All alerts.
- [ro-alerts-02](captures/ro-alerts-02.json) — success — symbol+asset_class=equity.
- [ro-alerts-03](captures/ro-alerts-03.json) — success — symbol+asset_class=crypto.
- [ro-alerts-04](captures/ro-alerts-04.json) — success — symbol only - exercises equity-first resolution order.

**Notes:**

- All alerts.
- symbol+asset_class=equity.
- symbol+asset_class=crypto.
- symbol only - exercises equity-first resolution order.
- asset_class WITHOUT symbol - schema says "cannot be used without symbol"; expect validation error.

### mark_alerts_read

**Safety:** account write · **Status:** probed

Mark fired alerts as read so already-handled events are not reported to the user twice. Call it after relaying fired alerts from get_alert_log.

Parameter rules:
- Provide exactly one of alert_log_ids or all_through.
- alert_log_ids marks specific events; all_through marks every event triggered at or before that instant, across ALL symbols — not only the ones just discussed.

**Parameters (live inputSchema):**

| param | type | required | description |
|---|---|---|---|
| alert_log_ids | null \| array | no | Fired-alert event ids from get_alert_log's alert_log_id (never alert_id). At most 100 per call — the server enforces the exact cap and rejects oversized batc… |
| all_through | string | no | RFC3339 timestamp: mark every event triggered at or before this instant as read, across all symbols. Set it to the triggered_at of the newest event you relay… |

**Response field tree** (union over 1 success capture(s)):

- `data`: object
  - `marked`: boolean
  - `scope`: string
  - `alert_log_id_count`: number
- `guide`: string

**Captures:**

- [err-markalerts-bad-id](captures/err-markalerts-bad-id.json) — success — Deliberate error: nonexistent alert log ids — harmless; cannot match real alerts.

**Notes:**

- Deliberate error: nonexistent alert log ids — harmless; cannot match real alerts.

### update_alert

**Safety:** account write · **Status:** missing

Change an existing price or indicator alert: enable/disable it, adjust its threshold or indicator settings, or switch its condition within the same family. Confirm the change with the user before calling — this is a real write.

Parameter rules:
- At least one of enabled, condition_type, threshold, or indicator is required; only the fields you send change, the rest keep their stored values.
- condition_type may only change within the alert's current condition family — e.g. price_above -> price_below, or sma_above -> price_above_sma (both sma family). To change the indicator family or the symbol, create a new alert instead.
- threshold/indicator rules per condition family match create_alert; conditions comparing price to an indicator line take no threshold.

**Parameters (live inputSchema):**

| param | type | required | description |
|---|---|---|---|
| alert_id | string | yes | The alert to change — take it from get_alerts or create_alert; never construct one. |
| enabled | null \| boolean | no | Set false to pause the alert or true to re-enable it. Omitted = unchanged. |
| condition_type | string | no | New condition for the alert — same vocabulary as create_alert. Omitted = unchanged. |
| threshold | string | no | New trigger price or target indicator value, as a decimal string. Omitted = unchanged. |
| indicator | null \| object | no | New indicator configuration — replaces the stored one wholesale, so send the complete configuration when provided. Omitted = unchanged. |

_No captures — missing probes._

## SEC Filings

### get_sec_filing

**Safety:** read-only · **Status:** probed

Read an SEC filing's table of contents or a specific section's text. Use get_sec_filing_index to find a filing_id first.

**Parameters (live inputSchema):**

| param | type | required | description |
|---|---|---|---|
| filing_id | string | yes | Filing identifier returned by get_sec_filing_index. |
| section | string | no | Section identifier from the table of contents (the id field). Omit to get the full table of contents; provide to get a specific section's text. |

**Response field tree** (union over 2 success capture(s)):

- `data`: object
  - `table_of_contents`: object
    - `filing_id`: string
    - `form_type`: string
    - `sections`: array<object>
      - `id`[]: string
      - `title`[]: string
      - `level`[]: number
  - `section`: object
    - `filing_id`: string
    - `form_type`: string
    - `section_id`: string
    - `section_title`: string
    - `content`: string
- `guide`: string

**Errors observed:** 1 capture(s), 1 distinct shape(s)

**Captures:**

- [dep-sec-filing-01](captures/dep-sec-filing-01.json) — success — AAPL 10-K filed 2025-10-31 - source of section ids for wave-3.
- [dep-sec-filing-02](captures/dep-sec-filing-02.json) — success — section param - TOC section id harvested from dep-sec-filing-01.
- [err-sec-bad-id](captures/err-sec-bad-id.json) — error — Deliberate error: nonexistent filing id.

**Notes:**

- AAPL 10-K filed 2025-10-31 - source of section ids for wave-3.
- section param - TOC section id harvested from dep-sec-filing-01.
- Deliberate error: nonexistent filing id.

### get_sec_filing_facts

**Safety:** read-only · **Status:** probed

Get reported facts tagged under specific GAAP concept names in one or more SEC filings — financial figures (revenue, net income, assets, debt) and disclosures (e.g. debt schedules, related-party transactions, subsequent events) alike. Use get_sec_filing_index to find filing_ids first.

**Parameters (live inputSchema):**

| param | type | required | description |
|---|---|---|---|
| filing_ids | null \| array | yes | Filing identifiers to fetch facts for (1-3), from get_sec_filing_index. Default to a single filing_id — most questions are answered by periods already embedd… |
| concepts | null \| array | yes | GAAP concept names to fetch (1-10) — covers numeric line items (e.g. NetIncomeLoss, Assets, Revenues) and disclosure text blocks (e.g. ScheduleOfDebtTableTex… |

**Response field tree** (union over 1 success capture(s)):

- `data`: object
  - `facts`: array<object>
    - `filing_id`[]: string
    - `concept`[]: string
    - `entity`[]: string
    - `period`[]: string
    - `axises`[]: array<string>
    - `decimals`[]: number
    - `value`[]: string
    - `char_value`[]: string
    - `unit`[]: string
    - `start_date`[]: string
    - `end_date`[]: string
- `guide`: string

**Captures:**

- [dep-sec-facts-01](captures/dep-sec-facts-01.json) — success — Batch facts for 3 common GAAP concepts on the 10-K.

**Notes:**

- Batch facts for 3 common GAAP concepts on the 10-K.

### get_sec_filing_facts_catalog

**Safety:** read-only · **Status:** probed

List the distinct GAAP concept names tagged in an SEC filing, with their reporting periods and dimension breakdowns. Use this only after a direct get_sec_filing_facts guess comes back empty, or for open-ended "what's unusual/notable" questions — most common financial questions should guess concept names directly rather than calling this first.

**Parameters (live inputSchema):**

| param | type | required | description |
|---|---|---|---|
| filing_id | string | yes | Filing identifier to catalog, from get_sec_filing_index. |
| concept_contains | string | no | Case-insensitive substring filter on concept name, e.g. 'Debt'. Omit to return all concepts. |
| axis_name_in | null \| array | no | Only return concepts broken down by at least one of these dimension names. For 'what's unusual/notable in this filing' questions, try named-entity axes like … |
| offset | integer | no | Pagination offset. Omit for the first page; to fetch the next page, pass the value from the prior response's next_offset field. |

**Response field tree** (union over 5 success capture(s)):

- `data`: object
  - `concepts`: array<object>
    - `concept`[]: string
    - `is_text_block`[]: boolean
    - `periods`[]: array<object>
      - `period`[]: string
      - `end_date`[]: string
      - `start_date`[]: string
    - `axis_names`[]: array<string>
  - `count`: number
  - `next_offset`: number
- `guide`: string

**Captures:**

- [dep-sec-fcat-01](captures/dep-sec-fcat-01.json) — success — Fact catalog page 0 - source of next_offset + axis names for wave-3.
- [dep-sec-fcat-02](captures/dep-sec-fcat-02.json) — success — concept_contains substring filter.
- [dep-sec-fcat-03](captures/dep-sec-fcat-03.json) — success — OFFSET PAGINATION FOLLOW - next_offset=50 from dep-sec-fcat-01.
- [dep-sec-fcat-04](captures/dep-sec-fcat-04.json) — success — axis_name_in filter - axis name harvested from dep-sec-fcat-01 concept entries.
- [dep-sec-fcat-05](captures/dep-sec-fcat-05.json) — success — OFFSET FOLLOW p3 - next_offset=100 from dep-sec-fcat-03.

**Notes:**

- Fact catalog page 0 - source of next_offset + axis names for wave-3.
- concept_contains substring filter.
- OFFSET PAGINATION FOLLOW - next_offset=50 from dep-sec-fcat-01.
- axis_name_in filter - axis name harvested from dep-sec-fcat-01 concept entries.
- OFFSET FOLLOW p3 - next_offset=100 from dep-sec-fcat-03.

### get_sec_filing_index

**Safety:** read-only · **Status:** probed

List a company's SEC filings, optionally filtered by form type and date. Use this to find a specific annual report (10-K), quarterly report (10-Q), or material event disclosure (8-K).

**Parameters (live inputSchema):**

| param | type | required | description |
|---|---|---|---|
| symbol | string | yes | Stock ticker symbol, e.g. AAPL. Exact match — no partial or name-based lookup. Lowercase input is normalized to uppercase. |
| form_type | null \| array | no | One or more SEC form types to filter by, e.g. ['10-K'] or ['10-K','10-Q']. Omit to return all form types. |
| since | string | no | Earliest filing date to include, ISO format YYYY-MM-DD. Omit to return filings from all dates. |
| until | string | no | Latest filing date to include, ISO format YYYY-MM-DD. Omit to return filings up to the most recent. |
| cursor | string | no | Pagination cursor. Omit for the first page; to fetch the next page, pass the value from the prior response's next field. |

**Response field tree** (union over 5 success capture(s)):

- `data`: object
  - `symbol`: string
  - `filings`: array<object>
    - `filing_id`[]: string
    - `form_type`[]: string
    - `description`[]: string
    - `date_filed`[]: string
  - `next`: string
- `guide`: string

**Captures:**

- [dep-sec-idx-cur-01](captures/dep-sec-idx-cur-01.json) — success — PAGINATION FOLLOW: cursor harvested from ro-sec-idx-01 data.next.
- [dep-sec-idx-cur-02](captures/dep-sec-idx-cur-02.json) — success — PAGINATION FOLLOW p3 - cursor from dep-sec-idx-cur-01 data.next.
- [ro-sec-idx-01](captures/ro-sec-idx-01.json) — success — All form types - source of filing_id + next_cursor.
- [ro-sec-idx-02](captures/ro-sec-idx-02.json) — success — form_type filter.
- [ro-sec-idx-03](captures/ro-sec-idx-03.json) — success — since+until window.

**Notes:**

- All form types - source of filing_id + next_cursor.
- form_type filter.
- since+until window.
- PAGINATION FOLLOW: cursor harvested from ro-sec-idx-01 data.next.
- PAGINATION FOLLOW p3 - cursor from dep-sec-idx-cur-01 data.next.

## Scanners

### create_scan

**Safety:** account write · **Status:** missing

Create a new saved scanner (screener) on the user's account — or, with scan_id, update an existing one by appending a new configuration version. Filters can be enum-based (from get_scanner_filter_specs) or expression-based (a raw market-data expression built from get_scanner_datapoints). Returns the scan's id, title, applied filters, and live market results.

Prefer an enum filter_type whenever one covers the request: enum filters are pre-validated and render as standard, user-editable filters in Legend. Build a raw expression only when no enum filter covers the request, and validate it with preview_scan before saving it here. This is the only tool that saves expression filters — update_scan_filters rejects them — so to change a scan that has an expression filter, call this tool with that scan's scan_id and the full desired filter set.

Columns display values, filters screen. To show a datapoint in results without restricting matches, pass it in columns — never fake it with a no-op filter like ">= 0", which pollutes the scan's filter list. A column is a display_name plus an expression, or a standard column's display name alone. A couple of contextual columns supporting the filters make a scan read better in Legend.

Two execution paths:
- New scan, enum-only filters (or none), no columns: composes multiple Beacon operations — create the scan, apply the preset configuration if non-INITIAL, apply filters, set the title. If a step after the initial create fails, the scan still exists in its partial state; the response surfaces what was applied, and update_scan_filters / update_scan_config can fix the rest.
- scan_id set, any expression filter present, or any columns present: a single transactional Beacon call that persists the filters and columns as a new ACTIVE configuration version (on the given scan, or on a brand-new one). All-or-nothing — an expression the market-data provider rejects means NOTHING is persisted, and the provider's validation error is returned. Earlier versions of a scan are never edited. A non-INITIAL preset cannot be combined with this path.

Parameters:
- scan_id (optional) — update this existing scan instead of creating one. REPLACE semantics: the new version holds exactly the filters and columns passed, so read the current set via get_scans first and send the complete intended set. Cortex-managed scans are rejected.
- preset (optional) — starting preset for a new scan. Default: DAILY_GAINERS when no filters supplied, INITIAL when filters supplied. Valid values: INITIAL, DAILY_GAINERS, DAILY_LOSERS, HIGH_OPTIONS_VOLUME_IV, UPCOMING_EARNINGS.
- filters (optional for a new scan, required with scan_id) — array of filter specs, enum and/or expression. Call get_scanner_filter_specs for enum filters; call get_scanner_datapoints before composing an expression.
- columns (optional) — extra result columns on top of the filters' own columns and the standard defaults. An expression matching a standard column's canonical form is saved as that standard column, canonical name included (e.g. "optionsPutDayVolume" always saves as "Total put volume").
- title (optional) — custom human-readable name for the scan.

Example: to make "stocks with RSI > 70 and volume > 1M", call with
  preset = "INITIAL"
  filters = [
    {"filter_type": "FILTER_TYPE_RSI", "predicate": ">", "values": ["70"], "interval": "1d", "length": 14},
    {"filter_type": "FILTER_TYPE_VOLUME", "predicate": ">", "values": ["1000000"], "interval": "1d"}
  ]
  title = "High RSI + High Volume"

Example: to save "stocks where put option volume exceeds call option volume" (no enum filter compares two datapoints), showing both volumes and the ratio as context, call with
  filters = [
    {"expression": "optionsPutDayVolume > optionsCallDayVolume", "predicate": "=", "values": ["True"], "display_title": "Put exceeds call"}
  ]
  columns = [
    {"display_name": "Put volume", "expression": "optionsPutDayVolume"},
    {"display_name": "Call volume", "expression": "optionsCallDayVolume"},
    {"display_name": "Put/Call ratio", "expression": "optionsPutDayVolume / optionsCallDayVolume"}
  ]
  title = "Put hedging screen"
  (the first two save under their canonical standard names, "Total put volume" and "Total call volume")

Example: to tighten that saved screen later without creating a second scan, call with
  scan_id = "<its scan_id from get_scans>"
  filters = [the scan's current filters, copied from get_scans (expressions verbatim, enum filters by filter_type_enum), with the desired change applied]
  columns = [the scan's current extra columns, copied from get_scans, if they should be kept]

**Parameters (live inputSchema):**

| param | type | required | description |
|---|---|---|---|
| scan_id | string | no | Optional. Update an existing scan by appending the given filters (and columns) as a NEW configuration version, which becomes the active one — earlier version… |
| preset | string | no | Starting preset for the new scan. One of: INITIAL (no preset; only valid if filters are provided), DAILY_GAINERS, DAILY_LOSERS, HIGH_OPTIONS_VOLUME_IV, UPCOM… |
| filters | null \| array | no | Custom filters, enum-based and/or expression-based. Enum filter: filter_type (FILTER_TYPE_... enum from get_scanner_filter_specs) plus predicate/values and o… |
| columns | null \| array | no | Optional result columns to display on top of what the filters and the standard default columns already show. Each column: display_name plus either an express… |
| title | string | no | Optional custom title for the saved scan. If omitted: a new scan gets Beacon's default title for the preset, and a scan_id update keeps the scan's existing t… |

_No captures — missing probes._

### get_scanner_datapoints

**Safety:** read-only · **Status:** probed

List the market-data datapoints available for building raw expressions: functions (with signatures) and fields, each with a category and description. Expressions serve two purposes — filters (screen on the expression's value) and columns (display it in results) — on preview_scan, create_scan and update_scan_config. Call this before constructing one; do not guess datapoint names or signatures.

For filters, use expressions only for screens no enum filter covers: check get_scanner_filter_specs first, and prefer an enum filter_type whenever one fits. For columns, a standard column referenced by display_name alone needs no expression at all.

Scoping a scan to a set of instruments is done here, not with an enum filter: the descriptive category's symbol field restricts a scan to named tickers or to an index's members. See the guide for the exact predicates.

Requires a category, since the full catalog is too large to return at once. Pass "technical", "price_volume", "fundamental", "options", "volatility", "quote" or "descriptive"; the response lists every category with a description so you can pick a different one if needed.

**Parameters (live inputSchema):**

| param | type | required | description |
|---|---|---|---|
| category | string | yes | Which part of the catalog to return. One of: technical (chart studies - rsi, macd, adx, bollinger, pivots), price_volume (prices, changes, moving averages, v… |

**Response field tree** (union over 9 success capture(s)):

- `data`: object
  - `datapoints`: array<object>
    - `name`[]: string
    - `kind`[]: string
    - `signature`[]: string
    - `description`[]: string
    - `value_type`[]: string
    - `examples`[]: array<string>
  - `categories`: array<object>
    - `name`[]: string
    - `description`[]: string
    - `datapoint_count`[]: number
    - `aliases`[]: array<string>
  - `argument_types`: array<object>
    - `name`[]: string
    - `argument_names`[]: array<string>
    - `values`[]: array<string>
    - `note`[]: string
- `guide`: string

**Captures:**

- [ro-scan-dp-01](captures/ro-scan-dp-01.json) — success — category=technical - one of the nine documented slices (each a distinct payload).
- [ro-scan-dp-02](captures/ro-scan-dp-02.json) — success — category=price_volume - one of the nine documented slices (each a distinct payload).
- [ro-scan-dp-03](captures/ro-scan-dp-03.json) — success — category=fundamental - one of the nine documented slices (each a distinct payload).
- [ro-scan-dp-04](captures/ro-scan-dp-04.json) — success — category=options - one of the nine documented slices (each a distinct payload).
- [ro-scan-dp-05](captures/ro-scan-dp-05.json) — success — category=volatility - one of the nine documented slices (each a distinct payload).
- [ro-scan-dp-06](captures/ro-scan-dp-06.json) — success — category=quote - one of the nine documented slices (each a distinct payload).
- [ro-scan-dp-07](captures/ro-scan-dp-07.json) — success — category=descriptive - one of the nine documented slices (each a distinct payload).
- [ro-scan-dp-08](captures/ro-scan-dp-08.json) — success — category=function - one of the nine documented slices (each a distinct payload).
- [ro-scan-dp-09](captures/ro-scan-dp-09.json) — success — category=field - one of the nine documented slices (each a distinct payload).

**Notes:**

- category=technical - one of the nine documented slices (each a distinct payload).
- category=price_volume - one of the nine documented slices (each a distinct payload).
- category=fundamental - one of the nine documented slices (each a distinct payload).
- category=options - one of the nine documented slices (each a distinct payload).
- category=volatility - one of the nine documented slices (each a distinct payload).
- category=quote - one of the nine documented slices (each a distinct payload).
- category=descriptive - one of the nine documented slices (each a distinct payload).
- category=function - one of the nine documented slices (each a distinct payload).
- category=field - one of the nine documented slices (each a distinct payload).

### get_scanner_filter_specs

**Safety:** read-only · **Status:** probed

List every valid scanner filter type and how to use it. Call this before constructing filters for create_scan or update_scan_filters — do not guess filter_type names.

This tool takes no parameters.

**Parameters (live inputSchema):**

_No parameters._

**Response field tree** (union over 1 success capture(s)):

- `data`: object
  - `filter_specs`: array<object>
    - `filter_type`[]: string
    - `display_name`[]: string
    - `filter_group`[]: string
    - `value_type`[]: string
    - `unit_type`[]: string
    - `supported_predicates`[]: array<string>
    - `options`[]: array<string>
    - `supported_lengths`[]: array<number>
    - `supported_intervals`[]: array<string>
    - `supported_plots`[]: array<string>
- `guide`: string

**Captures:**

- [ro-scanfilters-01](captures/ro-scanfilters-01.json) — success — Filter catalog - source of filter_type for preview_scan.

**Notes:**

- Filter catalog - source of filter_type for preview_scan.

### get_scans

**Safety:** read-only · **Status:** probed

List the authenticated user's saved scanners (also called screeners). A scan is a saved set of filters and columns that filters the market for instruments matching specific criteria (e.g. "RSI > 70 and Volume > 1M"). The user creates these in Legend or via the create_scan tool.

Returns one entry per scan with its id, title, active filters, configured columns, sort order, and a flag indicating whether the scan is managed by Cortex (Legend's AI agent). Cortex-managed scans are read-only via MCP — they can be run with run_scan but not modified with update_scan_filters or update_scan_config.

This tool takes no parameters.

**Parameters (live inputSchema):**

_No parameters._

**Response field tree** (union over 1 success capture(s)):

- `data`: object
  - `scans`: array<unknown>
- `guide`: string

**Captures:**

- [ro-scans-01](captures/ro-scans-01.json) — success — Saved scans - source of scan_id for run_scan.

**Notes:**

- Saved scans - source of scan_id for run_scan.

### preview_scan

**Safety:** simulation · **Status:** probed

Run a filter set against live market data and return the matching instruments WITHOUT saving a scan. Nothing is persisted and no scan_id is returned. A preview behaves exactly like creating a scan with these filters would — same filters, same default columns, same live evaluation — so it is the way to validate a filter set before create_scan or update_scan_filters.

Expression-based filters run here and save through create_scan (update_scan_filters rejects them). An expression filter sets expression (and omits filter_type): either a value expression with a numeric predicate (expression "dayVolume / volumeAvg(candleCount=30, candlePeriod=\"1d\", session=\"all\")", predicate PREDICATE_GREATER_THAN_OR_EQUAL, values ["1.5"]), or a boolean screen carrying the whole comparison inside the expression (expression "tradeAllDay.price > closeAvg(candleCount=50, candlePeriod=\"1d\", session=\"all\")", predicate PREDICATE_EQUAL, values ["True"]). An invalid expression comes back as a validation error from the market-data provider instead of failing a later save.

Prefer an enum filter_type whenever one covers the request — enum filters are pre-validated and render as standard, user-editable filters in Legend. Call get_scanner_filter_specs first; build a raw expression only when no enum filter covers the request.

Columns display values, filters screen. To show a datapoint in results without restricting matches, pass it in columns — never fake it with a no-op filter like ">= 0", which pollutes the scan's filter list. A column is a display_name plus an expression, or a standard column's display name alone ({"display_name": "Market cap"}). Scans read best with a few contextual columns supporting the filters (e.g. a put/call screen showing both raw volumes).

Parameters:
- filters (required, non-empty) — the complete filter set to evaluate.
- columns (optional) — extra result columns on top of the filters' own columns and the standard defaults. Note: an expression matching a standard column's canonical form is shown as that standard column, canonical name included.

**Parameters (live inputSchema):**

| param | type | required | description |
|---|---|---|---|
| filters | null \| array | yes | Filters to evaluate, enum-based and/or expression-based. Enum filter: filter_type from get_scanner_filter_specs plus predicate/values and optional interval/l… |
| columns | null \| array | no | Optional result columns to display on top of what the filters and the standard default columns already show. Each column: display_name plus either an express… |

**Response field tree** (union over 5 success capture(s)):

- `data`: object
  - `result`: object
    - `total_items`: number
    - `results`: array<object>
      - `ticker`[]: string
      - `instrument_id`[]: string
      - `instrument_type`[]: string
      - `columns`[]: object
        - `% Change`: string
        - `Asset type`: string
        - `Last`: string
        - `Name`: string
        - `Net change`: string
        - `Symbol`: string
        - `Volume`: string
        - `Forward P/E`: string
        - `Market cap`: string
        - `RSI`: string
        - `P/C volume`: string
    - `sorted_by`: string
    - `filters_applied`: array<object>
      - `filter_type`[]: string
      - `filter_type_enum`[]: string
      - `predicate`[]: string
      - `values`[]: array<string>
      - `expression`[]: string
      - `interval`[]: string
      - `plot`[]: string
- `guide`: string

**Errors observed:** 2 capture(s), 2 distinct shape(s)

**Captures:**

- [dep-prev-scan-01](captures/dep-prev-scan-01.json) — success — filters objects with enum filter_type harvested from get_scanner_filter_specs.
- [dep-prev-scan-02](captures/dep-prev-scan-02.json) — success — filters + columns objects both exercised.
- [dep-prev-scan-03](captures/dep-prev-scan-03.json) — error — filter interval/length/plot/display_title exercised on a parameterized RSI filter.
- [dep-prev-scan-04](captures/dep-prev-scan-04.json) — success — Expression filter (numeric-predicate form) + display_title; column expression/visible/order.
- [dep-prev-scan-05](captures/dep-prev-scan-05.json) — success — Boolean-comparison expression form per schema doc: predicate "=" + values ["True"]. May reject the literal predicate - error names valid wire enums.
- [dep-prev-scan-06](captures/dep-prev-scan-06.json) — error — filter interval/length/plot on an enum filter (display_title dropped - expression-only per dep-prev-scan-03 error).
- [dep-prev-scan-07](captures/dep-prev-scan-07.json) — success — plot on a filter that supports it (Close, from supported_plots). dep-prev-scan-06 proved plot is NOT validated pre-flight: RSI + plot produced a malformed DXFeed expression.

**Notes:**

- filters objects with enum filter_type harvested from get_scanner_filter_specs.
- filters + columns objects both exercised.
- filter interval/length/plot/display_title exercised on a parameterized RSI filter.
- Expression filter (numeric-predicate form) + display_title; column expression/visible/order.
- Boolean-comparison expression form per schema doc: predicate "=" + values ["True"]. May reject the literal predicate - error names valid wire enums.
- plot on RSI (no supported_plots): server does NOT validate plot pre-flight - produced a malformed DXFeed expression. Kept as bug evidence.
- plot on a filter that supports it (Close, from supported_plots). dep-prev-scan-06 proved plot is NOT validated pre-flight: RSI + plot produced a malformed DXFeed expression.

### run_scan

**Safety:** read-only · **Status:** error-only

Execute a saved scanner (also called screener) and return live market results. A scan's filters are evaluated against current market data at request time — results are real-time, not cached.

Returns the scan's title, the total number of matching instruments, a list of instrument rows (with ticker, instrument_id, type, and one cell per visible column), plus the active sort and filters. The agent should present results as a table and mention this is live data.

Parameters:
- scan_id (required) — the scan identifier from get_scans or create_scan. Returns an error if the scan does not exist or does not belong to the calling user.

Use get_scans first to discover available scan_ids if the user has not specified one.

**Parameters (live inputSchema):**

| param | type | required | description |
|---|---|---|---|
| scan_id | string | yes | The scan identifier to execute. Get this from get_scans or create_scan. |

**Errors observed:** 1 capture(s), 1 distinct shape(s)

**Captures:**

- [dep-run-scan-01](captures/dep-run-scan-01.json) — error — scan_id exercised with synthetic id - account has no saved scans (create_scan is a mutation); expect not-found error.

**Notes:**

- scan_id exercised with synthetic id - account has no saved scans (create_scan is a mutation); expect not-found error.

### update_scan_config

**Safety:** account write · **Status:** missing

Change the sort order of a saved scan's results table, and/or replace its extra result columns. The scan's filters are always preserved.

Parameters:
- scan_id (required) — the scan to modify.
- sorting_column (required unless columns is provided) — display name of the column to sort by. Must match a column on the scan; the error response lists available columns when no match is found.
- sorting_direction — "asc" or "desc". Required with sorting_column.
- columns (optional) — REPLACE the scan's extra result columns (beyond the filters' own columns and the standard defaults). The scan keeps its current filters verbatim and gets a new configuration version — earlier versions are preserved. To add one column, pass the complete intended set (current columns from get_scans plus the new one). Columns display values, filters screen — to show a datapoint without restricting results, this is the tool, never a no-op filter.

Restrictions:
- Cortex-managed scans (cortex_managed: true in get_scans) are rejected.
- Omitted/empty columns means sorting-only. To remove every extra column, use create_scan with this scan's scan_id and its current filters.
- An expression matching a standard column's canonical form is saved as that standard column, canonical name included.

Returns the scan with the changes applied and fresh live results.

**Parameters (live inputSchema):**

| param | type | required | description |
|---|---|---|---|
| scan_id | string | yes | The scan to modify. Get this from get_scans or create_scan. Cortex-managed scans are rejected. |
| sorting_column | string | no | Display name of the column to sort by (e.g. "Volume", "% Change", "RSI"). Must match a column on the scan — call get_scans / run_scan first to see available … |
| sorting_direction | string | no | "asc" or "desc" (ascending or descending). Required with sorting_column. |
| columns | null \| array | no | REPLACE the scan's extra result columns (the ones beyond what its filters and the standard defaults contribute): the scan keeps its current filters verbatim … |

_No captures — missing probes._

### update_scan_filters

**Safety:** account write · **Status:** missing

Replace the filters on an existing saved scan. The complete filter set provided replaces whatever filters the scan had — this is REPLACE semantics, not merge. To add a single filter to an existing scan, the agent must first read the scan (via get_scans or run_scan), then call this tool with all the existing filters plus the new one.

Parameters:
- scan_id (required) — the scan to modify. Get from get_scans or create_scan.
- filters (required) — the complete new filter set. Send [] to clear all filters. Each filter has filter_type (FILTER_TYPE_... enum), predicate, values, optional interval/length. Call get_scanner_filter_specs for valid combinations.

Restrictions:
- Cortex-managed scans (cortex_managed: true in get_scans) are rejected with a user-friendly error.
- Returns an error and does not apply any change if any filter fails validation.

Returns the scan with its new filters and fresh live results.

**Parameters (live inputSchema):**

| param | type | required | description |
|---|---|---|---|
| scan_id | string | yes | The scan to modify. Get this from get_scans or create_scan. Cortex-managed scans (cortex_managed: true in get_scans output) are rejected. |
| filters | null \| array | yes | The complete set of filters the scan should have after the update. REPLACE semantics — to add a filter, supply all existing filters plus the new one. To remo… |

_No captures — missing probes._

## Watchlists

### add_option_to_watchlist

**Safety:** account write · **Status:** missing

Add option contracts to the user's options watchlist. Works for both equity options (AAPL, NVDA) and index options (SPX, NDX, RUT). Source option_ids from get_option_instruments. Confirm with the user before calling — this is a real write.

**Parameters (live inputSchema):**

| param | type | required | description |
|---|---|---|---|
| option_ids | null \| array | yes | Option contract UUIDs to add. Each becomes a single-leg position on the user's options watchlist. Source from get_option_instruments. |
| position_type | string | no | "long" (default) or "short". Applies to every option_id in this call. For mixed long/short adds, issue two calls. |

_No captures — missing probes._

### add_to_watchlist

**Safety:** account write · **Status:** missing

Add items to a watchlist. Exactly one of symbols (stocks/ETFs), currency_pair_ids (crypto), or index_ids (market indexes like SPX, NDX) is required — mutually exclusive. For options use add_option_to_watchlist (separate dedicated watchlist). Futures still require the Robinhood app. Already-present items are no-ops. Confirm with the user before calling.

**Parameters (live inputSchema):**

| param | type | required | description |
|---|---|---|---|
| list_id | string | yes | UUID of the watchlist to add items to. |
| symbols | null \| array | no | Stock symbols to add (e.g. ['AAPL', 'NVDA']). US stocks and ETFs only. Mutually exclusive with currency_pair_ids and index_ids. |
| currency_pair_ids | null \| array | no | Currency-pair UUIDs to add (e.g. the object_id from get_watchlist_items where object_type=currency_pair, or the id from get_currency_pairs). Mutually exclusi… |
| index_ids | null \| array | no | Market-index UUIDs to add (the id field from get_indexes; SPX, NDX, DJI, etc.). Mutually exclusive with symbols and currency_pair_ids. |

_No captures — missing probes._

### create_watchlist

**Safety:** account write · **Status:** missing

Create a new custom watchlist for the user — a real write. When the user has already specified the name, call this directly; ask for a name first only when they have not. Do not use this to follow a Robinhood-curated list (use follow_watchlist).

**Parameters (live inputSchema):**

| param | type | required | description |
|---|---|---|---|
| display_name | string | yes | Name for the new watchlist (e.g. 'Tech Stocks'). Must be unique among the user's watchlists. |
| icon_emoji | string | no | Emoji shown next to the name (one character). |
| display_description | string | no | Short description shown under the name. |

_No captures — missing probes._

### follow_watchlist

**Safety:** account write · **Status:** missing

Follow a Robinhood-curated list so it appears in the user's watchlists. Confirm with the user before calling. Use only for curated lists; the user already owns their custom lists.

**Parameters (live inputSchema):**

| param | type | required | description |
|---|---|---|---|
| list_id | string | yes | UUID of the Robinhood-curated list to follow. Obtain from get_popular_watchlists. |

_No captures — missing probes._

### get_popular_watchlists

**Safety:** read-only · **Status:** probed

Discover Robinhood-curated lists the user can follow (e.g. '100 Most Popular', 'Daily Movers'). Use to find a list_id, then pass it to follow_watchlist.

**Parameters (live inputSchema):**

_No parameters._

**Response field tree** (union over 1 success capture(s)):

- `data`: object
  - `lists`: array<object>
    - `id`[]: string
    - `display_name`[]: string
    - `item_count`[]: number
    - `is_badged`[]: boolean
- `guide`: string

**Captures:**

- [ro-popwl-01](captures/ro-popwl-01.json) — success — Popular/public watchlists.

**Notes:**

- Popular/public watchlists.

### get_watchlist_items

**Safety:** read-only · **Status:** probed

List the items in a watchlist. Items may be stocks/ETFs, crypto pairs, futures, indexes — distinguished by object_type. For the options watchlist, use get_option_watchlist instead — this tool returns a generic shape that drops the strategy-specific fields and the upstream rejects it with 400 anyway. Does not return live prices; call get_quotes with the symbol(s) for that.

**Parameters (live inputSchema):**

| param | type | required | description |
|---|---|---|---|
| list_id | string | yes | UUID of the watchlist whose items to fetch. Obtain from get_watchlists or get_popular_watchlists. |

**Response field tree** (union over 1 success capture(s)):

- `data`: object
  - `items`: array<object>
    - `object_id`[]: string
    - `object_type`[]: string
    - `symbol`[]: string
  - `has_futures_contracts`: boolean
- `guide`: string

**Errors observed:** 1 capture(s), 1 distinct shape(s)

**Captures:**

- [dep-watchlist-items-01](captures/dep-watchlist-items-01.json) — success — list_id harvested from get_watchlists (list "ETFs", item_count=2).
- [err-watchlist-bad-id](captures/err-watchlist-bad-id.json) — error — Deliberate error: well-formed nonexistent list UUID.

**Notes:**

- list_id harvested from get_watchlists (list "ETFs", item_count=2).
- Deliberate error: well-formed nonexistent list UUID.

### get_watchlists

**Safety:** read-only · **Status:** probed

List the user's watchlists, including both user-created custom lists and Robinhood-curated lists the user follows. Use to look up list_id values for other watchlist tools.

**Parameters (live inputSchema):**

_No parameters._

**Response field tree** (union over 1 success capture(s)):

- `data`: object
  - `watchlists`: array<object>
    - `id`[]: string
    - `display_name`[]: string
    - `icon_emoji`[]: string
    - `owner_type`[]: string
    - `item_count`[]: number
    - `allowed_object_types`[]: array<string>
- `guide`: string

**Captures:**

- [ro-watchlists-01](captures/ro-watchlists-01.json) — success — User watchlists - source of list_id.

**Notes:**

- User watchlists - source of list_id.

### remove_from_watchlist

**Safety:** account write · **Status:** missing

Remove items from a watchlist. Exactly one of symbols (stocks/ETFs), currency_pair_ids (crypto), or index_ids (market indexes) is required — mutually exclusive. For options use remove_option_from_watchlist. Items not on the list are no-ops (not errors). Confirm with the user before calling.

**Parameters (live inputSchema):**

| param | type | required | description |
|---|---|---|---|
| list_id | string | yes | UUID of the watchlist to remove items from. |
| symbols | null \| array | no | Stock symbols to remove (e.g. ['AAPL']). Mutually exclusive with currency_pair_ids and index_ids. |
| currency_pair_ids | null \| array | no | Currency-pair UUIDs to remove. Mutually exclusive with symbols and index_ids. |
| index_ids | null \| array | no | Index UUIDs to remove. Mutually exclusive with symbols and currency_pair_ids. |

_No captures — missing probes._

### remove_option_from_watchlist

**Safety:** account write · **Status:** missing

Remove option contracts from the user's options watchlist. Specify the same position_type used when the contract was added (defaults to "long"). Contracts not on the list are no-ops. Confirm with the user before calling.

**Parameters (live inputSchema):**

| param | type | required | description |
|---|---|---|---|
| option_ids | null \| array | yes | Option contract UUIDs to remove. The position_type must match how each contract was added (most likely "long"). |
| position_type | string | no | "long" (default) or "short". Must match how the contract was originally added. |

_No captures — missing probes._

### unfollow_watchlist

**Safety:** account write · **Status:** missing

Stop following a Robinhood-curated list. The list itself is unchanged — it just no longer appears in the user's watchlists. Confirm with the user before calling.

**Parameters (live inputSchema):**

| param | type | required | description |
|---|---|---|---|
| list_id | string | yes | UUID of the Robinhood-curated list to unfollow. |

_No captures — missing probes._

### update_watchlist

**Safety:** account write · **Status:** missing

Rename a custom watchlist or change its icon/description. Robinhood-curated lists cannot be renamed; the call will fail with 404. Provide at least one of display_name, icon_emoji, display_description.

**Parameters (live inputSchema):**

| param | type | required | description |
|---|---|---|---|
| list_id | string | yes | UUID of the watchlist to update. Obtain from get_watchlists. |
| display_name | string | no | New name for the watchlist. |
| icon_emoji | string | no | New emoji. |
| display_description | string | no | New description. |

_No captures — missing probes._

## Orders

### cancel_equity_order

**Safety:** financial mutation · **Status:** probed

Cancel an open equity order by order_id. Always confirm with the user before calling. Resolve order_id via get_equity_orders if the user refers to it by symbol or description; pass the same account_number. Requires an agentic_allowed=true account; non-agentic accounts are rejected — do not call. Cancellation may be rejected if the order has already filled, was already cancelled, or is otherwise ineligible.

**Parameters (live inputSchema):**

| param | type | required | description |
|---|---|---|---|
| account_number | string | yes | Brokerage account that owns the order. Must come from the user or be clearly implied — never default from get_accounts. Must be agentic_allowed=true. The ups… |
| order_id | string | yes | Order UUID from get_equity_orders. Must live in account_number. |

**Response field tree** (union over 10 success capture(s)):

- `data`: object
  - `accepted`: boolean
- `guide`: string

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

**Safety:** financial mutation · **Status:** missing

Cancel all queued exercise requests for an option position. Pass the same account_number and option_id used for exercise_option. Internally looks up all queued exercise events for that option and cancels each one. Typically there is one; multiple means the user submitted separate exercise batches. Only cancels events in state=queued — events already processing are rejected by the broker. Always confirm with the user before calling.

**Parameters (live inputSchema):**

| param | type | required | description |
|---|---|---|---|
| account_number | string | yes | Brokerage account that owns the exercise. Must be agentic_allowed=true. |
| option_id | string | yes | Option instrument UUID — the same option_id used for exercise_option. The tool looks up the queued exercise for this option and cancels it. |

_No captures — missing probes._

### cancel_option_order

**Safety:** financial mutation · **Status:** unprobed

Cancel an open option order by account_number + order_id. Always confirm with the user before calling. Resolve order_id via get_option_orders if the user refers to it by description; pass the same account_number you used there. Requires an agentic_allowed=true account; non-agentic accounts are rejected. Cancellation may be rejected if the order has already filled, was already cancelled, or is otherwise ineligible.

**Parameters (live inputSchema):**

| param | type | required | description |
|---|---|---|---|
| account_number | string | yes | Brokerage account that owns the order. Must come from the user or be clearly implied — never default from get_accounts. Must be agentic_allowed=true. Mismatc… |
| order_id | string | yes | Order UUID from get_option_orders. Must live in account_number. |

_No captures — probes authored but not yet executed._

**Notes:**

- Cancel the resting opt-place-lim order — set NFLX_OPT_ORDER_ID from its capture.
- Cancel the resting spread order — set NFLX_OPT_ORDER_ID2 from opt-place-spread capture.

### exercise_option

**Safety:** financial mutation · **Status:** missing

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

_No captures — missing probes._

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

**Response field tree** (union over 11 success capture(s)):

- `data`: object
  - `orders`: array<object>
    - `id`[]: string
    - `ref_id`[]: string
    - `instrument_id`[]: string
    - `symbol`[]: string
    - `side`[]: string
    - `type`[]: string
    - `state`[]: string
    - `quantity`[]: string
    - `cumulative_quantity`[]: string
    - `price`[]: null | string
    - `stop_price`[]: null | string
    - `average_price`[]: null | string
    - `fees`[]: string
    - `dollar_based_amount`[]: null | object
      - `amount`: string
      - `currency_code`: string
    - `time_in_force`[]: string
    - `market_hours`[]: string
    - `trigger`[]: string
    - `placed_agent`[]: string
    - `created_at`[]: string
    - `last_transaction_at`[]: string
    - `executions`[]: array<object>
      - `id`[]: string
      - `price`[]: string
      - `quantity`[]: string
      - `timestamp`[]: string
      - `fees`[]: string
- `guide`: string

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

**Response field tree** (union over 13 success capture(s)):

- `data`: object
  - `orders`: array<unknown>
- `guide`: string

**Captures:**

- [dep-opt-orders-13](captures/dep-opt-orders-13.json) — success — order_id param exercised w/ an equity order id (no option orders exist to harvest) - expect not-found/empty.
- [dep-opt-orders-chain](captures/dep-opt-orders-chain.json) — success — chain_ids filter (harvested chain). Account has 0 option orders - expect empty list.
- [opt-orders-confirmed](captures/opt-orders-confirmed.json) — success — Resting option-order inventory — mirrors the equity confirmed-state finding; expected empty.
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

**Response field tree** (union over 17 success capture(s)):

- `data`: object
  - `order`: object
    - `id`: string
    - `ref_id`: string
    - `instrument_id`: string
    - `symbol`: string
    - `side`: string
    - `type`: string
    - `state`: string
    - `quantity`: string
    - `cumulative_quantity`: string
    - `price`: null | string
    - `stop_price`: null | string
    - `average_price`: null
    - `fees`: string
    - `dollar_based_amount`: null | object
      - `amount`: string
      - `currency_code`: string
    - `time_in_force`: string
    - `market_hours`: string
    - `trigger`: string
    - `placed_agent`: string
    - `created_at`: string
    - `last_transaction_at`: string
    - `executions`: array<unknown>
- `guide`: string

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

### place_option_order

**Safety:** financial mutation · **Status:** unprobed

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

_No captures — probes authored but not yet executed._

**Notes:**

- Place single-leg buy limit FAR below market (NFLX_OPT_PRICE_LO ~ half the mark) — rests, harvest id → opt-can-lim. Expect permission reject if option_level stays empty.
- Place 2-leg vertical spread limit far below mid — rests; harvest id → opt-can-spread.

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

**Response field tree** (union over 19 success capture(s)):

- `data`: object
  - `symbol`: string
  - `side`: string
  - `type`: string
  - `quantity`: string
  - `limit_price`: string
  - `order_checks`: object
    - `alertType`: string
    - `equityMaxSellSharesExceededAlertDetails`: object
      - `instrumentId`: string
      - `instrumentSymbol`: string
      - `sharesCanSell`: string
      - `sharesOptionsCollateral`: string
      - `sharesOwned`: string
      - `sharesPendingFromOptionsEvents`: string
      - `sharesPendingSell`: string
      - `sharesRewards`: string
    - `equityAllDayTradingAlertDetails`: object
      - `reason`: string
  - `quote_data`: object
    - `symbol`: string
    - `last_trade_price`: string
    - `venue_last_trade_time`: string
    - `last_non_reg_trade_price`: null | string
    - `venue_last_non_reg_trade_time`: null | string
    - `adjusted_previous_close`: string
    - `previous_close`: string
    - `previous_close_date`: string
    - `bid_price`: string
    - `venue_bid_time`: string
    - `ask_price`: string
    - `venue_ask_time`: string
    - `has_traded`: boolean
    - `state`: string
  - `market_data_disclosure`: string
  - `dollar_amount`: string
  - `stop_price`: string
- `guide`: string

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

**Response field tree** (union over 21 success capture(s)):

- `data`: object
  - `account_number`: string
  - `type`: string
  - `direction`: string
  - `quantity`: string
  - `legs`: array<object>
    - `option_id`[]: string
    - `side`[]: string
    - `position_effect`[]: string
    - `ratio_quantity`[]: number
  - `order_checks`: object
    - `alertType`: string
    - `details`: object
      - `isSingleLeg`: boolean
      - `spread`: object
        - `amount`: string
        - `currency`: string
      - `direction`: string
      - `askPrice`: object
        - `amount`: string
        - `currency`: string
      - `bidPrice`: object
        - `amount`: string
        - `currency`: string
      - `orderTime`: string
      - `stopPrice`: object
        - `amount`: string
        - `currency`: string
      - `instruments`: array<object>
        - `symbol`[]: string
        - `strikePrice`[]: string
        - `type`[]: string
        - `expirationDate`[]: string
        - `underlyingType`[]: string
      - `orderQuantity`: string
      - `underlyingSymbols`: array<string>
      - `underlyingType`: string
  - `option_quotes`: array<object>
    - `instrument_id`[]: string
    - `ask_price`[]: string
    - `ask_size`[]: number
    - `bid_price`[]: string
    - `bid_size`[]: number
    - `break_even_price`[]: string
    - `adjusted_mark_price`[]: string
    - `mark_price`[]: string
    - `high_fill_rate_buy_price`[]: string
    - `low_fill_rate_buy_price`[]: string
    - `high_fill_rate_sell_price`[]: string
    - `low_fill_rate_sell_price`[]: string
    - `previous_close_price`[]: string
    - `previous_close_date`[]: string
    - `implied_volatility`[]: null | string
    - `delta`[]: null | string
    - `gamma`[]: null | string
    - `rho`[]: null | string
    - `theta`[]: null | string
    - `vega`[]: null | string
    - `open_interest`[]: number
    - `volume`[]: number
    - `chance_of_profit_long`[]: null | string
    - `chance_of_profit_short`[]: null | string
    - `updated_at`[]: string
  - `price`: string
  - `fees`: object
    - `occ_fee`: object
      - `fee_rate`: string
      - `fee`: string
    - `or_fee`: object
      - `fee_rate`: string
      - `fee`: string
    - `contract_fee`: object
      - `fee_rate`: string
      - `fee`: string
    - `exchange_fee`: object
      - `fee_rate`: string
      - `fee`: string
    - `cat_fee`: object
      - `fee_rate`: string
      - `fee`: string
    - `gold_fee_savings`: object
      - `fee_saving_rate`: string
      - `fee_total_savings`: string
    - `sales_taxes`: array<unknown>
    - `is_gold`: boolean
    - `total_fee`: string
  - `collateral`: object
    - `account_number`: string
    - `cash`: object
      - `amount`: string
      - `direction`: string
      - `infinite`: boolean
    - `equities`: array<unknown>
  - `time_in_force`: string
  - `market_hours`: string
  - `stop_price`: string
- `guide`: string

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
- [opt-rev-mkt-gtc](captures/opt-rev-mkt-gtc.json) — success — Constraint probe: market + gtc — schema says market must be gfd; captures the reject text.
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


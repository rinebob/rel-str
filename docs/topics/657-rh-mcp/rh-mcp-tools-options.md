# Robinhood MCP — Options

> Part of the [canonical tool discovery](rh-mcp-tool-discovery-canonical-657-658-689.md) — 7 tools in this group.

### get_option_chains

**Safety:** read-only · **Status:** probed

List option chains for one or more underlyings. A chain describes the full set of expiration dates and contracts for a given underlying. One of underlying_symbol or ids is required.

**Parameters (live inputSchema):**

| param | type | required | description |
|---|---|---|---|
| ids | string | no | Comma-separated chain UUIDs. |
| underlying_symbol | string | no | Ticker filter; covers equity and index underlyings (e.g. 'AAPL', 'SPX'). |

**Response shape** (union over 5 success capture(s)):

```
data: object
data.chains: array<object>
data.chains[].id: string
data.chains[].symbol: string
data.chains[].can_open_position: boolean
data.chains[].cash_component: null
data.chains[].expiration_dates: array<string>
data.chains[].trade_value_multiplier: string
data.chains[].underlying_instruments: array<object>
data.chains[].underlying_instruments[].instrument: string
data.chains[].underlying_instruments[].symbol: string
data.chains[].min_ticks: object
data.chains[].min_ticks.above_tick: string
data.chains[].min_ticks.below_tick: string
data.chains[].min_ticks.cutoff_price: string
data.chains[].late_close_state: string
data.chains[].extended_hours_state: string
data.chains[].settle_on_open: boolean
data.chains[].sellout_time_to_expiration: number
guide: string
```

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

**Response shape** (union over 3 success capture(s)):

```
data: object
data.results: array<object>
data.results[].instrument_id: string
data.results[].occ_symbol: string
data.results[].symbol: string
data.results[].interval: string
data.results[].bounds: string
data.results[].bars: array<object>
data.results[].bars[].begins_at: string
data.results[].bars[].open_price: string
data.results[].bars[].high_price: string
data.results[].bars[].low_price: string
data.results[].bars[].close_price: string
data.results[].bars[].session: string
data.results[].bars[].interpolated: boolean
guide: string
```

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

**Response shape** (union over 12 success capture(s)):

```
data: object
data.instruments: array<object>
data.instruments[].id: string
data.instruments[].chain_id: string
data.instruments[].chain_symbol: string
data.instruments[].underlying_type: string
data.instruments[].expiration_date: string
data.instruments[].sellout_datetime: string
data.instruments[].strike_price: string
data.instruments[].type: string
data.instruments[].state: string
data.instruments[].tradability: string
data.instruments[].trade_value_multiplier: string
data.instruments[].min_ticks: object
data.instruments[].min_ticks.above_tick: string
data.instruments[].min_ticks.below_tick: string
data.instruments[].min_ticks.cutoff_price: string
data.next: string
guide: string
```

**Errors observed:** 1 capture(s), 1 distinct shape(s)

**Captures:**

- [dep-opt-instr-06](captures/dep-opt-instr-06.json) — success — chain_id path (harvested from get_option_chains).
- [dep-opt-instr-07](captures/dep-opt-instr-07.json) — success — ids CSV lookup path.
- [dep-opt-instr-08](captures/dep-opt-instr-08.json) — success — strike_price filter (last unexercised param).
- [dep-opt-instr-09](captures/dep-opt-instr-09.json) — success — state=inactive (last unprobed enum on this tool).
- [dep-opt-instr-10](captures/dep-opt-instr-10.json) — success — SPXW index-option instruments - source of index option_id for curb-hours review (chain extended_hours_state=enabled).
- [dep-opt-instr-cur-01](captures/dep-opt-instr-cur-01.json) — success — PAGINATION FOLLOW: cursor harvested from ro-opt-instr-01 data.next.
- [opt-instr-harvest](captures/opt-instr-harvest.json) — success — Harvest leg instruments — set NFLX_CHAIN_ID + NFLX_EXP from opt-chains-nflx; pick ~ATM call (NFLX_OPT_ID) + one strike up (NFLX_OPT_ID2).
- [opt-instr-puts](captures/opt-instr-puts.json) — success — Put-side harvest (first pass was calls-only) — pick a far-OTM put for the CSP leg.
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
- Put-side harvest (first pass was calls-only) — pick a far-OTM put for the CSP leg.

### get_option_level_upgrade_info

**Safety:** read-only · **Status:** probed

Get the upgrade URL to apply for — or raise — options access on an account. The returned link routes the customer into the correct application for their target tier, including upgrading an existing option_level_2 account to option_level_3. Call when the user requests an options level their account doesn't yet have: option_level_2 enables long calls/puts, covered calls, and cash-secured puts; option_level_3 adds spreads and other multi-leg/complex strategies. option_level_3 additionally requires a margin or limited-margin account. If the account type is cash, do NOT call this tool for an L3 request — the customer must first switch to a margin/limited-margin account via get_limited_margin_upgrade_info, then re-fetch get_accounts; call this tool for L3 only once the account type is margin or limited margin. option_level_2 has no account-type requirement and is available on cash accounts. Map the user's requested strategy to its required level and call this tool if the account is below it — null/empty/option_level_0 for any options, or option_level_2 for an L3-only strategy such as a spread. Do NOT call when the account already has the required level or higher.

**Parameters (live inputSchema):**

| param | type | required | description |
|---|---|---|---|
| account_number | string | yes | Brokerage account number to generate the upgrade URL for. Obtain from get_accounts. |

**Response shape** (union over 2 success capture(s)):

```
data: object
data.upgrade_url: string
data.account_number: string
guide: string
```

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

**Response shape** (union over 13 success capture(s)):

```
data: object
data.positions: array<object>
data.positions[].option_id: string
data.positions[].chain_id: string
data.positions[].chain_symbol: string
data.positions[].type: string
data.positions[].quantity: string
data.positions[].average_price: string
data.positions[].expiration_date: string
data.positions[].trade_value_multiplier: string
data.positions[].intraday_average_open_price: string
data.positions[].intraday_quantity: string
data.positions[].pending_buy_quantity: string
data.positions[].pending_sell_quantity: string
data.positions[].pending_exercise_quantity: string
data.positions[].pending_assignment_quantity: string
data.positions[].pending_expiration_quantity: string
data.positions[].opened_at: string
guide: string
```

**Captures:**

- [dep-opt-pos-chain](captures/dep-opt-pos-chain.json) — success — chain_ids filter on positions.
- [dep-opt-pos-ids](captures/dep-opt-pos-ids.json) — success — option_ids CSV filter on positions.
- [opt-pos-flat](captures/opt-pos-flat.json) — success — Verify option position ended flat (task AC).
- [opt-pos-open](captures/opt-pos-open.json) — success — Verify the long 70C position exists before sell legs.
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
- Verify the long 70C position exists before sell legs.
- Verify option position ended flat (task AC).

### get_option_quotes

**Safety:** read-only · **Status:** probed

Get real-time quotes for one or more option contracts by instrument UUID, plus the official prior-session close for each.

**Parameters (live inputSchema):**

| param | type | required | description |
|---|---|---|---|
| instrument_ids | null \| array | yes | Option instrument UUIDs. Above 20, quotes still return but closes is omitted with closes_error set. |

**Response shape** (union over 4 success capture(s)):

```
data: object
data.results: array<object>
data.results[].quote: object
data.results[].quote.instrument_id: string
data.results[].quote.ask_price: string
data.results[].quote.ask_size: number
data.results[].quote.bid_price: string
data.results[].quote.bid_size: number
data.results[].quote.break_even_price: string
data.results[].quote.adjusted_mark_price: string
data.results[].quote.mark_price: string
data.results[].quote.high_fill_rate_buy_price: string
data.results[].quote.low_fill_rate_buy_price: string
data.results[].quote.high_fill_rate_sell_price: string
data.results[].quote.low_fill_rate_sell_price: string
data.results[].quote.previous_close_price: string
data.results[].quote.previous_close_date: string
data.results[].quote.implied_volatility: null | string
data.results[].quote.delta: null | string
data.results[].quote.gamma: null | string
data.results[].quote.rho: null | string
data.results[].quote.theta: null | string
data.results[].quote.vega: null | string
data.results[].quote.open_interest: number
data.results[].quote.volume: number
data.results[].quote.chance_of_profit_long: null | string
data.results[].quote.chance_of_profit_short: null | string
data.results[].quote.updated_at: string
data.results[].close: object
data.results[].close.instrument_id: string
data.results[].close.symbol: string
data.results[].close.date: string
data.results[].close.price: string
data.results[].close.interpolated: boolean
data.results[].close.source: string
data.closes_error: string
guide: string
```

**Captures:**

- [dep-opt-quotes-01](captures/dep-opt-quotes-01.json) — success — instrument_ids harvested from get_option_instruments (NFLX Nov-20 $2.5 call + Oct-16 $2.5 put).
- [err-optq-bad-id](captures/err-optq-bad-id.json) — success — Deliberate error: malformed option instrument id.
- [opt-optq](captures/opt-optq.json) — success — Leg quotes — harvest mark for a below-market limit price (NFLX_OPT_PRICE).
- [opt-quote-fill](captures/opt-quote-fill.json) — success — Fresh 70C mark/ask immediately before the fill-priced buy — sets NFLX_OPT_ASK/HI/STOP.

**Notes:**

- instrument_ids harvested from get_option_instruments (NFLX Nov-20 $2.5 call + Oct-16 $2.5 put).
- Leg quotes — harvest mark for a below-market limit price (NFLX_OPT_PRICE).
- Fresh 70C mark/ask immediately before the fill-priced buy — sets NFLX_OPT_ASK/HI/STOP.
- Deliberate error: malformed option instrument id.

### get_option_watchlist

**Safety:** read-only · **Status:** probed

List the single-leg option contracts on the user's options watchlist. Use this instead of get_watchlist_items for the options watchlist — get_watchlist_items returns a generic shape that drops the option-specific title and the upstream rejects it with 400 anyway. Works for both equity options (AAPL, NVDA) and index options (SPX, NDX, RUT). Multi-leg strategies (verticals, condors, etc.) that may exist in the user's watchlist from app-side order placement are not shown — direct the user to the Robinhood app to view those.

**Parameters (live inputSchema):**

_No parameters._

**Response shape** (union over 1 success capture(s)):

```
data: object
data.items: array<unknown>
data.list_id: string
guide: string
```

**Captures:**

- [ro-optwl-01](captures/ro-optwl-01.json) — success — Zero-param option watchlist.

**Notes:**

- Zero-param option watchlist.


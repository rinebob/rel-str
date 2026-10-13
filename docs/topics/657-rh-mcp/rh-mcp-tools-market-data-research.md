# Robinhood MCP — Market Data & Research

> Part of the [canonical tool discovery](rh-mcp-tool-discovery-canonical-657-658-689.md) — 15 tools in this group.

### get_earnings_calendar

**Safety:** read-only · **Status:** probed

List earnings reports scheduled across the market over a date window (up to 31 days), optionally limited to high-market-cap names. Returns one entry per report event — estimated/actual EPS, report date and timing (am/pm), and company-verification status. Use this for market-wide discovery ("what large-caps report this week?"). For a specific known ticker, use get_earnings_results instead. Read-only.

**Parameters (live inputSchema):**

| param | type | required | description |
|---|---|---|---|
| start_date | string | no | Window anchor, YYYY-MM-DD. Defaults to today (US/Eastern) when omitted. |
| days | integer | no | Window length in days, measured from start_date. Defaults to 7. Positive = forward window (e.g. 7 = the next 7 days, inclusive of start_date); negative = loo… |
| filter | string | no | Optional result filter. Set to 'high_market_cap' to limit the calendar to high-market-cap names (market cap over $1B) — useful for 'what large-caps report th… |

**Response shape** (union over 3 success capture(s)):

```
data: object
data.results: array<object>
data.results[].symbol: string
data.results[].year: number
data.results[].quarter: number
data.results[].eps: object
data.results[].eps.estimate: null | string
data.results[].eps.actual: null | string
data.results[].report: object
data.results[].report.date: string
data.results[].report.timing: null | string
data.results[].report.verified: boolean
guide: string
```

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

**Response shape** (union over 1 success capture(s)):

```
data: object
data.results: array<object>
data.results[].symbol: string
data.results[].year: number
data.results[].quarter: number
data.results[].eps: object
data.results[].eps.estimate: string
data.results[].eps.actual: null | string
data.results[].report: object
data.results[].report.date: string
data.results[].report.timing: string
data.results[].report.verified: boolean
guide: string
```

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

**Response shape** (union over 1 success capture(s)):

```
data: object
data.results: array<object>
data.results[].symbol: string
data.results[].ratings: object
data.results[].ratings.num_buy_ratings: number
data.results[].ratings.num_hold_ratings: number
data.results[].ratings.num_sell_ratings: number
data.results[].ratings.high_price_target: string
data.results[].ratings.low_price_target: string
data.results[].ratings.mean_price_target: string
data.results[].ratings.updated_at: string
guide: string
```

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

**Response shape** (union over 4 success capture(s)):

```
data: object
data.results: array<object>
data.results[].symbol: string
data.results[].open: string
data.results[].high: string
data.results[].low: string
data.results[].volume: string
data.results[].overnight_volume: string
data.results[].bounds: string
data.results[].market_date: string
data.results[].average_volume_2_weeks: string
data.results[].average_volume: string
data.results[].average_volume_30_days: string
data.results[].high_52_weeks: string
data.results[].high_52_weeks_date: string
data.results[].low_52_weeks: string
data.results[].low_52_weeks_date: string
data.results[].float: string
data.results[].market_cap: string
data.results[].pb_ratio: string
data.results[].pe_ratio: string
data.results[].shares_outstanding: string
data.results[].dividend_yield: null
data.results[].dividend_per_share: null
data.results[].distribution_frequency: null
data.results[].payable_date: null
data.results[].ex_dividend_date: null
data.results[].record_date: null
data.results[].thirty_day_sec_yield: null
data.results[].description: string
data.results[].ceo: string
data.results[].headquarters_city: string
data.results[].headquarters_state: string
data.results[].sector: string
data.results[].industry: string
data.results[].num_employees: number
data.results[].year_founded: number
data.results[].financial_status_indicator: string
data.results[].financial_status_description: string
guide: string
```

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

**Response shape** (union over 11 success capture(s)):

```
data: object
data.results: array<object>
data.results[].symbol: string
data.results[].interval: string
data.results[].bounds: string
data.results[].bars: array<object>
data.results[].bars[].begins_at: string
data.results[].bars[].open_price: string
data.results[].bars[].close_price: string
data.results[].bars[].high_price: string
data.results[].bars[].low_price: string
data.results[].bars[].volume: number
data.results[].bars[].session: string
data.results[].bars[].interpolated: boolean
guide: string
```

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

**Response shape** (union over 1 success capture(s)):

```
data: object
data.books: array<object>
data.books[].symbol: string
data.books[].updated_at: string
data.books[].asks: array<object>
data.books[].asks[].price: string
data.books[].asks[].quantity: number
data.books[].bids: array<object>
data.books[].bids[].price: string
data.books[].bids[].quantity: number
guide: string
```

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

**Response shape** (union over 4 success capture(s)):

```
data: object
data.results: array<object>
data.results[].quote: object
data.results[].quote.symbol: string
data.results[].quote.last_trade_price: string
data.results[].quote.venue_last_trade_time: string
data.results[].quote.last_non_reg_trade_price: null
data.results[].quote.venue_last_non_reg_trade_time: null
data.results[].quote.adjusted_previous_close: string
data.results[].quote.previous_close: string
data.results[].quote.previous_close_date: string
data.results[].quote.bid_price: string
data.results[].quote.venue_bid_time: string
data.results[].quote.ask_price: string
data.results[].quote.venue_ask_time: string
data.results[].quote.has_traded: boolean
data.results[].quote.state: string
data.results[].close: object
data.results[].close.symbol: string
data.results[].close.date: string
data.results[].close.price: string
data.results[].close.interpolated: boolean
data.results[].close.source: string
data.closes_error: string
guide: string
```

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

Compute a technical indicator (RSI, MACD, Bollinger Bands, moving averages, ATR, VWAP, and more) over the OHLCV bars of up to 10 equity symbols across a time range. For the raw OHLCV bars themselves, use get_equity_historicals.

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
- If the requested range plus the indicator's warm-up exceeds the per-symbol bar cap, narrow the range or coarsen the interval.
- When screening several symbols, prefer output 'latest' or 'last:N' over the full series.

**Parameters (live inputSchema):**

| param | type | required | description |
|---|---|---|---|
| symbols | null \| array | no | Stock symbols (uppercase), max 10 per call. Pass every symbol you need in one call rather than one call per symbol; with more than 10, split across calls of … |
| symbol | string | no | Deprecated: use symbols. A single stock symbol; pass either symbols or symbol, not both. |
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

**Response shape** (union over 20 success capture(s)):

```
data: object
data.symbol: string
data.interval: string
data.bounds: string
data.indicators: array<object>
data.indicators[].type: string
data.indicators[].params: object
data.indicators[].params.period: number
data.indicators[].params.num_std: number
data.indicators[].params.fast_period: number
data.indicators[].params.signal_period: number
data.indicators[].params.slow_period: number
data.indicators[].params.multiplier: number
data.indicators[].series: array<object>
data.indicators[].series[].begins_at: string
data.indicators[].series[].value: number
data.indicators[].series[].lower: number
data.indicators[].series[].middle: number
data.indicators[].series[].upper: number
data.indicators[].series[].histogram: number
data.indicators[].series[].macd: number
data.indicators[].series[].signal: number
data.indicators[].series[].direction: number
data.indicators[].series[].pivot: number
data.indicators[].series[].r1: number
data.indicators[].series[].r2: number
data.indicators[].series[].r3: number
data.indicators[].series[].s1: number
data.indicators[].series[].s2: number
data.indicators[].series[].s3: number
guide: string
```

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

**Response shape** (union over 1 success capture(s)):

```
data: object
data.results: array<object>
data.results[].symbol: string
data.results[].name: string
data.results[].simple_name: string
data.results[].state: string
data.results[].country: string
data.results[].tradeable: boolean
data.results[].fractional_tradability: string
data.results[].extended_hours_fractional_tradability: boolean
data.results[].all_day_tradability: string
data.results[].short_selling_tradability: string
data.results[].account_type_tradabilities: array<object>
data.results[].account_type_tradabilities[].account_type: string
data.results[].account_type_tradabilities[].account_type_tradability: string
guide: string
```

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

**Response shape** (union over 2 success capture(s)):

```
data: object
data.results: array<object>
data.results[].symbol: string
data.results[].period: string
data.results[].financials: array<object>
data.results[].financials[].fiscal_year: number
data.results[].financials[].fiscal_quarter: null | number
data.results[].financials[].period_end_date: string
data.results[].financials[].revenue: string
data.results[].financials[].gross_profit: string
data.results[].financials[].net_income: string
data.results[].financials[].net_margin: string
guide: string
```

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

**Response shape** (union over 2 success capture(s)):

```
data: object
data.results: array<object>
data.results[].instrument_id: string
data.results[].symbol: string
data.results[].interval: string
data.results[].bars: array<object>
data.results[].bars[].begins_at: string
data.results[].bars[].open_value: string
data.results[].bars[].high_value: string
data.results[].bars[].low_value: string
data.results[].bars[].close_value: string
data.results[].bars[].interpolated: boolean
guide: string
```

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

**Response shape** (union over 1 success capture(s)):

```
data: object
data.quotes: array<object>
data.quotes[].instrument_id: string
data.quotes[].symbol: string
data.quotes[].value: string
data.quotes[].state: string
data.quotes[].venue_timestamp: string
data.quotes[].updated_at: string
guide: string
```

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

**Response shape** (union over 2 success capture(s)):

```
data: object
data.indexes: array<object>
data.indexes[].id: string
data.indexes[].symbol: string
data.indexes[].name: string
data.indexes[].current_value: string
data.indexes[].trade_halted: boolean
data.indexes[].updated_at: string
guide: string
```

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

**Response shape** (union over 3 success capture(s)):

```
data: object
data.trades: array<object>
data.trades[].politician_name: string
data.trades[].party: string
data.trades[].position: string
data.trades[].asset_type: string
data.trades[].symbol: string
data.trades[].transaction_type: string
data.trades[].amount_range: object
data.trades[].amount_range.min: string
data.trades[].amount_range.max: string
data.trades[].transaction_date: string
data.trades[].disclosure_date: string
data.trades[].source: string
data.has_more: boolean
guide: string
```

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

**Response shape** (union over 4 success capture(s)):

```
data: object
data.results: array<object>
data.results[].instrument_id: string
data.results[].symbol: string
data.results[].name: string
data.results[].simple_name: string
data.currency_pairs: array<object>
data.currency_pairs[].id: string
data.currency_pairs[].symbol: string
data.currency_pairs[].name: string
data.market_indexes: array<object>
data.market_indexes[].id: string
data.market_indexes[].symbol: string
data.market_indexes[].name: string
data.market_indexes[].description: string
guide: string
```

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


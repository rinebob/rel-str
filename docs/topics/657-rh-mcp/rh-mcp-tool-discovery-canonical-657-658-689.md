# Robinhood MCP — Canonical Tool Discovery

> **Canonical** — assembled (2026-10-11T21:29:07.268Z) from `probe-manifest.json` × `captures/` × live `tools/list`, hand-finished under #689: universal envelope, per-tool safety classification, gap callouts, allowlist mapping. Per-tool details live in the `rh-mcp-tools-*.md` category docs linked below. Regenerate via `functions/src/rh-agent-mcp/diagnostics/run-assemble-discovery-doc.ts`, then re-apply the sections marked *(#689)*.

## Contents

- [Account & Performance](rh-mcp-tools-account-performance.md) — 7 tools
- [Market Data & Research](rh-mcp-tools-market-data-research.md) — 15 tools
- [Options](rh-mcp-tools-options.md) — 7 tools
- [Crypto](rh-mcp-tools-crypto.md) — 8 tools
- [Alerts](rh-mcp-tools-alerts.md) — 6 tools
- [SEC Filings](rh-mcp-tools-sec-filings.md) — 4 tools
- [Scanners](rh-mcp-tools-scanners.md) — 8 tools
- [Watchlists](rh-mcp-tools-watchlists.md) — 11 tools
- [Orders](rh-mcp-tools-orders.md) — 10 tools

## Coverage matrix

**Account & Performance** — 7 tools · [doc](rh-mcp-tools-account-performance.md)

| tool | params (req/total) | probes | outcomes | status |
|---|---|---|---|---|
| [get_accounts](rh-mcp-tools-account-performance.md#get_accounts) | 0/0 | 1 | 1 success | probed |
| [get_equity_positions](rh-mcp-tools-account-performance.md#get_equity_positions) | 1/2 | 4 | 3 success, 1 error | probed |
| [get_equity_tax_lots](rh-mcp-tools-account-performance.md#get_equity_tax_lots) | 2/3 | 3 | 3 success | probed |
| [get_limited_margin_upgrade_info](rh-mcp-tools-account-performance.md#get_limited_margin_upgrade_info) | 1/1 | 1 | 1 success | probed |
| [get_pnl_trade_history](rh-mcp-tools-account-performance.md#get_pnl_trade_history) | 1/4 | 7 | 7 success | probed |
| [get_portfolio](rh-mcp-tools-account-performance.md#get_portfolio) | 1/1 | 1 | 1 success | probed |
| [get_realized_pnl](rh-mcp-tools-account-performance.md#get_realized_pnl) | 1/7 | 11 | 10 success, 1 error | probed |

**Market Data & Research** — 15 tools · [doc](rh-mcp-tools-market-data-research.md)

| tool | params (req/total) | probes | outcomes | status |
|---|---|---|---|---|
| [get_earnings_calendar](rh-mcp-tools-market-data-research.md#get_earnings_calendar) | 0/3 | 3 | 3 success | probed |
| [get_earnings_results](rh-mcp-tools-market-data-research.md#get_earnings_results) | 1/1 | 1 | 1 success | probed |
| [get_equity_analyst_ratings](rh-mcp-tools-market-data-research.md#get_equity_analyst_ratings) | 1/1 | 1 | 1 success | probed |
| [get_equity_fundamentals](rh-mcp-tools-market-data-research.md#get_equity_fundamentals) | 1/2 | 4 | 4 success | probed |
| [get_equity_historicals](rh-mcp-tools-market-data-research.md#get_equity_historicals) | 2/6 | 13 | 11 success, 2 error | probed |
| [get_equity_price_book](rh-mcp-tools-market-data-research.md#get_equity_price_book) | 1/1 | 1 | 1 success | probed |
| [get_equity_quotes](rh-mcp-tools-market-data-research.md#get_equity_quotes) | 1/1 | 5 | 4 success, 3 error | probed |
| [get_equity_technical_indicators](rh-mcp-tools-market-data-research.md#get_equity_technical_indicators) | 3/16 | 20 | 20 success | probed |
| [get_equity_tradability](rh-mcp-tools-market-data-research.md#get_equity_tradability) | 2/2 | 1 | 1 success | probed |
| [get_financials](rh-mcp-tools-market-data-research.md#get_financials) | 1/3 | 2 | 2 success | probed |
| [get_index_historicals](rh-mcp-tools-market-data-research.md#get_index_historicals) | 3/4 | 3 | 2 success, 1 error | probed |
| [get_index_quotes](rh-mcp-tools-market-data-research.md#get_index_quotes) | 1/1 | 1 | 1 success | probed |
| [get_indexes](rh-mcp-tools-market-data-research.md#get_indexes) | 0/1 | 2 | 2 success | probed |
| [get_politician_trades](rh-mcp-tools-market-data-research.md#get_politician_trades) | 0/2 | 3 | 3 success | probed |
| [search](rh-mcp-tools-market-data-research.md#search) | 1/3 | 6 | 4 success, 2 error | probed |

**Options** — 7 tools · [doc](rh-mcp-tools-options.md)

| tool | params (req/total) | probes | outcomes | status |
|---|---|---|---|---|
| [get_option_chains](rh-mcp-tools-options.md#get_option_chains) | 0/2 | 5 | 5 success | probed |
| [get_option_historicals](rh-mcp-tools-options.md#get_option_historicals) | 2/5 | 3 | 3 success | probed |
| [get_option_instruments](rh-mcp-tools-options.md#get_option_instruments) | 0/9 | 13 | 12 success, 1 error | probed |
| [get_option_level_upgrade_info](rh-mcp-tools-options.md#get_option_level_upgrade_info) | 1/1 | 2 | 2 success | probed |
| [get_option_positions](rh-mcp-tools-options.md#get_option_positions) | 1/10 | 13 | 13 success | probed |
| [get_option_quotes](rh-mcp-tools-options.md#get_option_quotes) | 1/1 | 4 | 4 success | probed |
| [get_option_watchlist](rh-mcp-tools-options.md#get_option_watchlist) | 0/0 | 1 | 1 success | probed |

**Crypto** — 8 tools · [doc](rh-mcp-tools-crypto.md)

| tool | params (req/total) | probes | outcomes | status |
|---|---|---|---|---|
| [cancel_crypto_order](rh-mcp-tools-crypto.md#cancel_crypto_order) | 2/2 | 1 | 1 error | error-only |
| [get_crypto_account_onboarding_info](rh-mcp-tools-crypto.md#get_crypto_account_onboarding_info) | 0/0 | 1 | 1 success | probed |
| [get_crypto_orders](rh-mcp-tools-crypto.md#get_crypto_orders) | 1/9 | 13 | 13 error | error-only |
| [get_crypto_positions](rh-mcp-tools-crypto.md#get_crypto_positions) | 1/2 | 1 | 1 success | probed |
| [get_crypto_quotes](rh-mcp-tools-crypto.md#get_crypto_quotes) | 1/3 | 4 | 4 success | probed |
| [get_currency_pairs](rh-mcp-tools-crypto.md#get_currency_pairs) | 0/2 | 4 | 4 success | probed |
| [place_crypto_order](rh-mcp-tools-crypto.md#place_crypto_order) | 4/11 | 1 | 1 error | error-only |
| [preview_crypto_order](rh-mcp-tools-crypto.md#preview_crypto_order) | 4/10 | 6 | 6 error | error-only |

**Alerts** — 6 tools · [doc](rh-mcp-tools-alerts.md)

| tool | params (req/total) | probes | outcomes | status |
|---|---|---|---|---|
| [create_alert](rh-mcp-tools-alerts.md#create_alert) | 2/5 | 1 | 1 success | probed |
| [delete_alert](rh-mcp-tools-alerts.md#delete_alert) | 1/2 | 1 | 1 success | probed |
| [get_alert_log](rh-mcp-tools-alerts.md#get_alert_log) | 0/4 | 4 | 4 success | probed |
| [get_alerts](rh-mcp-tools-alerts.md#get_alerts) | 0/3 | 5 | 4 success, 1 error | probed |
| [mark_alerts_read](rh-mcp-tools-alerts.md#mark_alerts_read) | 0/2 | 1 | 1 success | probed |
| [update_alert](rh-mcp-tools-alerts.md#update_alert) | 1/5 | 1 | 1 success | probed |

**SEC Filings** — 4 tools · [doc](rh-mcp-tools-sec-filings.md)

| tool | params (req/total) | probes | outcomes | status |
|---|---|---|---|---|
| [get_sec_filing](rh-mcp-tools-sec-filings.md#get_sec_filing) | 1/2 | 3 | 2 success, 1 error | probed |
| [get_sec_filing_facts](rh-mcp-tools-sec-filings.md#get_sec_filing_facts) | 2/2 | 1 | 1 success | probed |
| [get_sec_filing_facts_catalog](rh-mcp-tools-sec-filings.md#get_sec_filing_facts_catalog) | 1/4 | 5 | 5 success | probed |
| [get_sec_filing_index](rh-mcp-tools-sec-filings.md#get_sec_filing_index) | 1/5 | 5 | 5 success | probed |

**Scanners** — 8 tools · [doc](rh-mcp-tools-scanners.md)

| tool | params (req/total) | probes | outcomes | status |
|---|---|---|---|---|
| [create_scan](rh-mcp-tools-scanners.md#create_scan) | 0/5 | 1 | 1 success | probed |
| [get_scanner_datapoints](rh-mcp-tools-scanners.md#get_scanner_datapoints) | 1/1 | 9 | 9 success | probed |
| [get_scanner_filter_specs](rh-mcp-tools-scanners.md#get_scanner_filter_specs) | 0/0 | 1 | 1 success | probed |
| [get_scans](rh-mcp-tools-scanners.md#get_scans) | 0/0 | 1 | 1 success | probed |
| [preview_scan](rh-mcp-tools-scanners.md#preview_scan) | 1/2 | 7 | 5 success, 2 error | probed |
| [run_scan](rh-mcp-tools-scanners.md#run_scan) | 1/1 | 1 | 1 error | error-only |
| [update_scan_config](rh-mcp-tools-scanners.md#update_scan_config) | 1/4 | 1 | 1 success | probed |
| [update_scan_filters](rh-mcp-tools-scanners.md#update_scan_filters) | 2/2 | 1 | 1 success | probed |

**Watchlists** — 11 tools · [doc](rh-mcp-tools-watchlists.md)

| tool | params (req/total) | probes | outcomes | status |
|---|---|---|---|---|
| [add_option_to_watchlist](rh-mcp-tools-watchlists.md#add_option_to_watchlist) | 1/2 | 1 | 1 success | probed |
| [add_to_watchlist](rh-mcp-tools-watchlists.md#add_to_watchlist) | 1/4 | 1 | 1 success | probed |
| [create_watchlist](rh-mcp-tools-watchlists.md#create_watchlist) | 1/3 | 1 | 1 success | probed |
| [follow_watchlist](rh-mcp-tools-watchlists.md#follow_watchlist) | 1/1 | 1 | 1 success | probed |
| [get_popular_watchlists](rh-mcp-tools-watchlists.md#get_popular_watchlists) | 0/0 | 1 | 1 success | probed |
| [get_watchlist_items](rh-mcp-tools-watchlists.md#get_watchlist_items) | 1/1 | 2 | 1 success, 1 error | probed |
| [get_watchlists](rh-mcp-tools-watchlists.md#get_watchlists) | 0/0 | 1 | 1 success | probed |
| [remove_from_watchlist](rh-mcp-tools-watchlists.md#remove_from_watchlist) | 1/4 | 1 | 1 success | probed |
| [remove_option_from_watchlist](rh-mcp-tools-watchlists.md#remove_option_from_watchlist) | 1/2 | 1 | 1 success | probed |
| [unfollow_watchlist](rh-mcp-tools-watchlists.md#unfollow_watchlist) | 1/1 | 1 | 1 success | probed |
| [update_watchlist](rh-mcp-tools-watchlists.md#update_watchlist) | 1/4 | 1 | 1 success | probed |

**Orders** — 10 tools · [doc](rh-mcp-tools-orders.md)

| tool | params (req/total) | probes | outcomes | status |
|---|---|---|---|---|
| [cancel_equity_order](rh-mcp-tools-orders.md#cancel_equity_order) | 2/2 | 13 | 10 success, 3 error | probed |
| [cancel_option_exercise](rh-mcp-tools-orders.md#cancel_option_exercise) | 2/2 | 1 | 1 error | error-only |
| [cancel_option_order](rh-mcp-tools-orders.md#cancel_option_order) | 2/2 | 7 | 4 success | probed |
| [exercise_option](rh-mcp-tools-orders.md#exercise_option) | 3/6 | 1 | 1 error | error-only |
| [get_equity_orders](rh-mcp-tools-orders.md#get_equity_orders) | 1/7 | 11 | 11 success | probed |
| [get_option_orders](rh-mcp-tools-orders.md#get_option_orders) | 1/8 | 14 | 14 success | probed |
| [place_equity_order](rh-mcp-tools-orders.md#place_equity_order) | 4/12 | 22 | 18 success, 5 error, 1 skipped | probed |
| [place_option_order](rh-mcp-tools-orders.md#place_option_order) | 3/10 | 9 | 6 success, 3 error | probed |
| [review_equity_order](rh-mcp-tools-orders.md#review_equity_order) | 4/11 | 20 | 20 success | probed |
| [review_option_order](rh-mcp-tools-orders.md#review_option_order) | 3/11 | 27 | 23 success, 4 error | probed |

## Drift — bundled catalog vs live tools/list

- Live tools: **76** · catalog: **76** · generated 2026-10-09T16:09:02.304Z
- Changed schemas: `get_equity_technical_indicators`

## Response envelope *(#689)*

Every tool call returns one of two wire envelopes (verified across 353 captures):

- **Success** — `{"data": <tool payload>, "guide": "<agent-facing interpretation instructions>"}`. The `guide` text is part of the contract: it tells the caller how to phrase results, which fields to surface, and what follow-up calls are safe. Never ignore it.
- **Error** — `{"_meta": {"rh_error_category": <category>}, "content": [{"type": "text", "text": "<message>"}], "isError": true}`. Messages arrive in three dialects: `API error <NNN>: <json detail>` (HTTP passthrough), plain-text domain rejects (e.g. `not_enough_contracts`, `no queued exercise found`), and HTML error pages on some 404s. `rh_error_category` values observed: `invalid_request` (all 53 error captures), and uncategorized tool-level messages.

A third shape appears in two captures (`err-quote-missing-param`, `err-quote-wrong-type`): `{"category": "VALIDATION", "error": "<ajv message>"}` — emitted by the probe runner's arg validation before the call ever reaches Robinhood. It is not a wire envelope; app-side callers see their own client-side validation instead.

**Pagination** — list tools take an optional `cursor`; pass the prior response's `next` verbatim. Confirmed live on `get_equity_orders` / `get_option_orders` (see `ro-*`/matrix captures).

**Numeric fields** — quantities, prices, premiums, and collateral amounts are decimal **strings** (`"190.0000"`, `"4000.0000"`), never numbers. Options premiums are per-contract dollars; `premium`/`processed_premium` in order objects are multiplied by `trade_value_multiplier` (100).

## Safety classification *(#689)*

| Class | Meaning | Tools |
|---|---|---|
| `read-only` | No account state change | 49 of 76 |
| `financial mutation` | Moves money / places live orders | `place_equity_order`, `cancel_equity_order`, `place_option_order`, `cancel_option_order`, `place_crypto_order`, `cancel_crypto_order`, `exercise_option`, `cancel_option_exercise` |
| `account write` | Mutates non-money state (watchlists, alerts, scans) | `create_watchlist`, `update_watchlist`, `add_to_watchlist`, `remove_from_watchlist`, `follow_watchlist`, `unfollow_watchlist`, `add_option_to_watchlist`, `remove_option_from_watchlist`, `create_alert`, `update_alert`, `delete_alert`, `mark_alerts_read`, `create_scan`, `update_scan_config`, `update_scan_filters` |
| `simulation` | Advisory preview; never submits | `review_equity_order`, `review_option_order`, `preview_crypto_order`, `preview_scan` |

## App allowlist — 9 domain groups *(#689)*

Sections below match `functions/src/rh-agent-mcp/tools/robinhood-tools.ts` `TOOL_GROUPS` one-to-one: **Account & Performance, Market Data & Research, Options, Crypto, Alerts, SEC Filings, Scanners, Watchlists, Orders**. All nine groups are members of `ALL_ENABLED_TOOLS` — the app allowlist exposes the full live surface, including Crypto, Alerts, and SEC Filings. (Task #689's wording said "6 domain-group sections"; the authoritative `TOOL_GROUPS` has 9 and this doc follows the code.)

## Gaps & undocumented behaviors *(#689)* — verbatim

- **No `delete_watchlist`, no `delete_scan`** — created lists and scans are permanent residue (this discovery run left `MCP-DISCOVERY-TEST-2` behind deliberately; delete manually in-app). `update_watchlist` exists; deletion does not.
- **No `trailing_stop` equity order type** — `place_equity_order` `type` accepts only `market | limit | stop | stop_limit`; a trailing exit must be done as cancel/replace of a plain `stop` order (the `mx-sell-trail-*` probes document the workaround).
- **Multi-leg options orders are NOT supported at place time** — `400 "Multi-leg options orders aren't supported in the Robinhood Trading MCP yet. You can still place multi-leg options orders through the app or on web."` (`opt-place-spread`). Both the `place_option_order` schema (`legs` array) and `review_option_order` accept multi-leg shapes — the capability boundary is enforced only at place time, contradicting the tool's own level-3 capability text.
- **`review_option_order` is advisory, not a validation gate** — market+gtc and sell-close-without-position return success with empty `order_checks`; the naked-call credit returns success carrying `OPTION_NOT_ENOUGH_SHARES_FOR_COLLATERAL` as a *warning*. Enforcement lives in `place_option_order`.
- **Equity short sales rejected at place, flagged at review** — `place_equity_order` sell on a zero-held symbol → `400 {"detail":"Not enough shares to sell."}` (`mx-sell-short`; same 400 on `mx-sell-oversell` at 999 vs ~2.4 held). `review_equity_order` returns **success** carrying `order_checks.alertType = "EQUITY_MAX_SELL_SHARES_EXCEEDED"` with `sharesCanSell:"0"`, `sharesOwned:"0"` (`mx-rev-sell-short`) — advisory-only, same divergence as options. No `position_effect` param exists for equities, so no sell-to-open/buy-to-close contract surface.
- **`stop_market` buy-to-open rejected** — `400 "Stop market orders aren't supported when buying to open."` (`opt-place-stop`). `stop_limit` BTO **is** accepted (rests as `type:limit, trigger:stop`).
- **Naked sell-to-open call rejected** — `400 "This order introduces infinite risk."` (`opt-place-naked`). Cash-secured put STO **accepted** — `opt-rev-csp` shows `collateral.cash.amount = 4000.0000` (strike×100).
- **Resting option orders report `state:"unconfirmed"`** — NOT `confirmed` as on equities. Filter `state:"confirmed"` on `get_option_orders` is blind to resting option orders (fixed in `opt-orders-final` after review caught it).
- **`accepted:true` on cancel is NOT terminal** — cancellation is asynchronous; poll `get_option_orders`/`get_equity_orders` for `cancelled` (a fill can race the cancel).
- **Option place response does not show the fill** — a filled order returns `state:"unconfirmed", processed_quantity:"0"`; the position is only visible via `get_option_positions` (`opt-place-fill` → `opt-pos-open`, +39 ms).
- **Fractional / dollar equity orders are `regular_hours`-only** — post-close they reject with a regular-hours restriction (`mx-sell-xh-frac` verbatim).
- **`ref_id` uniqueness enforced server-side** — re-sending a consumed ref_id returns `409` (`mx-buy-lim-bid-409-refid`).
- **Crypto requires a separate crypto account** — all crypto mutations/read order-paths on this account reject `"no crypto account linked to brokerage account"` (`cx-place`, `dep-prev-crypto-*`); preview also fails past that gate.
- **`exercise_option` requires a held position** — `400 {"error":"not_enough_contracts"}` when no contracts are held (`ox-exercise`); `cancel_option_exercise` without a queued exercise returns `no queued exercise found` (`ox-cancel-ex`).
- **Schema drift residual** — `get_equity_technical_indicators`: live *added* a deprecated single-symbol `symbol` param and *dropped* `symbols` from `required` (catalog still requires it). Live accepts either; pass `symbols` (the deprecated `symbol` is single-symbol only).

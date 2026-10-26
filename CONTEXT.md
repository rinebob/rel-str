# Savant Trader Domain Glossary

## SA (SavantApi)

The SavantApi site/project — the data/API backend that owns corpus docs, GCS storage, and ingestion infrastructure. ST calls SA endpoints for data; SA owns the heavy data layer.

_Avoid_: Savant Architect, "the partner" (when SA itself is meant), backend

## ST (SavantTrader)

The SavantTrader site/project — this repo/app. The frontend + its Firebase functions layer. Consumes SA data and adds its own caching/UX.

_Avoid_: Savant Trader app vs SA confusion, frontend

## Signal Occurrence

One detected signal identified by its source run, symbol, timeframe, and signal type. A later detection is a different occurrence even when it has the same symbol.

## ACCEPT

A durable decision that a signal occurrence is a worthwhile trading candidate. Accepting creates an Order Ticket. Toggling accept off deletes the ticket.
_Avoid_: Approve, confirm

## Order Ticket

The root local order record created when a user accepts a signal or starts a manual order. It carries signal/provenance context, a stable `refId`, proposed order terms, and optional authorization. It is the local source of truth for the proposed order before Robinhood submission. After broker submission, Robinhood is authoritative for Broker Order lifecycle and fills.
_Avoid_: Order Intent, Order Draft, staged order

> **Note:** As of ADR-008, the Order Ticket concept is implemented as a **Order Ticket** — a lightweight Firestore document that preserves the signal-to-order link. It does not track broker lifecycle; RH is authoritative for order state, fills, and positions after submission.

## Trading Case

**Superseded by ADR-008.** The Trading Case was the durable lifecycle aggregate created when one signal was accepted. Its Order Ticket was the aggregate boundary and root of local provenance. The case contained the broker submission, Broker Order mirrors, Fill, Protective Stop, exits, replacement attempts, and current lifecycle metadata for that one accepted signal.

The replacement model uses a Order Ticket (one Firestore document per accepted signal that results in an order) and reads RH directly for positions, orders, fills, and stops. See ADR-008 for details.
_Avoid_: Trade, Order, Position, symbol history

## Case Summary

**Superseded by ADR-008.** The mutable metadata and progress projection stored on a Trading Case. It recorded the latest known lifecycle state, current outcome, active broker order IDs, last observed time, entry/protective-stop/exit states, filled and remaining quantities, and case progress.

The replacement model does not track lifecycle state locally. RH is authoritative for order state, fills, and positions. The Order Ticket stores fill results for convenience but does not maintain a mutable lifecycle summary.
_Avoid_: broker event log, observation collection

## Order Ticket

One Firestore document per accepted signal that results in an order submission. Written once at staging, updated once to record the RH order ID after submission, then never touched again. Stores only the signal-to-order link: signal context, refId (idempotency key), RH order ID, symbol, side, and account. Does not track broker lifecycle, fill results, or stop order IDs — RH is authoritative for all order state. Queryable by signal type, date, and symbol for signal success analysis. See ADR-008.
_Avoid_: Trading Case, Order Intent, Order Ticket

## Position Group

The lineage anchor that links a signal's spawned activity — one Firestore doc per accepted signal order (`st-position-groups/{SYM}-{YYMMDD}-grp-{NN}`) carrying `memberTicketIds`, `memberTradeIds`, `brokerOrderIds`, and open/closed rollups. Every spawned Order Ticket carries it via `origin.positionGroupId`; every member paper trade via `positionGroupId`. Distinct manual accepts mint separate groups; live Robinhood positions join via tax-lot `order_id` (equity) or `option_id`/`chain_id` (options). Replaces the legacy `cohortId` as the canonical grouping. Topic #984 / Task #1004.
_Avoid_: cohort (the legacy pre-#1004 name), strategy instance, ticket batch

## Symbol Position

The aggregate broker-reported holding for one account and symbol. A Symbol Position can be contributed to by multiple independent Trading Cases and owns aggregate quantity, exposure, protection coverage, and position-level exit management. When protection covers less than the aggregate quantity, the Symbol Position is protection-drifted and requires explicit user action to update the Protective Stop. It is distinct from each Trading Case and from each Broker Order.
_Avoid_: case position, entry position, order

## Preflight

A side-effect-free evaluation of exact proposed order terms, applicable risk and capacity rules, and the broker review. A material edit or expiration invalidates preflight.

## Order Authorization

Permission to dispatch one exact preflighted order ticket. It is distinct from accepting a signal occurrence.

## Review Flag

A dateless bookmark indicating the user wants to look at a symbol's chart. Independent of the accept/ticket lifecycle. Persists across runs.
_Avoid_: Review status, review decision

## Monitor

A non-exclusive symbol list (MONITOR; legacy Firestore doc name PAST_SIGNALS, migrated on load) for tracking symbols the user wants to keep an eye on. Can coexist with any exclusive list assignment. Membership is informational in the gallery — it does not action a card (#762 QA: monitoring ≠ a decision about the signal).
_Avoid_: Watch, watchlist

## Symbol List (Exclusive)

One of Primary, Secondary, Neutral, Avoid, or Hide. A symbol is in at most one exclusive list at a time. Mutually exclusive with each other but not with Review Flag or Monitor.
_Avoid_: Category, tag, bucket

## Stale Ticket

An order ticket whose `runId` or `marketDate` does not match the currently viewed run. Shown dimmed in the UI. Clicking accept on a stale ticket replaces it with a fresh ticket for the current run.

## Standing Exit Authorization

Permission to perform predefined risk-reducing actions when an exit policy condition occurs, including managing a protective stop and exiting a position.

## Broker Order

A broker instruction identified and state-managed by Robinhood. Submission does not imply a fill or an open position.

## Fill

Broker confirmation that some or all of a broker order traded, including confirmed quantity and price.

## Position

The current broker-reported holding for an instrument in the configured Agentic account. Every position is within RH Agent management scope regardless of origin.

## Protective Stop

A broker-held sell stop intended to reduce or close a long position if its stop price is reached.

## Synthetic Target

A cloud-evaluated exit policy. When the executable bid reaches its target, RH Agent cancels the protective stop, confirms cancellation, and submits a market exit for the remaining position.

## Update Stop

The operation of replacing one existing Protective Stop with a new stop order at a different price on the same position. Always targets a single broker order, never a symbol. Executed as cancel-then-place — the broker has no order-amend, and shares committed to a resting order cannot back a second order, so the replacement cannot be placed first. A Trailing Stop performs Update Stop repeatedly as the mark ratchets; the manual batch form (Update All Stops) applies a trail-% ratchet across an account's stops in one previewed pass.
_Avoid_: amend order, modify stop, replace order (implies a single broker call — no such operation exists)

## Allocation Unit

The configured base dollar exposure used to normalize position sizing and portfolio capacity. Capacity accounting may use fractional units so projected exposure is not rounded away.

## Allocation Bucket

A named strategy group that owns a funding target (`targetPct` of the current live account value) and aggregates every live trade attributed to it. Buckets are scoped to a single Robinhood account — each account has its own bucket set, Cash bucket, and Unassigned view; non-agentic accounts are manageable locally via manual assignment only. Trades attribute via the strategy name stamped on the Order Ticket — automatic for strategy-driven flows, manual via a bucket picker otherwise; unattributed live activity lands in the derived **Unassigned** pseudo-bucket and can be assigned post-hoc. A system-managed **Cash bucket** always exists and holds the uninvested remainder. Live trades only — buckets never contain paper trades. Reassignment between buckets is a mistake-correction path and is audit-recorded.

_Avoid_: Allocation Unit (per-trade sizing unit — different concept), position group, target weight

## Capacity Full

A derived condition where configured allocation capacity is unavailable after accounting for positions and active buy orders. It blocks new exposure but does not cancel or alter existing broker activity.

## Strategy Backtest Run

A UI-triggered, parameterized simulation of one or more strategies against historical data for one or more symbols. A run may span in-sample and out-of-sample windows and may generate many parameter permutations.

## Parameter Sweep

A set of strategy configurations produced by varying one or more numeric parameters across min/max/step ranges. Each permutation is a separate backtest task.

## Walk-Forward Window

An expanding-window partition of historical data into an in-sample optimization segment and an out-of-sample validation segment. The window advances by a configurable roll step.

## Signal Strategy

A strategy implementing the `StrategyAdapter` contract (`functions/src/rh-agent-cloud-function/strategies/base-strategy.ts`) that analyzes historical price/indicator data (`StrategyInput` bars) and emits a stateless, point-in-time LONG/SHORT/null `StrategyOutput`. Runs within the RH Agent's signal-detection worker pass; output feeds human review via ACR. Has no concept of managing a position over time. Examples: ST-Trend-Rider, Leap Drop, RSI Oversold Bounce, MACD Crossover. Tracked under `Topic: Trading Strategy Library`.

## Position-Lifecycle Strategy

A strategy that opens and manages options positions on a fixed schedule (daily/weekly) using option-chain contract-selection criteria (spread type, target delta, DTE) rather than price/indicator signal analysis. Owns the full position lifecycle itself: opening, periodic mark-to-market updates, and expiration settlement (expired worthless, cash-settled, or assigned). Runs under the Options Position Strategy Engine, independent of the RH Agent signal-detection worker and the ACR review flow. Examples: cash-secured put ladder, wheel, variance premium, iron condor. Tracked under `Topic: Options Position Strategy Engine`.

## Option Contract Selection Helper

A reusable engine that selects an option contract for each leg of a strategy based on target delta, target DTE, and side (long/short, call/put) on a given date.

## TradeStation-Style Report

A full backtest report containing equity curve, trade list, and performance metrics (initially Total Net Profit, Profit Factor, % Profitable, Win/Loss Ratio, Average Trade, Max Drawdown, Sharpe Ratio).

## Quality Designation

A user-assigned label on a backtest run that supplements the computed Calmar-based quality score.

## Options Contract Viewer

A dashboard page at `/rh-agent/option-chart` for requesting a historical options contract by OCC ID, inspecting its time-series data, and plotting it on a chart with underlying price overlay. Primary use is data validation; research overlays are a follow-on.

## OCC Contract ID

The Options Clearing Corporation symbol for a single option contract, encoding underlying symbol, expiration date, call/put, and strike price (e.g., `QQQ240719C00450000`). Used as the primary input for the options contract viewer.

## Contract Series

The daily time-series observations returned by the partner `partnerHistoricalOptionsContractV2` endpoint for one contract. Each observation includes date, mark, bid, ask, volume, open_interest, implied_volatility, and Greeks.

## Underlying Overlay

The underlying equity's daily close price rendered on the same chart pane as the option mark, using a secondary Y-axis. Auto-fetched on contract load; toggleable.

## Data Quality Flags

Summary indicators computed from the contract series: missing dates (gaps in the daily sequence), NaN implied volatility values, and zero-volume observations. Displayed in the viewer header to support validation.

## DTE

Days to expiration. Computed from the current date to the contract's expiration date. Displayed in the viewer header.

## Spread Time Series Viewer

A dashboard page for requesting historical time series of multi-leg options spreads and plotting multiple spread price series simultaneously on a single chart with underlying price overlay. Supports two viewing modes: plain viewing mode for spreads constructed in the builder, and backtest plotting mode for positions output by strategy tests. Purpose is identifying price behavior patterns across spread types, expirations, and configurations relative to the underlying. Distinct from the Options Contract Viewer, which inspects a single contract.

## Spread

A multi-leg options position definition constructed in the spread builder: spreadType (vertical, straddle, strangle, iron_condor, or custom), symbol, legs (2-4, each with expiration/strike/optionType/direction), and an optional date range. A spread is the instrument being analyzed — like an option contract or a stock. It has a first trading date and expiration but no entry date, exit date, or provenance. Its full historical price series is relevant and viewed over the course of its life. Produced by manual construction in the builder.

## Position

A trading decision to open a spread at a specific entry date, with optional exit date, target, stop, and provenance metadata. A position represents a commitment to a trade — whether in a backtest, on paper, or live. The spread is the instrument; the position is the act of trading it. Viewed from entry forward; pre-entry history is less relevant. The price series is one property of the position.

## Backtest Position

A position produced by a backtest run. Carries a run reference (runId, permutationId, strategyId) as provenance, plus entry date, exit date, exit reason, P&L, and the full spread definition (legs with contract IDs, strikes, expirations). Corresponds to the existing `BacktestTrade` type in the backtest system. Backtest positions are the output of backtest runs, not manual construction.

## Spread Price

The computed historical price of a multi-leg spread on a given date: `sum(long leg marks) − sum(short leg marks)`. Positive indicates a debit spread; negative indicates a credit spread. Returned as a daily time series by the partner `partnerSpreadTimeSeries` and `partnerSpreadTimeSeriesBatch` endpoints.

## Spread List

A session-working list of spreads produced by the spread builder for the Spread Time Series Viewer. Each entry is a spread definition (spreadType, symbol, legs, optional date range). The list determines single vs. batch endpoint usage: one spread uses the single endpoint, multiple spreads use the batch endpoint.

## Working Buffer

The in-memory list of spreads being built in the spread builder dialog. Persists across dialog open/close (lives in the root-provided `SpreadViewerStore`). The working buffer is the source of truth for what gets loaded to the chart. It is distinct from a Named List — the buffer is ephemeral working state, the named list is persisted.

## Named List

A persisted spread list in Firestore (`spread-lists/{listId}`), owned by a user. A Named List can be opened to populate the working buffer, and the buffer can be saved back to a Named List via Save or Save As. Named Lists are the persistence mechanism; the working buffer is the editing surface.

## Dirty State

A derived condition where the working buffer differs from the last-saved snapshot of the currently-selected Named List. Computed by comparing the buffer against a snapshot stored in the store. When dirty, the dialog shows an "unsaved changes" indicator and prompts on close.

## Entry Date

The date a trader plans to open a spread position. In the spread builder, the entry date drives the parametric chain: it determines the underlying price reference (for ATM strike selection) and filters the contract catalog to contracts first observed near that date. Distinct from the spread's first trading date (which is a property of the data, not a user choice).

## Strike Distance

The width between spread legs, measured in strike points. In the spread builder, the strike distance field auto-computes secondary strikes from a primary (ATM) strike. Type-specific: vertical uses one distance (long → short), strangle uses one symmetric distance (ATM ± distance), iron condor uses one symmetric wing width. The distance is preserved when cloning a spread across expirations.

## Contract Length Bucket

A categorical label for a contract's lifespan from listing to expiration: `1d`, `3d`, `7d`, `14d`, `1mo`, `3mo`, `6mo`, `1yr`, etc. Grouped into Short / Medium / Long. Used as a filter on the contract catalog query to narrow results to a manageable set. Distinct from DTE (days to expiration from entry), which is derived per-spread after selection.

## Parametric Spread Template

The configuration in the spread builder form that defines a spread structure once, then generates variants across expirations: spread type, option type, entry date, strike distance, contract length bucket. The template is the "same spread" being compared across time — the structure is fixed, the strikes and expiration vary with the underlying price and entry date.

## Catalog Picker

The filtered contract catalog table in the spread builder dialog (left column). Displays contracts matching the form's filters (symbol, first-observed date window, strike range, length bucket, option type). Clicking a row populates the form's expiration and strike fields. The catalog picker is the primary leg selection mechanism — the parametric chain narrows the catalog, the user picks the actual contract. No silent "nearest available" guesswork.

## Position List

A session-working list of backtest positions produced by a backtest run for the Spread Time Series Viewer's backtest plotting mode. Each entry is a position object carrying its spread definition, entry date, exit date, provenance (run reference), and other trade metadata. Loaded from backtest output, not constructed manually.

## Hybrid Quote Provider

A provider abstraction in the Options Position Strategy Engine that supplies normalized option quotes from more than one upstream source. The engine consumes a single `OptionQuote` shape and does not know whether the quote came from Alpha Vantage EOD data or Robinhood MCP real-time data. Lets the strategy use cheap EOD data for contract selection and free RH MCP data for live marks on open positions.

## OptionQuote

The normalized option quote consumed by the Options Position Strategy Engine. Contains the fields needed to select a contract, value a position, and update P&L: contract identifier, expiration, strike, type, side, mark, bid, ask, last, volume, open interest, Greeks (delta, gamma, theta, vega), implied volatility, source, and timestamp. Source-specific adapters map upstream responses into this shape.

## OCC → RH Instrument Map

A persisted lookup from an OCC contract ID to the Robinhood MCP instrument UUID that represents the same contract. Built once when a candidate contract is identified from AV EOD data, then reused for live `get_option_quotes` calls while the position is open. Stored globally so any strategy instance can reuse the mapping for the same contract.

## Overnight Delta Simulation

A pre-entry analysis step that runs a Black-Scholes estimate of delta, mark, and theta for a candidate contract across a grid of hypothetical next-day underlying prices. Used to decide whether the contract still meets the strategy's target delta after an overnight move in the underlying. The grid covers ±10% of the prior close in 0.5% increments.

## Saved Swing Config

A persisted ZigZagConfig (the five detection params: devThreshold, leftDepth, rightDepth, allowZigZagOnOneBar, projectionPivots) stored as a flat `st-swing-configs` document keyed by `paramsId`. Selectable per slot (Large/Small) on the swing-analysis page; a config may be flagged as the per-slot default applied on page load. Colors are not persisted - slot colors are hardcoded in the UI. Distinct from a saved swing analysis (`st-swing-sets`), which stores computed results keyed `{symbol}_{paramsId}`.
_Avoid_: swing preset, named config, saved analysis

## Symbol List

A named, Firestore-backed grouping that classifies a tracked symbol. Under the registry model (Thread: unified-list-infra) every list — system or user-created — is a `st-symbol-lists/{userId}_{key}` doc carrying `{key, label, order, role, hidden, symbols[]}`; `key` is the immutable identifier, `label` is renameable cosmetics, and `role` drives behavior (`exclusive` lists strip each other on move; `nonexclusive` lists — MONITOR and all user lists — coexist freely). Managed by SymbolListStore / SymbolListService and toggled via the SymbolListActionsComponent chip row (chips render the fixed system set only). The Monitor toggle is membership-driven (`SymbolListStore.toggleMonitor`) — identical behavior on every surface; chip state reads membership, not the active filter. SymbolListStore is also the single owner of the tracked-symbols universe (`trackedSymbols` / `unlistedSymbols` / `loadTrackedSymbols`) and the ordered catalog computeds (`filterOptions`, `byKey`, `byRole`) every surface consumes. Used as a review filter in signal-review and as the swing-analysis nav-sequence filter.

## Symbol Profile

The per-symbol Firestore doc (`savant-trader/data/symbols/{symbol}`, type `StSymbolProfile`) written by SA's overview-sync pipeline — carries the display name plus sector, industry, exchange, market cap, cap tier, beta, P/E, 52-week range, MAs, dividend yield. `StSymbolProfile.name` is the single source of truth for a symbol's display name — the partner callable's `Company.company` field is the universe source only (which symbols are tracked), never a display-name source. SymbolListStore owns the session-cached `profilesBySymbol` map (`loadProfiles()`); a tracked symbol with no synced profile displays its ticker, not a partner name.

_Avoid_: company name from getTrackedSymbols, partner name

## Untriaged

A symbol in zero exclusive (triage) lists — the "Not triaged" pseudo-filter (`NO_MEMBERSHIP`). Non-exclusive memberships (MONITOR, user lists) do not count: a monitored-but-unfiled symbol still surfaces for triage review. Implemented via `EXCLUSIVE_SYMBOL_LIST_NAMES` today; once the registry lands `role` as data it becomes `role === 'exclusive'` driven. Distinct from "no filter applied" (`NONE`/`'ALL'` anchors).

_Avoid_: no memberships (former label), unlisted (ambiguous)

## User List

A non-exclusive symbol list created by the user (e.g. "coming earnings", "look for breakouts") — a registry doc with a generated slug key, user-supplied label, and `role: 'nonexclusive'`. A symbol may belong to many user lists at once. User lists appear in dropdowns, exports, and complement computations but not in the chip row (system set only). CRUD/reorder happens in the list-management UI (follow-on thread).

_Avoid_: custom list (fine but "user list" is the canonical term), folder
_Avoid_: watchlist (ambiguous - the lists ARE the watchlists), tag, folder

## Option Chain Grid

The single-session option chain browser (Topic: Current option pricing) that renders a full chain in the percent-change grid's matrix form — strikes as rows, expirations as columns — showing mark price, $/% change vs the prior session, delta, and IV per cell, with the full contract payload on hover. Supports CALLS / PUTS / BOTH layouts (BOTH shares a strike column, calls left / puts right) and per-side strike-order orientation (default high→low top→bottom). Distinct from the pct-change grid: same visual form, different data (one session's chain, not a start→target price comparison).

_Avoid_: percent change grid (that is the analysis tool), option chain table

## Gallery Card

The actionable unit of the Order Ticket Gallery view (`trading/gallery`; `dev/gallery` retained): one card per symbol+side aggregating that symbol's contributing Signal Occurrences from the viewed run. Carries signal details, a chart area, and the labeled action toolbar. **Trade** stages a whole-share quantity ticket (no decision writes) and opens it in the Order Ticket dialog for submission; **Reject** writes durable REJECT occurrence decisions, removes this run's staged tickets, and parks the card in Actioned — Restore on an actioned card resets it; **Paper** (disabled pending `GALLERY_MANUAL_PAPER_ENABLED`) stages and sends through the paper-trading callable. Cards carry a derived lifecycle status (rejected > failed > settled > resting > submitting > pending); settled/failed/rejected cards leave the actionable grid and collect in the Actioned section, each exposing the inverse of its sinking action (rejected→Restore, failed→Requeue; settled is terminal). Monitor list membership does not status a card — a watched symbol's fresh signal stays actionable. The ticket line deep-links to `trading/live?ticket=<id>`. Gallery orders are whole-share only — fractional orders are not permitted.

## Position Card

The review unit of the portfolio-v2 position gallery (`/portfolio-v2`, #926/#950-951): one card per live equity position, joining position+PnL, quote, live orders, symbol profile, and allocation bucket — each field degrades independently (`—`) rather than dropping the card. Deliberately separate from the signal gallery's Gallery Card — **positions and signals never mix** and the card models differ. Carries the PROTECTED @ price (pct) / UNPROTECTED badge (long-only protective-stop semantics: a sell stop on a shorted symbol is not protection) and an action row (Close/Stop emit for #953; Add/Detail/Orders are stubs). The Group dropdown re-sorts one flat grid — contiguous blocks ordered by dimension value (alphabetical; tier rank for cap-tier), market-cap desc within, `(Unassigned)`/`(Unknown)` sinks last; the expando render path stays dormant behind the view's `useExpandos` flag.

_Avoid_: signal card, gallery card (those mean the Order Ticket Gallery's signal unit)

## Session Resolution

The rule that maps "today" to an actual trading-session date for the Option Chain Grid. Before 1:00 PM PT (market close — the app standardizes on Pacific Time) resolves to the prior trading session; after 1 PM PT it tries today's date and falls back to prior sessions when no snapshot exists. Resolution walks back over weekends/holidays to the most recent session with a snapshot (cap: 7 calendar days).

_Avoid_: current day, today's date (a calendar date is not necessarily a trading session)

## Trading Workflow

A documented, ordered procedure for one trading use case (signal review, order placement, portfolio management, …) — a checklist-style doc with defined entry criteria, steps, and exit criteria, designed to keep the trader on task during daily operations. Lives as a markdown doc; a future in-app checklist UI may consume the same source. Tracked under `Topic: Navigation and Workflows` (#625) — renamed from `Topic: Trading Workflows` on 2026-10-01.

_Avoid_: runbook (that is the ops doc type), process, SOP, task list

## Workflow Handoff

The declared link from one Trading Workflow's exit output to another workflow's entry condition. Workflows chain rather than run in isolation — e.g., signal review produces order candidates that order placement consumes. A workflow doc's `Feeds:` field names the downstream workflow(s); its exit criteria name *what* is handed off.

## Workflow Template

The shared doc format every Trading Workflow doc follows — defined by the foundation Thread of Topic #625. A template exists to be validated: the foundation Thread proves it by writing one complete pilot workflow (signal review) before per-workflow Threads adopt it.

## Session Run-Sheet

The per-session-type overview doc that sequences Trading Workflows into a day's plan — the single artifact opened at session start. Lists daily workflows in order plus a triggered section for event-driven workflows (with their triggers). Build order of workflow docs is independent of their position in the run-sheet sequence.

_Avoid_: daily routine, session plan, checklist index

## Flex Chart

The shared chart component (`app-flex-chart`) that renders a candlestick price pane plus lower indicator panes. Every chart surface in the app is a flex-chart instance: quick charts, the signal-detail chart on chart-review, the swing-analysis page, and the flex-chart sandbox. Display behavior is driven by `FlexChartConfig` (pane split via `mainPanePercent`, theme via `appearance`, visible window via `initialZoomDays`).

## Quick Charts

The stacked Monthly/Weekly/Daily chart panel on the signal-review page (`app-quick-charts` inside `app-quick-charts-panel`). Shows a fixed window of bars per chart with no zoom toolbar, scrollbar, or mouse-wheel zoom — the visible window is not user-adjustable. Each chart occupies one `.qc-chart-cell` of configurable pixel height.

## Main Pane / Lower Pane

The two row kinds inside a `app-flex-chart` instance. The **main pane** renders price (candles + overlay indicators); **lower panes** render bounded/numeric indicators (trend strength, zones) in fixed slots `lower-1`…`lower-3`. `ChartDataAdapter.chartRows` divides vertical space between them via a configurable main-pane percentage (`FlexChartConfig.mainPanePercent`); active lower panes split the remainder evenly.

## Visible Window

The trailing slice of loaded bars a flex-chart displays, set by `FlexChartConfig.initialZoomDays` (bar count, despite the name). Distinct from the fetched dataset — the store always loads full history; the visible window is display-only. The Y-axis auto-fits to whatever bars fall inside the visible window.

## Trailing Stop

The only stop primitive. A policy attached to a Position that keeps a broker-held Protective Stop's trigger at a configured Trail Distance below the position's Water Mark. A static stop is the degenerate case — a Trailing Stop whose Water Mark never advances. Protection is enforced broker-side by the resting order at all times; the Trailing Stop's own machinery only tightens the trigger. Replaces the standalone "initial/static stop" concept.
_Avoid_: static stop, fixed stop, initial stop

## Water Mark

The most favorable price observed for a trailed Position since its Trailing Stop was armed. Seeds at the position's entry price and only moves in the favorable direction — for a long position, the highest price seen.

## Trail Distance

The percentage gap a Trailing Stop maintains between the Water Mark and the Trigger, configured per position.

## Trigger

The stop price a Trailing Stop's resting Protective Stop should carry: `waterMark × (1 − trailDistance)` for a long position. Compare "where the trigger is" (the resting order's actual stop price) against "where the trigger should be" (the derived value).

## Ratchet

The replacement of a resting Protective Stop with a new one at a raised Trigger after the Water Mark advances. Bounded by a minimum improvement threshold and a Ratchet Cooldown; the resting order continues to protect at its last trigger while a ratchet is deferred or fails.

## Ratchet Cooldown

The minimum elapsed time between consecutive Ratchets of one Trailing Stop, dampening order churn during fast favorable moves. Applies only to trigger raises — never to failure recovery or quantity corrections.

## Anchored VWAP

A VWAP variant that accumulates `typical price x volume` forward from a specific anchor bar instead of resetting per session. In ST the anchor bar is an Anchor Pivot's bar; the line extends to the latest bar while active. Two retracement scales (small/large) run side by side, each with a pivot-high and a pivot-low line.

## Anchor Pivot

A confirmed ZigZag Pivot whose bar seeds an Anchored VWAP line. Only confirmed pivots anchor - a projected (unconfirmed) pivot never does. A same-side pivot that replaces the current anchor is itself an anchor, and the replaced one was the live anchor until then. When a later same-side anchor confirms, the existing line continues through that anchor's Confirmation Bar and terminates there, and the new line starts on that same bar, so each terminated segment spans exactly one confirmation-bar-to-next-confirmation-bar interval.

## Confirmation Bar

The bar on which a ZigZag pivot first becomes knowable: `pivot bar + rightDepth`. An Anchored VWAP line is drawn only from its anchor's Confirmation Bar forward and never back to the pivot bar, which would show lines that could not have existed in real time. The VWAP itself still accumulates from the pivot bar.
_Avoid_: trigger bar (the existing ZigZag trigger dots mark where the deviation threshold was crossed, a different bar)

## History Window

The render filter for terminated Anchored VWAP segments. `historyStart` (optional date) selects an era - segments anchored on/after it render chronologically until `maxHistory` is reached. Unset, the most recent `maxHistory` segments render (oldest pruned first) so history runs to the latest bar. Detection itself is unaffected - the window only controls which segments draw.

## Option Order Ticket

An Order Ticket whose instrument is a single Robinhood option contract (`instrumentType = 'option'`). Carries the same signal provenance (signalContext, decisionIds) and bucket choice as an equity ticket, but its leg holds the Robinhood `option_id` plus `positionEffect` — the two values the broker order tools require. Staged lazily from the Option tab of the gallery Trade dialog rather than at Trade-click.
_Avoid_: option intent, contract order

## Contract Picker

The contract-choice UI on the Option tab: compact selects (expiration → strike → call/put) fed by `get_option_chains`/`get_option_instruments`, plus a paste field accepting contract details copied from the option-chain page. Either path resolves to a Robinhood `option_id` via `get_option_instruments`. Distinct from the OCC-contract-id selection used by the option-chain pages — the two instrument namespaces do not interoperate without a resolution step.
_Avoid_: option selector, chain picker

## Savant Design System (savant-ds)

The shared design vocabulary for all Savant-* apps — design tokens plus SCSS pattern mixins shipped as a standalone package at `C:\aa\projects\savant-ds`, consumed by ST and SA via npm `file:` dependency. SCSS/CSS-only by design so both Angular versions consume it identically. The long-term replacement for per-feature visual language files and, eventually, for Angular Material.
_Avoid_: theme, style guide, daisyUI (rejected — Tailwind-coupled)

## Design Token

A named, single-source styling value exposed as a CSS custom property (`--ds-*` prefix) — color, spacing, typography, density, elevation. Tokens are the portable layer of the Savant Design System: framework- and version-agnostic, theme-swapped via `data-theme="dark"`.
_Avoid_: variable, constant, SCSS variable (tokens are emitted as CSS custom properties, not Sass vars)

## DS Gallery

The ST `/dev`-route showcase that renders every element the design system owns, each annotated with "seen in" provenance naming the source surfaces it generalizes. Doubles as the element inventory and the source of screenshots for mockups in planning docs.
_Avoid_: storybook, styleguide page, component library

## Theme

The app's active color token set — `dark` (default) or `light` (fallback). Swapped by the `data-theme` attribute on `<html>`, chosen via a header toggle, persisted in `localStorage`, and applied at bootstrap before first paint. Distinct from Palette: a theme is the mode, a palette is the color values within a mode.
_Avoid_: dark mode (describes only one variant), skin

## Brand Accent

The swappable neon hue that carries the app's identity — applied to accent surfaces, borders, headings, and glow effects, never to neutral surfaces. Surfaces stay a hue-free grey ramp in both themes; the accent is the only color that changes when the palette changes. Distinct from Direction Colors and status/feedback colors, which are semantic and do not swap with the accent.
_Avoid_: primary color (that's the Material name being replaced), highlight

## Direction Colors

The semantic up/down (long/short) color pair exposed as the `--ds-up` / `--ds-down` design tokens and consumed by badges, edges, pills, strips, banners, and P&L cells. User-pickable as a pair on `/dev/ds`; their values are preserved from the existing palette by default and are intentionally kept visually distinct from the Brand Accent.
_Avoid_: bullish/bearish colors, buy/sell colors (those are order-side labels, not the token names)

## Analysis Dataset

A versioned CSV of trade rows (one row per trade, ~45 cols: identity, provenance, outcomes, excursion, `ind.*` signal snapshot, `strength.*` computed context) generated on demand and stored in GCS (`analysis-datasets/{id}.csv`) with a metadata index doc carrying origin, params, provenance, row count, tags, and notes. Two producers: a **live snapshot** (export of `paper-trading/trades/items`) and a **replay run** (signals regenerated from SDS bars, walked through an exit rule). Snapshots are append-only — a new generation is a new dataset, never an overwrite. Thread #1059.
_Avoid_: materialized analysis collection (rejected — the CSV is the substrate), report

## Slice

A named, saved filter predicate over Analysis Dataset columns (e.g., `signalType=V2_LONG & zoneV2=4`), persisted as JSON in GCS (`analysis-slices/{id}.json`) and applicable to any dataset — the vehicle for testing whether a single-symbol finding generalizes.
_Avoid_: saved query, view

## Trade Row

One flattened record per paper trade in an Analysis Dataset — the analysis grain. `tradeRetPct` is direction-aware (shorts profit when the symbol falls); `symbolMovePct` is direction-neutral. Live rows carry ledger-observed entry/exit/marks; replay rows observe only OHLC + regenerated indicators, with entry/exit/outcomes modeled under the run's recorded conventions. Analysis views compute on `status=CLOSED` rows only — open trades are quarantined, not excluded from the file.
_Avoid_: observation (that's raw inputs), ledger entry

## Tracked Symbol Universe

The upstream-owned set of symbols ST's data pipeline syncs and scans — ~925 names fetched via `partnerListTrackedSymbolsV2` and cached at `app/trackedSymbolsCache`. Read-only from ST; membership changes happen upstream (adds arrive via `partner-symbol-added` Pub/Sub → backfill → `rh-agent-symbols` enable). Distinct from user symbol lists, which are locally writable triage buckets layered on top.
_Avoid_: watchlist, symbol list, tracked list (ambiguous without "universe")

## Scan Recipe

A named, code-versioned `preview_scan` bundle — filter set (unit-corrected expression filters, optional `symbol` scope), result columns, and sort — surfaced as a menu item on the Scanner page. Encodes the scanner field-guide corrections (fraction thresholds, ANY_OF/IN_LIST scoping); users pick recipes, never raw filters.
_Avoid_: screen (RH's word), saved scan (that's the RH-account entity)

## Curation Proposal

The persisted artifact of a Scanner compare run (`st-scanner/proposals/items/{id}`): recipe, timestamp, matched count, and the four buckets — add candidates (matched ∧ untracked), drop candidates (tracked ∧ failed), dead/uncovered (tracked ∧ absent from scanner), no-data (tracked ∧ returned-but-blank). Proposals are the output; applying them to the universe is a deferred decision.
_Avoid_: diff, recommendation, plan

## Dead Symbol

A tracked-universe symbol the Robinhood scanner never returns even when explicitly scoped via `symbol ANY_OF` — delisted/acquired or unsupported. Surfaced in its own proposal bucket, separate from quality failures (verify before dropping).
_Avoid_: invalid symbol, missing symbol

## Scan Latest Run

The most recent discovery-scan result for one Scan Recipe, persisted as a single doc per recipe (`st-scanner/latest-runs/items/{recipeId}`) and overwritten each time a discovery path completes. Carries the full matched row set plus run metadata (ranAt, matched count, truncation flag). Only discovery scans write it — a prune evaluation never replaces it. It is the read model for viewing scan output outside the Scanner page's session.
_Avoid_: scan history (one layer deep, not a history), cached scan (ambiguous), proposal (that's the compare artifact)

## Chart View

The generic symbol-list chart viewer page at `trading/chart-view`, repurposed from the former chart-review page (`signals/charts`). Presents a list-source selector and symbol list in the left pane with three D/W/M Flex Charts in the detail pane. Decoupled from ST signal runs — any list source can feed the pane, and non-tracked symbols render via ephemeral RH OHLCV data.
_Avoid_: chart review (the retired name), signal charts

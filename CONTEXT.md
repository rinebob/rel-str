# RH Agent Domain Glossary

## Signal Occurrence

One detected signal identified by its source run, symbol, timeframe, and signal type. A later detection is a different occurrence even when it has the same symbol.

## ACCEPT

A durable decision that a signal occurrence is a worthwhile trading candidate. `ACCEPT` does not authorize or imply a broker order.

## REJECT

A durable decision that a signal occurrence is not a worthwhile trading candidate. It applies only to that occurrence.

## Order Draft

Editable proposed order terms. An order draft has no broker side effect and consumes no allocation capacity.

## Preflight

A side-effect-free evaluation of exact proposed order terms, applicable risk and capacity rules, and the broker review. A material edit or expiration invalidates preflight.

## Order Intent

A finalized snapshot of proposed broker instructions with durable identity and provenance. Authorization applies to an exact order intent.

## Order Authorization

Permission to dispatch one exact preflighted order intent. It is distinct from accepting a signal occurrence.

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

## Allocation Unit

The configured base dollar exposure used to normalize position sizing and portfolio capacity. Capacity accounting may use fractional units so projected exposure is not rounded away.

## Capacity Full

A derived condition where configured allocation capacity is unavailable after accounting for positions and active buy orders. It blocks new exposure but does not cancel or alter existing broker activity.

## Strategy Backtest Run

A UI-triggered, parameterized simulation of one or more strategies against historical data for one or more symbols. A run may span in-sample and out-of-sample windows and may generate many parameter permutations.

## Parameter Sweep

A set of strategy configurations produced by varying one or more numeric parameters across min/max/step ranges. Each permutation is a separate backtest task.

## Walk-Forward Window

An expanding-window partition of historical data into an in-sample optimization segment and an out-of-sample validation segment. The window advances by a configurable roll step.

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

## Position List

A session-working list of backtest positions produced by a backtest run for the Spread Time Series Viewer's backtest plotting mode. Each entry is a position object carrying its spread definition, entry date, exit date, provenance (run reference), and other trade metadata. Loaded from backtest output, not constructed manually.

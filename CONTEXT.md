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

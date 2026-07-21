# ADR-001: Strategy Backtesting System

## Status

Accepted

## Context

The RH Agent feature needs a strategy authoring and backtesting capability so users can evaluate options trading ideas against real historical data before any live automation.

## Decisions

- **Strategy authoring.** Strategies are assistant-coded in TypeScript, source-committed, and statically registered in `functions/src/rh-agent-cloud-function/strategies/`. The UI consumes them via a dropdown.
- **Historical options data source.** Historical options are fetched from the Savant Partner API (`partnerHistoricalOptionsV2`) per run. We do not persist options data in Firestore; SA will provide persistence in a later phase.
- **Underlying bars source.** The backtest reads equity bars from the existing Firestore `symbol-data/{symbol}/daily/{year}` and `symbol-data/{symbol}/{weekly|monthly}/all` documents to avoid partner round-trips.
- **Timeframe.** Strategies run on daily bars by default. Weekly/monthly requirements are baked into individual strategies.
- **Trade prices.** Option entry and exit prices use the AV `mark` field.
- **Execution model.** Signals are evaluated and positions are entered/exited at the close of the day the condition is met (`today's close`).
- **Capital model.** Initial version uses one whole option contract per trade with no per-trade dollar cap and no max capital filter. Overspending is allowed; if cash goes negative, the backtest continues and the negative cash balance is reported. Position sizing optimization and cash-limited deployment are deferred.
- **Optimization objective.** Calmar ratio (or another accepted return-to-drawdown single score) is used for both parameter-set selection and the computed quality score.
- **Walk-forward.** Expanding-window walk-forward by default: 2-year in-sample, configurable out-of-sample window (default 12 months), configurable roll step. An "all-data run" option is supported for quick checks.
- **Parameter sweeps.** Numeric strategy parameters support min/max/step ranges in the UI; each permutation becomes its own Cloud Task.
- **Task runner.** A robust Cloud Task-based runner from the start: one Cloud Task per symbol+strategy+param set, with a Firestore job document that the UI polls for progress (symbol, strategy, percent complete).
- **Result persistence.** Results live in `backtest-runs` (job/progress) and `backtest-permutations` (per-symbol+strategy+param results). The user chooses `summary` or `full` report tier per run. Summary = run metadata, metrics, equity curve points, and trade count. Full = summary + every individual trade (entry/exit dates, marks, P&L). The UI shows all runs in a table with quality designation, view button, and compare checkbox.
- **Metrics.** Phase 1 TradeStation-style metrics: Total Net Profit, Profit Factor, % Profitable, Win/Loss Ratio, Average Trade, Max Drawdown, Sharpe Ratio, plus equity curve and trade list.
- **Top set identification.** The system helps identify strong symbol+strategy+param sets, preferring multi-symbol robustness but allowing strong single-symbol results on major ETFs like SPY/QQQ.
- **UI.** A new dedicated backtest page under `rh-agent`. First version prioritizes a working backend and minimal UI; polished UI comes later.
- **First strategy.** Proof-of-concept strategy: 75-delta LEAP — buy a 75-delta call when the underlying drops 1%, exit at 100% gain or 50% loss, with hold-days and target/stop percentages as sweepable parameters. `maxConcurrentPositions` is a strategy config parameter (default `0` = unlimited).
- **Live automation.** Deferred until after the backtesting phase selects proven strategies.

## Consequences

- New Cloud Function(s) and Cloud Tasks are used from the start: `rhAgentBacktestStart` (callable orchestrator) fans out one `rhAgentBacktestPermutation` Cloud Task per symbol+strategy+param set. No local-script intermediary.
- `functions/src/types/partner.ts` and `functions/src/partner-proxy.ts` will be extended once the `partnerHistoricalOptionsV2` discovery doc arrives.
- A reusable option contract-selection helper must be built to support single-leg and multi-leg spreads by target delta, DTE, and side per leg.

# RH-AGENT-ZONE-TS-FILTER-PRD-2607-01 — Zone Signal Trend-Strength Filter Research

## Status

Exploration / spike. No production code changes.

## Context

The ST-Zone V1 and V2 indicators produce strong signals at the beginning of trends but generate false positives in sideways, stagnant markets. The ST-Trend-Strength (TS) indicator (`diPlus`, `diMinus`, `diHist`, `adx`) is designed to measure directional conviction and should help distinguish genuine trend pullbacks from chop.

Visually, a trending market keeps `diHist` on one side of zero for extended periods and often well beyond the `±10` corridor. A stagnant market oscillates around zero, rarely pushes past `±10`, and quickly returns when it does. The research goal is to turn that visual intuition into an algorithmic regime detector that **closes the trading window** for poor zone candidates without eliminating valid pullback entries within an established trend.

## Related documents

- `functions/scripts/backtest-zone-filters.ts` — existing 10-bar forward-return backtest.
- `functions/src/indicators/st-trend-strength.ts` — TS math.
- `functions/src/indicators/st-zone.ts` and `st-zone-v2.ts` — zone math.
- `functions/src/rh-agent-cloud-function/strategies/signal-detection.ts` — current zone signal state machine.
- `RH-AGENT-SIGNAL-LIFECYCLE-2607-01_signal-bardate-lifecycle.md` — how daily signals are persisted.

## Goal

Produce a reproducible, extensible research harness that:

1. Replays long-only **Daily Zone V2** signals over historical `symbol-data`.
2. Measures each signal with a realistic **initial stop + trailing stop** exit model.
3. Computes TS regime scores from the `diHist` history around the signal bar.
4. Tests a family of regime-aware filters and reports which ones improve expectancy, win rate, and drawdown.
5. Generates a readable report with methodology, findings, discussion, and concrete filter recommendations.

## Scope

### In scope

- Long-only, daily, Zone V2 signals.
- Historical backtest over Firestore `symbol-data`.
- ATR-based initial and trailing stops.
- Regime detection from `diHist` history, especially behavior around the `±10` corridor and zero line.
- Filter evaluation by expectancy, win rate, profit factor, retention, average loss, max adverse excursion, and bars held.
- Markdown report output checked into `docs/implementations/` or `docs/research/`.

### Out of scope

- Live strategy code changes.
- Short signals, weekly signals, or V1 signals for this first pass.
- Machine learning / classifier training. This pass is rule-based and interpretable.
- Options, position sizing, slippage, commissions.

## Definitions

| Term | Meaning |
|---|---|
| Signal bar | The daily bar where the zone V2 uptick fires. |
| Entry price | Close of the signal bar. |
| Initial stop | `entry − (k × ATR(14))` for longs. |
| Trailing stop | Highest close since entry minus `(k × ATR(14))`, never lowered. |
| Exit | Earlier of trailing stop hit or max-bars held. "Ride" mode disables the max-bars cap. |
| R-multiple | `(exitPrice − entryPrice) / (entryPrice − initialStop)`. |
| Expectancy | Mean R-multiple across all trades. |
| Win | Trade closed with R-multiple > 0. |

## Hypotheses to test

1. **Trending regime signals outperform chop regime signals.** Long Zone V2 signals that fire while `diHist` has been persistently positive and has recently exceeded `+10` should have higher expectancy than signals that fire while `diHist` is oscillating inside `−10` to `+10`.
2. **Cumulative excursion matters more than snapshot value.** A "trend credit" that accumulates when `diHist` is beyond the `±10` corridor and resets at zero crossing should separate regimes better than the current `diHist` value alone.
3. **Valid pullbacks survive.** In an established uptrend, `diHist` may pull back from above `+10` to a value between `0` and `+10` before turning up. A regime detector that only checks the current bar would reject these good entries.
4. **Zero-cross frequency identifies chop.** Markets that cross the zero line frequently in the lookback window are sideways, regardless of the current `diHist` value.
5. **ADX and price slope are secondary confirmations.** Once the TS regime is established, ADX and price slope may help rank candidates but are not the primary chop detector.

## Feature snapshot at signal bar

Each signal will capture:

### Trend strength snapshot
- `diHist` value, sign, and 1/3-bar slope
- `diPlus`, `diMinus`, and spread
- `adx` and `adxSlope3`, `adxSlope5` (secondary)

### Regime history features (lookback N = 10, 20, 40 bars)
- `barsSinceZeroCross`: bars since `diHist` last crossed zero.
- `barsAbove10`: count of bars in lookback with `diHist > +10`.
- `barsBelowMinus10`: count of bars in lookback with `diHist < −10`.
- `barsInsideCorridor`: count of bars in lookback with `−10 ≤ diHist ≤ +10`.
- `maxDiHistLookback`: maximum `diHist` value in lookback.
- `minDiHistLookback`: minimum `diHist` value in lookback.
- `zeroCrossCount`: number of zero crossings in lookback.
- `longTrendCredit`: cumulative positive excursion beyond `+10`, reset to `0` when `diHist` crosses below `0`.
- `longCounter`: cumulative count of bars with `diHist > +10`, reset at zero cross.
- `pullbackQuality`: in an established positive trend, a valid pullback shows `diHist` declining from above `+10` but staying above `0`, then curling up.

### Price structure
- Signal-bar close, ATR(14), true range
- Price slope over 5, 10, 20 bars
- Normalized distance from ST-Trend-Bands middle/extreme bands
- Volatility regime: ATR percentile over last 20 bars

### Zone context
- Current zone value, previous zone value, delta
- Zone run length (bars at prevZone before uptick)
- Same-timeframe zone V2 sign at signal bar
- Weekly/monthly zone V2 value (HTF context)

## Filter evaluation framework

Each candidate filter is a boolean predicate over the feature snapshot. For every filter we report:

| Metric | Why it matters |
|---|---|
| Signals kept | How many trades survive the filter. |
| Win rate | % of trades profitable. |
| Avg R | Mean R-multiple. |
| Expectancy | Same as avg R in this simple model. |
| Profit factor | Gross wins / gross losses in R. |
| Avg win R | Average magnitude of winning trades. |
| Avg loss R | Average magnitude of losing trades. |
| Max adverse excursion | Worst underwater R during a trade. |
| Avg bars held | Holding period. |
| Retention % | Kept signals / total signals. |

Filters will be compared against the **unfiltered baseline** and ranked by expectancy, with a secondary sort by retention.

## Parameter sweep

### Stop engine
- ATR multiplier `k`: 1.0, 1.5, 2.0, 2.5, 3.0
- Max hold bars: 10, 20, 40, and "ride" (no cap)

### Regime detector
- Lookback window: 10, 20, 40 bars
- `longCounter` threshold: 3, 5, 10
- `longTrendCredit` threshold: 20, 50, 100 (units = sum of `diHist − 10`)
- `barsInsideCorridor` max: 0%, 30%, 50% of lookback
- `zeroCrossCount` max: 0, 1, 2 within lookback

A full factorial is not required. The first pass will use a default stop (`k=1.5`, max 20 bars) and sweep the regime parameters; a sensitivity page will show how the best regime detectors behave across stop parameters.

## Deliverables

1. `RH-AGENT-ZONE-TS-FILTER-IMPL-2607-01_zone-signal-trend-strength-filter-research-implementation.md` — technical build plan for the research harness.
2. A runnable backtest script extension in `functions/scripts/` (created during the implementation phase, after this PRD is approved).
3. `docs/research/RH-AGENT-ZONE-TS-FILTER-REPORT-2607-01.md` — the actual findings report with methodology, tables, charts (ASCII or markdown), discussion, and filter recommendations.

## Success criteria

- The harness can reproduce the unfiltered baseline with a clear expectancy and win rate.
- At least one interpretable TS-based filter improves expectancy over baseline without cutting signal count to impractical levels (retention ≥ 30%).
- Report explains **why** each filter works or fails in terms of market regime (trending vs sideways).
- Infrastructure is extensible: adding a new feature or filter is a single function addition.

## Conclusions to reach

1. Does a cumulative TS counter/credit that resets at zero reliably separate trending and chop regimes for long daily Zone V2 signals?
2. What is the best lookback window and threshold for the regime detector?
3. Do valid pullback entries within a trend survive a regime filter, or do we need an explicit pullback-aware exception?
4. What is the simplest production-ready rule to add to `signal-detection.ts`?
5. How sensitive are the best regime filters to ATR multiplier and max hold bars?
6. What follow-up research is needed for shorts, weekly signals, and V1?

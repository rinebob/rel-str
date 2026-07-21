# RH-AGENT-ZONE-TS-FILTER-IMPL-2607-01 — Zone Signal Trend-Strength Filter Research Implementation Plan

## Status

Implementation plan for the research spike defined in `RH-AGENT-ZONE-TS-FILTER-PRD-2607-01_zone-signal-trend-strength-filter-research-prd.md`. The focus is on detecting trending vs chop regimes from the `diHist` history, not snapshot thresholds. No production code changes in this phase.

## Goal

Build a self-contained, extensible backtest harness that:

1. Reads `symbol-data/{symbol}` from Firestore.
2. Replays long-only Daily Zone V2 signals.
3. Simulates trades with configurable initial + trailing ATR stops.
4. Computes TS regime scores from the `diHist` history around every signal.
5. Evaluates a library of regime-aware filters and outputs a markdown research report.

## Files to create or extend

### New files

- `functions/scripts/backtest-zone-ts-filter.ts` — main research harness.
- `functions/scripts/lib/backtest-trade-engine.ts` — stop/target simulator.
- `functions/scripts/lib/backtest-features.ts` — feature and regime-score builder.
- `functions/scripts/lib/backtest-filters.ts` — regime filter library.
- `functions/scripts/lib/backtest-report.ts` — markdown report generator.
- `docs/research/RH-AGENT-ZONE-TS-FILTER-REPORT-2607-01.md` — output report.

### Existing files to read, not modify

- `functions/scripts/backtest-zone-filters.ts` — current forward-return backtest.
- `functions/src/indicators/st-trend-strength.ts` — TS computation.
- `functions/src/indicators/st-zone-v2.ts` — Zone V2 computation.
- `functions/src/indicators/st-trend-bands.ts` — bands for price-slope context.
- `functions/src/rh-agent-cloud-function/strategies/signal-detection.ts` — signal state machine.

## Data source

Firestore collection `symbol-data` documents contain:

```ts
{
  symbol: string;
  daily:  OhlcBar[];   // { d, o, h, l, c, v }
  weekly: OhlcBar[];
  monthly: OhlcBar[];
}
```

Run environment:

```bash
cd functions
npx tsx scripts/backtest-zone-ts-filter.ts
```

Requires Firebase ADC with access to project `rel-str`.

## Signal generation

Use the same state machine as production: `detectAllStTrendRiderSignals` from `functions/src/rh-agent-cloud-function/strategies/signal-detection.ts`, configured for daily Zone V2.

Signal selection for this spike:

- `signalKey === 'D_V2'`
- `direction === 'LONG'`
- HTF = weekly Zone V2 (existing backtest convention)

Each signal will be paired with its **regime score** at the signal bar. The outcome of that one trade is then attributed to the regime state that existed at entry.

This keeps the first report focused and interpretable. The harness will be extensible to D_V1, weekly, and shorts by changing a config object.

## Trade engine specification

### Inputs per signal

- `entryPrice`: close of signal bar
- `atr14`: ATR(14) at signal bar
- `bars`: subsequent daily bars (OHLCV)
- `k`: ATR multiplier for initial and trailing stop
- `maxBars`: integer or `null` for "ride" mode

### Rules

1. **Initial stop** (long): `entryPrice − k × atr14`.
2. **Trailing stop** (long): after each bar, update to `max(highSinceEntry) − k × atr14`, never lower the stop.
3. **Exit triggered** when a bar's low ≤ stop.
   - Use the close of the triggering bar as exit price for simplicity.
   - Optionally model stop price exactly when hit; report will clarify assumption.
4. **Max bars exit**: if `maxBars` set and not stopped out, exit at close of bar `signalIndex + maxBars`.
5. **End-of-data exit**: if neither stop nor maxBars fires, exit at last available close.

### Outputs per trade

- `entryPrice`, `exitPrice`, `exitBarIndex`
- `exitReason`: 'stop', 'max-bars', 'eod'
- `rMultiple`: `(exit − entry) / (entry − initialStop)`
- `isWin`: `rMultiple > 0`
- `maxAdverseExcursion`: max loss relative to initial risk during trade
- `barsHeld`

## Regime feature specification

For each signal at bar index `i`, compute the following features from the `diHist` series. These are the core inputs to the regime detector.

### TS snapshot at signal bar

| Feature | Source | Notes |
|---|---|---|
| `diHist` | `computeStTrendStrength` | `diPlus − diMinus` |
| `diHistSlope1` | computed | `diHist[i] − diHist[i−1]` |
| `diHistSlope3` | computed | `(diHist[i] − diHist[i−3]) / 3` |
| `diPlus` | `computeStTrendStrength` | |
| `diMinus` | `computeStTrendStrength` | |
| `adx` | `computeStTrendStrength` | secondary confirmation |

### Regime history features (lookback N = 10, 20, 40 bars ending at bar `i`)

| Feature | Computation |
|---|---|
| `barsSinceZeroCross` | bars since `diHist` last crossed zero. |
| `barsAbove10` | count of bars with `diHist > +10`. |
| `barsBelowMinus10` | count of bars with `diHist < −10`. |
| `barsInsideCorridor` | count of bars with `−10 ≤ diHist ≤ +10`. |
| `maxDiHistLookback` | maximum `diHist` in lookback. |
| `minDiHistLookback` | minimum `diHist` in lookback. |
| `zeroCrossCount` | number of zero crossings in lookback. |
| `longTrendCredit` | cumulative `max(0, diHist − 10)` while `diHist > 0`, reset to `0` when `diHist` crosses below `0`. |
| `longCounter` | cumulative count of bars with `diHist > +10` while `diHist > 0`, reset at zero cross. |

### Pullback quality features

| Feature | Purpose |
|---|---|
| `pullbackFromHigh` | `maxDiHistLookback − diHist[i]`; how far `diHist` has pulled back from its recent high. |
| `inPositiveTrend` | `diHist` has not crossed below `0` for at least `N` recent bars and `longCounter > 0`. |
| `curlingUp` | `diHistSlope1 > 0` and `diHistSlope3 > 0`. |

### Price and zone context

| Feature | Source | Notes |
|---|---|---|
| `atr14` | computed from OHLCV | for stop sizing and normalization |
| `priceSlope10` | computed | slope of close over 10 bars |
| `priceSlope20` | computed | slope of close over 20 bars |
| `zoneValue`, `prevZone`, `zoneRunLength` | Zone V2 series | signal context |
| `htfZone` | weekly Zone V2 | mapped to daily bar dates |

## Filter library

Filters are pure functions `SignalSnapshot → boolean`. Each filter corresponds to a hypothesis about regime.

### Baseline

- `all`: no filter.

### Snapshot threshold filters (for comparison only)

These test the current `diHist` value. They are expected to reject valid pullbacks and will be used to demonstrate why regime history is better.

- `diHist_gt_10`: `diHist > +10` at signal bar.
- `diHist_gt_0`: `diHist > 0` at signal bar.
- `diHist_inside_corridor`: `−10 ≤ diHist ≤ +10` at signal bar.

### Regime history filters

These capture the two-mode intuition: trending vs chop.

- `longCounter_ge_{N}`: `longCounter >= N` at signal bar (lookback-aware).
- `trendCredit_ge_{T}`: `longTrendCredit >= T` at signal bar.
- `recentlyAbove10`: `barsAbove10 > 0` in lookback.
- `mostlyOutsideCorridor`: `barsInsideCorridor / lookback < 0.3`.
- `noRecentZeroCross`: `zeroCrossCount === 0` in lookback.
- `barsSinceZeroCross_ge_{N}`: `barsSinceZeroCross >= N`.
- `establishedPositiveTrend`: `diHist > 0 AND zeroCrossCount === 0 AND barsAbove10 > 0`.

### Pullback-aware filters

These allow a valid pullback within a trend to pass even if current `diHist` is below `+10`.

- `pullbackInTrend`: `diHist > 0 AND inPositiveTrend AND maxDiHistLookback > +10 AND curlingUp`.
- `shallowPullback`: `diHist > 0 AND maxDiHistLookback > +10 AND pullbackFromHigh < 10`.
- `trendResume`: `diHist > 0 AND barsSinceZeroCross >= 10 AND diHistSlope1 > 0`.

### Combined / scored filters

- `strongOrPullback`: `establishedPositiveTrend OR pullbackInTrend`.
- `trendCreditPlusSlope`: `longTrendCredit >= 50 AND diHistSlope1 > 0`.

New filters can be added by appending to the filter array; no other code changes required.

## Sensitivity parameters

### Stop engine

| Parameter | Values |
|---|---|
| `k` (ATR multiplier) | 1.5, 2.0, 2.5 |
| `maxBars` | 10, 20, null |

### Regime detector

| Parameter | Values |
|---|---|
| Lookback window | 10, 20, 40 bars |
| `longCounter` threshold | 3, 5, 10 |
| `longTrendCredit` threshold | 20, 50, 100 |
| `barsInsideCorridor` max fraction | 0.3, 0.5 |
| `zeroCrossCount` max | 0, 1 |

Top filters will be reported across all grid cells so we can see robustness. The baseline comparison shows whether regime history beats snapshot thresholds.

## Output report structure

`docs/research/RH-AGENT-ZONE-TS-FILTER-REPORT-2607-01.md` will contain:

1. **Executive summary** — best regime detector, expectancy improvement, retention.
2. **Methodology** — data source, signal definition, trade engine, and how TS regime is computed.
3. **Baseline results** — unfiltered win rate, expectancy, trade count.
4. **Snapshot vs regime comparison** — show that `diHist > 10` rejects valid pullbacks while regime detectors keep them.
5. **Filter results table** — sorted by expectancy, with retention, win rate, profit factor, avg loss, MAE.
6. **Parameter sensitivity** — top-3 regime filters across k and maxBars.
7. **Discussion** — why each detector succeeds or fails in trending vs chop markets.
8. **Conclusions and recommendations** — proposed production-ready rule.
9. **Next steps** — shorts, weekly, V1, and live strategy integration.

## Extensibility design

The harness will be split into small modules so later phases can reuse it:

- `backtest-trade-engine.ts` knows nothing about Firestore or indicators.
- `backtest-features.ts` knows how to compute features but not how to run trades.
- `backtest-filters.ts` exports a declarative filter list.
- `backtest-report.ts` consumes typed results and emits markdown.

Adding a new feature later means adding one function to `backtest-features.ts` and referencing it in filter definitions. Adding a new signal type means changing the config at the top of the main script.

## Commands

```bash
# Run the full research harness
cd functions
npx tsx scripts/backtest-zone-ts-filter.ts

# Limit symbols during dev
LIMIT=50 npx tsx scripts/backtest-zone-ts-filter.ts

# Use a specific ATR multiplier for quick checks
K_ATR=2.0 MAX_BARS=20 npx tsx scripts/backtest-zone-ts-filter.ts
```

## Success criteria

- Script runs end-to-end without crashing on the full `symbol-data` set.
- Baseline numbers are close to the existing `backtest-zone-filters.ts` when using the same stop-less forward-return metric (sanity check).
- At least one regime-aware filter improves expectancy over the simple `diHist > 10` snapshot filter at similar retention.
- The report demonstrates that snapshot filters reject valid pullback entries while regime detectors keep them.
- Report is readable without running the code.

## Out of scope for this spike

- Live strategy code changes in `signal-detection.ts` or the worker.
- Short signals, weekly signals, V1 signals.
- Commission, slippage, or market-impact modeling.
- Machine learning. Rule-based, interpretable filters only.
- UI changes.

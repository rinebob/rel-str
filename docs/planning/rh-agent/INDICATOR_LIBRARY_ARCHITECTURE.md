# Indicator & Strategy Architecture

## Overview

This document defines the architecture for **two fundamentally separate systems** that work together:

- **Indicators** — Pure math. Take price/volume data, return computed values. No trading logic.
- **Strategies** — Pure rules. Take pre-computed indicator values, return buy/sell/hold decisions. No indicator math.

An **orchestrator** bridges the two: it reads what indicators a strategy needs, computes them, and passes the results to the strategy.

---

## Core Principles

1. **Indicators and strategies are fundamentally different** — never mix calculation with trading logic
2. **One indicator per file** (MA variants grouped since they share the same interface)
3. **One strategy per file** (related rules like oversold/overbought can coexist)
4. **Strategies never see raw bars** — they receive a flat snapshot of pre-computed indicator values
5. **Indicators never return buy/sell** — they return numbers, arrays, and structured math results
6. **Registries drive the UI** — dropdowns, config dialogs, and chart pane assignments all come from registry metadata

---

## Layer 1: Indicators (Pure Math)

### What an Indicator Is

A function that takes price/volume arrays and parameters, returns computed numeric values. No concept of signals, thresholds, or actions.

### Indicator Contract

```typescript
/** Unique identifier for each indicator type */
enum IndicatorId {
  SMA   = 'SMA',
  EMA   = 'EMA',
  WMA   = 'WMA',
  TEMA  = 'TEMA',
  RSI   = 'RSI',
  MACD  = 'MACD',
  BOLLINGER = 'BOLLINGER',
  ATR   = 'ATR',
  ADX   = 'ADX',
  STOCHASTIC = 'STOCHASTIC',
  VWAP  = 'VWAP',
}

/** Moving average sub-types (used by ma.indicator.ts) */
enum MaType {
  SMA  = 'SMA',
  EMA  = 'EMA',
  WMA  = 'WMA',
  TEMA = 'TEMA',
  DEMA = 'DEMA',
  KAMA = 'KAMA',
}

/** What every indicator file must export */
interface IndicatorDefinition {
  id: IndicatorId;
  name: string;                                     // "RSI", "Simple Moving Average"
  category: 'momentum' | 'trend' | 'volatility' | 'volume';
  paramSchema: ParamField[];                        // Drives config dialog UI
  defaultParams: Record<string, number | string>;   // e.g. { period: 14 }
  minBarsRequired: (params: Record<string, number | string>) => number;
  compute: IndicatorComputeFn;
}

/** Pure compute function — bars + params in, numbers out */
type IndicatorComputeFn = (
  bars: OHLCV[],
  params: Record<string, number | string>
) => IndicatorResult;

/** What an indicator returns — just numbers */
interface IndicatorResult {
  /** One value per bar (aligned to bar index, NaN for insufficient lookback) */
  values: number[];
  /** Named secondary series (e.g., MACD signal line, Bollinger upper/lower) */
  series?: Record<string, number[]>;
}

/** Describes one configurable parameter — drives the UI config dialog */
interface ParamField {
  key: string;
  label: string;
  type: 'integer' | 'number' | 'select';
  default: number | string;
  min?: number;
  max?: number;
  options?: { label: string; value: string }[];   // For 'select' type (e.g., MA type)
  description?: string;
}
```

### Key Rules for Indicators

- **No `if (rsi < 30)`** — that's a strategy rule, not an indicator concern
- **No `return { action: 'BUY' }`** — indicators return numbers only
- **Output is per-bar** — `values[]` is aligned to the input bars array
- **Secondary series** — MACD needs `signal` and `histogram`, Bollinger needs `upper` and `lower`
- **Parameters are validated by the registry** using `paramSchema`

### Example: RSI Indicator File

```typescript
// rsi.indicator.ts — Pure RSI calculation. No trading rules.

export const rsiIndicator: IndicatorDefinition = {
  id: IndicatorId.RSI,
  name: 'Relative Strength Index',
  category: 'momentum',

  paramSchema: [
    { key: 'period', label: 'Period', type: 'integer', default: 14, min: 2, max: 100 },
  ],
  defaultParams: { period: 14 },

  minBarsRequired: (params) => Number(params.period) + 1,

  compute(bars: OHLCV[], params): IndicatorResult {
    const period = Number(params.period);
    // ... Wilder's smoothed RSI calculation ...
    // Returns: { values: [NaN, NaN, ..., 72.3, 68.1, 45.2, ...] }
  },
};
```

### Example: MA Indicator File (Grouped Variants)

```typescript
// ma.indicator.ts — All moving average variants. Same interface, different smoothing.

// One IndicatorDefinition per MA type, all in this file.
// SMA, EMA, WMA, TEMA share the same paramSchema shape.

export const smaIndicator: IndicatorDefinition = {
  id: IndicatorId.SMA,
  name: 'Simple Moving Average',
  category: 'trend',
  paramSchema: [
    { key: 'period', label: 'Period', type: 'integer', default: 20, min: 2, max: 500 },
  ],
  defaultParams: { period: 20 },
  minBarsRequired: (params) => Number(params.period),
  compute(bars, params) { /* SMA math */ },
};

export const emaIndicator: IndicatorDefinition = {
  id: IndicatorId.EMA,
  name: 'Exponential Moving Average',
  category: 'trend',
  paramSchema: [
    { key: 'period', label: 'Period', type: 'integer', default: 20, min: 2, max: 500 },
  ],
  defaultParams: { period: 20 },
  minBarsRequired: (params) => Number(params.period),
  compute(bars, params) { /* EMA math */ },
};

// ... WMA, TEMA, etc.
```

---

## Layer 2: Strategies (Pure Rules)

### What a Strategy Is

A rubric that takes **pre-computed indicator values** and applies deterministic rules to produce buy/sell/hold decisions. A strategy never calls an indicator function or touches raw bars.

### Strategy Contract

```typescript
/** Unique identifier for each strategy */
enum StrategyId {
  RSI_REVERSAL    = 'RSI_REVERSAL',
  MA_CROSSOVER    = 'MA_CROSSOVER',
  MACD_CROSSOVER  = 'MACD_CROSSOVER',
}

/** What every strategy file must export */
interface StrategyDefinition {
  id: StrategyId;
  name: string;
  description: string;
  requiredIndicators: IndicatorSpec[];            // Declares dependencies
  paramSchema: ParamField[];                      // Strategy-specific thresholds
  defaultParams: Record<string, number | string>;
  evaluate: StrategyEvaluateFn;
}

/** What the strategy declares it needs */
interface IndicatorSpec {
  id: IndicatorId;
  params: Record<string, number | string>;
  /** Key used to look up this indicator's result in the snapshot */
  snapshotKey: string;                            // e.g., "RSI:14", "SMA:20", "SMA:50"
}

/** Pre-computed indicator values passed to the strategy */
interface IndicatorSnapshot {
  [snapshotKey: string]: IndicatorResult;         // e.g., { "RSI:14": { values: [...] } }
}

/** Pure evaluate function — snapshot + params in, signals out */
type StrategyEvaluateFn = (
  snapshot: IndicatorSnapshot,
  params: Record<string, number | string>,
  barCount: number
) => StrategySignal[];

/** What a strategy returns — per-bar signals */
interface StrategySignal {
  barIndex: number;
  action: 'BUY' | 'SELL' | 'HOLD';
  confidence: number;                             // 0-100
  reason: string;
}
```

### Key Rules for Strategies

- **No `rsi(closes, 14)`** — the indicator engine already computed this
- **No bar slicing or close extraction** — strategies see `IndicatorSnapshot`, not bars
- **Declare dependencies** — `requiredIndicators` tells the orchestrator what to compute
- **Output is per-bar** — for historical backtesting, a strategy produces a signal for every bar
- **Related rules can share a file** — RSI oversold + RSI overbought = one `rsi-reversal.strategy.ts`

### Example: RSI Reversal Strategy File

```typescript
// rsi-reversal.strategy.ts — Oversold bounce + overbought fade. No indicator math.

export const rsiReversalStrategy: StrategyDefinition = {
  id: StrategyId.RSI_REVERSAL,
  name: 'RSI Reversal',
  description: 'BUY when RSI oversold, SELL when RSI overbought',

  requiredIndicators: [
    { id: IndicatorId.RSI, params: { period: 14 }, snapshotKey: 'RSI:14' },
  ],

  paramSchema: [
    { key: 'oversoldThreshold', label: 'Oversold Level', type: 'integer', default: 30, min: 10, max: 50 },
    { key: 'overboughtThreshold', label: 'Overbought Level', type: 'integer', default: 70, min: 50, max: 90 },
  ],
  defaultParams: { oversoldThreshold: 30, overboughtThreshold: 70 },

  evaluate(snapshot, params, barCount): StrategySignal[] {
    const rsi = snapshot['RSI:14'];
    const oversold = Number(params.oversoldThreshold);
    const overbought = Number(params.overboughtThreshold);
    const signals: StrategySignal[] = [];

    for (let i = 0; i < barCount; i++) {
      const val = rsi.values[i];
      if (isNaN(val)) continue;

      if (val < oversold) {
        signals.push({ barIndex: i, action: 'BUY', confidence: /*...*/, reason: `RSI ${val.toFixed(1)} < ${oversold}` });
      } else if (val > overbought) {
        signals.push({ barIndex: i, action: 'SELL', confidence: /*...*/, reason: `RSI ${val.toFixed(1)} > ${overbought}` });
      }
    }
    return signals;
  },
};
```

### Example: MA Crossover Strategy File

```typescript
// ma-crossover.strategy.ts — Two-MA crossover. No indicator math.

export const maCrossoverStrategy: StrategyDefinition = {
  id: StrategyId.MA_CROSSOVER,
  name: 'MA Crossover',
  description: 'BUY when fast MA crosses above slow MA, SELL on cross below',

  requiredIndicators: [
    { id: IndicatorId.SMA, params: { period: 10 }, snapshotKey: 'SMA:10' },
    { id: IndicatorId.SMA, params: { period: 20 }, snapshotKey: 'SMA:20' },
  ],

  paramSchema: [
    { key: 'fastPeriod', label: 'Fast MA Period', type: 'integer', default: 10, min: 2, max: 50 },
    { key: 'slowPeriod', label: 'Slow MA Period', type: 'integer', default: 20, min: 5, max: 200 },
    { key: 'maType', label: 'MA Type', type: 'select', default: 'SMA',
      options: [
        { label: 'Simple', value: 'SMA' },
        { label: 'Exponential', value: 'EMA' },
      ] },
  ],
  defaultParams: { fastPeriod: 10, slowPeriod: 20, maType: 'SMA' },

  evaluate(snapshot, params, barCount): StrategySignal[] {
    const fast = snapshot[`${params.maType}:${params.fastPeriod}`];
    const slow = snapshot[`${params.maType}:${params.slowPeriod}`];
    const signals: StrategySignal[] = [];

    for (let i = 1; i < barCount; i++) {
      const prevFast = fast.values[i - 1], prevSlow = slow.values[i - 1];
      const currFast = fast.values[i], currSlow = slow.values[i];
      if (isNaN(prevFast) || isNaN(currFast)) continue;

      if (prevFast <= prevSlow && currFast > currSlow) {
        signals.push({ barIndex: i, action: 'BUY', confidence: /*...*/, reason: 'Bullish MA crossover' });
      } else if (prevFast >= prevSlow && currFast < currSlow) {
        signals.push({ barIndex: i, action: 'SELL', confidence: /*...*/, reason: 'Bearish MA crossover' });
      }
    }
    return signals;
  },
};
```

---

## Layer 3: Orchestrator (Glue)

The orchestrator bridges indicators and strategies. It operates in two modes.

---

## Execution Modes

### Execution Context

```typescript
interface ExecutionContext {
  mode: 'current' | 'historical';

  /**
   * Current mode: 'all' scans the full universe (watchlist or configured symbol set).
   * Historical mode: explicit symbol list (typically one at a time).
   */
  symbols: 'all' | string[];

  /** Strategy + user params */
  strategyId: StrategyId;
  strategyParams: Record<string, number | string>;

  /** Bar depth override. Defaults: current=50, historical=252 */
  barCount?: number;

  /** Historical range (historical mode only) */
  startDate?: Date;
  endDate?: Date;
}
```

### Current Mode — "What should I trade today?"

| Aspect | Detail |
|--------|--------|
| **Intent** | Scan full universe for actionable signals now |
| **Symbols** | `'all'` — resolved from watchlist/universe config |
| **Bar depth** | Minimum needed (e.g., 50 bars for RSI 14) |
| **Signals kept** | Only the latest actionable signal per symbol |
| **Trigger** | Scheduled Cloud Function or "Scan Now" button |
| **Output** | Trade opportunity list → left panel |

```
Scheduled trigger → resolve 'all' symbols from universe
  → For each symbol:
      → Fetch last 50 bars (minimal data)
      → indicatorEngine.computeAll(bars, strategy.requiredIndicators)
      → strategy.evaluate(snapshot, params, barCount)
      → Take ONLY the last actionable signal: signals.filter(s => s.action !== 'HOLD').pop()
      → If signal exists → store as opportunity in Firestore
  → Result: list of trade opportunities
```

### Historical Mode — "How did this strategy perform?"

| Aspect | Detail |
|--------|--------|
| **Intent** | Evaluate strategy quality on past data |
| **Symbols** | Explicit list, typically one at a time |
| **Bar depth** | Full range (252 for 1yr, 1260 for 5yr, or date-bounded) |
| **Signals kept** | All signals across all bars |
| **Trigger** | User picks symbol + date range + strategy, clicks "Backtest" |
| **Output** | All signals → chart markers + stats panel |

```
User selects AAPL + "RSI Reversal" + 1 year
  → Fetch 252 bars
  → indicatorEngine.computeAll(bars, strategy.requiredIndicators)
  → strategy.evaluate(snapshot, params, 252)
  → Return ALL signals (e.g., 15 BUY + 12 SELL over the year)
  → statsCalculator.pairTrades(signals, bars) → TradeResult[]
  → statsCalculator.computeStats(trades) → HistoricalStats
  → Chart: render every signal as a marker
  → Stats panel: win rate, profit factor, expectancy, etc.
```

---

## Execution Output

### Result Structure

```typescript
interface ExecutionResult {
  mode: 'current' | 'historical';
  results: SymbolResult[];
  /** Aggregate stats — populated in historical mode */
  stats?: HistoricalStats;
}

interface SymbolResult {
  symbol: string;
  signals: StrategySignal[];
  /** Per-symbol stats (historical mode) */
  stats?: SymbolStats;
}
```

### Per-Symbol Stats (Historical)

```typescript
interface SymbolStats {
  totalSignals: number;
  buys: number;
  sells: number;
  trades: TradeResult[];          // Paired BUY→SELL as completed round-trips
}

/** A completed round-trip trade (BUY entry → SELL exit) */
interface TradeResult {
  entryBarIndex: number;
  exitBarIndex: number;
  entryPrice: number;
  exitPrice: number;
  returnPct: number;              // (exit - entry) / entry
  holdingBars: number;
  result: 'win' | 'loss';
}
```

### Aggregate Stats (Historical)

```typescript
interface HistoricalStats {
  totalTrades: number;
  wins: number;
  losses: number;
  winRate: number;                // wins / totalTrades
  avgWinPct: number;
  avgLossPct: number;
  profitFactor: number;           // gross gains / gross losses
  avgHoldingBars: number;
  maxConsecutiveLosses: number;
  maxDrawdownPct: number;
  expectancy: number;             // (winRate × avgWin) - (lossRate × avgLoss)
  sharpeRatio?: number;
}
```

### Stats Calculator (Separate Module)

The strategy only produces signals. Trade pairing and performance stats are a separate concern:

```
strategy.evaluate() → StrategySignal[]
  → statsCalculator.pairTrades(signals, bars) → TradeResult[]
  → statsCalculator.computeStats(trades) → HistoricalStats
```

This keeps strategies pure and stats logic reusable across any strategy.

---

## Orchestrator Implementation

```typescript
// strategy-engine.ts

function runStrategy(context: ExecutionContext): ExecutionResult {
  const strategy = strategyRegistry.get(context.strategyId);
  const symbols = context.symbols === 'all'
    ? resolveUniverse()           // Fetch from watchlist/universe config
    : context.symbols;
  const barCount = context.barCount ?? (context.mode === 'current' ? 50 : 252);
  const results: SymbolResult[] = [];

  for (const symbol of symbols) {
    const bars = fetchBars(symbol, barCount, context.startDate, context.endDate);
    const specs = resolveIndicatorSpecs(strategy, context.strategyParams);
    const snapshot = indicatorEngine.computeAll(bars, specs);
    const signals = strategy.evaluate(snapshot, context.strategyParams, bars.length);

    if (context.mode === 'current') {
      const latest = signals.filter(s => s.action !== 'HOLD').pop();
      if (latest) results.push({ symbol, signals: [latest] });
    } else {
      const trades = statsCalculator.pairTrades(signals, bars);
      results.push({ symbol, signals, stats: { totalSignals: signals.length, buys: signals.filter(s => s.action === 'BUY').length, sells: signals.filter(s => s.action === 'SELL').length, trades } });
    }
  }

  const stats = context.mode === 'historical'
    ? statsCalculator.computeStats(results.flatMap(r => r.stats?.trades ?? []))
    : undefined;

  return { mode: context.mode, results, stats };
}
```

---

## Frontend Chart Integration

```
User picks indicators from dropdown
  → indicatorRegistry.list() populates the dropdown
  → User configures params via dialog (driven by paramSchema)
  → flex-chart computes indicator values from bars
  → Renders on appropriate pane (main overlay or lower pane)

User applies a strategy overlay
  → Strategy's requiredIndicators auto-added to chart if not already present
  → Strategy signals rendered as dot/arrow markers on price pane
```

---

## File Structure

```
functions/src/rh-agent-cloud-function/
  indicators/
    indicator.types.ts              ← IndicatorId, IndicatorDefinition, IndicatorResult, ParamField
    indicator-registry.ts           ← Registry: maps IndicatorId → definition, list(), compute()
    ma.indicator.ts                 ← SMA, EMA, WMA, TEMA (grouped — same concept, different smoothing)
    rsi.indicator.ts                ← RSI only
    macd.indicator.ts               ← MACD only
    bollinger.indicator.ts          ← Bollinger Bands only
    atr.indicator.ts                ← ATR only

  strategies/
    strategy.types.ts               ← StrategyId, StrategyDefinition, StrategySignal, IndicatorSnapshot
    strategy-registry.ts            ← Registry: maps StrategyId → definition, list(), evaluate()
    rsi-reversal.strategy.ts        ← RSI oversold bounce + overbought fade
    ma-crossover.strategy.ts        ← Two-MA crossover (configurable MA type + periods)
    macd-crossover.strategy.ts      ← MACD histogram flip / line crossover

  stats/
    stats-calculator.ts             ← pairTrades(), computeStats()
    stats.types.ts                  ← TradeResult, SymbolStats, HistoricalStats

  indicator-engine.ts               ← computeAll(bars, IndicatorSpec[]) → IndicatorSnapshot
  strategy-engine.ts                ← runStrategy(context: ExecutionContext) → ExecutionResult

src/app/features/shared/components/flex-chart/
  flex-chart-calculations.ts        ← Frontend indicator compute (same math, browser context)
  flex-chart.types.ts               ← Chart-specific types (IndicatorConfig, FlexChartConfig)
  flex-chart.component.ts           ← Syncfusion chart rendering
```

---

## Grouping Rules

| Question | Answer |
|----------|--------|
| SMA + EMA + WMA + TEMA in same file? | **Yes** — all MA variants, same interface, one `ma.indicator.ts` with MaType param |
| RSI + MACD in same file? | **No** — fundamentally different calculations |
| RSI oversold + RSI overbought in same file? | **Yes** — same indicator, mirrored rules, one `rsi-reversal.strategy.ts` |
| MA crossover + MACD crossover in same file? | **No** — different indicators, different logic |
| Composite (RSI + MA + MACD) strategy? | **Own file** — declares all three as requiredIndicators |

---

## Data Flow Summary

```
                    ┌─────────────────┐
                    │   Raw OHLCV     │
                    │     Bars        │
                    └────────┬────────┘
                             │
                    ┌────────▼────────┐
                    │   Indicator     │    Reads strategy.requiredIndicators
                    │    Engine       │    Computes each indicator once
                    └────────┬────────┘
                             │
                    ┌────────▼────────┐
                    │   Indicator     │    Flat map: { "RSI:14": {...}, "SMA:20": {...} }
                    │   Snapshot      │    Just numbers — no trading logic
                    └────────┬────────┘
                             │
              ┌──────────────┼──────────────┐
              │              │              │
     ┌────────▼──────┐  ┌───▼────┐  ┌──────▼───────┐
     │  Strategy      │  │ Chart  │  │  Stats       │
     │  evaluate()    │  │ render │  │  Calculator  │
     │  → signals     │  │ panes  │  │  → trades    │
     └───────┬───────┘  └────────┘  └──────┬───────┘
             │                              │
             └──────────────┬───────────────┘
                            │
                   ┌────────▼────────┐
                   │  ExecutionResult │
                   │  signals + stats │
                   └─────────────────┘
```

---

## User Workflow

### Adding Indicators to Chart

1. User clicks "Add Indicator" → dropdown populated from `indicatorRegistry.list()`
2. Selects "RSI" → config dialog shows `paramSchema`: Period (default 14)
3. User adjusts period to 10, clicks Apply
4. Chart adds RSI(10) to lower pane
5. Repeat for more indicators — each gets its own pane or overlays on main

### Current Mode — Scanning for Trades

1. Scheduled run or "Scan Now" → executes with `{ mode: 'current', symbols: 'all' }`
2. Scans full universe with minimal bar depth
3. Latest actionable signal per symbol stored as opportunity
4. Signal list panel shows today's trade candidates

### Historical Mode — Evaluating a Strategy

1. User selects symbol (AAPL), strategy (RSI Reversal), date range (1 year)
2. Executes with `{ mode: 'historical', symbols: ['AAPL'] }`
3. All signals returned + trades paired + stats computed
4. Chart shows signal markers at each bar where rules fired
5. Stats panel shows: win rate, profit factor, expectancy, max drawdown, etc.

---

## Benefits

| Benefit | How |
|---------|-----|
| **Clarity** | Reading a strategy file shows only business logic. Reading an indicator file shows only math. |
| **Testability** | Strategies tested with mock `IndicatorSnapshot`. No bar fixtures needed. |
| **Composability** | One indicator computed once, reused by multiple strategies and the chart. |
| **Pluggability** | Swap custom RSI implementation → every strategy and chart using RSI gets it automatically. |
| **UI-driven** | `paramSchema` arrays auto-generate config dialogs. Registries auto-populate dropdowns. |
| **Extensibility** | New indicator = one file + register. New strategy = one file + register. Zero changes elsewhere. |
| **Dual-mode** | Same strategy code works for real-time scanning and historical backtesting. |
| **Stats separation** | Trade pairing and performance metrics are independent of strategy logic. |

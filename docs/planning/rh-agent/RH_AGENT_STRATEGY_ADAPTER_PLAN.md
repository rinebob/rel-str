# RH Agent Strategy Adapter Architecture Plan

## Executive Summary

Transform the RH Agent from a single hard-coded RSI strategy into a **plugin-based strategy engine** where multiple trading strategies can be registered, configured, and executed with zero code changes to the core pipeline.

## Goals

1. **Zero-friction strategy addition** - New strategies are just new files
2. **Runtime strategy selection** - Choose strategy per run or per symbol
3. **Configuration-driven** - Strategy parameters live in Firestore, not code
4. **Standardized I/O** - All strategies speak the same interface
5. **Backtest-friendly** - Strategies can be run against historical data
6. **UI-discoverable** - Frontend can list and configure all available strategies

## Core Architecture

### 1. The Strategy Port (Interface Contract)

Every strategy must implement:

```
Input:
  - symbol: string
  - marketDate: string
  - bars: OHLCV[] (historical bars from rs-symbol-cache)
  - intraday: IntradaySnapshot (optional, from PDR payload)
  - context: StrategyContext (market regime, sector, etc.)
  - config: StrategyConfig (parameters from Firestore)

Output (Standardized Signal):
  - action: 'BUY' | 'SELL' | 'HOLD' | null
  - confidence: number (0-100)
  - reason: string (human-readable)
  - signalType: string (strategy identifier)
  - metadata: object (strategy-specific data for UI)
  - indicators: object (RSI, MACD, etc. for display)

Throws:
  - StrategyError (insufficient data, calculation failure)
```

### 2. Strategy Registry (Factory Pattern)

**Central registry** that maps strategy names to implementations:

```
Registry:
  - register(name: string, implementation: StrategyAdapter): void
  - get(name: string): StrategyAdapter
  - list(): StrategyMetadata[] (for UI dropdown)
  - validate(config: StrategyConfig): boolean
```

**Auto-discovery mechanism:**
- Strategies are files in `strategies/` folder
- Each exports a `strategyMetadata` object + `execute` function
- Registry scans folder at cold start to populate

### 3. Configuration Layer

**Firestore Collections:**

```
rh-agent-strategies (global registry)
  - strategyId: "rsi-oversold-bounce"
  - displayName: "RSI Oversold Bounce"
  - description: "..."
  - defaultConfig: { rsiPeriod: 14, threshold: 30, priceDrop: -0.02 }
  - enabled: true
  - category: "momentum" | "mean-reversion" | "breakout"
  - author: "system" | "user-created"
  - version: "1.0.0"

rh-agent-strategy-assignments (per-symbol overrides)
  - symbol: "AAPL"
  - primaryStrategy: "rsi-oversold-bounce"
  - configOverrides: { threshold: 25 }  // AAPL uses tighter threshold

rh-agent-runs/{runId} (strategy selection per run)
  - strategy: "rsi-oversold-bounce"  // or "multi-strategy"
  - strategyConfig: { ... }  // runtime overrides
```

### 4. Strategy Execution Engine

**Replaces hard-coded logic in rh-agent-worker:**

```
StrategyEngine:
  - loadStrategy(strategyName: string): StrategyAdapter
  - execute(symbol, bars, intraday, context): Signal
  - handleErrors(): Log and continue
  - emitMetrics(): Per-strategy performance tracking
```

**Multi-strategy mode:**
- Run can execute multiple strategies per symbol
- Each strategy gets same input, produces independent signal
- Signals aggregated or ranked by confidence

### 5. Strategy Implementation Structure

**File layout:**
```
rh-agent-cloud-function/
  strategies/
    index.ts              # Registry and exports
    base-strategy.ts      # Abstract base class
    
    rsi-oversold-bounce/
      index.ts            # Strategy implementation
      config-schema.ts    # Zod/JSON schema for validation
      test.spec.ts        # Unit tests
      README.md           # Strategy documentation
    
    macd-crossover/
      index.ts
      ...
    
    volume-breakout/
      index.ts
      ...
    
  indicators/           # Shared technical indicators
    rsi.ts
    macd.ts
    bollinger.ts
    ...
```

**Strategy file template:**
```typescript
export const metadata: StrategyMetadata = {
  id: 'rsi-oversold-bounce',
  name: 'RSI Oversold Bounce',
  description: 'Detects oversold conditions with RSI < threshold',
  category: 'mean-reversion',
  defaultConfig: { rsiPeriod: 14, threshold: 30, priceDrop: -0.02 },
  minBarsRequired: 14,
  supportedTimeframes: ['1d', '1h'],
};

export function execute(
  input: StrategyInput,
  config: RsiOversoldConfig
): StrategyOutput {
  // Implementation
}
```

### 6. Validation & Safety

**Config validation:**
- JSON Schema or Zod validation per strategy
- Range checks (e.g., RSI period 5-50, threshold 10-50)
- Type safety via TypeScript generics

**Strategy sandboxing:**
- Timeout per strategy execution (5 seconds max)
- Resource limits (memory, CPU)
- Error isolation (one strategy crash doesn't kill worker)

### 7. Backtesting Support

**Historical runner:**
```
StrategyBacktester:
  - runStrategy(strategyName, dateRange, symbols)
  - replay historical bars through strategy
  - collect signals, compare to actual outcomes
  - generate performance report (win rate, avg return, max drawdown)
```

**Firestore results:**
```
rh-agent-backtests/{backtestId}
  - strategy: "rsi-oversold-bounce"
  - dateRange: [start, end]
  - symbols: [...]
  - signals: [...]
  - performance: { winRate, avgReturn, sharpeRatio }
```

### 8. UI Integration

**Dashboard additions:**
- Strategy selector dropdown (populated from registry)
- Strategy config editor (JSON or form-based from schema)
- Strategy performance comparison chart
- "Backtest Strategy" button
- Strategy assignment grid (which symbols use which strategies)

**API additions:**
```
rhAgentListStrategies() → StrategyMetadata[]
rhAgentBacktestStrategy(request) → BacktestResult
rhAgentGetStrategyPerformance(strategyName) → Metrics
```

## Migration Path

### Phase 1: Extract Current Strategy (No behavior change)
1. Create `strategies/` folder structure
2. Move existing RSI logic to `strategies/rsi-oversold-bounce/`
3. Implement registry with single registered strategy
4. Worker calls registry instead of hard-coded logic

### Phase 2: Add Configuration Layer
1. Create `rh-agent-strategies` collection
2. Seed with RSI strategy default config
3. Worker reads config from Firestore
4. Add strategy selection to run document

### Phase 3: Multi-Strategy Support
1. Add second strategy (e.g., MACD crossover)
2. Enable per-symbol strategy assignment
3. Add strategy aggregation logic

### Phase 4: Backtesting & UI
1. Build backtest runner
2. Add dashboard strategy management
3. Performance analytics per strategy

## Key Design Decisions

### 1. Registry vs. Dependency Injection
- **Chosen:** Central registry with auto-discovery
- **Why:** Zero config, just drop in a new strategy file
- **Alternative:** Constructor injection (more explicit, more boilerplate)

### 2. Firestore vs. In-Memory Config
- **Chosen:** Firestore for strategy configs
- **Why:** Runtime adjustable, survives deploys, UI editable
- **Tradeoff:** 50-100ms read latency (acceptable for batch processing)

### 3. Per-Symbol vs. Global Strategies
- **Chosen:** Both supported
- **Default:** Global strategy from run document
- **Override:** Per-symbol assignment in `rh-agent-strategy-assignments`

### 4. Strategy Composition
- **Chosen:** Independent strategies, results merged
- **Alternative:** Strategy composition (strategies calling strategies)
- **Why:** Simpler, easier to debug, test in isolation

### 5. Error Handling
- **Chosen:** Fail open (log error, continue to next symbol)
- **Alternative:** Fail closed (stop run on strategy error)
- **Why:** One bad strategy shouldn't kill the entire agent run

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| Strategy name collision | Namespaced IDs: `author/strategy-name` |
| Infinite loops in strategy | 5-second timeout per execution |
| Resource exhaustion | Max 20 concurrent workers, memory limits |
| Config drift | Schema validation on every read |
| Strategy bloat | UI categorization, enabled/disabled flag |
| Performance regression | Per-strategy metrics, slow strategy alerts |

## Success Metrics

1. **Time to new strategy:** Developer can add strategy in < 30 minutes
2. **Zero deploy changes:** Strategies added without touching worker code
3. **Config flexibility:** Any strategy parameter adjustable via UI
4. **Testability:** Each strategy has isolated unit tests
5. **Observability:** Per-strategy signal count, performance metrics visible

## Next Steps

1. **Review this plan** - Identify gaps or concerns
2. **Phase 1 implementation** - Extract current RSI strategy
3. **Create strategy template** - Document for future strategy developers
4. **Add one new strategy** - Validate the adapter pattern (suggest: MACD crossover)
5. **Build backtest runner** - Enable strategy comparison

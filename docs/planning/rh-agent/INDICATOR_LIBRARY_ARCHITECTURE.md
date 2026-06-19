# Indicator Library Architecture

## Overview

The Indicator Library provides a **uniform interface** for all technical indicators, enabling infinite indicator implementations while maintaining a single, consistent consumption pattern. Indicators are **encapsulated calculation engines** that implement a common contract, allowing polymorphic usage across strategies.

## Core Design Principles

1. **Single Interface Contract** - All indicators implement `IIndicator<TConfig, TOutput>`
2. **Encapsulation** - Each indicator owns its configuration, state, and calculation logic
3. **Polymorphic Registry** - Strategies consume indicators through the interface, not concrete types
4. **Calculation Engine Documentation** - Each indicator's "secret sauce" is documented as a first-class concern
5. **Composable Building Blocks** - Indicators can be combined to create complex signals

---

## The Indicator Port (Interface Contract)

Every indicator must implement the `IIndicator` interface:

```typescript
/**
 * Core interface for all technical indicators.
 * Provides a uniform contract for calculation, configuration, and metadata.
 */
export interface IIndicator<TConfig, TOutput> {
  /** Indicator metadata for discovery and documentation */
  readonly metadata: IndicatorMetadata;
  
  /** Current configuration state */
  readonly config: TConfig;
  
  /** 
   * Apply configuration changes.
   * Validates and merges partial config with defaults.
   */
  configure(config: Partial<TConfig>): void;
  
  /**
   * Execute the indicator calculation.
   * @param bars - OHLCV price data
   * @returns Typed indicator output
   */
  calculate(bars: OHLCV[]): TOutput;
  
  /** 
   * Get minimum bars required for accurate calculation.
   * Used for validation before execution.
   */
  getRequiredBars(): number;
  
  /**
   * Validate current configuration.
   * @returns Validation result with errors if invalid
   */
  validateConfig(): ValidationResult;
}

export interface IndicatorMetadata {
  id: string;                    // Unique identifier (e.g., "rsi")
  name: string;                  // Display name (e.g., "Relative Strength Index")
  description: string;           // Human-readable description
  category: 'momentum' | 'trend' | 'volatility' | 'volume' | 'custom';
  version: string;               // Semantic version
  author: string;                // Creator attribution
  
  /** 
   * Links to calculation engine documentation.
   * Critical for understanding the indicator's logic.
   */
  documentation: {
    overview: string;            // High-level explanation
    calculation: string;         // Mathematical formula / algorithm
    parameters: string;          // Parameter descriptions
    interpretation: string;      // How to read the output
    references: string[];        // Academic/technical references
  };
}
```

---

## Calculation Engine Surface

### Input Surface (What the Indicator Accepts)

```typescript
/**
 * Standard OHLCV bar structure.
 * All indicators consume this uniform format.
 */
export interface OHLCV {
  timestamp: number;           // Unix timestamp (ms)
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

/**
 * Extended context for advanced indicators.
 * Optional market context (sector, regime, etc.)
 */
export interface IndicatorContext {
  symbol: string;
  marketRegime?: 'bull' | 'bear' | 'neutral' | 'volatile';
  sector?: string;
  timeframe: '1m' | '5m' | '15m' | '1h' | '4h' | '1d' | '1w';
}
```

### Output Surface (What the Indicator Returns)

```typescript
/**
 * Base output - all indicator outputs extend this.
 */
export interface BaseIndicatorOutput {
  /** Primary value(s) - the indicator's main reading */
  values: number | number[] | Record<string, number>;
  
  /** Whether the calculation succeeded */
  valid: boolean;
  
  /** Error message if calculation failed */
  error?: string;
  
  /** Metadata about the calculation */
  meta: {
    barsUsed: number;
    calculationTime: number;   // ms
    timestamp: number;
  };
}

/**
 * Example: RSI Output
 */
export interface RSIOutput extends BaseIndicatorOutput {
  values: {
    rsi: number;                 // 0-100
  };
  
  /** Signal conditions */
  conditions: {
    oversold: boolean;           // RSI < oversoldThreshold
    overbought: boolean;         // RSI > overboughtThreshold
    neutral: boolean;
  };
  
  /** Additional insights */
  insights?: {
    divergence?: 'bullish' | 'bearish' | null;
    strength: 'weak' | 'moderate' | 'strong';
    trend: 'rising' | 'falling' | 'flat';
  };
}

/**
 * Example: MACD Output
 */
export interface MACDOutput extends BaseIndicatorOutput {
  values: {
    macdLine: number;
    signalLine: number;
    histogram: number;
  };
  
  conditions: {
    bullishCross: boolean;       // MACD crosses above signal
    bearishCross: boolean;       // MACD crosses below signal
    positiveHistogram: boolean;
    histogramGrowing: boolean;
  };
}
```

---

## Indicator Implementation Pattern

### RSI Calculation Engine (Example)

```typescript
/**
 * RSI Indicator - Relative Strength Index
 * 
 * Calculation Engine: Wilder's Smoothed Moving Average
 * 
 * Formula:
 *   RS = Average Gain / Average Loss
 *   RSI = 100 - (100 / (1 + RS))
 * 
 * Where Average Gain/Loss uses Wilder's smoothing:
 *   First Average Gain = Sum of gains over first n periods / n
 *   Subsequent Avg Gain = (Prev Avg Gain × (n-1) + Current Gain) / n
 */
export class RSIIndicator implements IIndicator<RSIConfig, RSIOutput> {
  // Default configuration
  private _config: RSIConfig = {
    period: 14,
    source: 'close',
    oversoldThreshold: 30,
    overboughtThreshold: 70,
    smoothing: 'wilder'
  };
  
  // Internal state (optional - for stateful indicators)
  private previousGains: number[] = [];
  private previousLosses: number[] = [];
  
  public readonly metadata: IndicatorMetadata = {
    id: 'rsi',
    name: 'Relative Strength Index',
    description: 'Momentum oscillator measuring speed/change of price movements',
    category: 'momentum',
    version: '1.0.0',
    author: 'rel-str',
    documentation: {
      overview: 'RSI compares magnitude of recent gains to recent losses',
      calculation: `
        1. Calculate price changes: change = price[t] - price[t-1]
        2. Separate gains (positive changes) and losses (absolute negative)
        3. Apply Wilder's smoothing to get Average Gain and Average Loss
        4. RS = Average Gain / Average Loss
        5. RSI = 100 - (100 / (1 + RS))
      `,
      parameters: `
        - period: Lookback window (default: 14)
        - source: Price source - open, high, low, close (default: close)
        - oversold: Threshold for oversold condition (default: 30)
        - overbought: Threshold for overbought (default: 70)
      `,
      interpretation: `
        - RSI > 70: Overbought (potential sell)
        - RSI < 30: Oversold (potential buy)
        - Divergence: Price makes new low, RSI doesn't = bullish reversal signal
      `,
      references: [
        'Wilder, J. Welles (1978). New Concepts in Technical Trading Systems'
      ]
    }
  };
  
  get config(): RSIConfig {
    return { ...this._config };
  }
  
  configure(config: Partial<RSIConfig>): void {
    this._config = { ...this._config, ...config };
    
    const validation = this.validateConfig();
    if (!validation.valid) {
      throw new Error(`Invalid RSI config: ${validation.errors.join(', ')}`);
    }
  }
  
  validateConfig(): ValidationResult {
    const errors: string[] = [];
    
    if (this._config.period < 2 || this._config.period > 100) {
      errors.push('Period must be between 2 and 100');
    }
    if (this._config.oversoldThreshold >= this._config.overboughtThreshold) {
      errors.push('Oversold must be less than overbought');
    }
    
    return {
      valid: errors.length === 0,
      errors
    };
  }
  
  getRequiredBars(): number {
    // Need at least period + 1 bars for first calculation
    return this._config.period + 1;
  }
  
  /**
   * PRIMARY CALCULATION ENGINE
   * 
   * This is the "secret sauce" - the actual RSI algorithm.
   * All indicator complexity lives here.
   */
  calculate(bars: OHLCV[]): RSIOutput {
    const startTime = Date.now();
    
    // 1. Validate input
    if (bars.length < this.getRequiredBars()) {
      return {
        values: { rsi: 0 },
        valid: false,
        error: `Need ${this.getRequiredBars()} bars, got ${bars.length}`,
        conditions: { oversold: false, overbought: false, neutral: true },
        meta: { barsUsed: bars.length, calculationTime: 0, timestamp: Date.now() }
      };
    }
    
    // 2. Extract price series from source
    const prices = this.extractPrices(bars);
    
    // 3. Calculate price changes
    const changes = this.calculateChanges(prices);
    
    // 4. Separate gains and losses
    const gains = changes.map(c => c > 0 ? c : 0);
    const losses = changes.map(c => c < 0 ? Math.abs(c) : 0);
    
    // 5. Apply Wilder's smoothing (THE CORE ALGORITHM)
    const avgGains = this.wilderSmoothing(gains, this._config.period);
    const avgLosses = this.wilderSmoothing(losses, this._config.period);
    
    // 6. Calculate final RSI values
    const rsiValues = this.calculateRSI(avgGains, avgLosses);
    const currentRSI = rsiValues[rsiValues.length - 1];
    
    // 7. Detect divergences and trends
    const insights = this.analyzeRSI(prices, rsiValues);
    
    // 8. Build output
    return {
      values: { rsi: currentRSI },
      valid: true,
      conditions: {
        oversold: currentRSI < this._config.oversoldThreshold,
        overbought: currentRSI > this._config.overboughtThreshold,
        neutral: currentRSI >= this._config.oversoldThreshold && 
                 currentRSI <= this._config.overboughtThreshold
      },
      insights,
      meta: {
        barsUsed: bars.length,
        calculationTime: Date.now() - startTime,
        timestamp: Date.now()
      }
    };
  }
  
  // ==========================================================================
  // PRIVATE CALCULATION METHODS (Internal to the engine)
  // ==========================================================================
  
  private extractPrices(bars: OHLCV[]): number[] {
    const source = this._config.source;
    return bars.map(bar => {
      switch (source) {
        case 'open': return bar.open;
        case 'high': return bar.high;
        case 'low': return bar.low;
        case 'close': return bar.close;
        default: return bar.close;
      }
    });
  }
  
  private calculateChanges(prices: number[]): number[] {
    return prices.slice(1).map((price, i) => price - prices[i]);
  }
  
  /**
   * WILDER'S SMOOTHING ALGORITHM
   * 
   * The heart of RSI calculation. Unlike simple moving average,
   * Wilder's method applies exponential weighting to recent data.
   */
  private wilderSmoothing(values: number[], period: number): number[] {
    const smoothed: number[] = [];
    
    // First value: simple average of first n periods
    let avg = values.slice(0, period).reduce((a, b) => a + b, 0) / period;
    smoothed.push(avg);
    
    // Subsequent values: Wilder's smoothing formula
    for (let i = period; i < values.length; i++) {
      avg = (avg * (period - 1) + values[i]) / period;
      smoothed.push(avg);
    }
    
    return smoothed;
  }
  
  private calculateRSI(avgGains: number[], avgLosses: number[]): number[] {
    return avgGains.map((gain, i) => {
      const loss = avgLosses[i];
      if (loss === 0) return 100;  // No losses = pure bullish
      const rs = gain / loss;
      return 100 - (100 / (1 + rs));
    });
  }
  
  private analyzeRSI(prices: number[], rsiValues: number[]): RSIOutput['insights'] {
    const currentRSI = rsiValues[rsiValues.length - 1];
    const previousRSI = rsiValues[rsiValues.length - 2];
    
    // Calculate trend
    let trend: 'rising' | 'falling' | 'flat' = 'flat';
    if (currentRSI > previousRSI + 1) trend = 'rising';
    else if (currentRSI < previousRSI - 1) trend = 'falling';
    
    // Calculate strength
    let strength: 'weak' | 'moderate' | 'strong' = 'weak';
    const distanceFrom50 = Math.abs(currentRSI - 50);
    if (distanceFrom50 > 30) strength = 'strong';
    else if (distanceFrom50 > 15) strength = 'moderate';
    
    // Detect divergence (simplified)
    const divergence = this.detectDivergence(prices, rsiValues);
    
    return {
      divergence,
      trend,
      strength
    };
  }
  
  private detectDivergence(
    prices: number[], 
    rsiValues: number[]
  ): 'bullish' | 'bearish' | null {
    // Simplified: check last 5 bars
    const priceLow1 = Math.min(...prices.slice(-10, -5));
    const priceLow2 = Math.min(...prices.slice(-5));
    const rsiLow1 = Math.min(...rsiValues.slice(-10, -5));
    const rsiLow2 = Math.min(...rsiValues.slice(-5));
    
    // Bullish divergence: price lower low, RSI higher low
    if (priceLow2 < priceLow1 && rsiLow2 > rsiLow1) {
      return 'bullish';
    }
    
    // Bearish divergence: price higher high, RSI lower high
    const priceHigh1 = Math.max(...prices.slice(-10, -5));
    const priceHigh2 = Math.max(...prices.slice(-5));
    const rsiHigh1 = Math.max(...rsiValues.slice(-10, -5));
    const rsiHigh2 = Math.max(...rsiValues.slice(-5));
    
    if (priceHigh2 > priceHigh1 && rsiHigh2 < rsiHigh1) {
      return 'bearish';
    }
    
    return null;
  }
}
```

---

## Indicator Registry

The registry provides polymorphic access to all indicators:

```typescript
/**
 * Central registry for indicator discovery and instantiation.
 * Strategies consume indicators through the registry, not concrete types.
 */
export class IndicatorRegistry {
  private indicators = new Map<string, new () => IIndicator<any, any>>();
  private instances = new Map<string, IIndicator<any, any>>();
  
  /**
   * Register an indicator class.
   * Called at module initialization.
   */
  register<TConfig, TOutput>(
    id: string, 
    IndicatorClass: new () => IIndicator<TConfig, TOutput>
  ): void {
    this.indicators.set(id, IndicatorClass);
    
    // Pre-instantiate for performance
    this.instances.set(id, new IndicatorClass());
  }
  
  /**
   * Get an indicator instance by ID.
   * Returns the polymorphic interface, not concrete type.
   */
  get<TConfig, TOutput>(id: string): IIndicator<TConfig, TOutput> {
    const indicator = this.instances.get(id);
    if (!indicator) {
      throw new Error(`Indicator '${id}' not registered`);
    }
    return indicator;
  }
  
  /**
   * Get multiple indicators for batch processing.
   */
  getMany(ids: string[]): IIndicator<any, any>[] {
    return ids.map(id => this.get(id));
  }
  
  /**
   * List all registered indicators (for UI discovery).
   */
  list(): IndicatorMetadata[] {
    return Array.from(this.instances.values()).map(i => i.metadata);
  }
  
  /**
   * Calculate with any registered indicator (polymorphic usage).
   * This is the primary consumption method for strategies.
   */
  calculate(
    indicatorId: string, 
    bars: OHLCV[], 
    config?: Record<string, any>
  ): BaseIndicatorOutput {
    const indicator = this.get(indicatorId);
    
    if (config) {
      indicator.configure(config);
    }
    
    return indicator.calculate(bars);
  }
}

// Singleton registry instance
export const indicatorRegistry = new IndicatorRegistry();

// Auto-registration at module load
indicatorRegistry.register('rsi', RSIIndicator);
indicatorRegistry.register('macd', MACDIndicator);
indicatorRegistry.register('bollinger', BollingerBandsIndicator);
// ... etc
```

---

## Strategy Consumption Pattern

Strategies consume indicators through the registry polymorphically:

```typescript
/**
 * Example: Multi-Indicator Strategy
 * 
 * Uses RSI, MACD, and Volume Profile together.
 * Each indicator calculated independently, results combined.
 */
export class MultiSignalStrategy {
  private indicators: IIndicator<any, any>[];
  
  constructor(indicatorIds: string[]) {
    // Get indicators polymorphically - don't care about concrete types
    this.indicators = indicatorRegistry.getMany(indicatorIds);
  }
  
  analyze(bars: OHLCV[]): TradingSignal | null {
    // Calculate ALL indicators using same interface
    const results = this.indicators.map(ind => ind.calculate(bars));
    
    // Combine signals (e.g., all must agree)
    const buySignals = results.filter(r => 
      r.conditions.oversold || 
      r.conditions.bullishCross
    );
    
    if (buySignals.length >= this.indicators.length * 0.7) {
      return {
        action: 'BUY',
        confidence: this.calculateConfidence(results),
        indicators: results
      };
    }
    
    return null;
  }
  
  private calculateConfidence(results: BaseIndicatorOutput[]): number {
    // Weight confidence by indicator type
    // Implementation details...
    return Math.round(average(results.map(r => r.values.confidence || 50)));
  }
}

// Usage
const strategy = new MultiSignalStrategy(['rsi', 'macd', 'volume-profile']);
const signal = strategy.analyze(priceData);
```

---

## File Structure

```
libs/indicators/                    # Standalone TypeScript library
  src/
    core/
      types.ts                      # IIndicator, BaseIndicatorOutput, OHLCV
      registry.ts                   # IndicatorRegistry singleton
      
    indicators/
      rsi/
        index.ts                    # RSIIndicator class + config
        types.ts                    # RSIConfig, RSIOutput
        test.spec.ts                # Unit tests
        README.md                   # Calculation documentation
      
      macd/
        index.ts
        types.ts
        test.spec.ts
        README.md
      
      bollinger-bands/
        ...
    
    index.ts                        # Public API exports
  
  package.json                      # Library config
  tsconfig.json                     # Strict TypeScript settings
```

---

## Key Benefits

| Benefit | Description |
|---------|-------------|
| **Encapsulation** | Each indicator owns its config, state, calculations |
| **Polymorphism** | Strategies call `calculate()` on any indicator uniformly |
| **Discoverability** | Registry enables UI to list all available indicators |
| **Documentation** | Calculation engines documented as first-class citizens |
| **Testability** | Each indicator tested in isolation with clear inputs/outputs |
| **Extensibility** | New indicator = new file implementing IIndicator |
| **Composition** | Multiple indicators combined for complex signals |
| **Type Safety** | Generic TConfig/TOutput ensures compile-time correctness |

---

## Migration from Current Code

**Current (hard-coded):**
```typescript
// In rh-agent-worker.ts
const rsiValue = rsi(closes);  // Function call, no encapsulation
if (rsiValue < 30 && priceChange < -0.02) { ... }
```

**New (indicator lib):**
```typescript
// Strategy imports from lib
import { indicatorRegistry } from '@rel-str/indicators';

// Get indicator polymorphically
const rsi = indicatorRegistry.get('rsi');
rsi.configure({ period: 14, oversoldThreshold: 30 });

// Calculate using standard interface
const result = rsi.calculate(bars);

if (result.conditions.oversold && result.insights?.divergence === 'bullish') {
  // Act on structured output
}
```

# Example Strategy File: MACD Crossover

This is a complete, drop-in strategy file. Save as:
`functions/src/rh-agent-cloud-function/strategies/macd-crossover/index.ts`

```typescript
/**
 * MACD Crossover Strategy
 * 
 * Detects bullish/bearish MACD crossovers for momentum trading.
 * Bullish: MACD line crosses above signal line (buy)
 * Bearish: MACD line crosses below signal line (sell)
 */

import { macd, ema } from '../../indicators';
import type { 
  StrategyMetadata, 
  StrategyInput, 
  StrategyOutput, 
  StrategyConfig 
} from '../base-strategy';

// =============================================================================
// 1. CONFIGURATION SCHEMA (TypeScript types for this strategy)
// =============================================================================

export interface MacdCrossoverConfig extends StrategyConfig {
  fastPeriod: number;      // Default: 12
  slowPeriod: number;      // Default: 26
  signalPeriod: number;    // Default: 9
  minHistogram: number;    // Min |histogram| to trigger (filters noise)
}

// =============================================================================
// 2. METADATA EXPORT (Registry uses this to discover and document the strategy)
// =============================================================================

export const metadata: StrategyMetadata = {
  id: 'macd-crossover',
  name: 'MACD Crossover',
  description: 'Detects MACD line crossing above/below signal line. Bullish cross = buy, bearish cross = sell. Filters weak signals by minimum histogram threshold.',
  category: 'momentum',
  
  // Default configuration - user can override per run or per symbol
  defaultConfig: {
    fastPeriod: 12,
    slowPeriod: 26,
    signalPeriod: 9,
    minHistogram: 0.5,  // Ignore signals with histogram < 0.5
  } as MacdCrossoverConfig,
  
  // Requirements
  minBarsRequired: 35,  // Need slowPeriod + signalPeriod + buffer
  supportedTimeframes: ['1d', '1h', '15m'],
  
  // Authorship
  version: '1.0.0',
  author: 'system',
  
  // Optional: validation rules (enforced by registry)
  configSchema: {
    fastPeriod: { type: 'integer', min: 5, max: 20 },
    slowPeriod: { type: 'integer', min: 15, max: 50 },
    signalPeriod: { type: 'integer', min: 5, max: 20 },
    minHistogram: { type: 'number', min: 0, max: 5 },
  },
};

// =============================================================================
// 3. MAIN EXECUTION FUNCTION (The strategy logic)
// =============================================================================

export function execute(
  input: StrategyInput,
  config: MacdCrossoverConfig
): StrategyOutput {
  const { symbol, bars, intraday, marketDate, context } = input;
  const { fastPeriod, slowPeriod, signalPeriod, minHistogram } = config;
  
  // Validate we have enough data
  const requiredBars = slowPeriod + signalPeriod + 5;
  if (bars.length < requiredBars) {
    return {
      action: null,
      confidence: 0,
      reason: `Insufficient data: ${bars.length} bars, need ${requiredBars}`,
      signalType: 'MACD_CROSSOVER',
      indicators: { barCount: bars.length },
    };
  }
  
  // Extract closing prices
  const closes = bars.map(b => b.close || b.c || 0).filter(c => c > 0);
  
  // Calculate MACD
  const macdResult = macd(closes, fastPeriod, slowPeriod, signalPeriod);
  
  if (!macdResult) {
    return {
      action: null,
      confidence: 0,
      reason: 'MACD calculation failed (insufficient data)',
      signalType: 'MACD_CROSSOVER',
      indicators: { barCount: closes.length },
    };
  }
  
  const { macdLine, signalLine, histogram } = macdResult;
  
  // Get current and previous values to detect cross
  const currentMACD = macdLine[macdLine.length - 1];
  const prevMACD = macdLine[macdLine.length - 2];
  const currentSignal = signalLine[signalLine.length - 1];
  const prevSignal = signalLine[signalLine.length - 2];
  const currentHistogram = histogram[histogram.length - 1];
  
  // Current price (prefer intraday if available)
  const currentPrice = intraday?.ip ?? closes[closes.length - 1];
  
  // Check for crossover
  const wasBelow = prevMACD < prevSignal;
  const isAbove = currentMACD > currentSignal;
  const wasAbove = prevMACD > prevSignal;
  const isBelow = currentMACD < currentSignal;
  
  const bullishCross = wasBelow && isAbove;
  const bearishCross = wasAbove && isBelow;
  
  // Filter by minimum histogram strength
  const strongEnough = Math.abs(currentHistogram) >= minHistogram;
  
  // =============================================================================
  // 4. SIGNAL GENERATION
  // =============================================================================
  
  if (bullishCross && strongEnough) {
    // Bullish crossover - buy signal
    const confidence = calculateConfidence(currentHistogram, true);
    
    return {
      action: 'BUY',
      confidence,
      reason: `Bullish MACD crossover (histogram: ${currentHistogram.toFixed(2)}). Momentum shifting positive.`,
      signalType: 'MACD_CROSSOVER_BULLISH',
      indicators: {
        macd: currentMACD,
        signal: currentSignal,
        histogram: currentHistogram,
        currentPrice,
      },
      metadata: {
        crossType: 'bullish',
        fastPeriod,
        slowPeriod,
        histogramStrength: currentHistogram,
      },
    };
  }
  
  if (bearishCross && strongEnough) {
    // Bearish crossover - sell signal
    const confidence = calculateConfidence(currentHistogram, false);
    
    return {
      action: 'SELL',
      confidence,
      reason: `Bearish MACD crossover (histogram: ${currentHistogram.toFixed(2)}). Momentum shifting negative.`,
      signalType: 'MACD_CROSSOVER_BEARISH',
      indicators: {
        macd: currentMACD,
        signal: currentSignal,
        histogram: currentHistogram,
        currentPrice,
      },
      metadata: {
        crossType: 'bearish',
        fastPeriod,
        slowPeriod,
        histogramStrength: currentHistogram,
      },
    };
  }
  
  // No signal
  return {
    action: null,
    confidence: 0,
    reason: `No crossover detected. MACD: ${currentMACD.toFixed(2)}, Signal: ${currentSignal.toFixed(2)}, Hist: ${currentHistogram.toFixed(2)}`,
    signalType: 'MACD_CROSSOVER',
    indicators: {
      macd: currentMACD,
      signal: currentSignal,
      histogram: currentHistogram,
    },
  };
}

// =============================================================================
// 5. HELPER FUNCTIONS (Strategy-specific logic)
// =============================================================================

function calculateConfidence(histogram: number, isBullish: boolean): number {
  // Confidence based on histogram magnitude
  // Larger histogram = stronger signal
  const absHistogram = Math.abs(histogram);
  
  // Scale: 0.5 histogram = 50% confidence, 3.0+ histogram = 95% confidence
  const rawConfidence = Math.min(95, 50 + (absHistogram - 0.5) * 20);
  
  return Math.round(rawConfidence);
}

// =============================================================================
// 6. OPTIONAL: UNIT TESTS (Co-located with strategy)
// =============================================================================

if (process.env.NODE_ENV === 'test') {
  describe('MACD Crossover Strategy', () => {
    it('should detect bullish crossover', () => {
      // Mock data with bullish cross pattern
      const mockBars = generateBullishCrossBars();
      const input: StrategyInput = {
        symbol: 'AAPL',
        bars: mockBars,
        marketDate: '2026-06-16',
        context: { marketRegime: 'bullish' },
      };
      
      const result = execute(input, metadata.defaultConfig as MacdCrossoverConfig);
      
      expect(result.action).toBe('BUY');
      expect(result.confidence).toBeGreaterThan(50);
      expect(result.signalType).toBe('MACD_CROSSOVER_BULLISH');
    });
    
    it('should return null for weak signals', () => {
      // Mock data with crossover but weak histogram
      const mockBars = generateWeakCrossBars();
      const input: StrategyInput = {
        symbol: 'AAPL',
        bars: mockBars,
        marketDate: '2026-06-16',
        context: {},
      };
      
      const result = execute(input, { ...metadata.defaultConfig, minHistogram: 2.0 } as MacdCrossoverConfig);
      
      expect(result.action).toBeNull(); // Filtered by minHistogram
    });
  });
}
```

---

## What This Strategy File Provides

| Export | Purpose |
|--------|---------|
| `metadata` | Registry discovers strategy, UI displays info, defaults set |
| `execute()` | Core logic - takes input, returns signal or null |
| `MacdCrossoverConfig` | TypeScript interface for type safety |
| Helper functions | Internal logic (confidence calc, etc.) |
| Unit tests | Co-located, run with strategy file |

## How the Registry Loads It

```typescript
// strategies/index.ts (auto-discovery)
import * as macdCrossover from './macd-crossover';

registry.register(macdCrossover.metadata.id, {
  metadata: macdCrossover.metadata,
  execute: macdCrossover.execute,
});
```

## Firestore Config Override Example

```json
// rh-agent-strategies/macd-crossover
{
  "defaultConfig": {
    "fastPeriod": 12,
    "slowPeriod": 26,
    "signalPeriod": 9,
    "minHistogram": 0.5
  }
}

// rh-agent-strategy-assignments/AAPL (per-symbol override)
{
  "primaryStrategy": "macd-crossover",
  "configOverrides": {
    "minHistogram": 1.0  // AAPL needs stronger confirmation
  }
}
```

## Comparison: Old vs New

**Old (hard-coded):**
```typescript
// In rh-agent-worker.ts
const rsiValue = rsi(closes);
if (rsiValue < 30 && priceChange < -0.02) {
  // create opportunity
}
```

**New (strategy file):**
```typescript
// In strategies/macd-crossover/index.ts
export function execute(input, config) {
  const macdResult = macd(closes, config.fastPeriod, ...);
  if (detectCrossover(macdResult)) {
    return { action: 'BUY', confidence: ..., ... };
  }
  return { action: null, ... };
}
```

**Worker calls registry:**
```typescript
// In rh-agent-worker.ts (one-time implementation)
const strategy = registry.get(strategyName);  // "macd-crossover"
const signal = strategy.execute(input, config);  // Executes above code
```

/**
 * MACD Crossover Strategy
 *
 * Detects bullish/bearish MACD crossovers for momentum trading.
 * Bullish: MACD line crosses above signal line (buy)
 * Bearish: MACD line crosses below signal line (sell)
 */

import { macd } from '../../../rh-agent/indicators';
import {
  IndicatorId,
} from '../base-strategy';
import type {
  StrategyMetadata,
  StrategyInput,
  StrategyOutput,
  StrategyConfig,
  StrategyAdapter,
} from '../base-strategy';

// =============================================================================
// 1. CONFIGURATION SCHEMA
// =============================================================================

export interface MacdCrossoverConfig extends StrategyConfig {
  fastPeriod: number;      // Default: 12
  slowPeriod: number;      // Default: 26
  signalPeriod: number;    // Default: 9
  minHistogram: number;    // Min |histogram| to trigger (filters noise)
  suggestedAmount: number; // Default: 1000
}

// =============================================================================
// 2. METADATA EXPORT
// =============================================================================

export const metadata: StrategyMetadata = {
  id: 'macd-crossover',
  name: 'MACD Crossover',
  description:
    'Detects MACD line crossing above/below signal line. Bullish cross = buy, bearish cross = sell. Filters weak signals by minimum histogram threshold.',
  category: 'momentum',

  defaultConfig: {
    fastPeriod: 12,
    slowPeriod: 26,
    signalPeriod: 9,
    minHistogram: 0.5,
    suggestedAmount: 1000,
  } as MacdCrossoverConfig,

  minBarsRequired: 35, // slowPeriod + signalPeriod
  supportedTimeframes: ['1d', '1h', '15m'],

  version: '1.0.0',
  author: 'system',

  configSchema: {
    fastPeriod: { type: 'integer', min: 5, max: 20, description: 'Fast EMA period' },
    slowPeriod: { type: 'integer', min: 15, max: 50, description: 'Slow EMA period' },
    signalPeriod: { type: 'integer', min: 5, max: 20, description: 'Signal line EMA period' },
    minHistogram: { type: 'number', min: 0, max: 5, description: 'Minimum histogram value to trigger signal' },
    suggestedAmount: { type: 'number', min: 50, max: 100000, description: 'Suggested dollar amount per trade' },
  },
};

// =============================================================================
// 3. MAIN EXECUTION FUNCTION
// =============================================================================

export function execute(input: StrategyInput, config: StrategyConfig): StrategyOutput {
  const { bars, intraday } = input;
  const {
    fastPeriod = 12,
    slowPeriod = 26,
    signalPeriod = 9,
    minHistogram = 0.5,
    suggestedAmount = 1000,
  } = config as MacdCrossoverConfig;

  // Validate we have enough data
  const requiredBars = slowPeriod + signalPeriod + 5;
  if (!bars || bars.length < requiredBars) {
    return {
      action: null,
      confidence: 0,
      reason: `Insufficient data: ${bars?.length || 0} bars, need ${requiredBars}`,
      signalType: `${IndicatorId.MACD}_CROSSOVER`,
      indicators: { barCount: bars?.length || 0 },
    };
  }

  // Extract closing prices
  const closes = bars.map((b: any) => b.close || b.c || 0).filter((c: number) => c > 0);

  if (closes.length < requiredBars) {
    return {
      action: null,
      confidence: 0,
      reason: `Insufficient valid closes: ${closes.length}, need ${requiredBars}`,
      signalType: `${IndicatorId.MACD}_CROSSOVER`,
      indicators: { closesCount: closes.length },
    };
  }

  // Calculate current and previous MACD to detect crossover
  const currentResult = macd(closes, fastPeriod, slowPeriod, signalPeriod);
  const prevResult = macd(closes.slice(0, -1), fastPeriod, slowPeriod, signalPeriod);

  if (!currentResult || !prevResult) {
    return {
      action: null,
      confidence: 0,
      reason: 'MACD calculation failed (insufficient data)',
      signalType: `${IndicatorId.MACD}_CROSSOVER`,
      indicators: { closesCount: closes.length },
    };
  }

  // Detect crossover
  const wasBelow = prevResult.macd < prevResult.signal;
  const isAbove = currentResult.macd > currentResult.signal;
  const wasAbove = prevResult.macd > prevResult.signal;
  const isBelow = currentResult.macd < currentResult.signal;

  const bullishCross = wasBelow && isAbove;
  const bearishCross = wasAbove && isBelow;

  // Filter by minimum histogram strength
  const strongEnough = Math.abs(currentResult.histogram) >= minHistogram;

  // Current price
  const currentPrice = intraday?.ip ?? closes[closes.length - 1];

  // =============================================================================
  // 4. SIGNAL GENERATION
  // =============================================================================

  if (bullishCross && strongEnough) {
    const confidence = calculateConfidence(currentResult.histogram);

    return {
      action: 'BUY',
      confidence,
      reason: `Bullish MACD crossover (histogram: ${currentResult.histogram.toFixed(2)}). Momentum shifting positive.`,
      signalType: `${IndicatorId.MACD}_CROSSOVER_BULLISH`,
      suggestedAmount,
      indicators: {
        [IndicatorId.MACD]: currentResult.macd,
        signal: currentResult.signal,
        histogram: currentResult.histogram,
        currentPrice,
      },
      metadata: {
        crossType: 'bullish',
        fastPeriod,
        slowPeriod,
        signalPeriod,
      },
    };
  }

  if (bearishCross && strongEnough) {
    const confidence = calculateConfidence(currentResult.histogram);

    return {
      action: 'SELL',
      confidence,
      reason: `Bearish MACD crossover (histogram: ${currentResult.histogram.toFixed(2)}). Momentum shifting negative.`,
      signalType: `${IndicatorId.MACD}_CROSSOVER_BEARISH`,
      suggestedAmount,
      indicators: {
        [IndicatorId.MACD]: currentResult.macd,
        signal: currentResult.signal,
        histogram: currentResult.histogram,
        currentPrice,
      },
      metadata: {
        crossType: 'bearish',
        fastPeriod,
        slowPeriod,
        signalPeriod,
      },
    };
  }

  // No signal
  return {
    action: null,
    confidence: 0,
    reason: `No crossover detected. MACD: ${currentResult.macd.toFixed(2)}, Signal: ${currentResult.signal.toFixed(2)}, Hist: ${currentResult.histogram.toFixed(2)}`,
    signalType: `${IndicatorId.MACD}_CROSSOVER`,
    indicators: {
      [IndicatorId.MACD]: currentResult.macd,
      signal: currentResult.signal,
      histogram: currentResult.histogram,
    },
  };
}

// =============================================================================
// 5. HELPERS
// =============================================================================

function calculateConfidence(histogram: number): number {
  const absHistogram = Math.abs(histogram);
  // Scale: 0.5 histogram = 50% confidence, 3.0+ histogram = 95% confidence
  const rawConfidence = Math.min(95, 50 + (absHistogram - 0.5) * 20);
  return Math.round(Math.max(10, rawConfidence));
}

// =============================================================================
// 6. EXPORT AS STRATEGY ADAPTER
// =============================================================================

const _adapter: StrategyAdapter = { metadata, execute };
export default _adapter;

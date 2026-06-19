/**
 * RSI Oversold Bounce Strategy
 *
 * Detects oversold conditions using RSI(14) combined with significant price drop.
 * Generates BUY signal when both conditions are met — a mean-reversion play.
 *
 * Entry Rules:
 *   - RSI(14) < oversoldThreshold (default 30)
 *   - 1-day price change < priceDrop threshold (default -2%)
 *
 * Confidence Calculation:
 *   confidence = ((threshold - rsi) / threshold) * 100, capped at 95
 *
 * Exit Rules: (not managed by this strategy - handled at portfolio level)
 *   - Take profit at +5% or RSI > 50
 *   - Stop loss at -3% from entry
 */

import { rsi } from '../../../rh-agent/indicators';
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

export interface RsiOversoldBounceConfig extends StrategyConfig {
  rsiPeriod: number;          // Default: 14
  oversoldThreshold: number;  // Default: 30
  priceDrop: number;          // Default: -0.02 (negative = drop required)
  suggestedAmount: number;    // Default: 1000
}

// =============================================================================
// 2. METADATA EXPORT
// =============================================================================

export const metadata: StrategyMetadata = {
  id: 'rsi-oversold-bounce',
  name: 'RSI Oversold Bounce',
  description:
    'Detects oversold conditions using RSI < threshold combined with significant price drop. Mean-reversion play expecting a bounce.',
  category: 'mean-reversion',

  defaultConfig: {
    rsiPeriod: 14,
    oversoldThreshold: 30,
    priceDrop: -0.02,
    suggestedAmount: 1000,
  } as RsiOversoldBounceConfig,

  minBarsRequired: 15, // 14 periods + 1 for RSI calculation
  supportedTimeframes: ['1d'],

  version: '1.0.0',
  author: 'system',

  configSchema: {
    rsiPeriod: { type: 'integer', min: 5, max: 50, description: 'RSI lookback period' },
    oversoldThreshold: { type: 'integer', min: 10, max: 50, description: 'RSI level below which is considered oversold' },
    priceDrop: { type: 'number', min: -0.20, max: 0, description: 'Max price change threshold (negative = drop)' },
    suggestedAmount: { type: 'number', min: 50, max: 100000, description: 'Suggested dollar amount per trade' },
  },
};

// =============================================================================
// 3. MAIN EXECUTION FUNCTION
// =============================================================================

export function execute(input: StrategyInput, config: StrategyConfig): StrategyOutput {
  const { bars, intraday } = input;
  const {
    rsiPeriod = 14,
    oversoldThreshold = 30,
    priceDrop = -0.02,
    suggestedAmount = 1000,
  } = config as RsiOversoldBounceConfig;

  // Validate we have enough data
  const requiredBars = rsiPeriod + 1;
  if (!bars || bars.length < requiredBars) {
    return {
      action: null,
      confidence: 0,
      reason: `Insufficient data: ${bars?.length || 0} bars, need ${requiredBars}`,
      signalType: `${IndicatorId.RSI}_OVERSOLD`,
      indicators: { barCount: bars?.length || 0 },
    };
  }

  // Extract closing prices (handle different field names: close, c)
  const historicalCloses = bars
    .slice(-rsiPeriod)
    .map((b: any) => b.close || b.c || 0)
    .filter((c: number) => c > 0);

  // Current price: prefer intraday, fall back to last bar
  const currentPrice = intraday?.ip ?? historicalCloses[historicalCloses.length - 1];
  const previousPrice =
    historicalCloses[historicalCloses.length - 2] ||
    historicalCloses[historicalCloses.length - 1] ||
    currentPrice;
  const priceChange = (currentPrice - previousPrice) / previousPrice;

  // Full close array for RSI: historical + current
  const closes = [...historicalCloses, currentPrice];

  // Calculate RSI
  const rsiValue = rsi(closes, rsiPeriod);

  if (rsiValue === null) {
    return {
      action: null,
      confidence: 0,
      reason: 'RSI calculation returned null (insufficient price data)',
      signalType: `${IndicatorId.RSI}_OVERSOLD`,
      indicators: { closesCount: closes.length },
    };
  }

  // =============================================================================
  // 4. SIGNAL GENERATION
  // =============================================================================

  if (rsiValue < oversoldThreshold && priceChange < priceDrop) {
    // Confidence increases as RSI drops lower
    const confidence = Math.min(
      95,
      Math.round(((oversoldThreshold - rsiValue) / oversoldThreshold) * 100)
    );

    return {
      action: 'BUY',
      confidence,
      reason: `RSI oversold (${rsiValue.toFixed(1)}) with ${(priceChange * 100).toFixed(1)}% price drop. Potential bounce opportunity.`,
      signalType: `${IndicatorId.RSI}_OVERSOLD`,
      suggestedAmount,
      indicators: {
        rsi: rsiValue,
        priceChange,
        currentPrice,
        previousPrice,
      },
      metadata: {
        rsiPeriod,
        oversoldThreshold,
        priceDropThreshold: priceDrop,
      },
    };
  }

  // No signal
  return {
    action: null,
    confidence: 0,
    reason: `No signal. RSI: ${rsiValue.toFixed(1)} (threshold: ${oversoldThreshold}), Price change: ${(priceChange * 100).toFixed(1)}% (threshold: ${(priceDrop * 100).toFixed(0)}%)`,
    signalType: `${IndicatorId.RSI}_OVERSOLD`,
    indicators: {
      [IndicatorId.RSI]: rsiValue,
      priceChange,
      currentPrice,
    },
  };
}

// =============================================================================
// 5. EXPORT AS STRATEGY ADAPTER (satisfies the interface)
// =============================================================================

const _adapter: StrategyAdapter = { metadata, execute };
export default _adapter;

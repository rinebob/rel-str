/**
 * 75-Delta LEAP Drop Strategy
 *
 * Proof-of-concept mean-reversion options strategy:
 * - Buy a long-dated, 75-delta call (or put) when the underlying closes down
 *   at least `dropPct` from the previous day's close.
 * - Enter and exit at the close-of-day mark of the option contract.
 * - Exit at target gain, stop loss, or maximum hold days — whichever comes first.
 *
 * This file is self-contained: it exports the full adapter (metadata + execute)
 * plus a typed config interface and defaults. The README.md in this directory
 * documents every parameter and its possible values.
 */

import { StSignalDirection } from '../../rh-agent-signals';
import { OptionType } from '../../../types/partner';
import type {
  StrategyAdapter,
  StrategyConfig,
  StrategyInput,
  StrategyMetadata,
  StrategyOutput,
  OHLCV,
} from '../base-strategy';

// =============================================================================
// 1. CONFIG
// =============================================================================

export interface LeapDropConfig extends StrategyConfig {
  /** Minimum one-day underlying drop (decimal) to trigger entry. */
  dropPct: number;
  /** Target gain as a multiple of option entry price (1.0 = 100%). */
  targetGainPct: number;
  /** Stop loss as a multiple of option entry price (0.5 = 50%). */
  stopLossPct: number;
  /** Maximum calendar days to hold the position. */
  maxHoldDays: number;
  /** Target absolute option delta. */
  targetDelta: number;
  /** Target days to expiration. */
  targetDte: number;
  /** Minimum allowed DTE for contract selection. */
  minDte: number;
  /** Maximum allowed DTE for contract selection. */
  maxDte: number;
  /** Option type to buy: CALL for the POC. */
  optionType: OptionType;
  /** Maximum concurrent open positions; 0 means unlimited. */
  maxConcurrentPositions: number;
}

export function applyDefaults(config: StrategyConfig = {}): LeapDropConfig {
  return {
    dropPct: config.dropPct ?? 0.01,
    targetGainPct: config.targetGainPct ?? 1.0,
    stopLossPct: config.stopLossPct ?? 0.5,
    maxHoldDays: config.maxHoldDays ?? 252,
    targetDelta: config.targetDelta ?? 0.75,
    targetDte: config.targetDte ?? 365,
    minDte: config.minDte ?? 180,
    maxDte: config.maxDte ?? 730,
    optionType: (config.optionType as OptionType) ?? OptionType.CALL,
    maxConcurrentPositions: config.maxConcurrentPositions ?? 0,
  };
}

// =============================================================================
// 2. BAR NORMALIZATION
// =============================================================================

function normalizeBars(bars: unknown[]): OHLCV[] {
  return bars.map((raw) => {
    const b = raw as Record<string, unknown>;
    return {
      open: Number(b?.open ?? b?.o ?? 0),
      high: Number(b?.high ?? b?.h ?? 0),
      low: Number(b?.low ?? b?.l ?? 0),
      close: Number(b?.close ?? b?.c ?? 0),
      volume: Number(b?.volume ?? b?.v ?? 0),
      date: String(b?.d ?? b?.date ?? b?.t ?? ''),
    };
  });
}

// =============================================================================
// 3. METADATA
// =============================================================================

export const metadata: StrategyMetadata = {
  id: 'leap-drop',
  name: '75-Delta LEAP Drop',
  description:
    'Mean-reversion LEAP strategy. Buys a long-dated, high-delta call when the ' +
    'underlying drops at least the configured percentage from the prior close. ' +
    'Exits at target gain, stop loss, or max hold days using end-of-day option mark prices.',
  category: 'mean-reversion',
  defaultConfig: applyDefaults({}),
  minBarsRequired: 2,
  supportedTimeframes: ['1d'],
  version: '1.0.0',
  author: 'system',
  configSchema: {
    dropPct: {
      type: 'number',
      min: 0.001,
      max: 0.5,
      step: 0.005,
      description: 'Minimum one-day underlying drop required to enter, as a decimal. Example: 0.01 = 1%.',
    },
    targetGainPct: {
      type: 'number',
      min: 0.05,
      max: 5.0,
      step: 0.05,
      description: 'Target gain as a multiple of option entry price. Example: 1.0 = 100% gain.',
    },
    stopLossPct: {
      type: 'number',
      min: 0.05,
      max: 0.95,
      step: 0.05,
      description: 'Stop loss as a multiple of option entry price. Example: 0.5 = 50% loss.',
    },
    maxHoldDays: {
      type: 'integer',
      min: 5,
      max: 1000,
      step: 5,
      description: 'Maximum calendar days to hold the position before a time-based exit.',
    },
    targetDelta: {
      type: 'number',
      min: 0.5,
      max: 0.95,
      step: 0.05,
      description: 'Target absolute option delta. 0.75 is the proof-of-concept LEAP delta.',
    },
    targetDte: {
      type: 'integer',
      min: 30,
      max: 1095,
      step: 30,
      description: 'Target days to expiration for the selected option contract.',
    },
    minDte: {
      type: 'integer',
      min: 30,
      max: 730,
      step: 30,
      description: 'Minimum allowed DTE; contracts expiring sooner are excluded (relaxed if no match).',
    },
    maxDte: {
      type: 'integer',
      min: 90,
      max: 1825,
      step: 30,
      description: 'Maximum allowed DTE; contracts expiring later are excluded (relaxed if no match).',
    },
    optionType: {
      type: 'string',
      enum: [OptionType.CALL, OptionType.PUT],
      description: "Option type to buy. 'call' for the proof-of-concept LEAP strategy.",
    },
    maxConcurrentPositions: {
      type: 'integer',
      min: 0,
      max: 100,
      step: 1,
      description: 'Maximum concurrent open positions; 0 means unlimited.',
    },
  },
};

// =============================================================================
// 4. EXECUTION
// =============================================================================

export function execute(input: StrategyInput, config: StrategyConfig = {}): StrategyOutput[] {
  const cfg = applyDefaults(config);
  const bars = normalizeBars(input.bars);

  if (bars.length < 2) {
    return [];
  }

  const yesterday = bars[bars.length - 2];
  const today = bars[bars.length - 1];
  const prevClose = yesterday.close;
  const currentClose = today.close;

  if (!prevClose || !currentClose || prevClose === 0) {
    return [];
  }

  const pctChange = (currentClose - prevClose) / prevClose;
  if (pctChange > -cfg.dropPct) {
    return [];
  }

  const barDate = (today.date as string) || input.marketDate;

  return [
    {
      action: StSignalDirection.LONG,
      confidence: 100,
      reason:
        `Underlying dropped ${(pctChange * 100).toFixed(2)}% from ` +
        `${prevClose.toFixed(2)} to ${currentClose.toFixed(2)}. ` +
        `Buying ${(cfg.targetDelta * 100).toFixed(0)}-delta ${cfg.optionType} LEAP ` +
        `with ${cfg.targetDte}-day target DTE.`,
      signalType: 'D_LEAP_DROP_LONG',
      barDate,
      indicators: {
        dropPct: pctChange * 100,
        prevClose,
        currentClose,
        targetDelta: cfg.targetDelta,
        targetDte: cfg.targetDte,
      },
      metadata: {
        strategy: metadata.id,
        entry: {
          trigger: '1-day drop >= dropPct',
          dropPct: cfg.dropPct,
        },
        optionLegs: [
          {
            side: 'long',
            quantity: 1,
            criteria: {
              type: cfg.optionType,
              targetDelta: cfg.targetDelta,
              targetDte: cfg.targetDte,
              minDte: cfg.minDte,
              maxDte: cfg.maxDte,
              requireMark: true,
            },
          },
        ],
        exit: {
          targetGainPct: cfg.targetGainPct,
          stopLossPct: cfg.stopLossPct,
          maxHoldDays: cfg.maxHoldDays,
        },
      },
    },
  ];
}

// =============================================================================
// 5. ADAPTER EXPORT
// =============================================================================

export const adapter: StrategyAdapter = { metadata, execute };
export default adapter;

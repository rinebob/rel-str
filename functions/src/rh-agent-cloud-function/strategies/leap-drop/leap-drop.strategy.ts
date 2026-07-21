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

interface LeapDropBaseConfig extends StrategyConfig {
  /** Minimum one-day underlying drop (decimal) to trigger entry. */
  dropPct: number;
  /** Trade the underlying equity instead of options. */
  useUnderlying: boolean;
  /** Target gain as a decimal of entry price (0.2 = 20%). Omit to disable. */
  targetGainPct?: number;
  /** Stop loss as a decimal of entry (0.08 = 8%). 0 disables the stop. */
  stopLossPct: number;
  /** Trailing stop as a decimal of peak pnl (0.08 = 8%). 0 disables. */
  trailingStopPct?: number;
  /** Maximum calendar days to hold the position. 0 disables. */
  maxHoldDays: number;
  /** Maximum concurrent open positions; 0 means unlimited. */
  maxConcurrentPositions: number;
}

export interface OptionLeapDropConfig extends LeapDropBaseConfig {
  useUnderlying: false;
  targetDelta: number;
  targetDte: number;
  minDte?: number;
  maxDte?: number;
  optionType: OptionType;
}

export interface UnderlyingLeapDropConfig extends LeapDropBaseConfig {
  useUnderlying: true;
  /** Dollar amount to allocate to each underlying position. */
  positionSize: number;
}

export type LeapDropConfig = OptionLeapDropConfig | UnderlyingLeapDropConfig;

export function applyDefaults(config: StrategyConfig = {}): LeapDropConfig {
  const useUnderlying = config.useUnderlying === true;
  const base = {
    dropPct: config.dropPct ?? 0.01,
    useUnderlying,
    targetGainPct: config.targetGainPct ?? (useUnderlying ? undefined : 1.0),
    stopLossPct: config.stopLossPct ?? (useUnderlying ? 0.08 : 0.5),
    trailingStopPct: config.trailingStopPct ?? (useUnderlying ? 0.08 : undefined),
    maxHoldDays: config.maxHoldDays ?? 252,
    maxConcurrentPositions: config.maxConcurrentPositions ?? 0,
  };

  if (useUnderlying) {
    return {
      ...base,
      useUnderlying: true as const,
      positionSize: config.positionSize ?? 1000,
    };
  }

  return {
    ...base,
    useUnderlying: false as const,
    targetDelta: config.targetDelta ?? 0.75,
    targetDte: config.targetDte ?? 365,
    minDte: config.minDte ?? 180,
    maxDte: config.maxDte ?? 730,
    optionType: (config.optionType as OptionType | undefined) ?? OptionType.CALL,
  };
}

// =============================================================================
// 2. BAR NORMALIZATION
// =============================================================================

function normalizeBars(bars: OHLCV[]): OHLCV[] {
  return bars.map((b) => ({
    open: Number(b?.open ?? b?.o ?? 0),
    high: Number(b?.high ?? b?.h ?? 0),
    low: Number(b?.low ?? b?.l ?? 0),
    close: Number(b?.close ?? b?.c ?? 0),
    volume: Number(b?.volume ?? b?.v ?? 0),
    date: String(b?.d ?? b?.date ?? b?.t ?? ''),
  }));
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
      min: 0.0,
      max: 2.0,
      step: 0.01,
      description: 'Stop loss as a decimal of entry price. Example: 0.08 = 8% loss. 0 disables the stop.',
    },
    trailingStopPct: {
      type: 'number',
      min: 0.0,
      max: 0.5,
      step: 0.01,
      description: 'Trailing stop as a decimal of peak pnl. Example: 0.08 = 8% trailing stop. 0 disables.',
    },
    maxHoldDays: {
      type: 'integer',
      min: 0,
      max: 1000,
      step: 1,
      description: 'Maximum calendar days to hold the position before a time-based exit. 0 disables.',
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
    useUnderlying: {
      type: 'boolean',
      description: 'If true, buy the underlying equity instead of an option contract.',
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
    positionSize: {
      type: 'number',
      min: 1,
      max: 1_000_000,
      step: 100,
      description: 'Dollar amount to allocate to each underlying position. Quantity is computed as floor(positionSize / close).',
    },
  },
};

// =============================================================================
// 4. EXECUTION
// =============================================================================

function computeDrop(
  bars: OHLCV[],
  dropPct: number,
): { yesterday: OHLCV; today: OHLCV; pctChange: number; prevClose: number; currentClose: number } | null {
  if (bars.length < 2) return null;

  const yesterday = bars[bars.length - 2];
  const today = bars[bars.length - 1];
  const prevClose = yesterday.close;
  const currentClose = today.close;

  if (!prevClose || !currentClose || prevClose === 0) {
    return null;
  }

  const pctChange = (currentClose - prevClose) / prevClose;
  if (pctChange > -dropPct) {
    return null;
  }

  return { yesterday, today, pctChange, prevClose, currentClose };
}

function computeUnderlyingQuantity(currentClose: number, positionSize: number): number {
  if (currentClose <= 0 || positionSize <= 0) return 1;
  return Math.max(1, Math.floor(positionSize / currentClose));
}

function buildUnderlyingReason(
  symbol: string,
  pctChange: number,
  prevClose: number,
  currentClose: number,
  quantity: number,
  cfg: UnderlyingLeapDropConfig,
): string {
  return (
    `Underlying dropped ${(pctChange * 100).toFixed(2)}% from ` +
    `${prevClose.toFixed(2)} to ${currentClose.toFixed(2)}. ` +
    `Buying ${quantity} ${symbol} shares (~$${(quantity * currentClose).toFixed(2)}) with ` +
    `${(cfg.stopLossPct * 100).toFixed(0)}% stop loss and ${((cfg.trailingStopPct ?? 0) * 100).toFixed(0)}% trailing stop.`
  );
}

function buildOptionReason(
  pctChange: number,
  prevClose: number,
  currentClose: number,
  cfg: OptionLeapDropConfig,
): string {
  return (
    `Underlying dropped ${(pctChange * 100).toFixed(2)}% from ` +
    `${prevClose.toFixed(2)} to ${currentClose.toFixed(2)}. ` +
    `Buying ${(cfg.targetDelta * 100).toFixed(0)}-delta ${cfg.optionType} LEAP ` +
    `with ${cfg.targetDte}-day target DTE.`
  );
}

export function execute(input: StrategyInput, config: StrategyConfig = {}): StrategyOutput[] {
  const cfg = applyDefaults(config);
  const bars = normalizeBars(input.bars);

  const drop = computeDrop(bars, cfg.dropPct);
  if (!drop) return [];

  const { pctChange, prevClose, currentClose } = drop;
  const barDate = (drop.today.date as string) || input.marketDate;

  const exit = {
    targetGainPct: cfg.targetGainPct,
    stopLossPct: cfg.stopLossPct,
    trailingStopPct: cfg.trailingStopPct,
    maxHoldDays: cfg.maxHoldDays,
  };

  if (cfg.useUnderlying) {
    const positionSize = cfg.positionSize ?? 1000;
    const quantity = computeUnderlyingQuantity(currentClose, positionSize);
    return [
      {
        action: StSignalDirection.LONG,
        confidence: 100,
        reason: buildUnderlyingReason(input.symbol, pctChange, prevClose, currentClose, quantity, cfg),
        signalType: 'D_DROP_BUY_UNDERLYING_LONG',
        barDate,
        indicators: {
          dropPct: pctChange * 100,
          prevClose,
          currentClose,
          positionSize,
          quantity,
        },
        metadata: {
          strategy: metadata.id,
          entry: {
            trigger: '1-day drop >= dropPct',
            dropPct: cfg.dropPct,
          },
          underlyingPosition: {
            side: 'long',
            quantity,
          },
          exit,
        },
      },
    ];
  }

  return [
    {
      action: StSignalDirection.LONG,
      confidence: 100,
      reason: buildOptionReason(pctChange, prevClose, currentClose, cfg),
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
        exit,
      },
    },
  ];
}

// =============================================================================
// 5. ADAPTER EXPORT
// =============================================================================

export const adapter: StrategyAdapter = { metadata, execute };
export default adapter;

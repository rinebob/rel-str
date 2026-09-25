/**
 * @topic #553 — Paper Trading Infra (task #562)
 *
 * Position/trade ID builders and leg helpers for the engine's Position view.
 * Kept separate from position-repository.ts so the repository stays focused
 * on storage adapters.
 */

import { OptionType, StrategyFrequency } from '@options/common';
import { TradeSide } from '@common';
import { stratType } from './trade-adapter';
import type { PositionLeg } from './types';

/** Minimal config shape needed to build a position ID. */
export interface PositionIdConfig {
  symbol: string;
  optionType: OptionType;
  side: TradeSide;
  targetDelta?: number;
  dteMax?: number;
  frequency: StrategyFrequency;
  openTimePT: string;
}

/**
 * Build a position/trade ID from the strategy config and the opening date.
 * Legacy format kept for migrated docs: YYMMDD-SYMBOL-STRATTYPE-DELTA-DTE-FREQ-HHMM
 */
export function buildPositionId(
  config: PositionIdConfig,
  openDate: string,
): string {
  const datePart = openDate.slice(2).replace(/-/g, '');
  const strat = stratType(config.optionType, config.side);
  const delta = String(Math.round((config.targetDelta ?? 0) * 100)).padStart(3, '0');
  const dte = String(config.dteMax ?? 0);
  const freq = config.frequency === StrategyFrequency.DAILY ? 'D' : 'W';
  const time = config.openTimePT.replace(':', '');
  return `${datePart}-${config.symbol}-${strat}-${delta}-${dte}-${freq}-${time}`;
}

export function buildLegId(
  type: OptionType,
  strike: number,
  expiration: string,
): string {
  const normalizedStrike = strike.toFixed(2);
  const typeLabel = type === OptionType.CALL ? 'CALL' : 'PUT';
  return `${typeLabel}-${normalizedStrike}-${expiration}`;
}

/** Find the primary leg (the one with a contractID) from a position's legs. */
export function findPrimaryLeg(legs: PositionLeg[]): PositionLeg | undefined {
  return legs.find((leg) => leg.contractID);
}

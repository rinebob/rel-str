/**
 *
 * Generates strategy instance IDs from config using the naming convention:
 * YYMMDD-{SYMBOL}-{STRATEGY}-{DELTA}-{DTE}-{FREQ}-{TIME}
 *
 * Strategy codes are derived from PositionSpreadType:
 * - CASH_SECURED_PUT → CSP
 * - COVERED_CALL → CC
 */

import { PositionSpreadType, StrategyFrequency } from './options-common';
import { formatDelta, formatDte, formatYYMMDD } from './id-format';
import type { StrategyInstancePhase } from './options-strategy-engine-contracts';

const SPREAD_TYPE_CODES: Record<PositionSpreadType, string> = {
  [PositionSpreadType.CASH_SECURED_PUT]: 'CSP',
  [PositionSpreadType.COVERED_CALL]: 'CC',
};

/**
 * Generate a strategy instance ID from the creation date and config.
 *
 * The date component uses UTC (getUTCFullYear/Month/Date) so IDs are stable
 * regardless of the server's local timezone.
 *
 * @param createdAt   The instance creation date (UTC used for the date prefix).
 * @param symbol      Underlying ticker symbol (case-insensitive, normalized to uppercase).
 * @param phases      Strategy phases — the first phase determines the strategy code, delta, and DTE.
 * @param frequency   How often new positions are opened.
 * @param openTimePT  Local time of day to open new positions (HH:MM), e.g. "07:30" or "12:00".
 * @returns           The generated ID, e.g. "250816-QQQM-CSP-020-28-D-1200".
 * @throws            If phases is empty.
 */
export function generateInstanceId(
  createdAt: Date,
  symbol: string,
  phases: StrategyInstancePhase[],
  frequency: StrategyFrequency,
  openTimePT: string,
): string {
  if (phases.length === 0) {
    throw new Error('phases must be non-empty');
  }

  const phase = phases[0];
  const datePart = formatYYMMDD(createdAt);
  const symbolPart = symbol.toUpperCase();
  const strategyPart = SPREAD_TYPE_CODES[phase.spreadType] ?? phase.spreadType;
  const deltaPart = formatDelta(phase.targetDelta);
  const dtePart = formatDte(phase.dteMax);
  const timePart = formatOpenTime(openTimePT);
  const freqPart = frequency === StrategyFrequency.DAILY ? 'D' : 'W';

  return `${datePart}-${symbolPart}-${strategyPart}-${deltaPart}-${dtePart}-${freqPart}-${timePart}`;
}

function formatOpenTime(openTimePT: string): string {
  return openTimePT.replace(':', '');
}

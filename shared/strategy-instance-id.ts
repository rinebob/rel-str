/**
 *
 * Generates strategy instance IDs from config using the naming convention:
 * YYMMDD-{SYMBOL}-{STRATEGY}-{DELTA}-{DTE}-{FREQ}
 *
 * Strategy codes are derived from PositionSpreadType:
 * - CASH_SECURED_PUT → CSP
 * - COVERED_CALL → CC
 */

import { PositionSpreadType, StrategyFrequency } from './options-common';
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
 * @returns           The generated ID, e.g. "250816-QQQM-CSP-020-28-D".
 * @throws            If phases is empty.
 */
export function generateInstanceId(
  createdAt: Date,
  symbol: string,
  phases: StrategyInstancePhase[],
  frequency: StrategyFrequency,
): string {
  if (phases.length === 0) {
    throw new Error('phases must be non-empty');
  }

  const phase = phases[0];
  const datePart = formatDatePart(createdAt);
  const symbolPart = symbol.toUpperCase();
  const strategyPart = SPREAD_TYPE_CODES[phase.spreadType] ?? phase.spreadType;
  const deltaPart = formatDelta(phase.targetDelta);
  const dtePart = formatDte(phase.dteMax);
  const freqPart = frequency === StrategyFrequency.DAILY ? 'D' : 'W';

  return `${datePart}-${symbolPart}-${strategyPart}-${deltaPart}-${dtePart}-${freqPart}`;
}

function formatDatePart(date: Date): string {
  const yy = String(date.getUTCFullYear()).slice(2);
  const mm = String(date.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(date.getUTCDate()).padStart(2, '0');
  return `${yy}${mm}${dd}`;
}

function formatDelta(delta: number): string {
  return String(Math.round(delta * 100)).padStart(3, '0');
}

function formatDte(dte: number): string {
  return String(dte).padStart(2, '0');
}

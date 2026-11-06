/**
 * Open-pass gate evaluation (#1247) — the cadence + concurrency-cap
 * decisions as one pure function over the instance's position list.
 *
 * Cadence anchors to the newest openDate across ALL positions (any
 * status): a leg that expired or closed mid-period still consumed its
 * cadence slot, so the window does not reopen early, and a same-day
 * closed leg still blocks a retry cleanly instead of colliding at
 * `createPosition`. Only OPEN positions count toward `maxOpenPositions`.
 */

import type { StrategyInstanceConfig } from '@options-strategy-engine/contracts';
import { StrategyFrequency } from '@options/common';
import { calendarDaysBetween } from '../../../common/pt-date-utils';
import type { Position } from '../types';
import { PositionStatus } from '../types';

export type OpenGateSkipReason =
  | 'already_opened_today'
  | 'already_opened_in_period'
  | 'max_open_positions';

export interface OpenGateDecision {
  reason: OpenGateSkipReason;
  /** The position that consumed the cadence slot — carried into the
   *  skip result so a same-day retry does not erase the opened leg's
   *  id from the daily-analysis/latest record. Null for the cap gate
   *  (no single blocker). */
  blockingPositionId: string | null;
  /** Open-position count at evaluation time — for the cap-skip log. */
  openCount: number;
}

/** Returns the blocking gate, or null when the pass may proceed. */
export function evaluateOpenGates(
  positions: Position[],
  config: StrategyInstanceConfig,
  date: string,
): OpenGateDecision | null {
  const cadenceDays = config.frequency === StrategyFrequency.WEEKLY ? 7 : 1;
  // Newest openDate at-or-before `date` (the list is not relied on for
  // sort order — reduce to the max matching openDate).
  const lastOpened = positions.reduce<Position | null>(
    (best, p) =>
      p.openDate <= date && (best === null || p.openDate > best.openDate)
        ? p
        : best,
    null,
  );
  const openCount = positions.filter(
    (p) => p.status === PositionStatus.OPEN,
  ).length;
  if (lastOpened) {
    const daysSinceOpen = calendarDaysBetween(lastOpened.openDate, date);
    if (daysSinceOpen < cadenceDays) {
      return {
        reason:
          daysSinceOpen === 0
            ? 'already_opened_today'
            : 'already_opened_in_period',
        blockingPositionId: lastOpened.id,
        openCount,
      };
    }
  }

  const maxOpen = config.maxOpenPositions;
  if (typeof maxOpen === 'number' && maxOpen > 0 && openCount >= maxOpen) {
    return {
      reason: 'max_open_positions',
      blockingPositionId: null,
      openCount,
    };
  }

  return null;
}

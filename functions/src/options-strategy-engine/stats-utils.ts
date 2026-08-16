/**
 * @topic #108 — Options Position Strategy Engine
 *
 * Pure utility functions for the options strategy stats rollup — no Firestore,
 * no side effects. Tested with plain input/output.
 */

import type { EquityCurvePoint, Position, StrategyStats } from './types';
import { PositionStatus } from './types';

/**
 * Compute the maximum drawdown over a cumulative P&L series.
 *
 * Drawdown = peak value minus the lowest trough after that peak. Returns the
 * largest such decline as a positive number (0 if the series never declines).
 *
 * The series is assumed to be sorted by date (oldest first). If unsorted, the
 * caller is responsible for sorting.
 */
export function computeMaxDrawdown(points: EquityCurvePoint[]): number {
  if (points.length === 0) return 0;

  let peak = points[0].cumulativePnl;
  let maxDrawdown = 0;

  for (const point of points) {
    const value = point.cumulativePnl;
    if (value > peak) {
      peak = value;
    }
    const drawdown = peak - value;
    if (drawdown > maxDrawdown) {
      maxDrawdown = drawdown;
    }
  }

  return maxDrawdown;
}

/**
 * Compute a StrategyStats object from a list of positions.
 *
 * - OPEN and ASSIGNED_HOLDING_SHARES count as "open" positions with unrealized P&L.
 * - EXPIRED_WORTHLESS counts as "closed" with realized P&L = premium collected.
 * - maxDrawdown is left at 0 here; it is computed from the equity-curve series
 *   by the caller (stats-repository) which has access to historical points.
 *
 * @param scope  The stats scope (instanceId or "ALL").
 * @param date   The market date this computation is for (used as lastUpdated).
 */
export function computeStatsFromPositions(
  positions: Position[],
  scope: string,
  date: string,
): StrategyStats {
  let totalPremiumCollected = 0;
  let totalRealizedPnl = 0;
  let totalUnrealizedPnl = 0;
  let openPositionCount = 0;
  let closedPositionCount = 0;
  let assignedCount = 0;
  let expiredWorthlessCount = 0;

  for (const pos of positions) {
    totalPremiumCollected += pos.premiumCollected;

    if (pos.status === PositionStatus.OPEN) {
      openPositionCount++;
      totalUnrealizedPnl += pos.unrealizedPnl;
    } else if (pos.status === PositionStatus.ASSIGNED_HOLDING_SHARES) {
      openPositionCount++;
      assignedCount++;
      totalUnrealizedPnl += pos.unrealizedPnl;
    } else if (pos.status === PositionStatus.EXPIRED_WORTHLESS) {
      closedPositionCount++;
      expiredWorthlessCount++;
      // Realized P&L for expired worthless = premium retained.
      totalRealizedPnl += pos.premiumCollected;
    } else {
      // CLOSED or future statuses — count as closed, realized P&L = unrealized at close.
      closedPositionCount++;
      totalRealizedPnl += pos.unrealizedPnl;
    }
  }

  return {
    scope,
    totalPremiumCollected,
    totalRealizedPnl,
    totalUnrealizedPnl,
    openPositionCount,
    closedPositionCount,
    assignedCount,
    expiredWorthlessCount,
    maxDrawdown: 0,
    lastUpdated: date,
  };
}

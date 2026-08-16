/**
 * @topic #108 — Options Position Strategy Engine
 *
 * Query service for the options strategy dashboard — pure functions that
 * transform position data into dashboard-ready response shapes.
 */

import type { Position } from './types';
import { PositionStatus } from './types';

// ── Response types ───────────────────────────────────────────────────────────

export interface StrategyPositionsResponse {
  openPositions: Position[];
  closedPositions: Position[];
}

// ── Pure functions ───────────────────────────────────────────────────────────

/**
 * Split a flat list of positions into open and closed arrays for the
 * dashboard. OPEN and ASSIGNED_HOLDING_SHARES are "open" (still holding);
 * EXPIRED_WORTHLESS and CLOSED are "closed" (position resolved).
 */
export function buildPositionsResponse(
  positions: Position[],
): StrategyPositionsResponse {
  const openPositions: Position[] = [];
  const closedPositions: Position[] = [];

  for (const pos of positions) {
    if (
      pos.status === PositionStatus.OPEN ||
      pos.status === PositionStatus.ASSIGNED_HOLDING_SHARES ||
      pos.status === PositionStatus.COVERED_CALL_OPEN
    ) {
      openPositions.push(pos);
    } else {
      closedPositions.push(pos);
    }
  }

  return { openPositions, closedPositions };
}

/**
 * FE-side types for the options strategy dashboard. Mirrors the BE types
 * from functions/src/options-strategy-engine/types.ts, minus backend-only
 * fields (Timestamp). These are the response shapes the callables return.
 *
 * Named `OptionsPositionStatus` (not `PositionStatus`) to avoid collision
 * with the existing RS-trading `PositionStatus` in core/models/fe-position.types.ts.
 */

export enum OptionsPositionStatus {
  OPEN = 'OPEN',
  EXPIRED_WORTHLESS = 'EXPIRED_WORTHLESS',
  ASSIGNED_HOLDING_SHARES = 'ASSIGNED_HOLDING_SHARES',
  COVERED_CALL_OPEN = 'COVERED_CALL_OPEN',
  CLOSED = 'CLOSED',
}

/** Human-readable display labels for each OptionsPositionStatus value. */
export const OPTIONS_POSITION_STATUS_LABELS: Record<OptionsPositionStatus, string> = {
  [OptionsPositionStatus.OPEN]: 'Open',
  [OptionsPositionStatus.EXPIRED_WORTHLESS]: 'Expired Worthless',
  [OptionsPositionStatus.ASSIGNED_HOLDING_SHARES]: 'Assigned',
  [OptionsPositionStatus.COVERED_CALL_OPEN]: 'Covered Call Open',
  [OptionsPositionStatus.CLOSED]: 'Closed',
};

export interface PositionLeg {
  id: string;
  type: string;
  side: string;
  strike: number;
  expiration: string;
  openDate: string;
  contractID?: string;
  closeDate?: string;
  premium: number;
  outcome?: string;
}

export interface PositionAssignment {
  strikePrice: number;
  underlyingCloseAtExpiration: number;
  assignedAt: string;
}

export interface PositionShares {
  quantity: number;
  costBasis: number;
}

export interface Position {
  id: string;
  instanceId: string;
  symbol: string;
  status: OptionsPositionStatus;
  premiumCollected: number;
  capitalRequired: number;
  openDate: string;
  currentValue: number;
  currentValueAsOf: string;
  unrealizedPnl: number;
  /** Realized P&L for closed positions (premium retained after assignment/close). */
  realizedPnl?: number;
  assignment?: PositionAssignment;
  shares?: PositionShares;
  legs?: PositionLeg[];
}

export interface StrategyStats {
  scope: string;
  totalPremiumCollected: number;
  totalRealizedPnl: number;
  totalUnrealizedPnl: number;
  openPositionCount: number;
  closedPositionCount: number;
  assignedCount: number;
  expiredWorthlessCount: number;
  maxDrawdown: number;
  lastUpdated: string;
}

export interface EquityCurvePoint {
  date: string;
  cumulativePnl: number;
}

// ── Callable request/response shapes ─────────────────────────────────────────

export interface ListStrategyPositionsRequest {
  instanceId?: string;
  status?: OptionsPositionStatus;
}

export interface StrategyPositionsResponse {
  openPositions: Position[];
  closedPositions: Position[];
}

export interface GetStrategyEquityCurveRequest {
  instanceId?: string;
}

export interface StrategyEquityCurveResponse {
  points: EquityCurvePoint[];
  stats: StrategyStats | null;
}

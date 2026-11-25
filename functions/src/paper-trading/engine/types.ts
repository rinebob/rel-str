/**
 *
 * Shared types and enums for the options position strategy engine backend.
 *
 * Reuses `OptionType` from `@options/common` and `TradeSide` from the universal
 * `shared/common.ts` so the frontend and backend share a single canonical source
 * for option leg primitives.
 */

import type { Timestamp } from 'firebase-admin/firestore';
import { TradeSide } from '@common';
import { OptionType } from '@options/common';

// Re-export unified types from shared contracts so existing BE imports work.
export type {
  StrategyInstanceConfig,
  StrategyInstancePhase,
  ExitPolicy,
  ExitPolicyConfig,
  LifecycleState,
  MarketRegime,
} from '@options-strategy-engine/contracts';

// ── Enums ──────────────────────────────────────────────────────────────────

export enum PositionStatus {
  OPEN = 'OPEN',
  EXPIRED_WORTHLESS = 'EXPIRED_WORTHLESS',
  ASSIGNED_HOLDING_SHARES = 'ASSIGNED_HOLDING_SHARES',
  COVERED_CALL_OPEN = 'COVERED_CALL_OPEN',
  CLOSED = 'CLOSED',
}

export enum LegOutcome {
  EXPIRED_WORTHLESS = 'EXPIRED_WORTHLESS',
  ASSIGNED = 'ASSIGNED',
}

// ── Position lifecycle documents ───────────────────────────────────────────

export interface PositionLeg {
  id: string;
  type: OptionType;
  side: TradeSide;
  strike: number;
  expiration: string;
  openDate: string;
  contractID?: string;
  closeDate?: string;
  premium: number;
  outcome?: LegOutcome;
}

export interface PositionAssignment {
  strikePrice: number;
  underlyingCloseAtExpiration: number;
  /** Market date (YYYY-MM-DD) on which the position was assigned. */
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
  status: PositionStatus;
  premiumCollected: number;
  capitalRequired: number;
  openDate: string;
  currentValue: number;
  currentValueAsOf: string;
  unrealizedPnl: number;
  /** Realized P&L from the trade doc — emitted by tradeToPosition so
   *  closed/expired rows show real realized instead of inferring from
   *  premiumCollected. */
  realizedPnl?: number;
  assignment?: PositionAssignment;
  shares?: PositionShares;
  createdAt?: Timestamp;
}

export interface DailyUpdate {
  date: string;
  markPrice?: number;
  underlyingClose: number;
}

export interface RawQuote {
  date: string;
  rawResponse: unknown;
}

/**
 * Unified mark-pass write payload (#1712): each option leg's own mark plus
 * the position-level values stamped on the trade doc in one transaction.
 */
export interface PositionMarkUpdate {
  /** OCC contractID → per-contract mark, one entry per option leg. */
  legMarks: Record<string, number>;
  /** Order-level exit price → `marks[date].mark` (the convention
   *  eval/settlement/live-snapshot readers consume — cost-to-close for a
   *  SHORT order, exit proceeds for a LONG order). */
  mark: number;
  unrealizedPnl: number;
  currentValueAsOf: string;
}

// ── Portfolio-level stats ──────────────────────────────────────────────────

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

// ── Settlement types ────────────────────────────────────────────────────────

/** Shares per options contract (the ×100 multiplier in P&L formulas). */
export const SHARES_PER_CONTRACT = 100;

/** Settlement data written to a position document at expiration. */
export interface SettlementData {
  status: PositionStatus.EXPIRED_WORTHLESS | PositionStatus.ASSIGNED_HOLDING_SHARES;
  currentValue: number;
  currentValueAsOf: string;
  unrealizedPnl: number;
  assignment?: PositionAssignment;
  shares?: PositionShares;
}

/** Leg outcome update written to each leg document at settlement. */
export interface LegOutcomeUpdate {
  legId: string;
  outcome: LegOutcome;
  closeDate: string;
}

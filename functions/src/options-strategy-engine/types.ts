/**
 * @topic #108 — Options Position Strategy Engine
 *
 * Shared types and enums for the options position strategy engine backend.
 *
 * Reuses `OptionType` from `@options/common` and `TradeSide` from the universal
 * `shared/common.ts` so the frontend and backend share a single canonical source
 * for option leg primitives.
 */

import type { Timestamp } from 'firebase-admin/firestore';
import { TradeSide } from '@common';
import {
  OptionType,
  PositionSpreadType,
  StrategyFrequency,
} from '@options/common';

// ── Enums ──────────────────────────────────────────────────────────────────

export enum PositionStatus {
  OPEN = 'OPEN',
  EXPIRED_WORTHLESS = 'EXPIRED_WORTHLESS',
  ASSIGNED_HOLDING_SHARES = 'ASSIGNED_HOLDING_SHARES',
  COVERED_CALL_OPEN = 'COVERED_CALL_OPEN',
  CLOSED = 'CLOSED',
}

// ── Strategy instance config (read-only registry entry) ────────────────────

export interface StrategyInstancePhase {
  spreadType: PositionSpreadType;
  targetDelta: number;
  dteMin: number;
  dteMax: number;
}

export enum LegOutcome {
  EXPIRED_WORTHLESS = 'EXPIRED_WORTHLESS',
  ASSIGNED = 'ASSIGNED',
}

export interface StrategyInstanceConfig {
  id: string;
  symbol: string;
  /** Active phase selection criteria. If absent, the top-level legacy fields are used. */
  phases?: StrategyInstancePhase[];
  /** Phase 1 legacy fields — retained for backward compatibility until all instances migrate to `phases`. */
  spreadType?: PositionSpreadType;
  targetDelta?: number;
  dteMin?: number;
  dteMax?: number;
  frequency: StrategyFrequency;
  openTimePT: string;
  exitCriteria: null;
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

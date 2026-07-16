/**
 * RH Agent shared types and constants.
 *
 * These were extracted from rh-agent.service.ts so the new focused services
 * can share them without circular dependencies.
 */

import { RhAgentReviewDecision, RhAgentTradeStatus, SignalDirection, SignalStatus, SignalTimeframe } from '../common/rh-agent.constants';

/**
 * Cron expression for the RH Agent daily scheduler (UTC).
 * Must stay in sync with functions/src/rh-agent-cloud-function/rh-agent-trigger.ts
 */
export const RH_AGENT_SCHEDULE_CRON = '0 1 * * 2-6'; // 1 AM UTC = 6 PM PT, Mon-Fri

/**
 * Maximum dollar amount per trade to prevent oversized positions.
 */
export const RH_AGENT_MAX_TRADE_AMOUNT = 100;

export interface RhAgentStatus {
  isEnabled: boolean;
  lastRunAt?: string;
  lastRunStatus?: string;
  totalRuns: number;
  totalSignalsGenerated: number;
  symbolsMonitored: string[]; // Always defined, empty array if none
  schedule?: string;
}

export interface RhAgentRun {
  id: string;
  status: string;
  startedAt: string;
  completedAt?: string;
  strategy?: string;
  marketDate?: string;
  symbolsProcessed?: number;
  totalSymbols?: number;
  processedCount?: number;
  signalsGenerated?: number;
  summary?: string;
  triggeredBy?: 'manual' | 'pdr' | 'nightly' | 'symbol-added';
}

/** Market cap tiers derived from SA overview data. */
export type MarketCapTier = 'mega' | 'large' | 'mid' | 'small' | 'micro';

export { SignalDirection, RhAgentTradeStatus } from '../common/rh-agent.constants';

/** Known source values for how a symbol entered the RH Agent tracked universe. */
export enum RhAgentSymbolSource {
  MANUAL_ADD = 'manual-add',
  PARTNER_UNIVERSE = 'partner-universe',
}

/**
 * Symbol profile returned by rhAgentGetSymbolsWithSignals.
 * Includes config fields and company overview (after Phase 1 sync).
 */
export interface RhAgentSymbolProfile {
  symbol: string;
  enabled: boolean;
  createdAt: string;
  /** How this symbol entered the tracked universe (one of RhAgentSymbolSource). */
  source?: RhAgentSymbolSource;
  lastAnalyzedAt?: string;
  lastDailySignalDate?: string;
  lastWeeklySignalDate?: string;
  lastDailySignalDirection?: string;
  lastWeeklySignalDirection?: string;
  // Company overview (populated by Phase 1 SA sync)
  name?: string;
  sector?: string;
  industry?: string;
  exchange?: string;
  marketCap?: number;
  marketCapTier?: MarketCapTier;
  beta?: number;
  peRatio?: number;
  week52High?: number;
  week52Low?: number;
  ma200?: number;
  ma50?: number;
  dividendYield?: number;
}

/**
 * A single signal entry stored in run-ids or signal-history docs.
 */
export interface RhAgentSignalItem {
  id: string; // barDate (doc ID)
  symbol: string;
  barDate: string; // YYYY-MM-DD — the bar that fired
  marketDate: string; // YYYY-MM-DD — the run date
  runId: string;
  timeframe: SignalTimeframe;
  direction: SignalDirection;
  signalType: string;
  status: SignalStatus;
  indicators: Record<string, number | string | null>;
  /** Closing price for the bar that fired the signal, if available. */
  closePrice?: number;
}

/** UI row shape used as input when opening trades from the Order page. */
export interface TradeInputRow {
  symbol: string;
  direction: SignalDirection;
  signalType: string;
  barDate: string;
  timeframe: SignalTimeframe;
  positionSize: number;
  stopLossPercent: number;
  entryPrice: number;
}

/** A real trade placed from an accepted RH Agent occurrence. */
export interface RhAgentTrade {
  id: string;
  userId?: string;
  runId: string;
  marketDate: string;
  /** Optional link back to the occurrence decision that generated this trade. */
  occurrenceDecisionId?: string;
  symbol: string;
  direction: SignalDirection;
  timeframe: SignalTimeframe;
  signalType: string;
  barDate: string;
  status: RhAgentTradeStatus;
  /** Timestamp when the trade was opened (when the user marked it executed). */
  entryAt: string;
  /** Entry price, typically the close price of the signal bar. */
  entryPrice: number;
  /** Dollar amount committed. */
  positionSize: number;
  /** Whole-share quantity derived from positionSize / entryPrice. */
  quantity: number;
  /** Stop-loss price derived from the configured stop-loss percentage. */
  stopPrice?: number;
  /** Timestamp when the trade was closed, if applicable. */
  exitAt?: string;
  /** Exit price, if the trade has been closed. */
  exitPrice?: number;
  /** Realized P&L in dollars, if the trade has been closed. */
  realizedPnl?: number;
  /** Optional user-facing notes. */
  notes?: string;
  createdAt: string;
  updatedAt?: string;
}

/** Firestore document shape for a trade record (the trade ID is the doc ID). */
export interface RhAgentTradeDoc extends Omit<RhAgentTrade, 'id'> {}

/** Subset of review decisions that are persisted as durable occurrence decisions. */
export type DurableDecisionType =
  | RhAgentReviewDecision.ACCEPT
  | RhAgentReviewDecision.REJECT;

export interface RhAgentOccurrenceDecision {
  /** Stable identity for the decision doc. */
  id: string;
  /** User who made the decision. Optional when the object is built optimistically; the service stamps it. */
  userId?: string;
  /** Source run that produced the occurrence. */
  runId: string;
  /** Market date of the source run. */
  marketDate: string;
  /** Symbol ticker. */
  symbol: string;
  /** Timeframe of the signal: D or W. */
  timeframe: SignalTimeframe;
  /** LONG or SHORT direction of the signal. */
  direction: SignalDirection;
  /** Concrete signal type (e.g., D_ZONE_V1_UPTICK). */
  signalType: string;
  /** Bar date that fired the signal. */
  barDate: string;
  /** Decision type. */
  decisionType: DurableDecisionType;
  /** Timestamp when the user decision was recorded. */
  decidedAt: string;
  /** Timestamp when the associated trade was actually placed, if applicable. */
  executedAt?: string;
  /** Whether this decision still appears in the latest completed run. */
  isCurrentInLatestRun: boolean;
  /** Optional user-facing notes. */
  notes?: string;
  /** Indicator payload snapshot from the source signal. */
  indicators?: Record<string, number | string | null>;
}

export interface ManualRunRequest {
  symbols?: string[]; // Optional: specific symbols to run, or all enabled
  strategy?: string; // Optional: specific strategy to run
  date?: string; // Optional: override market date (YYYY-MM-DD)
}

export interface ManualRunResponse {
  runId: string;
  status: string;
  totalSymbols: number;
  enqueued: number;
  failed: number;
  message: string;
}

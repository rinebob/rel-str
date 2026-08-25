/**
 * Savant Trader shared types and constants.
 *
 * These were extracted from st.service.ts so the new focused services
 * can share them without circular dependencies.
 */

import { ReviewDecision, SignalDirection, SignalStatus, SignalTimeframe } from '../common/constants';

/**
 * Cron expression for the Savant Trader daily scheduler (UTC).
 * Must stay in sync with functions/src/st-cloud-function/trigger.ts
 */
export const ST_SCHEDULE_CRON = '0 1 * * 2-6'; // 1 AM UTC = 6 PM PT, Mon-Fri

/**
 * Maximum dollar amount per trade to prevent oversized positions.
 */
export const ST_MAX_TRADE_AMOUNT = 100;

export interface StStatus {
  isEnabled: boolean;
  lastRunAt?: string;
  lastRunStatus?: string;
  totalRuns: number;
  totalSignalsGenerated: number;
  symbolsMonitored: string[]; // Always defined, empty array if none
  schedule?: string;
}

export interface StRun {
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

export { SignalDirection } from '../common/constants';

/** Known source values for how a symbol entered the Savant Trader tracked universe. */
export enum StSymbolSource {
  MANUAL_ADD = 'manual-add',
  PARTNER_UNIVERSE = 'partner-universe',
}

/**
 * Symbol profile returned by stGetSymbolsWithSignals.
 * Includes config fields and company overview (after Phase 1 sync).
 */
export interface StSymbolProfile {
  symbol: string;
  enabled: boolean;
  createdAt: string;
  /** How this symbol entered the tracked universe (one of StSymbolSource). */
  source?: StSymbolSource;
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
export interface StSignalItem {
  id: string; // barDate (doc ID)
  symbol: string;
  barDate: string; // YYYY-MM-DD â€” the bar that fired
  marketDate: string; // YYYY-MM-DD â€” the run date
  runId: string;
  timeframe: SignalTimeframe;
  direction: SignalDirection;
  signalType: string;
  status: SignalStatus;
  indicators: Record<string, number | string | null>;
  /** Closing price for the bar that fired the signal, if available. */
  closePrice?: number;
}

/** Subset of review decisions that are persisted as durable occurrence decisions. */
export type DurableDecisionType =
  | ReviewDecision.ACCEPT
  | ReviewDecision.REJECT;

export interface StOccurrenceDecision {
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

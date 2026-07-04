/**
 * RH Agent shared types and constants.
 *
 * These were extracted from rh-agent.service.ts so the new focused services
 * can share them without circular dependencies.
 */

/**
 * Cron expression for the RH Agent daily scheduler (UTC).
 * Must stay in sync with functions/src/rh-agent-cloud-function/rh-agent-trigger.ts
 */
export const RH_AGENT_SCHEDULE_CRON = '0 20 * * 1-5'; // 8 PM UTC = 12 PM PT, Mon-Fri

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
  triggeredBy?: 'manual' | 'pdr' | 'nightly';
}

/** Market cap tiers derived from SA overview data. */
export type MarketCapTier = 'mega' | 'large' | 'mid' | 'small' | 'micro';

/** Direction of a signal entry. */
export type SignalDirection = 'LONG' | 'SHORT';

/**
 * Symbol profile returned by rhAgentGetSymbolsWithSignals.
 * Includes config fields and company overview (after Phase 1 sync).
 */
export interface RhAgentSymbolProfile {
  symbol: string;
  enabled: boolean;
  addedAt: string;
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
  timeframe: 'D' | 'W';
  direction: SignalDirection;
  signalType: string;
  status: 'INTERIM' | 'CONFIRMED';
  indicators: Record<string, number | string | null>;
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

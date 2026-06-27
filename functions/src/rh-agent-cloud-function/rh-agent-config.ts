/**
 * RH Agent Cloud Function Config
 *
 * Collection names and constants for the Robinhood Agent Cloud Function.
 */

/** Root collection for agent run records (metadata, status, summary). */
export const RH_AGENT_RUNS_COLLECTION = 'rh-agent-runs';

/** Singleton doc ID for agent status under rh-agent-status/{AGENT_STATUS_DOC}. */
export const AGENT_STATUS_DOC = 'current';

/** Root collection for agent configuration and status. */
export const RH_AGENT_STATUS_COLLECTION = 'rh-agent-status';

/** Root collection for symbol analysis jobs (subcollection under runs). */
export const RH_AGENT_JOBS_SUBCOLLECTION = 'jobs';

/** Symbol list collection for daily scanning. */
export const RH_AGENT_SYMBOLS_COLLECTION = 'rh-agent-symbols';

/** Signal-dates subcollection under each symbol doc. One doc per bar date, signals as a map field. */
export const RH_AGENT_SIGNAL_DATES_SUBCOLLECTION = 'signal-dates';

/** @deprecated Use RH_AGENT_SIGNAL_DATES_SUBCOLLECTION. Kept for migration reference. */
export const RH_AGENT_SIGNALS_SUBCOLLECTION = 'signals';

/**
 * Signal direction — whether the signal is a long or short entry.
 */
export enum StSignalDirection {
  LONG  = 'LONG',
  SHORT = 'SHORT',
}

/**
 * All known signal types produced by ST strategies.
 * Format: {TIMEFRAME}_{INDICATOR}_{VERSION}_{DIRECTION}
 */
export enum StSignalType {
  D_ZONE_V1_UPTICK   = 'D_ZONE_V1_UPTICK',
  D_ZONE_V1_DOWNTICK = 'D_ZONE_V1_DOWNTICK',
  D_ZONE_V2_UPTICK   = 'D_ZONE_V2_UPTICK',
  D_ZONE_V2_DOWNTICK = 'D_ZONE_V2_DOWNTICK',
  W_ZONE_V1_UPTICK   = 'W_ZONE_V1_UPTICK',
  W_ZONE_V1_DOWNTICK = 'W_ZONE_V1_DOWNTICK',
  W_ZONE_V2_UPTICK   = 'W_ZONE_V2_UPTICK',
  W_ZONE_V2_DOWNTICK = 'W_ZONE_V2_DOWNTICK',
}

/**
 * Signal status — INTERIM for open W/M periods, CONFIRMED once the period closes.
 * Daily signals are INTERIM during intraday runs, CONFIRMED on the nightly run.
 */
export type RhAgentSignalStatus = 'INTERIM' | 'CONFIRMED';

/**
 * Individual signal entry stored in the signals map of RhAgentSignalDateDoc.
 */
export interface RhAgentSignalEntry {
  signalType: StSignalType | string;
  timeframe: 'D' | 'W';
  direction: StSignalDirection;
  status: RhAgentSignalStatus;
  barDate: string;               // YYYY-MM-DD — the bar that triggered (doc ID)
  marketDate: string;            // YYYY-MM-DD — run date (may differ from barDate for W)
  indicators: Record<string, number | string | null>;
}

/**
 * Signal date doc stored under rh-agent-symbols/{SYMBOL}/signal-dates/{barDate}.
 * One doc per bar date; all signals for that date stored as a map keyed by signalType.
 */
export interface RhAgentSignalDateDoc {
  symbol: string;
  barDate: string;               // YYYY-MM-DD — doc ID
  runId: string;                 // last run that wrote/updated this doc
  updatedAt: FirebaseFirestore.Timestamp | FirebaseFirestore.FieldValue;
  signals: Record<string, RhAgentSignalEntry>;
}

/** @deprecated Use RhAgentSignalDateDoc. */
export interface RhAgentSignalDoc {
  id: string;                   // {DATE}_{SIGNALTYPE}
  symbol: string;
  marketDate: string;           // YYYY-MM-DD
  runId: string;
  timeframe: 'D' | 'W';
  direction: StSignalDirection;
  signalType: StSignalType | string;
  indicators: Record<string, number | string | null>;
  createdAt: FirebaseFirestore.Timestamp | FirebaseFirestore.FieldValue;
}

/**
 * Status of an agent run.
 */
export enum RhAgentRunStatus {
  PENDING = 'PENDING',
  RUNNING = 'RUNNING',
  SUCCESS = 'SUCCESS',
  PARTIAL = 'PARTIAL',
  FAILED = 'FAILED',
}

/**
 * Status of a symbol analysis job.
 */
export enum RhAgentJobStatus {
  PENDING = 'PENDING',
  IN_PROGRESS = 'IN_PROGRESS',
  SUCCESS = 'SUCCESS',
  FAILED = 'FAILED',
}

/**
 * Type of trade action.
 */
export enum RhTradeAction {
  BUY = 'BUY',
  SELL = 'SELL',
  HOLD = 'HOLD',
}

/**
 * Agent run record stored in Firestore.
 */
export interface RhAgentRun {
  id: string;
  status: RhAgentRunStatus;
  startedAt: FirebaseFirestore.Timestamp | FirebaseFirestore.FieldValue;
  completedAt?: FirebaseFirestore.Timestamp | FirebaseFirestore.FieldValue;
  strategy: string;
  symbol?: string;
  dryRun: boolean;
  triggeredBy?: 'manual' | 'pdr' | 'nightly';
  symbolsProcessed: number;
  signalsGenerated: number;
  errors: string[];
  logs: string[];
  summary?: string;
}

/**
 * Agent status singleton stored in Firestore.
 */
export interface RhAgentStatus {
  lastRunAt?: FirebaseFirestore.Timestamp | FirebaseFirestore.FieldValue;
  lastRunId?: string;
  lastRunStatus?: RhAgentRunStatus;
  totalRuns: number;
  totalSignalsGenerated: number;
  isEnabled: boolean;
  schedule?: string;
  symbolsMonitored: string[];
  updatedAt: FirebaseFirestore.Timestamp | FirebaseFirestore.FieldValue;
}

/**
 * Configuration for a watched symbol (moved from watchlist.ts for cloud function use).
 */
export interface RhWatchedSymbol {
  symbol: string;
  strategy: 'st-zone-uptick' | string;
  amount: number;
  enabled: boolean;
  customPrompt?: string;
  intervalMinutes: number;
}

/**
 * Daily agent run record stored in Firestore.
 * Used for the daily 12:00 PM PT scan of ~700 symbols.
 */
export interface RhAgentDailyRun {
  id: string;
  type: 'daily-scan';
  marketDate: string;  // YYYY-MM-DD
  status: RhAgentRunStatus;
  triggeredBy?: 'manual' | 'pdr' | 'nightly';
  totalSymbols: number;
  processedCount: number;
  successCount: number;
  failureCount: number;
  signalsGenerated: number;
  completionProcessed?: boolean;
  startedAt: FirebaseFirestore.Timestamp | FirebaseFirestore.FieldValue;
  completedAt?: FirebaseFirestore.Timestamp | FirebaseFirestore.FieldValue;
  deadlineAt: string;  // ISO string - deadline for user approval
  errors?: string[];
  logs?: string[];
}

/**
 * Symbol analysis job stored in Firestore (subcollection under daily run).
 */
export interface RhAgentJob {
  id: string;  // symbol name
  symbol: string;
  status: RhAgentJobStatus;
  attempts: number;
  lastError?: string;
  createdAt: FirebaseFirestore.Timestamp | FirebaseFirestore.FieldValue;
  startedAt?: FirebaseFirestore.Timestamp | FirebaseFirestore.FieldValue;
  completedAt?: FirebaseFirestore.Timestamp | FirebaseFirestore.FieldValue;
}

/**
 * Symbol document in rh-agent-symbols/{SYMBOL}.
 * Config fields coexist with SA company overview and signal gate fields.
 */
export interface RhAgentSymbol {
  symbol: string;
  enabled: boolean;
  addedAt: FirebaseFirestore.Timestamp | FirebaseFirestore.FieldValue;
  lastAnalyzedAt?: FirebaseFirestore.Timestamp | FirebaseFirestore.FieldValue;
  // Denormalized signal gate fields (written by worker on each signal)
  lastDailySignalDate?: string;   // YYYY-MM-DD
  lastWeeklySignalDate?: string;  // YYYY-MM-DD
  // Company overview (written by rhAgentOverviewSyncSymbol, Phase 1)
  name?: string;
  sector?: string;
  industry?: string;
  exchange?: string;
  assetType?: string;
  marketCap?: number;
  marketCapTier?: 'mega' | 'large' | 'mid' | 'small' | 'micro';
  beta?: number;
  peRatio?: number;
  forwardPe?: number;
  week52High?: number;
  week52Low?: number;
  ma200?: number;
  ma50?: number;
  dividendYield?: number;
  analystTarget?: number;
  analystBuys?: number;
  analystSells?: number;
  overviewFetchedAt?: FirebaseFirestore.Timestamp | FirebaseFirestore.FieldValue;
}

/**
 * Cloud Task payload for symbol analysis job.
 */
export interface SymbolJobPayload {
  runId: string;
  symbol: string;
  marketDate: string;  // YYYY-MM-DD
  intraday?: IntradaySnapshot;  // Intraday data from trigger's bulk fetch
}

/**
 * Intraday snapshot data from SavantAPI partnerIntradaySnapshotV2 endpoint.
 */
export interface IntradaySnapshot {
  symbol: string;
  ip: number;      // Latest intraday price
  ipc: number;     // Intraday change %
  io: number;      // Epoch ms timestamp
  it: string;      // Time string (e.g., "10:30")
  ic: number;      // Intraday change $
}

/**
 * RH Agent Run Types and Configuration
 *
 * Run statuses, job statuses, agent status, daily run records, and per-symbol
 * job records used by the run orchestration and progress tracker.
 */

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
 * Trigger source for an agent run.
 */
export type RhAgentTriggeredBy = 'manual' | 'pdr' | 'nightly';

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
  strategy: 'st-trend-rider' | string;
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
  triggeredBy?: RhAgentTriggeredBy;
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

/**
 * ST Run Types and Configuration
 *
 * Run statuses, job statuses, agent status, daily run records, and per-symbol
 * job records used by the run orchestration and progress tracker.
 *
 * These types are shared across the ST module and symbol-data-sync, so they
 * live in common/ to avoid cross-module import cycles.
 */

/**
 * Status of an agent run.
 */
export enum StRunStatus {
  PENDING = 'PENDING',
  RUNNING = 'RUNNING',
  SUCCESS = 'SUCCESS',
  PARTIAL = 'PARTIAL',
  FAILED = 'FAILED',
}

/**
 * Status of a symbol analysis job.
 */
export enum StJobStatus {
  PENDING = 'PENDING',
  IN_PROGRESS = 'IN_PROGRESS',
  SUCCESS = 'SUCCESS',
  FAILED = 'FAILED',
}

/**
 * Trigger source for an agent run.
 */
export type StTriggeredBy = 'manual' | 'pdr' | 'nightly' | 'symbol-added';

/**
 * Agent status singleton stored in Firestore.
 */
export interface StStatus {
  lastRunAt?: FirebaseFirestore.Timestamp | FirebaseFirestore.FieldValue;
  lastRunId?: string;
  lastRunStatus?: StRunStatus;
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
export interface StWatchedSymbol {
  symbol: string;
  strategy: 'st-trend-rider' | string;
  amount: number;
  enabled: boolean;
  customPrompt?: string;
  intervalMinutes: number;
}

/**
 * Agent run record stored in Firestore.
 */
export interface StDailyRun {
  id: string;
  type: 'daily-scan' | 'symbol-added';
  marketDate: string;  // YYYY-MM-DD — trading date of the data being processed
  runDate: string;    // YYYY-MM-DD — PT calendar date on which the run occurred
  status: StRunStatus;
  triggeredBy?: StTriggeredBy;
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
export interface StJob {
  id: string;  // symbol name
  symbol: string;
  status: StJobStatus;
  attempts: number;
  lastError?: string;
  createdAt: FirebaseFirestore.Timestamp | FirebaseFirestore.FieldValue;
  startedAt?: FirebaseFirestore.Timestamp | FirebaseFirestore.FieldValue;
  completedAt?: FirebaseFirestore.Timestamp | FirebaseFirestore.FieldValue;
}

/**
 * RH Agent Firestore Collections
 *
 * Collection names, document ID patterns, and core symbol document shapes used
 * across the RH Agent cloud function and related modules such as symbol-data-sync.
 * Keeping these in one place prevents typos and makes renames easy.
 */

/** Root collection for agent run records (metadata, status, summary). */
export const RH_AGENT_RUNS_COLLECTION = 'rh-agent-runs';

/** Singleton doc ID for agent status under rh-agent-status/{AGENT_STATUS_DOC}. */
export const AGENT_STATUS_DOC = 'current';

/** Root collection for agent configuration and status. */
export const RH_AGENT_STATUS_COLLECTION = 'rh-agent-status';

/** UTC cron for the nightly RH Agent Cloud Scheduler (6 PM PT Mon-Fri in PDT). */
export const RH_AGENT_SCHEDULE_CRON = '0 1 * * 2-6';

/** Symbol list collection for daily scanning. */
export const RH_AGENT_SYMBOLS_COLLECTION = 'rh-agent-symbols';

/** User-defined symbol lists (PRIMARY, SECONDARY, etc.). */
export const RH_AGENT_SYMBOL_LISTS_COLLECTION = 'rh-agent-symbol-lists';

/** Symbol analysis jobs (subcollection under runs). */
export const RH_AGENT_JOBS_SUBCOLLECTION = 'jobs';

/** Run-ids subcollection under each symbol doc. One doc per runId, signals as a map field. */
export const RH_AGENT_RUN_IDS_SUBCOLLECTION = 'run-ids';

/** Signal-history subcollection under each symbol doc. One doc per date; canonical EOD truth. */
export const RH_AGENT_SIGNAL_HISTORY_SUBCOLLECTION = 'signal-history';

/**
 * Symbol document in rh-agent-symbols/{SYMBOL}.
 * Config fields coexist with SA company overview and signal gate fields.
 */
export interface RhAgentSymbol {
  symbol: string;
  enabled: boolean;
  createdAt: string | FirebaseFirestore.Timestamp;
  /** How this symbol was added to the tracked universe (e.g. 'manual-addition'). */
  source?: string;
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
 * Overview fields written by rhAgentOverviewSyncSymbol.
 * Single source of truth: a strict subset of RhAgentSymbol.
 */
export type RhAgentOverviewFields = Pick<
  RhAgentSymbol,
  | 'name'
  | 'sector'
  | 'industry'
  | 'exchange'
  | 'assetType'
  | 'marketCap'
  | 'marketCapTier'
  | 'beta'
  | 'peRatio'
  | 'forwardPe'
  | 'week52High'
  | 'week52Low'
  | 'ma200'
  | 'ma50'
  | 'dividendYield'
  | 'analystTarget'
  | 'analystBuys'
  | 'analystSells'
>;

/**
 * Symbol profile returned by rhAgentGetSymbolsWithSignals.
 * Mirrors RhAgentSymbol with timestamp fields converted to ISO strings for JSON.
 */
export interface RhAgentSymbolProfile extends Omit<RhAgentOverviewFields, 'marketCapTier'> {
  symbol: string;
  enabled: boolean;
  createdAt: string;
  lastAnalyzedAt?: string;
  lastDailySignalDate?: string;
  lastWeeklySignalDate?: string;
  lastDailySignalDirection?: string;
  lastWeeklySignalDirection?: string;
  marketCapTier?: string;
}

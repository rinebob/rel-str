/**
 * ST Firestore Collections
 *
 * Collection names, document ID patterns, and core symbol document shapes used
 * across the ST cloud function and related modules such as symbol-data-sync.
 * Keeping these in one place prevents typos and makes renames easy.
 */

/** Root collection for agent run records (metadata, status, summary). */
export const ST_RUNS_COLLECTION = 'savant-trader/data/runs';

/** Singleton doc ID for agent status under savant-trader/data/status/{AGENT_STATUS_DOC}. */
export const AGENT_STATUS_DOC = 'current';

/** Root collection for agent configuration and status. */
export const ST_STATUS_COLLECTION = 'savant-trader/data/status';

/** UTC cron for the nightly ST Cloud Scheduler (6 PM PT Mon-Fri in PDT). */
export const ST_SCHEDULE_CRON = '0 1 * * 2-6';

/** Symbol list collection for daily scanning. */
export const ST_SYMBOLS_COLLECTION = 'savant-trader/data/symbols';

/** User-defined symbol lists (PRIMARY, SECONDARY, etc.). */
export const ST_SYMBOL_LISTS_COLLECTION = 'savant-trader/data/symbol-lists';

/** Default list name for newly onboarded symbols. */
export const DEFAULT_SYMBOL_LIST_NAME = 'PRIMARY';

/** Known source values for how a symbol entered the ST tracked universe. */
export enum StSymbolSource {
  MANUAL_ADD = 'manual-add',
  PARTNER_UNIVERSE = 'partner-universe',
}

/** Symbol analysis jobs (subcollection under runs). */
export const ST_JOBS_SUBCOLLECTION = 'jobs';

/** Run-ids subcollection under each symbol doc. One doc per runId, signals as a map field. */
export const ST_RUN_IDS_SUBCOLLECTION = 'run-ids';

/** Signal-history subcollection under each symbol doc. One doc per date; canonical EOD truth. */
export const ST_SIGNAL_HISTORY_SUBCOLLECTION = 'signal-history';

/** Order intents collection (new). */
export const ST_ORDER_INTENTS_COLLECTION = 'savant-trader/data/order-intents';

/** Trading config collection (new). */
export const ST_TRADING_CONFIG_COLLECTION = 'savant-trader/data/trading-config';

/** Occurrence decisions collection (matches FE Collection enum). */
export const ST_OCCURRENCE_DECISIONS_COLLECTION = 'savant-trader/data/occurrence-decisions';

/** Review list collection (matches FE Collection enum). */
export const ST_REVIEW_LIST_COLLECTION = 'savant-trader/data/review-list';

/**
 * Symbol document in savant-trader/data/symbol-meta/{SYMBOL}.
 * Config fields coexist with SA company overview and signal gate fields.
 */
export interface StSymbol {
  symbol: string;
  enabled: boolean;
  createdAt: string | FirebaseFirestore.Timestamp;
  /** How this symbol was added to the tracked universe (one of StSymbolSource). */
  source?: StSymbolSource;
  lastAnalyzedAt?: FirebaseFirestore.Timestamp | FirebaseFirestore.FieldValue;
  // Denormalized signal gate fields (written by worker on each signal)
  lastDailySignalDate?: string;   // YYYY-MM-DD
  lastWeeklySignalDate?: string;  // YYYY-MM-DD
  // Company overview (written by stOverviewSyncSymbol, Phase 1)
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
 * Overview fields written by stOverviewSyncSymbol.
 * Single source of truth: a strict subset of StSymbol.
 */
export type StOverviewFields = Pick<
  StSymbol,
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
 * Symbol profile returned by stGetSymbolsWithSignals.
 * Mirrors StSymbol with timestamp fields converted to ISO strings for JSON.
 */
export interface StSymbolProfile extends Omit<StOverviewFields, 'marketCapTier'> {
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

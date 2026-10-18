/**
 * ST Firestore Collections
 *
 * Collection names, document ID patterns, and core symbol document shapes used
 * across the ST cloud function and related modules such as symbol-data-sync.
 * Keeping these in one place prevents typos and makes renames easy.
 *
 * This file is also the functions-side re-export surface for the canonical
 * `st-` roots in shared/st-collections.ts (@st/collections) — during the #984
 * dual-write window it carries both legacy (deprecated) and new names.
 */
import type { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { ST_JOBS_SUBCOLLECTION_NAME } from '@st/collections';

// Canonical `st-` roots live in shared/st-collections.ts (@st/collections) —
// single source for BE + FE. Explicit re-export list (fails loudly on a name
// collision, unlike `export *` which would silently shadow); names use *_ROOT,
// disjoint from the legacy *_COLLECTION constants below.
export {
  ST_SYMBOLS_ROOT,
  ST_SIGNALS_ROOT,
  ST_RUNS_ROOT,
  ST_ORDER_TICKETS_ROOT,
  ST_POSITION_GROUPS_ROOT,
  ST_STRATEGY_INSTANCES_ROOT,
  ST_CONFIG_ROOT,
  ST_SYMBOL_LISTS_ROOT,
  ST_BACKTEST_RUNS_ROOT,
  ST_BACKTEST_PERMUTATIONS_ROOT,
  ST_PAPER_TRADING_ROOT,
  ST_PORTFOLIO_ROOT,
  ST_CONFIG_STATUS_DOC,
  ST_JOBS_SUBCOLLECTION_NAME,
  StPaperTradingKind,
  StPortfolioKind,
  stRunJobsPath,
  stRunJobDocPath,
  stPaperTradingItemsPath,
  stPaperTradingDocPath,
  stPortfolioItemsPath,
  stPortfolioDocPath,
} from '@st/collections';
export type { StPaperTradingPathKind } from '@st/collections';

/**
 * Root collection for agent run records (metadata, status, summary).
 * @deprecated Use ST_RUNS_ROOT ('st-runs') for new writes; removed in #1013.
 */
export const ST_RUNS_COLLECTION = 'savant-trader/data/runs';

/**
 * Singleton doc ID for agent status under savant-trader/data/status/{AGENT_STATUS_DOC}.
 * @deprecated Status doc moves to st-config/status — ST_CONFIG_ROOT + ST_CONFIG_STATUS_DOC (#984); removed in #1013.
 */
export const AGENT_STATUS_DOC = 'current';

/**
 * Root collection for agent configuration and status.
 * @deprecated Use ST_CONFIG_ROOT ('st-config') for new writes; removed in #1013.
 */
export const ST_STATUS_COLLECTION = 'savant-trader/data/status';

/** UTC cron for the nightly ST Cloud Scheduler (6 PM PT Mon-Fri in PDT). */
export const ST_SCHEDULE_CRON = '0 1 * * 2-6';

/**
 * Symbol list collection for daily scanning.
 * @deprecated Use ST_SYMBOLS_ROOT ('st-symbols') for new writes; removed in #1013.
 */
export const ST_SYMBOLS_COLLECTION = 'savant-trader/data/symbols';

/**
 * User-defined symbol lists (NEW, PRIMARY, SECONDARY, etc.).
 * @deprecated Use ST_SYMBOL_LISTS_ROOT ('st-symbol-lists') for new writes; removed in #1013.
 */
export const ST_SYMBOL_LISTS_COLLECTION = 'savant-trader/data/symbol-lists';

/**
 * Inbox list for newly onboarded symbols — lands them in NEW instead of
 * PRIMARY so nothing enters the triage buckets unreviewed. Frontend
 * registry treats NEW as an exclusive system list: filing the symbol
 * elsewhere strips the NEW membership automatically.
 */
export const DEFAULT_SYMBOL_LIST_NAME = 'NEW';

/** Known source values for how a symbol entered the ST tracked universe. */
export enum StSymbolSource {
  MANUAL_ADD = 'manual-add',
  PARTNER_UNIVERSE = 'partner-universe',
}

/**
 * Symbol analysis jobs subcollection name (same 'jobs' under legacy runs and st-runs).
 * @deprecated Use ST_JOBS_SUBCOLLECTION_NAME / stRunJobsPath from @st/collections for new code.
 */
export const ST_JOBS_SUBCOLLECTION = ST_JOBS_SUBCOLLECTION_NAME;

/**
 * Run-ids subcollection under each symbol doc. One doc per runId, signals as a map field.
 * @deprecated Superseded by runIds[] on st-signals occurrence docs (#984); removed in #1013.
 */
export const ST_RUN_IDS_SUBCOLLECTION = 'run-ids';

/**
 * Signal-history subcollection under each symbol doc. One doc per date; canonical EOD truth.
 * @deprecated Superseded by flat st-signals occurrence docs (#984); removed in #1013.
 */
export const ST_SIGNAL_HISTORY_SUBCOLLECTION = 'signal-history';

/**
 * Legacy order-intents collection (FE-written order tickets pre-#1003).
 * @deprecated Use ST_ORDER_TICKETS_ROOT ('st-order-tickets') for new writes; removed in #1013.
 */
export const ST_ORDER_INTENTS_COLLECTION = 'savant-trader/data/order-intents';

/**
 * Pre-#1006 strategy-instance root (orphaned — nothing read it; the engine
 * read the paper-trading/instances anchor). Referenced by migration/audit
 * scripts only.
 * @deprecated Superseded by ST_STRATEGY_INSTANCES_ROOT; removed in #1013.
 */
export const LEGACY_OPTIONS_STRATEGY_INSTANCES = 'options-strategy-instances';

/**
 * Screenshot-capture index — one flat doc per lifecycle capture
 * (`{groupId}-{refId}-{event}`), backend-written, FE read-only for the
 * screenshot library. Canonical home is `@screenshot-capture/contracts`
 * (shared with the FE); re-exported here for the backend constants surface.
 */
export { ST_SCREENSHOTS_COLLECTION } from '@screenshot-capture/contracts';

/**
 * Trading config collection (new).
 * @deprecated Use ST_CONFIG_ROOT ('st-config') for new writes; removed in #1013.
 */
export const ST_TRADING_CONFIG_COLLECTION = 'savant-trader/data/trading-config';

/** Doc id for the auto-paper ingest config — legacy trading-config/autoPaper, moves to st-config/autoPaper (#984). */
export const AUTO_PAPER_CONFIG_DOC = 'autoPaper';

/**
 * Auto-paper ingest config (Thread #904) — read by the `stAutoPaperIngest`
 * task at run completion.
 *
 * `lists` names symbol-list keys to capture from (lists are user-scoped —
 * `symbol-lists/{uid}_{KEY}`); a `'*'` entry flips to global capture, which
 * is how "open it for a few runs" stays a config-only experiment.
 * `signalTypes` overrides the default daily trend-rider allowlist.
 * `ownerUid` picks which user's list doc to read when several users carry
 * the same list key.
 */
export interface AutoPaperConfig {
  enabled: boolean;
  lists: string[];
  signalTypes?: string[];
  ownerUid?: string;
}

/**
 * Occurrence decisions collection (matches FE Collection enum).
 * @deprecated Decisions fold into st-order-tickets (#984); removed in #1013.
 */
export const ST_OCCURRENCE_DECISIONS_COLLECTION = 'savant-trader/data/occurrence-decisions';

/**
 * Review list collection (matches FE Collection enum).
 * @deprecated Being removed entirely in #984 — do not write new consumers.
 */
export const ST_REVIEW_LIST_COLLECTION = 'savant-trader/data/review-list';

/**
 * Symbol document — today under savant-trader/data/symbols/{SYMBOL}
 * (config fields coexist with SA company overview + signal gate fields);
 * symbols + symbol-meta merge into st-symbols/{SYMBOL} in #984.
 */
export interface StSymbol {
  symbol: string;
  enabled: boolean;
  createdAt: string | Timestamp;
  /** How this symbol was added to the tracked universe (one of StSymbolSource). */
  source?: StSymbolSource;
  lastAnalyzedAt?: Timestamp | FieldValue;
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
  overviewFetchedAt?: Timestamp | FieldValue;
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

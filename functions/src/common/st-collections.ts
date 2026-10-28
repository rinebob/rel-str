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
  stConfigDocPath,
  ST_JOBS_SUBCOLLECTION_NAME,
  StPaperTradingKind,
  StPortfolioKind,
  ST_PORTFOLIO_ANCHORS,
  stRunJobsPath,
  stRunJobDocPath,
  stPaperTradingItemsPath,
  stPaperTradingDocPath,
  stPortfolioItemsPath,
  stPortfolioDocPath,
  ST_SCANNER_ROOT,
  ST_SCANNER_PROPOSALS_ANCHOR,
  stScannerProposalsPath,
  stScannerProposalDocPath,
} from '@st/collections';
export type { StPaperTradingPathKind, StScannerKind } from '@st/collections';

/** UTC cron for the nightly ST Cloud Scheduler (6 PM PT Mon-Fri in PDT). */
export const ST_SCHEDULE_CRON = '0 1 * * 2-6';

/**
 * Legacy symbol collection — after #1159 this root is retained ONLY as the
 * parent path for run-ids/signal-history subcollection reads/writes, which
 * stay live until #1019 cuts their readers to st-signals. Doc-level traffic
 * (symbol profile, gate fields, overview) lives on ST_SYMBOLS_ROOT.
 * @deprecated Doc-level use is retired in #1159; the root itself retires
 * in #1019.
 */
export const ST_SYMBOLS_COLLECTION = 'savant-trader/data/symbols';

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
 * Symbol analysis jobs subcollection name (under st-runs run docs — #1159).
 * @deprecated Use ST_JOBS_SUBCOLLECTION_NAME / stRunJobsPath from @st/collections for new code.
 */
export const ST_JOBS_SUBCOLLECTION = ST_JOBS_SUBCOLLECTION_NAME;

/**
 * Run-ids subcollection under each LEGACY symbol doc — still written and
 * read live until #1019 cuts readers to st-signals (#1159 keeps these on
 * the legacy parent path deliberately).
 * @deprecated Superseded by runIds[] on st-signals occurrence docs (#984);
 * retires with the legacy symbols root in #1019.
 */
export const ST_RUN_IDS_SUBCOLLECTION = 'run-ids';

/**
 * Signal-history subcollection under each LEGACY symbol doc — same
 * disposition as ST_RUN_IDS_SUBCOLLECTION.
 * @deprecated Superseded by flat st-signals occurrence docs (#984);
 * retires with the legacy symbols root in #1019.
 */
export const ST_SIGNAL_HISTORY_SUBCOLLECTION = 'signal-history';

/**
 * Screenshot-capture index — one flat doc per lifecycle capture
 * (`{groupId}-{refId}-{event}`), backend-written, FE read-only for the
 * screenshot library. Canonical home is `@screenshot-capture/contracts`
 * (shared with the FE); re-exported here for the backend constants surface.
 */
export { ST_SCREENSHOTS_COLLECTION } from '@screenshot-capture/contracts';

/** Doc id for the auto-paper ingest config — st-config/autoPaper (#984/#1008). */
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
 * Symbol document — canonical home is st-symbols/{SYMBOL} since #1159
 * (config fields coexist with SA company overview + signal gate fields).
 * The legacy savant-trader/data/symbols parent still hosts the
 * run-ids/signal-history subcollections until #1019.
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

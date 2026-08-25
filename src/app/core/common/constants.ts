/** @topic #108 — Options Position Strategy Engine */
import { NavItem } from "./interfaces";

export const NAV_MENU_ITEMS: NavItem[] = [
    // {
    //     name: 'documentation',
    //     text: 'documentation',
    //     href: 'documentation',
    //     mobileOnly: false,
    //     external: true,
    //     target: '_self',
    // },
    // {
    //     name: 'contact',
    //     text: 'contact',
    //     href: 'contact',
    //     mobileOnly: false,
    //     external: true,
    //     target: '_self',
    // },
    {
        name: 'symbols',
        text: 'symbols',
        href: '',
        mobileOnly: false,
        external: true,
        target: '_self',
    },
    
    {
        name: 'signup',
        text: 'signup',
        href: 'signup',
        mobileOnly: false,
        external: true,
        target: '_self',
    },
    {
        name: 'login',
        text: 'login',
        href: 'login',
        mobileOnly: false,
        external: true,
        target: '_self',
    },
    {
        name: 'dashboard',
        text: 'dashboard',
        href: 'dashboard',
        mobileOnly: false,
        external: false,
        target: '_self',
    },
    {
        name: 'dashboard-v2',
        text: 'dashboard-v2',
        href: 'dashboard-v2',
        mobileOnly: false,
        external: false,
        target: '_self',
    },
    {
        name: 'dashboard-v3',
        text: 'dashboard-v3',
        href: 'dashboard-v3',
        mobileOnly: false,
        external: false,
        target: '_self',
    },  
    {
        name: 'decision-board',
        text: 'decision board',
        href: 'decision-board',
        mobileOnly: false,
        external: false,
        target: '_self',
    },
    {
        name: 'positions',
        text: 'positions',
        href: 'positions-view',
        mobileOnly: false,
        external: false,
        target: '_self',
    },
    {
        name: 'trade-journal',
        text: 'trade journal',
        href: 'trade-journal',
        mobileOnly: false,
        external: false,
        target: '_self',
    },
    {
        name: 'heatmap',
        text: 'heatmap',
        href: 'heatmap-view',
        mobileOnly: false,
        external: false,
        target: '_self',
    },
    {
        name: 'heatmap-chart',
        text: 'heatmap chart',
        href: 'heatmap-chart/SPY/AAPL',
        mobileOnly: false,
        external: false,
        target: '_self',
    },
    {
        name: 'rs-chart',
        text: 'rs-chart',
        href: 'rs-chart',
        mobileOnly: false,
        external: false,
        target: '_self',
    },
    {
        name: 'sync-chart',
        text: 'sync-chart',
        href: 'sync-chart',
        mobileOnly: false,
        external: false,
        target: '_self',
    },
    {
        name: 'rs-table',
        text: 'rs-table',
        href: 'rs-table',
        mobileOnly: false,
        external: false,
        target: '_self',
    },
    {
        name: 'rh-agent',
        text: 'RH Agent',
        href: 'rh-agent',
        mobileOnly: false,
        external: false,
        target: '_self',
    },
    {
        name: 'history',
        text: 'history',
        href: 'history',
        mobileOnly: false,
        external: false,
        target: '_self',
    },
    {
        name: 'logout',
        text: 'logout',
        href: '',
        mobileOnly: false,
        external: false,
        target: '_self',
    },
    // {
    //     name: 'chart',
    //     text: '',
    //     href: '/',
    //     mobileOnly: false,
    //     target: '_self',
    // },
    // {
    //     name: '',
    //     text: '',
    //     target: '',
    //     mobileOnly: false,
    //     children: [
    //         {
    //             name: '',
    //             text: '',
    //             href: '',
    //             target: '_self',
    //         },
    //
    // ]
]

export const NUM_HEATMAP_MIDPOINTS = 11;

// =============================
// Firebase/Firestore constants
// =============================

/** Canonical callable function names used by the FE. */
export enum CallableName {
  GET_TRACKED_SYMBOLS = 'getTrackedSymbols',
  VALIDATE_AND_REGISTER_PAIRS = 'validateAndRegisterPairs',
  UNREGISTER_PAIRS = 'unregisterPairs',
  // RsSignalHistory
  GET_PAIR_SIGNALS = 'getPairSignals',
  GET_DAILY_SIGNALS = 'getDailySignals',
  GET_PNL_SUMMARY = 'getPnLSummary',
  UPDATE_POSITION_ACTUALS = 'updatePositionActuals',
  /** Diagnose and optionally auto-fix missing pair-day RS entries */
  DIAGNOSE_PAIR_DAYS = 'diagnosePairDays',
  /** RS chart: daily OHLCV bars via SavantAPI */
  GET_PAIR_DAILY_BARS = 'getPairDailyBars',
  /** Options contract viewer: historical time-series for a single contract */
  GET_HISTORICAL_OPTIONS_CONTRACT = 'getHistoricalOptionsContract',
  /** Options contract viewer: discover available contract IDs */
  LIST_OPTIONS_CONTRACTS = 'listOptionsContracts',
  /** Options contract viewer: fetch expiration/strike index from SA */
  GET_OPTIONS_CONTRACT_INDEX = 'getOptionsContractIndex',
  /** Options contract viewer: query contract catalog with metadata, filters, pagination */
  QUERY_CONTRACT_CATALOG = 'queryContractCatalog',
  /** Spread viewer: submit a batch of spreads for time series loading */
  SUBMIT_SPREAD_RUN = 'submitSpreadRun',
  /** Options strategy dashboard: list open/closed positions */
  LIST_STRATEGY_POSITIONS = 'listStrategyPositions',
  /** Options strategy dashboard: equity curve + stats for a scope */
  GET_STRATEGY_EQUITY_CURVE = 'getStrategyEquityCurve',
}

/** Top-level Firestore collections used by the FE. */
export enum Collection {
  TRACKED_SYMBOLS = 'tracked-symbols',
  PAIR_REGISTRY = 'pair-registry',
  PAIRS_DATA = 'pairs-data',
  USERS = 'users',
  ADMIN = 'admin',
  APP = 'app',
  POSITIONS = 'positions',
  SYMBOL_DATA = 'symbol-data',
  ST_OCCURRENCE_DECISIONS = 'savant-trader/data/occurrence-decisions',
  ST_REVIEW_LIST = 'savant-trader/data/review-list',
  ST_SYMBOL_LISTS = 'savant-trader/data/symbol-lists',
  ST_SYMBOL_META = 'savant-trader/data/symbol-meta',
  ST_RUNS = 'savant-trader/data/runs',
  ST_ORDER_INTENTS = 'savant-trader/data/order-intents',
  ST_TRADING_CONFIG = 'savant-trader/data/trading-config',
  SPREAD_RUNS = 'spread-runs',
  SPREAD_LISTS = 'spread-lists',
  OPTIONS_STRATEGY_INSTANCES = 'options-strategy-instances',
}

/** Known subcollection names under a user document. */
export enum Subcollection {
  LISTS = 'lists',
  REFRESH_STATUS = 'refresh-status',
  ITEMS = 'items',
  TRADES = 'trades',
}

/** Bucket document ids used under certain root collections (e.g., positions/open). */
export enum BucketDocId {
  OPEN = 'open',
}

// =============================
// Trade journal enums
// =============================

export enum TradeDirection {
  LONG = 'LONG',
  SHORT = 'SHORT',
}

export enum TradeStatus {
  OPEN = 'OPEN',
  CLOSED = 'CLOSED',
  CANCELED = 'CANCELED',
  QUEUED = 'QUEUED',
  SETUP = 'SETUP',
}

/** Helper to produce the lists collection path for a user. */
export const userListsPath = (uid: string) => `${Collection.USERS}/${uid}/${Subcollection.LISTS}`;

// =============================
// Savant Trader path helpers
// =============================

export const stOccurrenceDecisionsPath = () => Collection.ST_OCCURRENCE_DECISIONS;
export const stOrderIntentsPath = () => Collection.ST_ORDER_INTENTS;
export const stSymbolListsPath = () => Collection.ST_SYMBOL_LISTS;
export const stSymbolMetaPath = () => Collection.ST_SYMBOL_META;
export const stRunsPath = () => Collection.ST_RUNS;
export const stReviewListDocPath = () => Collection.ST_REVIEW_LIST;
export const stTradingConfigDocPath = () => Collection.ST_TRADING_CONFIG;
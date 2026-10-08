/** @topic #108 — Options Position Strategy Engine */
import { AppRoutes, NavItem, NavSection, PageInfo } from "./interfaces";

/** Workflow-ordered sidenav sections — the Journey Navigation data
 *  model (#660/#700). Groups match the PRD Sidenav Groups table; the
 *  empty-label section is the unlabeled tail. Auth items are NOT data —
 *  the shell renders them by auth state (T3). Hidden/dev surfaces are
 *  reachable by URL but absent here. */
export const NAV_SECTIONS: NavSection[] = [
    {
        label: 'Portfolio',
        items: [
            { name: 'portfolio-dashboard', text: 'Portfolio Dashboard', href: 'portfolio' },
            { name: 'portfolio-allocation', text: 'Portfolio Allocation', href: 'portfolio/allocation' },
        ],
    },
    {
        label: 'Signals',
        items: [
            { name: 'run-dashboard', text: 'Runs', href: 'signals/runs' },
            { name: 'signal-review', text: 'Signal Review', href: 'signals/review' },
            { name: 'chart-review', text: 'Chart Review', href: 'signals/charts' },
        ],
    },
    {
        label: 'Trading',
        items: [
            { name: 'signal-order', text: 'Live', href: 'trading/live' },
            { name: 'paper-trading', text: 'Paper', href: 'trading/paper' },
        ],
    },
    {
        label: 'Options',
        items: [
            { name: 'option-chain', text: 'Chain', href: 'options/chain' },
            { name: 'option-chain-pct-change', text: '% Change', href: 'options/pct-change' },
            { name: 'option-chart', text: 'Chart', href: 'options/chart' },
            { name: 'spread-chart', text: 'Spread Chart', href: 'options/spread-chart' },
            { name: 'options-strategy-dashboard', text: 'Strategy Dashboard', href: 'options/strategy-dashboard' },
            { name: 'strategy-builder', text: 'Build', href: 'options/strategy/build' },
            { name: 'strategy-backtest', text: 'Backtest', href: 'options/strategy/backtest' },
        ],
    },
    {
        label: 'Analysis',
        items: [
            { name: 'swing-analysis', text: 'Swing Analysis', href: 'analysis/swings' },
        ],
    },
    {
        label: 'Tools',
        items: [
            { name: 'rh-account-inquiry', text: 'Account Inquiry', href: 'tools/account' },
            { name: 'topic-viewer', text: 'Topic Viewer', href: 'tools/topic-viewer' },
        ],
    },
    {
        label: '',
        items: [
            { name: 'dashboard-v3', text: 'Dashboard V3', href: 'dashboard-v3' },
        ],
    },
];

/** Flat view of NAV_SECTIONS — kept for consumers that still iterate a
 *  flat list (sidenav until T3; several specs). Single source of truth
 *  is NAV_SECTIONS; do not extend this list directly. */
export const NAV_MENU_ITEMS: NavItem[] = NAV_SECTIONS.flatMap((s) => s.items);

/** Signed-out sidenav content — auth actions only. Every href MUST resolve
 *  to an unguarded route (no canActivate); nav-sections.spec pins that
 *  invariant. Kept out of NAV_SECTIONS/NAV_MENU_ITEMS: auth items are shell
 *  state, not feature nav (#701/#740). */
export const SIGNED_OUT_SECTIONS: NavSection[] = [
    {
        label: '',
        items: [
            { name: 'login', text: 'Log in', href: 'login' },
            { name: 'signup', text: 'Sign up', href: 'signup' },
        ],
    },
];

/** Page identity registry — the single source for what the global header
 *  shows per route (#823). `icon` is a Material Icons ligature name — the
 *  font loaded by index.html (legacy set, not Material Symbols).
 *  `Record<AppRoutes, …>` makes coverage exhaustive
 *  at compile time: adding an AppRoutes member without a PAGE_INFO entry
 *  fails the build; core-routes.spec additionally pins non-empty fields.
 *  The header resolves the joined route path against these keys by
 *  longest-prefix match, so nested children inherit ancestor identity.
 *  Redirect-only members (CHART, LOGOUT) carry dormant entries — their
 *  targets' identity wins on arrival. */
export const PAGE_INFO: Record<AppRoutes, PageInfo> = {
    [AppRoutes.LOGIN]:                        { title: 'Log in',                     icon: 'login' },
    [AppRoutes.LOGOUT]:                       { title: 'Log out',                    icon: 'logout' },
    [AppRoutes.DASHBOARD]:                    { title: 'Dashboard',                  icon: 'dashboard' },
    [AppRoutes.DASHBOARD_V2]:                 { title: 'Dashboard V2',               icon: 'dashboard' },
    [AppRoutes.DASHBOARD_V3]:                 { title: 'Dashboard V3',               icon: 'dashboard' },
    [AppRoutes.DOCUMENTATION]:                { title: 'Documentation',              icon: 'description' },
    [AppRoutes.CONTACT]:                      { title: 'Contact',                    icon: 'mail' },
    [AppRoutes.SIGNUP]:                       { title: 'Sign up',                    icon: 'person_add' },
    [AppRoutes.CHART]:                        { title: 'Chart',                      icon: 'candlestick_chart' },
    [AppRoutes.SYNC_CHART]:                   { title: 'Sync Chart',                 icon: 'candlestick_chart' },
    [AppRoutes.RS_CHART]:                     { title: 'RS Chart',                   icon: 'candlestick_chart' },
    [AppRoutes.HISTORY]:                      { title: 'History',                    icon: 'history' },
    [AppRoutes.RS_TABLE]:                     { title: 'RS Table',                   icon: 'table' },
    [AppRoutes.POSITIONS_VIEW]:               { title: 'Positions',                  icon: 'inventory_2' },
    [AppRoutes.TRADE_JOURNAL]:                { title: 'Trade Journal',              icon: 'menu_book' },
    [AppRoutes.HEATMAP_VIEW]:                 { title: 'Heatmap',                    icon: 'grid_view' },
    [AppRoutes.HEATMAP_CHART]:                { title: 'Heatmap Chart',              icon: 'grid_on' },
    [AppRoutes.DECISION_BOARD]:               { title: 'Decision Board',             icon: 'view_kanban' },
    [AppRoutes.RUN_DASHBOARD]:                { title: 'Run Dashboard',              icon: 'view_list' },
    [AppRoutes.CHART_REVIEW]:                 { title: 'Chart Review',               icon: 'image_search' },
    [AppRoutes.SIGNAL_REVIEW]:                { title: 'Signal Review',              icon: 'rate_review' },
    [AppRoutes.SIGNAL_ORDER]:                 { title: 'Signal Order',               icon: 'bolt' },
    [AppRoutes.SIGNAL_ACTION_REPORT]:         { title: 'Triage Report',              icon: 'fact_check' },
    [AppRoutes.RH_ACCOUNT_INQUIRY]:           { title: 'Account Inquiry',            icon: 'account_balance' },
    [AppRoutes.STRATEGY_BACKTEST]:            { title: 'Strategy Backtest',          icon: 'science' },
    [AppRoutes.SIGNAL_HISTORY]:               { title: 'Signal History',             icon: 'manage_history' },
    [AppRoutes.OPTION_CHART]:                 { title: 'Option Chart',               icon: 'stacked_line_chart' },
    [AppRoutes.SPREAD_CHART]:                 { title: 'Spread Chart',               icon: 'show_chart' },
    [AppRoutes.OPTIONS_STRATEGY_DASHBOARD]:   { title: 'Options Strategy Dashboard', icon: 'analytics' },
    [AppRoutes.PAPER_TRADING]:                { title: 'Paper Trading',              icon: 'receipt_long' },
    [AppRoutes.STRATEGY_BUILDER]:             { title: 'Strategy Builder',           icon: 'build' },
    [AppRoutes.PORTFOLIO_DASHBOARD]:          { title: 'Portfolio Dashboard',        icon: 'account_balance_wallet' },
    [AppRoutes.PORTFOLIO_ALLOCATION]:         { title: 'Portfolio Allocation',       icon: 'pie_chart' },
    [AppRoutes.OPTION_CHAIN_PCT_CHANGE]:      { title: 'Option Chain % Change',      icon: 'percent' },
    [AppRoutes.OPTION_CHAIN]:                 { title: 'Option Chain',               icon: 'link' },
    [AppRoutes.SWING_ANALYSIS]:               { title: 'Swing Analysis',             icon: 'query_stats' },
    [AppRoutes.FLEX_CHART_SANDBOX]:           { title: 'Flex Chart Sandbox',         icon: 'lab_profile' },
    [AppRoutes.DEV_GALLERY]:                  { title: 'Gallery (Dev)',              icon: 'photo_library' },
    [AppRoutes.SCREENSHOT_DEV]:               { title: 'Screenshot (Dev)',           icon: 'screenshot_monitor' },
    [AppRoutes.TOPIC_VIEWER]:                 { title: 'Topic Viewer',               icon: 'account_tree' },
};

/** Longest-prefix identity lookup (#823). `joinedPath` is the route's
 *  `routeConfig.path` segments joined from root — NOT resolved URL
 *  segments — so param templates ('heatmap-chart/:baseline/:symbol')
 *  still key directly. A nested child with no own entry inherits its
 *  ancestor's identity; an unkeyed path resolves undefined. */
export function resolvePageInfo(joinedPath: string): PageInfo | undefined {
    // Drop empty segments — the pathFromRoot join includes the root '' route
    // ('/signals/review'), and empties can never be registry keys anyway.
    let p = joinedPath.split('/').filter(Boolean).join('/');
    while (!Object.hasOwn(PAGE_INFO, p) && p.includes('/')) {
        p = p.slice(0, p.lastIndexOf('/'));
    }
    return Object.hasOwn(PAGE_INFO, p) ? PAGE_INFO[p as AppRoutes] : undefined;
}

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
  /** Options chain snapshot: fetch full chain snapshot for a symbol+date */
  GET_HISTORICAL_OPTIONS_CHAIN = 'getHistoricalOptionsChain',
  /** Spread viewer: submit a batch of spreads for time series loading */
  SUBMIT_SPREAD_RUN = 'submitSpreadRun',
  /** Options strategy dashboard: list open/closed positions */
  LIST_STRATEGY_POSITIONS = 'listStrategyPositions',
  /** Options strategy dashboard: equity curve + stats for a scope */
  GET_STRATEGY_EQUITY_CURVE = 'getStrategyEquityCurve',
  /** Paper trading: accept a signal/order ticket as paper trades */
  PAPER_SIGNAL_ORDER = 'paperSignalOrder',
  /** Paper trading: list trades with AND-combined filters */
  LIST_PAPER_TRADES = 'listPaperTrades',
  /** Paper trading: rollup stats for a scope, or all docs when omitted */
  GET_PAPER_STATS = 'getPaperStats',
  /** Paper trading: caller's paper account */
  GET_PAPER_ACCOUNT = 'getPaperAccount',
  /** Paper trading: exit-variant registry configs */
  LIST_EXIT_VARIANTS = 'listExitVariants',
  /** Dev lifecycle viewer: GitHub issue-hierarchy tree for supported repos */
  GET_LIFECYCLE_TREE = 'getLifecycleTree',
  /** Screenshot capture: spec → SVG+PNG artifacts in the default bucket (#746) */
  CAPTURE_CHART_SNAPSHOT = 'captureChartSnapshot',
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
  ST_SYMBOLS = 'savant-trader/data/symbols',
  ST_SYMBOL_META = 'savant-trader/data/symbol-meta',
  ST_RUNS = 'savant-trader/data/runs',
  ST_ORDER_INTENTS = 'savant-trader/data/order-intents',
  /** Screenshot-capture index — backend-written, FE read-only (#846). */
  ST_SCREENSHOTS = 'st-screenshots',
  ST_TRADING_CONFIG = 'savant-trader/data/trading-config',
  SPREAD_RUNS = 'spread-runs',
  SPREAD_LISTS = 'spread-lists',
  PAPER_TRADING_INSTANCES = 'paper-trading/instances/items',
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


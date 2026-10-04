/** @topic #108 — Options Position Strategy Engine | @topic #137 — Strategy Builder UI */
export enum AppRoutes {
	LOGIN = 'login',
	LOGOUT = 'logout',
	DASHBOARD = 'dashboard',
	DASHBOARD_V2 = 'dashboard-v2',
	DASHBOARD_V3 = 'dashboard-v3',
	DOCUMENTATION = 'documentation',
	CONTACT = 'contact',
	SIGNUP = 'signup',
	CHART = 'chart',
    SYNC_CHART = 'sync-chart',
    RS_CHART = 'rs-chart',
	HISTORY = 'history',
	RS_TABLE = 'rs-table',
	POSITIONS_VIEW = 'positions-view',
	TRADE_JOURNAL = 'trade-journal',
	HEATMAP_VIEW = 'heatmap-view',
	HEATMAP_CHART = 'heatmap-chart/:baseline/:symbol',
	DECISION_BOARD = 'decision-board',
	/** Run Dashboard — funnel root: pick a run (#660). */
	RUN_DASHBOARD = 'signals/runs',
	CHART_REVIEW = 'signals/charts',
	SIGNAL_REVIEW = 'signals/review',
	/** Signal Order — the live order ticket (#660). */
	SIGNAL_ORDER = 'trading/live',
	SIGNAL_ACTION_REPORT = 'signal-action-report',
	RH_ACCOUNT_INQUIRY = 'tools/account',
	STRATEGY_BACKTEST = 'options/strategy/backtest',
	SIGNAL_HISTORY = 'signal-history',
	OPTION_CHART = 'options/chart',
	SPREAD_CHART = 'options/spread-chart',
	OPTIONS_STRATEGY_DASHBOARD = 'options/strategy-dashboard',
	/** Paper trading dashboard: paper ledger trades + stats (#553/#569). */
	PAPER_TRADING = 'trading/paper',
	STRATEGY_BUILDER = 'options/strategy/build',
	PORTFOLIO_DASHBOARD = 'portfolio',
	PORTFOLIO_ALLOCATION = 'portfolio/allocation',
	OPTION_CHAIN_PCT_CHANGE = 'options/pct-change',
	OPTION_CHAIN = 'options/chain',
	SWING_ANALYSIS = 'analysis/swings',
	FLEX_CHART_SANDBOX = 'dev/flex-chart',
	/** Gallery View dev surface — promoted to trading/gallery by #762 (#743). */
	DEV_GALLERY = 'dev/gallery',
	/** PROTOTYPE — throwaway Today-surface variants route. Remove after decision. */
	PROTOTYPE_TODAY = 'prototype-today',
	/** Topic Viewer: read-only GitHub issue-lifecycle tree (#619). */
	TOPIC_VIEWER = 'tools/topic-viewer',
}

export enum AuthLevel {
    OWNER = 'owner',
    ADMIN = 'admin',
    USER = 'user',
    UNKNOWN = 'unknown',
}

export interface ButtonMetadata {
	url: string;
	fragment?: string;
	text: string;
	authLevel?: AuthLevel;
}

/** One nav entry — `name` is the unique @for track key, `text` the label,
 *  `href` the canonical route path (relative to the root core route). */
export interface NavItem {
    name: string;
    text: string;
    href: string;
}

/** Labeled group of nav items — the workflow-ordered sidenav unit (#660).
 *  An empty `label` renders as the unlabeled tail group. */
export interface NavSection {
    label: string;
    items: NavItem[];
}

export interface Equity {
    symbol: string;
    company?: string;
    exchange?: string;

}

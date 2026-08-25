/** @topic #108 — Options Position Strategy Engine | @topic #137 — Strategy Builder UI */
export enum AppRoutes {
	LOGIN = 'login',
	LOGOUT = 'logout',
	BLOG = 'blog',
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
    CHAT = 'chat',
	CHART_TWO = 'chart-two',
	RS_TABLE = 'rs-table',
	POSITIONS_VIEW = 'positions-view',
	TRADE_JOURNAL = 'trade-journal',
	HEATMAP_VIEW = 'heatmap-view',
	HEATMAP_CHART = 'heatmap-chart/:baseline/:symbol',
	// ROBERT = 'robert',
	// KANBAN = 'kanban',
	// AUDIO = 'audio',
	// MESSAGES = 'messages',
	// BOARD = 'board',
	// CHARTS = 'charts',
	// TRADER = 'trader',
	// ANG_EXP = 'ang-exp',
	// CUBIC_BEZIER = 'cubic-bezier',
	// BIODATA = 'biodata',
	// DESIGN_SYSTEM = 'design-system',
	// KANBAN_BOARD = 'kanban/board',
	// KANBAN_LOGIN = 'kanban/login',
	// KANBAN_LOGOUT = 'kanban/logout',
	// ACME = 'acme',
	DECISION_BOARD = 'decision-board',
	RUN_DASHBOARD = 'run-dashboard',
	CHART_REVIEW = 'chart-review',
	SIGNAL_REVIEW = 'signal-review',
	SIGNAL_ORDER = 'signal-order',
	SIGNAL_ACTION_REPORT = 'signal-action-report',
	RH_ACCOUNT_INQUIRY = 'rh-account-inquiry',
	STRATEGY_BACKTEST = 'strategy-backtest',
	SIGNAL_HISTORY = 'signal-history',
	OPTION_CHART = 'option-chart',
	SPREAD_CHART = 'spread-chart',
	OPTIONS_STRATEGY_DASHBOARD = 'options-strategy-dashboard',
	STRATEGY_BUILDER = 'strategy-builder',
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

export interface NavItem {
    name: string;
    text: string;
    href: string;
    external: boolean;
    children?: NavItem[];
    target?: string;
    mobileOnly?: boolean;
}

export interface Equity {
    symbol: string;
    company?: string;
    exchange?: string;

}

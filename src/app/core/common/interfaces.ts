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
	RH_AGENT = 'rh-agent',
	RH_AGENT_REVIEW = 'rh-agent-review',
	SIGNAL_HISTORY = 'signal-history',
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

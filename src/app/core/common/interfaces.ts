export enum AppRoutes {
	LOGIN = 'login',
	LOGOUT = 'logout',
	BLOG = 'blog',
	DASHBOARD = 'dashboard',
	DOCUMENTATION = 'documentation',
	CONTACT = 'contact',
	SIGNUP = 'signup',
	CHART = 'chart',
	HISTORY = 'history',
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

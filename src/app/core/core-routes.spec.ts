/**
 * @topic #625 — Journey Navigation (task #699 — canonical route tree)
 *
 * Asserts the route table's canonical domain-prefixed paths: the tree's
 * shape IS the contract — nav data, in-page links, and typed URLs all
 * resolve through AppRoutes, so the route table is the single authority.
 */
import CORE_ROUTES from './core-routes';
import { AppRoutes } from './common/interfaces';
import { NAV_MENU_ITEMS } from './common/constants';
import type { Route } from '@angular/router';

const children = (): Route[] => CORE_ROUTES[0]?.children ?? [];
const routeByPath = (path: string): Route | undefined =>
  children().find((r) => r.path === path);

describe('core-routes — canonical journey paths (#699)', () => {
  it.each([
    ['portfolio', 'Portfolio Dashboard landing'],
    ['portfolio/allocation', 'Portfolio Allocation'],
    ['signals/runs', 'Run Dashboard'],
    ['signals/review', 'Signal Review'],
    ['signals/charts', 'Chart Review'],
    ['trading/live', 'Signal Order'],
    ['trading/paper', 'Paper Trading'],
    ['options/chain', 'Option Chain'],
    ['options/pct-change', 'Option Chain % Change'],
    ['options/chart', 'Option Chart'],
    ['options/spread-chart', 'Spread Chart'],
    ['options/strategy-dashboard', 'Options Strategy Dashboard'],
    ['options/strategy/build', 'Strategy Builder'],
    ['options/strategy/backtest', 'Strategy Backtest'],
    ['analysis/swings', 'Swing Analysis'],
    ['tools/account', 'RH Account Inquiry'],
    ['tools/topic-viewer', 'Topic Viewer'],
    ['dev/flex-chart', 'Flex Chart Sandbox'],
    ['dashboard-v3', 'Dashboard V3'],
    ['signal-history', 'Signal History'],
    ['signal-action-report', 'Triage Report'],
  ])('registers %s (%s) as an auth-gated component route', (path) => {
    const route = routeByPath(path);
    expect(route).toBeTruthy();
    expect(route!.loadComponent).toBeTruthy();
    expect(route!.canActivate?.length).toBeGreaterThan(0);
  });

  it('landing redirects to /portfolio', () => {
    const route = routeByPath('');
    expect(route?.redirectTo).toBe(AppRoutes.PORTFOLIO_DASHBOARD);
    expect(AppRoutes.PORTFOLIO_DASHBOARD).toBe('portfolio');
  });

  it.each([
    ['signals', 'signals/runs'],
    ['options', 'options/chain'],
  ])('%s redirects to %s', (from, to) => {
    const route = routeByPath(from);
    expect(route?.redirectTo).toBe(to);
    expect(route?.loadComponent).toBeUndefined();
  });

  it.each([
    'run-dashboard',
    'signal-review',
    'chart-review',
    'signal-order',
    'paper-trading',
    'option-chain',
    'option-chain-pct-change',
    'option-chart',
    'spread-chart',
    'options-strategy-dashboard',
    'strategy-builder',
    'strategy-backtest',
    'savant-trader/option-chain',
    'savant-trader/swing-analysis',
    'savant-trader/flex-chart-sandbox',
    'rh-account-inquiry',
    'portfolio-dashboard',
    'portfolio-allocation',
    'dev-lifecycle',
  ])('retired path %s is no longer registered', (path) => {
    expect(routeByPath(path)).toBeUndefined();
  });

  it.each([
    'dashboard', 'dashboard-v2', 'decision-board', 'positions-view',
    'heatmap-view', 'heatmap-chart/:baseline/:symbol', 'rs-chart',
    'rs-table', 'sync-chart', 'history', 'trade-journal',
    'documentation', 'contact',
  ])('legacy route %s stays registered (nav-hidden, code alive)', (path) => {
    expect(routeByPath(path)).toBeTruthy();
  });

  it('login/signup/logout exist as the auth flow', () => {
    expect(routeByPath('login')?.loadComponent).toBeTruthy();
    expect(routeByPath('signup')?.loadComponent).toBeTruthy();
    expect(routeByPath('logout')?.redirectTo).toBe('/');
  });

  it('no path is registered twice (a duplicate would shadow silently)', () => {
    const paths = children().map((r) => r.path);
    expect(new Set(paths).size).toBe(paths.length);
  });

  it('the wildcard falls through to / — the stale-URL safety net', () => {
    const wild = CORE_ROUTES.find((r) => r.path === '**');
    expect(wild?.redirectTo).toBe('/');
  });

  it.each([
    ['portfolio-dashboard', AppRoutes.PORTFOLIO_DASHBOARD],
    ['portfolio-allocation', AppRoutes.PORTFOLIO_ALLOCATION],
    ['run-dashboard', AppRoutes.RUN_DASHBOARD],
    ['option-chain', AppRoutes.OPTION_CHAIN],
    ['option-chain-pct-change', AppRoutes.OPTION_CHAIN_PCT_CHANGE],
    ['topic-viewer', AppRoutes.TOPIC_VIEWER],
  ])('nav item %s href stays in parity with AppRoutes', (name, expected) => {
    const item = NAV_MENU_ITEMS.find((i) => i.name === name);
    expect(item?.href).toBe(expected);
  });

  it('AppRoutes values match the canonical tree', () => {
    const expected: Partial<Record<keyof typeof AppRoutes, string>> = {
      PORTFOLIO_DASHBOARD: 'portfolio',
      PORTFOLIO_ALLOCATION: 'portfolio/allocation',
      RUN_DASHBOARD: 'signals/runs',
      SIGNAL_REVIEW: 'signals/review',
      CHART_REVIEW: 'signals/charts',
      SIGNAL_ORDER: 'trading/live',
      PAPER_TRADING: 'trading/paper',
      OPTION_CHAIN: 'options/chain',
      OPTION_CHAIN_PCT_CHANGE: 'options/pct-change',
      OPTION_CHART: 'options/chart',
      SPREAD_CHART: 'options/spread-chart',
      OPTIONS_STRATEGY_DASHBOARD: 'options/strategy-dashboard',
      STRATEGY_BUILDER: 'options/strategy/build',
      STRATEGY_BACKTEST: 'options/strategy/backtest',
      SWING_ANALYSIS: 'analysis/swings',
      RH_ACCOUNT_INQUIRY: 'tools/account',
      FLEX_CHART_SANDBOX: 'dev/flex-chart',
      TOPIC_VIEWER: 'tools/topic-viewer',
    };
    for (const [key, value] of Object.entries(expected)) {
      expect(AppRoutes[key as keyof typeof AppRoutes]).toBe(value);
    }
  });
});

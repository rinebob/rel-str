/**
 * @topic #625 — Journey Navigation (task #700 — grouped nav data model)
 *
 * NAV_SECTIONS is the workflow-ordered nav source: groups match the PRD
 * Sidenav Groups table exactly, every href resolves to a registered
 * canonical route, and the retired legacy items are absent. NAV_MENU_ITEMS
 * survives as a derived flat export until T3/T4 move the consumers.
 */
import { NAV_MENU_ITEMS, NAV_SECTIONS, SIGNED_OUT_SECTIONS } from './constants';
import CORE_ROUTES from '../core-routes';

const registeredPaths = (): Set<string> =>
  new Set(
    (CORE_ROUTES[0]?.children ?? [])
      .filter((r) => r.redirectTo === undefined) // redirects are not page targets
      .map((r) => r.path ?? ''),
  );

const unguardedPaths = (): Set<string> =>
  new Set(
    (CORE_ROUTES[0]?.children ?? [])
      .filter((r) => r.redirectTo === undefined && !r.canActivate?.length)
      .map((r) => r.path ?? ''),
  );

describe('NAV_SECTIONS — grouped nav model (#700)', () => {
  it('has the PRD group order, ending with the unlabeled tail', () => {
    expect(NAV_SECTIONS.map((s) => s.label)).toEqual([
      'Portfolio',
      'Signals',
      'Trading',
      'Options',
      'Analysis',
      'Tools',
      '',
    ]);
  });

  it.each<[string, string[]]>([
    ['Portfolio', ['Portfolio Dashboard', 'Portfolio Allocation']],
    ['Signals', ['Runs', 'Signal Review', 'Chart Review']],
    ['Trading', ['Live', 'Paper']],
    [
      'Options',
      ['Chain', '% Change', 'Chart', 'Spread Chart', 'Strategy Dashboard', 'Build', 'Backtest'],
    ],
    ['Analysis', ['Swing Analysis']],
    ['Tools', ['Account Inquiry', 'Topic Viewer', 'Dev']],
    ['', ['Dashboard V3']],
  ])('%s carries its PRD items in order', (label, texts) => {
    const section = NAV_SECTIONS.find((s) => s.label === label);
    expect(section?.items.map((i) => i.text)).toEqual(texts);
  });

  it('every item href resolves to a registered component route path', () => {
    const paths = registeredPaths();
    for (const section of NAV_SECTIONS) {
      for (const item of section.items) {
        // Submenu triggers carry no href — their children are the targets.
        const leaves = item.children ?? [item];
        for (const leaf of leaves) {
          expect(leaf.href.trim().length).toBeGreaterThan(0);
          expect(leaf.text.trim().length).toBeGreaterThan(0);
          expect(paths.has(leaf.href)).toBe(true);
        }
      }
    }
  });

  it.each([
    'portfolio',
    'portfolio/allocation',
    'signals/runs',
    'signals/review',
    'signals/charts',
    'trading/live',
    'trading/paper',
    'options/chain',
    'options/pct-change',
    'options/chart',
    'options/spread-chart',
    'options/strategy-dashboard',
    'options/strategy/build',
    'options/strategy/backtest',
    'analysis/swings',
    'tools/account',
    'tools/topic-viewer',
    'dashboard-v3',
    'dev/flex-chart',
    'dev/gallery',
    'dev/screenshot',
  ])('nav carries exactly one entry for %s', (href) => {
    const hits = NAV_SECTIONS.flatMap((s) =>
      s.items.flatMap((i) => i.children ?? [i]),
    ).filter((i) => i.href === href);
    expect(hits).toHaveLength(1);
  });

  it.each([
    'dashboard',
    'dashboard-v2',
    'decision-board',
    'positions-view',
    'trade-journal',
    'heatmap-view',
    'heatmap-chart/SPY/AAPL',
    'rs-chart',
    'sync-chart',
    'rs-table',
    'history',
    'signal-history',
    'signal-action-report',
    'documentation',
    'contact',
  ])('retired/hidden item %s is absent from nav', (href) => {
    const hits = NAV_SECTIONS.flatMap((s) =>
      s.items.flatMap((i) => i.children ?? [i]),
    ).filter((i) => i.href === href);
    expect(hits).toHaveLength(0);
  });

  it('the Dev submenu trigger sits last under Tools and holds exactly the dev/* routes', () => {
    const tools = NAV_SECTIONS.find((s) => s.label === 'Tools');
    const dev = tools?.items[tools.items.length - 1];
    expect(dev?.text).toBe('Dev');
    expect(dev?.children?.map((c) => c.href)).toEqual([
      'dev/flex-chart',
      'dev/gallery',
      'dev/screenshot',
    ]);
    // The trigger itself is not a nav destination.
    expect(dev?.href).toBe('');
  });

  it('auth items are not data — they are rendered/gated by the shell (T3)', () => {
    const hits = NAV_SECTIONS.flatMap((s) => s.items).filter(
      (i) =>
        ['login', 'signup', 'logout', 'symbols'].includes(i.name) ||
        ['login', 'signup', 'logout'].includes(i.href),
    );
    expect(hits).toHaveLength(0);
  });

  it('SIGNED_OUT_SECTIONS is exactly the auth actions (login, signup)', () => {
    expect(SIGNED_OUT_SECTIONS).toHaveLength(1);
    expect(SIGNED_OUT_SECTIONS[0].label).toBe('');
    expect(SIGNED_OUT_SECTIONS[0].items.map((i) => i.name)).toEqual(['login', 'signup']);
  });

  it('every signed-out item href resolves to an UNGUARDED route (#740)', () => {
    const open = unguardedPaths();
    for (const item of SIGNED_OUT_SECTIONS.flatMap((s) => s.items)) {
      expect(open.has(item.href)).toBe(true);
    }
  });

  it('SIGNED_OUT_SECTIONS stays out of the flat nav menu', () => {
    const flatHrefs = new Set(NAV_MENU_ITEMS.map((i) => i.href));
    for (const item of SIGNED_OUT_SECTIONS.flatMap((s) => s.items)) {
      expect(flatHrefs.has(item.href)).toBe(false);
    }
  });

  it('NAV_MENU_ITEMS exposes the same item objects flattened in order', () => {
    const flat = NAV_SECTIONS.flatMap((s) =>
      s.items.flatMap((i) => i.children ?? [i]),
    );
    expect(NAV_MENU_ITEMS).toHaveLength(flat.length);
    for (const item of flat) {
      expect(NAV_MENU_ITEMS.indexOf(item)).toBeGreaterThan(-1); // identity, not copy
    }
    expect(NAV_MENU_ITEMS).toEqual(flat);
  });

  it('item names are unique (used as the @for track key)', () => {
    const names = NAV_MENU_ITEMS.map((i) => i.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it('non-tail section labels are unique, and exactly one unlabeled tail exists', () => {
    const labels = NAV_SECTIONS.map((s) => s.label).filter((l) => l !== '');
    expect(new Set(labels).size).toBe(labels.length);
    expect(NAV_SECTIONS.filter((s) => s.label === '')).toHaveLength(1);
  });
});

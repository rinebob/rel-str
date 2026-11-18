/**
 * TopicViewerPageComponent spec (task #643) — header controls, grouped
 * topic list, banners, empty states. Store is stubbed with signals.
 */

jest.mock('@angular/fire/functions', () => ({
  Functions: class {},
  httpsCallable: jest.fn(),
}));

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection, signal } from '@angular/core';
import { provideNoopAnimations } from '@angular/platform-browser/animations';

import { TopicViewerPageComponent } from './topic-viewer-page.component';
import { TopicViewerStore } from './topic-viewer.store';
import { NAV_MENU_ITEMS } from '../../core/common/constants';
import { AppRoutes } from '../../core/common/interfaces';
import CORE_ROUTES from '../../core/core-routes';
import type { LifecycleNode, LifecycleTopic, LifecycleTreeResponse } from '@lifecycle/contracts';
import type { AllSectionRows, TopicSortMode, TreeRow, VisibleTopics } from './topic-viewer.store';

// Children never carry `group` — the factory returns a plain LifecycleNode;
// `topic` wraps it with the stamped group for the flat response surface.
const node = (n: number, children: LifecycleNode[] = []): LifecycleNode => ({
  number: n, title: `Topic ${n}`, state: 'open',
  url: `https://github.com/rinebob/rel-str/issues/${n}`,
  nodeType: 'topic', stageLabel: '5_IMPLEMENT', status: 'IN PROGRESS',
  labels: [], updatedAt: '2026-09-28T00:00:00Z', children,
});
const topic = (n: number, children: LifecycleNode[] = []): LifecycleTopic => ({
  ...node(n, children), group: 'A. Group',
});

const RESPONSE: LifecycleTreeResponse = {
  topics: [topic(1, [node(10)])],
  groupOrder: ['A. Group'],
  fetchedAt: '2026-09-28T12:00:00Z',
};

describe('TopicViewerPageComponent', () => {
  let fixture: ComponentFixture<TopicViewerPageComponent>;

  const response = signal<LifecycleTreeResponse | null>(RESPONSE);
  const loading = signal(false);
  const error = signal<string | null>(null);
  const showClosed = signal(false);
  const groupingWarning = signal<string | null>(null);
  const selectedTopicNumber = signal<number | null>(null);
  const selectedTopic = signal<LifecycleNode | null>(null);
  const fetchedAt = signal<string | null>(null);
  const visibleTopics = signal<VisibleTopics>({ mode: 'grouped', sections: [] });
  const query = signal('');
  const sortMode = signal<TopicSortMode>('grouped');
  const showAllTopics = signal(false);
  const matchCount = signal(0);
  const matchSet = signal<ReadonlySet<number>>(new Set());
  const allSectionsRows = signal<AllSectionRows[]>([]);
  const refresh = jest.fn(async () => undefined);
  const selectRepo = jest.fn(async () => undefined);
  const selectTopic = jest.fn();
  const setShowClosed = jest.fn();
  const setQuery = jest.fn();
  const setSortMode = jest.fn();
  const setShowAllTopics = jest.fn();
  const expandAll = jest.fn();
  const collapseAll = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    loading.set(false);
    error.set(null);
    showClosed.set(false);
    groupingWarning.set(null);
    selectedTopicNumber.set(null);
    selectedTopic.set(null);
    fetchedAt.set(null);
    response.set(null);
    visibleTopics.set({ mode: 'grouped', sections: [] });
    query.set('');
    sortMode.set('grouped');
    showAllTopics.set(false);
    matchCount.set(0);
    matchSet.set(new Set());
    allSectionsRows.set([]);
    TestBed.resetTestingModule();
  });

  async function setup() {
    const res = response();
    const sections = res
      ? res.groupOrder.map(name => ({
          name,
          topics: res.topics.filter(t => t.group === name).map(t => ({
            number: t.number, title: t.title,
            stageLabel: t.stageLabel, status: t.status, closed: false,
          })),
        })).filter(s => s.topics.length > 0) // matches the store's drop
      : [];
    visibleTopics.set(
      sortMode() === 'number'
        ? {
            mode: 'number',
            topics: sections.flatMap(s => s.topics).sort((a, b) => a.number - b.number),
          }
        : { mode: 'grouped', sections },
    );
    await TestBed.configureTestingModule({
      imports: [TopicViewerPageComponent],
      providers: [
        provideZonelessChangeDetection(),
        provideNoopAnimations(),
        {
          provide: TopicViewerStore,
          useValue: {
            repos: signal([{ owner: 'rinebob', repo: 'rel-str', label: 'rel-str' }]),
            selectedRepoIndex: signal(0),
            response, loading, error, showClosed, groupingWarning,
            selectedTopicNumber, selectedTopic, fetchedAt,
            visibleTopics, query, sortMode, showAllTopics,
            matchCount, matchSet, allSectionsRows,
            // The tree child binds effectiveExpandedIds — stub it so a
            // non-empty treeRows can't hit an undefined signal (#1532).
            effectiveExpandedIds: signal<ReadonlySet<number>>(new Set()),
            treeRows: signal<TreeRow[]>([]),
            expandableIds: signal<number[]>([]),
            refresh, selectRepo, selectTopic, setShowClosed,
            setQuery, setSortMode, setShowAllTopics,
            expandAll, collapseAll,
            toggleExpanded: jest.fn(),
          },
        },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(TopicViewerPageComponent);
    fixture.detectChanges();
    await fixture.whenStable();
  }

  it('loads on init when no response is cached', async () => {
    response.set(null);
    await setup();
    expect(refresh).toHaveBeenCalled();
  });

  it('skips the initial fetch when a response is already cached', async () => {
    response.set(RESPONSE);
    await setup();
    expect(refresh).not.toHaveBeenCalled();
  });

  it('header renders fetchedAt; refresh button calls store', async () => {
    response.set(RESPONSE);
    fetchedAt.set('2026-09-28T12:00:00Z');
    await setup();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('[data-testid="fetched-at"]')?.textContent).toContain('2026-09-28T12:00:00Z');
    (el.querySelector('[data-testid="refresh"]') as HTMLButtonElement).click();
    expect(refresh).toHaveBeenCalled();
  });

  it('sections render group names + topic rows; select calls store', async () => {
    response.set(RESPONSE);
    await setup();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('[data-testid="section-name"]')?.textContent).toContain('A. Group');
    (el.querySelector('[data-testid="topic-1"]') as HTMLElement).click();
    expect(selectTopic).toHaveBeenCalledWith(1);
  });

  it('topic rows strip the "Topic:" title prefix and show a stage chip (#1532 — dot removed)', async () => {
    response.set(RESPONSE);
    await setup();
    visibleTopics.set({ mode: 'grouped', sections: [{
      name: 'G', topics: [{ number: 7, title: 'Topic: Cool Stuff', stageLabel: '5_IMPLEMENT', closed: false }],
    }]});
    fixture.detectChanges();
    const row = fixture.nativeElement.querySelector('[data-testid="topic-7"]') as HTMLElement;
    expect(row.textContent).toContain('Cool Stuff');
    expect(row.textContent).not.toContain('Topic:');
    const chip = row.querySelector('.chip.stage');
    expect(chip?.textContent).toContain('5_IMPLEMENT');
    expect(chip?.getAttribute('data-stage')).toBe('5');
    expect(row.querySelector('.stage-dot')).toBeNull();
  });

  // ── #1532: header controls + visibleTopics union ─────────────────────────

  it('search input reflects the query and forwards input to setQuery', async () => {
    response.set(RESPONSE);
    await setup();
    const el = fixture.nativeElement as HTMLElement;
    const box = el.querySelector('[data-testid="search"]') as HTMLInputElement;
    expect(box).toBeTruthy();
    expect(box.value).toBe('');
    box.value = 'lifecycle';
    box.dispatchEvent(new Event('input'));
    expect(setQuery).toHaveBeenCalledWith('lifecycle');
    // The [value] binding round-trips: drive the signal, the DOM follows.
    query.set('lifecycle');
    fixture.detectChanges();
    expect(box.value).toBe('lifecycle');
  });

  it('match count renders beside search only with a query AND a match surface (#1532 gate)', async () => {
    response.set(RESPONSE);
    await setup();
    const el = fixture.nativeElement as HTMLElement;
    // No query → no badge.
    expect(el.querySelector('[data-testid="match-count"]')).toBeNull();
    // Query but no selected topic and no all-topics → badge hidden
    // ("0 matches" over a plainly-filtered list would be a lie).
    query.set('impl');
    matchCount.set(3);
    fixture.detectChanges();
    expect(el.querySelector('[data-testid="match-count"]')).toBeNull();
    // A selected topic gives the badge its match surface.
    selectedTopic.set(node(1));
    fixture.detectChanges();
    expect(el.querySelector('[data-testid="match-count"]')?.textContent).toContain('3 matches');
  });

  it('match count shows in all-topics mode without a selection; singular is "1 match"', async () => {
    response.set(RESPONSE);
    showAllTopics.set(true);
    await setup();
    const el = fixture.nativeElement as HTMLElement;
    query.set('impl');
    matchCount.set(1);
    fixture.detectChanges();
    expect(el.querySelector('[data-testid="match-count"]')?.textContent).toContain('1 match');
  });

  it('sort toggle reflects sortMode and calls setSortMode on click', async () => {
    response.set(RESPONSE);
    await setup();
    const el = fixture.nativeElement as HTMLElement;
    const grouped = el.querySelector('[data-testid="sort-grouped"]') as HTMLButtonElement;
    const number = el.querySelector('[data-testid="sort-number"]') as HTMLButtonElement;
    expect(grouped.getAttribute('aria-pressed')).toBe('true');
    expect(number.getAttribute('aria-pressed')).toBe('false');
    number.click();
    expect(setSortMode).toHaveBeenCalledWith('number');
    sortMode.set('number');
    fixture.detectChanges();
    expect(number.getAttribute('aria-pressed')).toBe('true');
  });

  it('number mode renders one flat topic list — no section headers', async () => {
    response.set(RESPONSE);
    sortMode.set('number');
    await setup();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelectorAll('[data-testid="section-name"]').length).toBe(0);
    expect(el.querySelector('[data-testid="topic-1"]')).toBeTruthy();
  });

  it('all-topics checkbox forwards checked to setShowAllTopics', async () => {
    response.set(RESPONSE);
    await setup();
    const cb = fixture.nativeElement.querySelector('[data-testid="all-topics"]') as HTMLElement;
    (cb.tagName === 'INPUT' ? cb : cb.querySelector('input')!).click();
    fixture.detectChanges();
    expect(setShowAllTopics).toHaveBeenCalledWith(true);
  });

  it('Labels button is present but disabled until the dialog lands (#1533)', async () => {
    response.set(RESPONSE);
    await setup();
    const btn = fixture.nativeElement.querySelector('[data-testid="labels-btn"]') as HTMLButtonElement;
    expect(btn).toBeTruthy();
    expect(btn.disabled).toBe(true);
  });

  // ── #1532: all-topics right pane ──────────────────────────────────────

  it('all-topics mode renders every section header + a tree per section', async () => {
    response.set(RESPONSE);
    showAllTopics.set(true);
    allSectionsRows.set([
      { name: 'A. Group', rows: [{ node: node(1), depth: 0 }] },
      { name: 'B. Group', rows: [{ node: node(2), depth: 0 }] },
    ]);
    await setup();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('[data-testid="allsec-A. Group"]')?.textContent).toContain('A. Group');
    expect(el.querySelector('[data-testid="allsec-B. Group"]')?.textContent).toContain('B. Group');
    // Two tree children render — each fed its section's rows.
    const trees = el.querySelectorAll('app-topic-viewer-tree');
    expect(trees.length).toBe(2);
    expect(el.querySelector('[data-testid="tree-node-1"]')).toBeTruthy();
    expect(el.querySelector('[data-testid="tree-node-2"]')).toBeTruthy();
    // The single-topic head/link is replaced by the all-topics head.
    expect(el.querySelector('[data-testid="tree-topic-link"]')).toBeNull();
  });

  it('all-topics query hits highlight in whichever section tree they live (#1532 gate)', async () => {
    response.set(RESPONSE);
    showAllTopics.set(true);
    allSectionsRows.set([
      { name: 'A. Group', rows: [{ node: node(1), depth: 0 }] },
      { name: 'B. Group', rows: [{ node: node(2), depth: 0 }] },
    ]);
    matchSet.set(new Set([2]));
    await setup();
    const el = fixture.nativeElement as HTMLElement;
    const hit = el.querySelector('[data-testid="tree-node-2"]') as HTMLElement;
    const miss = el.querySelector('[data-testid="tree-node-1"]') as HTMLElement;
    expect(hit.classList.contains('match')).toBe(true);
    expect(miss.classList.contains('match')).toBe(false);
  });

  it('all-topics empty state is query-aware and loading-gated', async () => {
    response.set(RESPONSE);
    showAllTopics.set(true);
    allSectionsRows.set([]);
    await setup();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('[data-testid="all-topics-empty"]')?.textContent)
      .toContain('No Topics found');
    query.set('zzz');
    fixture.detectChanges();
    expect(el.querySelector('[data-testid="all-topics-empty"]')?.textContent)
      .toContain('No topics match "zzz"');
  });

  it('left-pane empty state is query-aware', async () => {
    response.set(RESPONSE);
    await setup();
    visibleTopics.set({ mode: 'grouped', sections: [] });
    query.set('zzz');
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('[data-testid="empty-state"]')?.textContent)
      .toContain('No topics match "zzz"');
  });

  it('leaving all-topics restores the selected-topic pane + select prompt', async () => {
    response.set(RESPONSE);
    showAllTopics.set(true);
    allSectionsRows.set([{ name: 'A. Group', rows: [{ node: node(1), depth: 0 }] }]);
    await setup();
    const el = fixture.nativeElement as HTMLElement;
    showAllTopics.set(false);
    fixture.detectChanges();
    expect(el.querySelector('[data-testid="allsec-A. Group"]')).toBeNull();
    expect(el.querySelector('[data-testid="tree-empty"]')).toBeTruthy();
  });

  it('selected topic row exposes aria-current', async () => {
    response.set(RESPONSE);
    selectedTopicNumber.set(1);
    await setup();
    const row = fixture.nativeElement.querySelector('[data-testid="topic-1"]') as HTMLElement;
    expect(row.getAttribute('aria-current')).toBe('true');
  });

  it('error banner renders the message; tree list stays visible', async () => {
    response.set(RESPONSE);
    error.set('internal: boom');
    await setup();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('[data-testid="error-banner"]')?.textContent).toContain('boom');
    expect(el.querySelector('[data-testid="topic-1"]')).toBeTruthy(); // preserved
  });

  it('grouping warning banner renders when set', async () => {
    response.set(RESPONSE);
    groupingWarning.set('grouping unavailable: GitHub 500');
    await setup();
    expect(fixture.nativeElement.querySelector('[data-testid="grouping-warning"]')?.textContent)
      .toContain('GitHub 500');
  });

  it('empty state shows when no topics and no error', async () => {
    response.set(resp2Empty());
    error.set(null);
    await setup();
    expect(fixture.nativeElement.querySelector('[data-testid="empty-state"]')?.textContent)
      .toContain('No Topics');
  });

  it('repo picker change calls selectRepo', async () => {
    response.set(RESPONSE);
    await setup();
    // The mock repo list has one entry — picking it forwards index 0.
    const sel = fixture.nativeElement.querySelector('select.dse-select') as HTMLSelectElement;
    sel.selectedIndex = 0;
    sel.dispatchEvent(new Event('change'));
    await fixture.whenStable();
    expect(selectRepo).toHaveBeenCalledWith(0);
  });

  it('refresh button disables while loading', async () => {
    response.set(RESPONSE);
    loading.set(true);
    await setup();
    const btn = fixture.nativeElement.querySelector('[data-testid="refresh"]') as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
  });

  it('show-closed checkbox forwards checked to the store', async () => {
    response.set(RESPONSE);
    await setup();
    const cb = fixture.nativeElement.querySelector('[data-testid="show-closed"]') as HTMLElement;
    (cb.tagName === 'INPUT' ? cb : cb.querySelector('input')!).click();
    fixture.detectChanges();
    expect(setShowClosed).toHaveBeenCalled();
  });

  it('expand-all / collapse-all call the store', async () => {
    response.set(RESPONSE);
    selectedTopic.set(node(1));
    await setup();
    const el = fixture.nativeElement as HTMLElement;
    (el.querySelector('[data-testid="expand-all"]') as HTMLButtonElement).click();
    (el.querySelector('[data-testid="collapse-all"]') as HTMLButtonElement).click();
    expect(expandAll).toHaveBeenCalled();
    expect(collapseAll).toHaveBeenCalled();
  });

  it('tree pane shows select prompt until a topic is chosen', async () => {
    response.set(RESPONSE);
    selectedTopic.set(null);
    await setup();
    expect(fixture.nativeElement.querySelector('[data-testid="tree-empty"]')?.textContent)
      .toContain('Select a Topic');
    expect(fixture.nativeElement.querySelector('[data-testid="expand-all"]')).toBeNull();
  });

  function resp2Empty(): LifecycleTreeResponse {
    return { topics: [], groupOrder: [], fetchedAt: 'x' };
  }
});

describe('TopicViewer route + nav (task #644)', () => {
  it('registers a lazy auth-gated route', async () => {
    const route = CORE_ROUTES[0]?.children?.find(
      (r) => r.path === AppRoutes.TOPIC_VIEWER,
    );
    expect(route).toBeTruthy();
    expect(route?.canActivate?.length).toBeGreaterThan(0);
    const mod = await (route!.loadComponent as () => Promise<unknown>)();
    expect(mod).toBeTruthy();
  });

  it('exposes a nav entry', () => {
    const nav = NAV_MENU_ITEMS.find((i) => i.href === AppRoutes.TOPIC_VIEWER);
    expect(nav).toBeTruthy();
    expect(nav?.text).toBe('Topic Viewer');
  });
});

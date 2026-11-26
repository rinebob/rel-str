/**
 * TopicViewerPageComponent spec (task #643) — header controls, flat
 * topic list (#1667), banners, empty states. Store is stubbed with
 * signals.
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
import type { LifecycleNode, LifecycleTreeResponse } from '@lifecycle/contracts';
import type { AllTopicBlock, IssueResolution, TopicRow, TreeRow } from './topic-viewer.store';

const node = (n: number, children: LifecycleNode[] = []): LifecycleNode => ({
  number: n, title: `Topic ${n}`, state: 'open',
  url: `https://github.com/rinebob/rel-str/issues/${n}`,
  nodeType: 'topic', stageLabel: '5_IMPLEMENT', status: 'IN PROGRESS',
  labels: [], updatedAt: '2026-09-28T00:00:00Z', children,
});

const row = (t: LifecycleNode): TopicRow => ({
  number: t.number, title: t.title, stageLabel: t.stageLabel,
  closed: t.state === 'closed',
});

const RESPONSE: LifecycleTreeResponse = {
  topics: [node(1, [node(10)])],
  fetchedAt: '2026-09-28T12:00:00Z',
};

/** A 'ready' all-topics block (#1638) — the topic's flattened rows. */
const readyBlock = (n: number): AllTopicBlock => ({
  topic: node(n), status: 'ready', error: null,
  rows: [{ node: node(n), depth: 0 }],
});

describe('TopicViewerPageComponent', () => {
  let fixture: ComponentFixture<TopicViewerPageComponent>;

  const response = signal<LifecycleTreeResponse | null>(RESPONSE);
  const loading = signal(false);
  const error = signal<string | null>(null);
  const showClosed = signal(false);
  const selectedTopicNumber = signal<number | null>(null);
  const selectedTopic = signal<LifecycleNode | null>(null);
  const fetchedAt = signal<string | null>(null);
  const visibleTopics = signal<TopicRow[]>([]);
  const query = signal('');
  const showAllTopics = signal(false);
  const matchCount = signal(0);
  const matchSet = signal<ReadonlySet<number>>(new Set());
  const allTopicsBlocks = signal<AllTopicBlock[]>([]);
  const allTopicsDrained = signal(false);
  const anyTreeLoading = signal(false);
  const anyTreeError = signal(false);
  const selectedTreeLoading = signal(false);
  const selectedTreeError = signal<string | null>(null);
  const issueResolution = signal<IssueResolution | null>(null);
  const resolvedNodeNumber = signal<number | null>(null);
  const refresh = jest.fn(async () => undefined);
  const selectRepo = jest.fn(async () => undefined);
  const selectTopic = jest.fn();
  const setShowClosed = jest.fn();
  const setQuery = jest.fn();
  const setShowAllTopics = jest.fn();
  const expandAll = jest.fn();
  const collapseAll = jest.fn();
  const ensureTopic = jest.fn(async () => null);
  const resumeAllTopics = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    loading.set(false);
    error.set(null);
    showClosed.set(false);
    selectedTopicNumber.set(null);
    selectedTopic.set(null);
    fetchedAt.set(null);
    response.set(null);
    visibleTopics.set([]);
    query.set('');
    showAllTopics.set(false);
    matchCount.set(0);
    matchSet.set(new Set());
    allTopicsBlocks.set([]);
    allTopicsDrained.set(false);
    anyTreeLoading.set(false);
    anyTreeError.set(false);
    selectedTreeLoading.set(false);
    selectedTreeError.set(null);
    issueResolution.set(null);
    resolvedNodeNumber.set(null);
    TestBed.resetTestingModule();
  });

  async function setup() {
    const res = response();
    // Flat issue-# ascending list — the only mode (#1667).
    visibleTopics.set(
      res ? res.topics.map(row).sort((a, b) => a.number - b.number) : []);
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
            response, loading, error, showClosed,
            selectedTopicNumber, selectedTopic, fetchedAt,
            visibleTopics, query, showAllTopics,
            matchCount, matchSet, allTopicsBlocks, allTopicsDrained,
            // The tree child binds effectiveExpandedIds — stub it so a
            // non-empty treeRows can't hit an undefined signal (#1532).
            effectiveExpandedIds: signal<ReadonlySet<number>>(new Set()),
            // Page-state signals (#1637 + #1638 styled states).
            treeLoadingSet: signal<ReadonlySet<number>>(new Set()),
            selectedTreeLoading,
            selectedTreeError,
            anyTreeLoading,
            anyTreeError,
            // Deep-resolution state (#1696) — the header note + the tree
            // child's resolved-row highlight both read these.
            issueResolution,
            resolvedNodeNumber,
            treeRows: signal<TreeRow[]>([]),
            expandableIds: signal<number[]>([]),
            refresh, selectRepo, selectTopic, setShowClosed,
            setQuery, setShowAllTopics,
            expandAll, collapseAll,
            ensureTopic, resumeAllTopics,
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

  it('flat list renders topic rows; select calls store', async () => {
    response.set(RESPONSE);
    await setup();
    const el = fixture.nativeElement as HTMLElement;
    // No group/section headers — flat rows only (#1667).
    expect(el.querySelector('[data-testid="section-name"]')).toBeNull();
    (el.querySelector('[data-testid="topic-1"]') as HTMLElement).click();
    expect(selectTopic).toHaveBeenCalledWith(1);
  });

  it('topic rows strip the "Topic:" title prefix and show a stage chip (#1532 — dot removed)', async () => {
    response.set(RESPONSE);
    await setup();
    visibleTopics.set([
      { number: 7, title: 'Topic: Cool Stuff', stageLabel: '5_IMPLEMENT', closed: false },
    ]);
    fixture.detectChanges();
    const row = fixture.nativeElement.querySelector('[data-testid="topic-7"]') as HTMLElement;
    expect(row.textContent).toContain('Cool Stuff');
    expect(row.textContent).not.toContain('Topic:');
    const chip = row.querySelector('.chip.stage');
    expect(chip?.textContent).toContain('5_IMPLEMENT');
    expect(chip?.getAttribute('data-stage')).toBe('5');
    expect(row.querySelector('.stage-dot')).toBeNull();
  });

  // ── #1532: header controls ───────────────────────────────────────────

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

  it('no sort pill — flat issue-# list is the only mode (#1667)', async () => {
    response.set(RESPONSE);
    await setup();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('[data-testid="sort-grouped"]')).toBeNull();
    expect(el.querySelector('[data-testid="sort-number"]')).toBeNull();
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

  it('all-topics mode renders a tree block per topic — no section headers', async () => {
    response.set(RESPONSE);
    showAllTopics.set(true);
    allTopicsBlocks.set([readyBlock(1), readyBlock(2)]);
    await setup();
    const el = fixture.nativeElement as HTMLElement;
    // Flat blocks — no grouped section headers (#1667).
    expect(el.querySelectorAll('app-topic-viewer-tree').length).toBe(2);
    expect(el.querySelector('[data-testid="tree-node-1"]')).toBeTruthy();
    expect(el.querySelector('[data-testid="tree-node-2"]')).toBeTruthy();
    // The single-topic head/link is replaced by the all-topics head.
    expect(el.querySelector('[data-testid="tree-topic-link"]')).toBeNull();
  });

  it('all-topics query hits highlight in whichever tree they live (#1532 gate)', async () => {
    response.set(RESPONSE);
    showAllTopics.set(true);
    allTopicsBlocks.set([readyBlock(1), readyBlock(2)]);
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
    allTopicsBlocks.set([]);
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
    visibleTopics.set([]);
    query.set('zzz');
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('[data-testid="empty-state"]')?.textContent)
      .toContain('No topics match "zzz"');
  });

  it('leaving all-topics restores the selected-topic pane + select prompt', async () => {
    response.set(RESPONSE);
    showAllTopics.set(true);
    allTopicsBlocks.set([readyBlock(1)]);
    await setup();
    const el = fixture.nativeElement as HTMLElement;
    showAllTopics.set(false);
    fixture.detectChanges();
    expect(el.querySelector('app-topic-viewer-tree')).toBeNull();
    expect(el.querySelector('[data-testid="tree-empty"]')).toBeTruthy();
  });

  // ── #1638: progressive per-topic blocks ─────────────────────────────

  it('all-topics loading block renders a spinner, not a tree', async () => {
    response.set(RESPONSE);
    showAllTopics.set(true);
    allTopicsBlocks.set([
      { topic: node(7), status: 'loading', error: null, rows: [] },
    ]);
    await setup();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('[data-testid="allsec-loading-7"]')).toBeTruthy();
    expect(el.querySelector('[data-testid="allsec-loading-7"] .dse-spinner')).toBeTruthy();
    expect(el.querySelector('app-topic-viewer-tree')).toBeNull();
  });

  it('all-topics error block shows its own retry → ensureTopic', async () => {
    response.set(RESPONSE);
    showAllTopics.set(true);
    allTopicsBlocks.set([
      { topic: node(7), status: 'error', error: 'functions/internal: internal', rows: [] },
    ]);
    await setup();
    const el = fixture.nativeElement as HTMLElement;
    const err = el.querySelector('[data-testid="allsec-error-7"]') as HTMLElement;
    expect(err.textContent).toContain('#7');
    expect(err.textContent).toContain('internal');
    (el.querySelector('[data-testid="allsec-retry-7"]') as HTMLButtonElement).click();
    expect(ensureTopic).toHaveBeenCalledWith(7);
  });

  it('drain notice renders when the queue rate-limits; Resume re-arms', async () => {
    response.set(RESPONSE);
    showAllTopics.set(true);
    allTopicsDrained.set(true);
    allTopicsBlocks.set([readyBlock(1)]);
    await setup();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('[data-testid="drain-notice"]')?.textContent)
      .toContain('rate limit');
    (el.querySelector('[data-testid="drain-resume"]') as HTMLButtonElement).click();
    expect(resumeAllTopics).toHaveBeenCalled();
  });

  it('refresh button disables while any tree fetch is in flight', async () => {
    response.set(RESPONSE);
    await setup();
    const el = fixture.nativeElement as HTMLElement;
    const btn = el.querySelector('[data-testid="refresh"]') as HTMLButtonElement;
    expect(btn.disabled).toBe(false);
    anyTreeLoading.set(true);
    fixture.detectChanges();
    expect(btn.disabled).toBe(true);
  });

  it('selected-topic loading renders the spinner', async () => {
    response.set(RESPONSE);
    selectedTopicNumber.set(1);
    selectedTreeLoading.set(true);
    await setup();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('[data-testid="tree-loading"]')).toBeTruthy();
    expect(el.querySelector('[data-testid="tree-loading"] .dse-spinner')).toBeTruthy();
    expect(el.querySelector('[data-testid="tree-empty"]')).toBeNull();
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

  it('empty state shows when no topics and no error', async () => {
    response.set({ topics: [], fetchedAt: 'x' });
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

  it('tree pane shows a loading indicator while the selection fetches (#1637)', async () => {
    response.set(RESPONSE);
    selectedTopicNumber.set(619);
    selectedTopic.set(null); // selected but not yet fetched
    selectedTreeLoading.set(true);
    await setup();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('[data-testid="tree-loading"]')).toBeTruthy();
    expect(el.querySelector('[data-testid="tree-empty"]')).toBeNull();
  });

  it('tree pane shows the fetch error + retry when the selection fails (#1637)', async () => {
    response.set(RESPONSE);
    selectedTopicNumber.set(619);
    selectedTopic.set(null);
    selectedTreeLoading.set(false);
    selectedTreeError.set('functions/internal: internal');
    await setup();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('[data-testid="tree-error"]')?.textContent)
      .toContain('functions/internal: internal');
    (el.querySelector('[data-testid="tree-error-retry"]') as HTMLButtonElement).click();
    expect(selectTopic).toHaveBeenCalledWith(619);
  });

  // ── deep-resolution note (#1696) ────────────────────────────────────

  it('resolution-note is absent until a resolution is in play', async () => {
    response.set(RESPONSE);
    await setup();
    expect(fixture.nativeElement.querySelector('[data-testid="resolution-note"]')).toBeNull();
  });

  it('resolving phase shows a scoped spinner + number — not a global block', async () => {
    response.set(RESPONSE);
    issueResolution.set({
      issueNumber: 1696, phase: 'resolving', message: null, rootNumber: null,
    });
    await setup();
    const note = fixture.nativeElement.querySelector('[data-testid="resolution-note"]')!;
    expect(note.textContent).toContain('Resolving #1696');
    expect(note.querySelector('[role="progressbar"]')).toBeTruthy();
    expect(note.getAttribute('data-phase')).toBe('resolving');
    // Scoped — the tree pane is untouched, no global overlay.
    expect(fixture.nativeElement.querySelector('[data-testid="topic-1"]')).toBeTruthy();
  });

  it('resolved phase reports the owning root; hidden note surfaces too', async () => {
    response.set(RESPONSE);
    issueResolution.set({
      issueNumber: 30, phase: 'resolved', rootNumber: 2,
      message: 'Issue #30 sits under a closed ancestor — enable Show closed',
    });
    await setup();
    const note = fixture.nativeElement.querySelector('[data-testid="resolution-note"]')!;
    expect(note.textContent).toContain('#30');
    expect(note.textContent).toContain('#2');
    expect(note.textContent).toContain('Show closed');
  });

  it('not-in-tree phase shows the honest message, not a generic empty list', async () => {
    response.set(RESPONSE);
    issueResolution.set({
      issueNumber: 77, phase: 'not-in-tree', rootNumber: null,
      message: "Issue #77 — A standalone issue — isn't in a lifecycle tree",
    });
    await setup();
    const note = fixture.nativeElement.querySelector('[data-testid="resolution-note"]')!;
    expect(note.getAttribute('data-phase')).toBe('not-in-tree');
    expect(note.textContent).toContain("isn't in a lifecycle tree");
    expect(note.textContent).toContain('#77');
  });

  it("not-found phase reports the issue doesn't exist", async () => {
    response.set(RESPONSE);
    issueResolution.set({
      issueNumber: 999999, phase: 'not-found', rootNumber: null,
      message: "Issue #999999 doesn't exist in rinebob/rel-str",
    });
    await setup();
    const note = fixture.nativeElement.querySelector('[data-testid="resolution-note"]')!;
    expect(note.getAttribute('data-phase')).toBe('not-found');
    expect(note.textContent).toContain("doesn't exist");
  });


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

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
import { By } from '@angular/platform-browser';
import { MatSelect } from '@angular/material/select';

import { TopicViewerPageComponent } from './topic-viewer-page.component';
import { TopicViewerStore } from './topic-viewer.store';
import { NAV_MENU_ITEMS } from '../../core/common/constants';
import { AppRoutes } from '../../core/common/interfaces';
import CORE_ROUTES from '../../core/core-routes';
import type { LifecycleNode, LifecycleTreeResponse } from '@lifecycle/contracts';
import type { TopicSectionVm, TreeRow } from './topic-viewer.store';

const node = (n: number, children: LifecycleNode[] = []): LifecycleNode => ({
  number: n, title: `Topic ${n}`, state: 'open',
  url: `https://github.com/rinebob/rel-str/issues/${n}`,
  nodeType: 'topic', stageLabel: '5_IMPLEMENT', status: 'IN PROGRESS',
  labels: [], updatedAt: '2026-09-28T00:00:00Z', children,
});

const RESPONSE: LifecycleTreeResponse = {
  sections: [{ name: 'A. Group', topics: [node(1, [node(10, [], )])] }],
  fetchedAt: '2026-09-28T12:00:00Z', truncatedNodes: 0,
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
  const topicSections = signal<TopicSectionVm[]>([]);
  const refresh = jest.fn(async () => undefined);
  const selectRepo = jest.fn(async () => undefined);
  const selectTopic = jest.fn();
  const setShowClosed = jest.fn();
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
    topicSections.set([]);
    TestBed.resetTestingModule();
  });

  async function setup() {
    topicSections.set(
      (response()?.sections ?? []).map(s => ({
        name: s.name,
        topics: s.topics.map(t => ({
          number: t.number, title: t.title,
          stageLabel: t.stageLabel, status: t.status, closed: false,
        })),
      })).filter(s => s.topics.length > 0), // matches the store's drop
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
            selectedTopicNumber, selectedTopic, fetchedAt, topicSections,
            expandedIds: signal<number[]>([]),
            treeRows: signal<TreeRow[]>([]),
            expandableIds: signal<number[]>([]),
            refresh, selectRepo, selectTopic, setShowClosed,
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

  it('page heading reads "Topic Viewer"', async () => {
    response.set(RESPONSE);
    await setup();
    expect(fixture.nativeElement.querySelector('.page-title')?.textContent?.trim())
      .toBe('Topic Viewer');
  });

  it('topic rows strip the "Topic:" title prefix and show a stage dot', async () => {
    response.set(RESPONSE);
    await setup();
    topicSections.set([{
      name: 'G', topics: [{ number: 7, title: 'Topic: Cool Stuff', stageLabel: '5_IMPLEMENT', closed: false }],
    }]);
    fixture.detectChanges();
    const row = fixture.nativeElement.querySelector('[data-testid="topic-7"]') as HTMLElement;
    expect(row.textContent).toContain('Cool Stuff');
    expect(row.textContent).not.toContain('Topic:');
    const dot = row.querySelector('.stage-dot');
    expect(dot?.getAttribute('data-stage')).toBe('5');
    expect(dot?.getAttribute('title')).toBe('5_IMPLEMENT');
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
    fixture.debugElement.query(By.directive(MatSelect))
      .componentInstance.selectionChange.emit({ value: 1 });
    await fixture.whenStable();
    expect(selectRepo).toHaveBeenCalledWith(1);
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
    cb.dispatchEvent(new Event('change')); // MatCheckbox re-emits on the host
    // mat-checkbox (change) fires on the inner input — trigger via click
    (cb.querySelector('input') ?? cb).click();
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
    return { sections: [{ name: 'Ungrouped', topics: [] }], fetchedAt: 'x', truncatedNodes: 0 };
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

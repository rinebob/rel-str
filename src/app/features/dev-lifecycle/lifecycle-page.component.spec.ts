/**
 * LifecyclePageComponent spec (task #643) — header controls, grouped
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

import { LifecyclePageComponent } from './lifecycle-page.component';
import { LifecycleStore } from './lifecycle.store';
import type { LifecycleNode, LifecycleTreeResponse } from '@lifecycle/contracts';
import type { TopicSectionVm, TreeRow } from './lifecycle.store';

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

describe('LifecyclePageComponent', () => {
  let fixture: ComponentFixture<LifecyclePageComponent>;

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
  const toggleShowClosed = jest.fn();
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
      imports: [LifecyclePageComponent],
      providers: [
        provideZonelessChangeDetection(),
        provideNoopAnimations(),
        {
          provide: LifecycleStore,
          useValue: {
            repos: signal([{ owner: 'rinebob', repo: 'rel-str', label: 'rel-str' }]),
            selectedRepoIndex: signal(0),
            response, loading, error, showClosed, groupingWarning,
            selectedTopicNumber, selectedTopic, fetchedAt, topicSections,
            expandedIds: signal<number[]>([]),
            treeRows: signal<TreeRow[]>([]),
            expandableIds: signal<number[]>([]),
            refresh, selectRepo, selectTopic, toggleShowClosed, setShowClosed,
            expandAll, collapseAll,
            toggleExpanded: jest.fn(),
          },
        },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(LifecyclePageComponent);
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

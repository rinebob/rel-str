/**
 * TopicViewerTreeComponent spec (task #643) — depth indentation, caret
 * visibility/toggle, github link hrefs, chips, closed styling.
 */

jest.mock('@angular/fire/functions', () => ({
  Functions: class {},
  httpsCallable: jest.fn(),
}));

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection, signal } from '@angular/core';
import { provideNoopAnimations } from '@angular/platform-browser/animations';

import { TopicViewerTreeComponent } from './topic-viewer-tree.component';
import { TopicViewerStore } from './topic-viewer.store';
import type { LifecycleNode } from '@lifecycle/contracts';
import type { TreeRow } from './topic-viewer.store';

const node = (n: number, overrides: Partial<LifecycleNode> = {}): LifecycleNode => ({
  number: n, title: `Issue ${n}`, state: 'open',
  url: `https://github.com/rinebob/rel-str/issues/${n}`,
  nodeType: 'task', labels: [], updatedAt: '2026-09-28T00:00:00Z',
  children: [], ...overrides,
});

describe('TopicViewerTreeComponent', () => {
  let fixture: ComponentFixture<TopicViewerTreeComponent>;
  const treeRows = signal<TreeRow[]>([]);
  const expandedIds = signal<number[]>([]);
  const toggleExpanded = jest.fn();

  async function setup() {
    await TestBed.configureTestingModule({
      imports: [TopicViewerTreeComponent],
      providers: [
        provideZonelessChangeDetection(),
        provideNoopAnimations(),
        { provide: TopicViewerStore, useValue: {
          treeRows, expandedIds, toggleExpanded,
          showClosed: signal(true), // specs control visibility via treeRows
        } },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(TopicViewerTreeComponent);
    fixture.detectChanges();
    await fixture.whenStable();
  }

  it('renders rows with depth indentation', async () => {
    treeRows.set([
      { node: node(2, { nodeType: 'topic' }), depth: 0 },
      { node: node(20, { nodeType: 'thread' }), depth: 1 },
      { node: node(30), depth: 2 },
    ]);
    await setup();
    const rows = fixture.nativeElement.querySelectorAll('.tree-row');
    expect(rows[0].style.paddingLeft).toBe('0px');
    expect(rows[1].style.paddingLeft).toBe('18px');
    expect(rows[2].style.paddingLeft).toBe('36px');
  });

  it('caret shows only on nodes with children; click toggles', async () => {
    const parent = node(20, { nodeType: 'thread' });
    parent.children = [node(30)];
    treeRows.set([
      { node: node(2, { nodeType: 'topic' }), depth: 0 },
      { node: parent, depth: 1 },
      { node: node(30), depth: 2 },
    ]);
    expandedIds.set([2, 20]);
    await setup();
    const el = fixture.nativeElement as HTMLElement;
    // topic root row has children in the node data → caret; leaf has spacer
    expect(el.querySelector('[data-testid="caret-20"]')).toBeTruthy();
    expect(el.querySelector('[data-testid="caret-30"]')).toBeNull();
    (el.querySelector('[data-testid="caret-20"]') as HTMLElement).click();
    expect(toggleExpanded).toHaveBeenCalledWith(20);
  });

  it('aria-expanded reflects membership in expandedIds', async () => {
    const parent = node(20);
    parent.children = [node(30)];
    treeRows.set([{ node: parent, depth: 0 }]);
    expandedIds.set([]);
    await setup();
    const caret = fixture.nativeElement.querySelector('[data-testid="caret-20"]') as HTMLElement;
    expect(caret.getAttribute('aria-expanded')).toBe('false');
    expandedIds.set([20]);
    fixture.detectChanges();
    expect(caret.getAttribute('aria-expanded')).toBe('true');
  });

  it('titles link to the node url in a new tab; stage/status/tags render', async () => {
    treeRows.set([{
      node: node(5, { stageLabel: '6_REVIEW', status: 'IN PROGRESS', labels: ['6_REVIEW', 'BE', 'OPTIONS'] }),
      depth: 0,
    }]);
    await setup();
    const el = fixture.nativeElement as HTMLElement;
    const link = el.querySelector('[data-testid="link-5"]') as HTMLAnchorElement;
    expect(link.href).toBe('https://github.com/rinebob/rel-str/issues/5');
    expect(link.target).toBe('_blank');
    expect(link.rel).toContain('noopener');
    // stage label rendered once as stage chip, not duplicated as a tag
    expect(el.querySelector('[data-testid="stage-chip"]')?.textContent).toContain('6_REVIEW');
    expect(el.textContent).toContain('IN PROGRESS');
    expect(el.textContent).toContain('BE');
    expect(el.textContent).toContain('OPTIONS');
    expect(el.querySelectorAll('.chip.tag').length).toBe(2); // BE + OPTIONS only
  });

  it('caret hidden when all children are closed and showClosed is off', async () => {
    const parent = node(20);
    parent.children = [node(30, { state: 'closed' })];
    treeRows.set([{ node: parent, depth: 0 }]);
    await setup();
    const store = fixture.debugElement.injector.get(TopicViewerStore) as unknown as {
      showClosed: ReturnType<typeof signal<boolean>>;
    };
    store.showClosed.set(false);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('[data-testid="caret-20"]')).toBeNull();
    store.showClosed.set(true);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('[data-testid="caret-20"]')).toBeTruthy();
  });

  it('closed nodes render dimmed', async () => {
    treeRows.set([{ node: node(7, { state: 'closed' }), depth: 0 }]);
    await setup();
    expect(fixture.nativeElement.querySelector('[data-testid="tree-node-7"]').classList)
      .toContain('closed');
  });
});

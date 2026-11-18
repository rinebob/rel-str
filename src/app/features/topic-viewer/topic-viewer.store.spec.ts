/**
 * TopicViewerStore spec (task #642) — section assembly, closed filtering,
 * selection, expand/collapse, stale-response guard, error retention.
 */

jest.mock('@angular/fire/functions', () => ({
  Functions: class {},
  httpsCallable: jest.fn(),
}));

import { TestBed } from '@angular/core/testing';
import { firstValueFrom, of, Subject, throwError } from 'rxjs';

import { TopicViewerStore } from './topic-viewer.store';
import { TopicViewerService } from './topic-viewer.service';
import type {
  LifecycleNode,
  LifecycleTreeResponse,
} from '@lifecycle/contracts';

const node = (
  n: number,
  overrides: Partial<LifecycleNode> = {},
  children: LifecycleNode[] = [],
): LifecycleNode => ({
  number: n, title: `Issue ${n}`, state: 'open',
  url: `https://github.com/rinebob/rel-str/issues/${n}`,
  nodeType: n === 1 || n === 2 ? 'topic' : 'task',
  labels: [], updatedAt: '2026-09-28T00:00:00Z',
  children,
  ...overrides,
});

/** Declarative section fixtures → the flat v2 response shape. */
const resp = (groups: { name: string; topics: LifecycleNode[] }[]): LifecycleTreeResponse => ({
  topics: groups.flatMap(s =>
    s.topics.map(t => ({ ...t, group: s.name }))),
  groupOrder: groups.map(s => s.name),
  fetchedAt: '2026-09-28T12:00:00Z',
});

const FIXTURE = resp([
  { name: 'A. Group', topics: [node(1)] },
  {
    name: 'Ungrouped',
    topics: [
      node(2, { state: 'open' }, [
        node(20, { nodeType: 'thread' }, [node(30), node(31)]),
      ]),
      node(3, { state: 'closed' }),
    ],
  },
]);

function storeWith(service: Partial<TopicViewerService>) {
  return TestBed.configureTestingModule({
    providers: [
      TopicViewerStore,
      { provide: TopicViewerService, useValue: service },
    ],
  }).inject(TopicViewerStore);
}

/** Flattened topic numbers out of the visibleTopics union — number mode
 *  asserts read this; grouped-mode specs check `.sections` directly. */
const vmTopics = (store: ReturnType<typeof storeWith>): number[] => {
  const vm = store.visibleTopics();
  return vm.mode === 'number' ? vm.topics.map(t => t.number) : [];
};

describe('TopicViewerStore', () => {
  beforeEach(() => TestBed.resetTestingModule());

  it('maps sections to view rows; closed filtered unless showClosed', async () => {
    const getLifecycleTree$ = jest.fn(() => of(FIXTURE));
    const store = storeWith({ getLifecycleTree$ });
    await store.refresh();

    let sections = store.topicSections();
    expect(sections.map(s => s.name)).toEqual(['A. Group', 'Ungrouped']);
    expect(sections[1].topics.map(t => t.number)).toEqual([2]); // #3 closed → hidden

    store.setShowClosed(true);
    sections = store.topicSections();
    expect(sections[1].topics.map(t => t.number)).toEqual([2, 3]);
    expect(sections[1].topics[1].closed).toBe(true);
  });

  it('sorts topics within a group by issue number ascending', async () => {
    const f = resp([{
      name: 'A', topics: [node(3), node(1), node(2)],
    }]);
    const store = storeWith({ getLifecycleTree$: jest.fn(() => of(f)) });
    await store.refresh();
    expect(store.topicSections()[0].topics.map(t => t.number)).toEqual([1, 2, 3]);
  });

  it('empty groupOrder falls back to stamped group names (degrade path)', async () => {
    const f: LifecycleTreeResponse = {
      topics: [{ ...node(1), group: 'Ungrouped' }],
      groupOrder: [], fetchedAt: '2026-09-28T12:00:00Z',
      groupingWarning: 'grouping unavailable: GitHub 500',
    };
    const store = storeWith({ getLifecycleTree$: jest.fn(() => of(f)) });
    await store.refresh();
    const sections = store.topicSections();
    expect(sections.map(s => s.name)).toEqual(['Ungrouped']);
    expect(sections[0].topics.map(t => t.number)).toEqual([1]);
  });

  it('emptied sections drop out of the list', async () => {
    const empty = resp([{ name: 'A', topics: [node(9, { state: 'closed' })] }]);
    const store = storeWith({ getLifecycleTree$: jest.fn(() => of(empty)) });
    await store.refresh();
    expect(store.topicSections()).toEqual([]);
    store.setShowClosed(true);
    expect(store.topicSections()[0].name).toBe('A');
  });

  it('treeRows flatten visible nodes honoring expandedIds', async () => {
    const store = storeWith({ getLifecycleTree$: jest.fn(() => of(FIXTURE)) });
    await store.refresh();
    store.selectTopic(2);

    // default: root expanded → depth-1 (threads) visible
    expect(store.treeRows().map(r => r.node.number)).toEqual([2, 20]);
    expect(store.treeRows()[1].depth).toBe(1);

    store.toggleExpanded(20);
    expect(store.treeRows().map(r => r.node.number)).toEqual([2, 20, 30, 31]);
    expect(store.treeRows()[2].depth).toBe(2);

    store.toggleExpanded(2); // collapse the root
    expect(store.treeRows().map(r => r.node.number)).toEqual([2]);

    store.expandAll();
    expect(store.treeRows().map(r => r.node.number)).toEqual([2, 20, 30, 31]);

    store.collapseAll();
    expect(store.treeRows().map(r => r.node.number)).toEqual([2]);
  });

  it('closed children hidden under showClosed=false', async () => {
    const f = resp([{
      name: 'Ungrouped',
      topics: [node(2, {}, [node(20, {}, [node(30, { state: 'closed' })])])],
    }]);
    const store = storeWith({ getLifecycleTree$: jest.fn(() => of(f)) });
    await store.refresh();
    store.selectTopic(2);
    store.expandAll();
    // 20's only child is closed → not expandable under showClosed=false
    expect(store.treeRows().map(r => r.node.number)).toEqual([2, 20]);
    store.setShowClosed(true);
    store.expandAll();
    expect(store.treeRows().map(r => r.node.number)).toEqual([2, 20, 30]);
  });

  it('a late-arriving earlier response is discarded (stale guard)', async () => {
    const slow = new Subject<LifecycleTreeResponse>();
    let call = 0;
    const getLifecycleTree$ = jest.fn(() =>
      ++call === 1 ? slow.asObservable() : of(resp([{ name: 'Ungrouped', topics: [node(7)] }])));
    const store = storeWith({ getLifecycleTree$ });

    const p1 = store.refresh();          // seq 1 — stays in-flight
    await store.refresh();               // seq 2 — resolves immediately
    expect(store.selectedTopicNumber()).toBeNull();
    // seq-1 resolves late — must be discarded, not overwrite seq-2's tree
    slow.next(resp([{ name: 'Ungrouped', topics: [node(99)] }]));
    slow.complete();
    await p1;

    const nums = store.topicSections().flatMap(s => s.topics.map(t => t.number));
    expect(nums).toEqual([7]);
    expect(store.loading()).toBe(false);
  });

  it('failed fetch preserves the previous tree and sets error', async () => {
    let call = 0;
    const getLifecycleTree$ = jest.fn(() =>
      ++call === 1 ? of(FIXTURE) : throwError(() => new Error('boom')));
    const store = storeWith({ getLifecycleTree$ });
    await store.refresh();
    expect(store.topicSections().length).toBe(2);

    await store.refresh();
    expect(store.error()).toBe('boom');
    expect(store.topicSections().length).toBe(2); // tree still there
    expect(store.loading()).toBe(false);
  });

  it('refresh clears error on success and updates fetchedAt', async () => {
    let call = 0;
    const getLifecycleTree$ = jest.fn(() =>
      ++call === 1
        ? throwError(() => new Error('first'))
        : of(resp([{ name: 'Ungrouped', topics: [node(5)] }])));
    const store = storeWith({ getLifecycleTree$ });
    await store.refresh();
    expect(store.error()).toBe('first');

    await store.refresh();
    expect(store.error()).toBeNull();
    expect(store.fetchedAt()).toBe('2026-09-28T12:00:00Z');
  });

  it('selection drops when the topic vanishes in a refresh', async () => {
    let call = 0;
    const getLifecycleTree$ = jest.fn(() =>
      ++call === 1 ? of(FIXTURE) : of(resp([{ name: 'Ungrouped', topics: [node(7)] }])));
    const store = storeWith({ getLifecycleTree$ });
    await store.refresh();
    store.selectTopic(2);
    expect(store.selectedTopic()?.number).toBe(2);

    await store.refresh();
    expect(store.selectedTopicNumber()).toBeNull();
  });

  // ── v2 view state (task #1531) ───────────────────────────────────────────

  describe('sort modes', () => {
    it('grouped mode is the default and identical to the existing view', async () => {
      const store = storeWith({ getLifecycleTree$: jest.fn(() => of(FIXTURE)) });
      await store.refresh();
      expect(store.sortMode()).toBe('grouped');
      expect(store.topicSections().map(s => s.name)).toEqual(['A. Group', 'Ungrouped']);
      const vm = store.visibleTopics();
      expect(vm.mode).toBe('grouped');
    });

    it('number mode emits one flat issue-number ascending list', async () => {
      const f = resp([
        { name: 'A', topics: [node(9), node(2)] },
        { name: 'B', topics: [node(5), node(1, { state: 'closed' })] },
      ]);
      const store = storeWith({ getLifecycleTree$: jest.fn(() => of(f)) });
      await store.refresh();
      store.setSortMode('number');
      expect(vmTopics(store)).toEqual([2, 5, 9]);
      store.setShowClosed(true);
      expect(vmTopics(store)).toEqual([1, 2, 5, 9]);
    });
  });

  describe('query predicates', () => {
    const QFIX = resp([
      { name: 'A', topics: [node(1, { title: 'Lifecycle viewer', labels: ['INTERNAL'] })] },
      { name: 'B', topics: [node(154, { title: 'Scanner fix', labels: ['BACKTEST'] }), node(9, { title: 'Other' })] },
    ]);

    it('title substring filters case-insensitively in both modes', async () => {
      const store = storeWith({ getLifecycleTree$: jest.fn(() => of(QFIX)) });
      await store.refresh();
      store.setQuery('lifecycle');
      expect(store.topicSections().map(s => s.name)).toEqual(['A']);
      store.setSortMode('number');
      expect(vmTopics(store)).toEqual([1]);
    });

    it("numeric query '154' and '#154' match the issue number", async () => {
      const store = storeWith({ getLifecycleTree$: jest.fn(() => of(QFIX)) });
      await store.refresh();
      store.setSortMode('number');
      store.setQuery('154');
      expect(vmTopics(store)).toEqual([154]);
      store.setQuery('#154');
      expect(vmTopics(store)).toEqual([154]);
    });

    it('label substring matches label carriers', async () => {
      const store = storeWith({ getLifecycleTree$: jest.fn(() => of(QFIX)) });
      await store.refresh();
      store.setSortMode('number');
      store.setQuery('backtest');
      expect(vmTopics(store)).toEqual([154]);
    });

    it('empty query disables filtering', async () => {
      const store = storeWith({ getLifecycleTree$: jest.fn(() => of(QFIX)) });
      await store.refresh();
      store.setSortMode('number');
      store.setQuery('zz');
      expect(vmTopics(store)).toEqual([]);
      store.setQuery('   ');
      expect(vmTopics(store)).toEqual([1, 9, 154]);
    });

    it('a section emptied by the query drops out', async () => {
      const store = storeWith({ getLifecycleTree$: jest.fn(() => of(QFIX)) });
      await store.refresh();
      store.setQuery('lifecycle');
      expect(store.topicSections().some(s => s.name === 'B')).toBe(false);
    });

    it('selection survives the selected topic being filtered out of the list', async () => {
      const store = storeWith({ getLifecycleTree$: jest.fn(() => of(QFIX)) });
      await store.refresh();
      store.selectTopic(9);
      store.setQuery('lifecycle'); // #9 no longer in the visible list
      expect(store.selectedTopicNumber()).toBe(9);
      expect(store.selectedTopic()?.number).toBe(9); // right pane unaffected
      store.setQuery('');
      expect(store.selectedTopicNumber()).toBe(9);
    });
  });

  describe('in-tree match', () => {
    const TREE = resp([{
      name: 'A',
      topics: [node(2, {}, [
        node(20, { nodeType: 'thread' }, [
          node(30),
          node(31, {}, [node(99, { title: 'Deep hit' })]),
        ]),
        node(21, { nodeType: 'thread' }, [node(40)]),
      ])],
    }]);

    it('matchSet + ancestor expansion reveals a depth-3 hit, unrelated subtrees stay collapsed', async () => {
      const store = storeWith({ getLifecycleTree$: jest.fn(() => of(TREE)) });
      await store.refresh();
      store.selectTopic(2);
      store.setQuery('deep hit');
      // 99 matches; ancestors 2→20→31 expand; sibling rows still render,
      // 21 stays collapsed (40 never appears)
      expect([...store.matchSet()]).toEqual([99]);
      expect(store.treeRows().map(r => r.node.number)).toEqual([2, 20, 30, 31, 99, 21]);
      expect(store.matchCount()).toBe(1);
    });

    it('clearing the query restores the prior expandedIds', async () => {
      const store = storeWith({ getLifecycleTree$: jest.fn(() => of(TREE)) });
      await store.refresh();
      store.selectTopic(2);
      store.setQuery('deep hit');
      store.setQuery('');
      expect(store.expandedIds()).toEqual([2]);
      expect(store.treeRows().map(r => r.node.number)).toEqual([2, 20, 21]);
      expect(store.matchSet().size).toBe(0);
    });

    it('collapsing an auto-expanded ancestor works and restores on query clear', async () => {
      const store = storeWith({ getLifecycleTree$: jest.fn(() => of(TREE)) });
      await store.refresh();
      store.selectTopic(2);
      store.setQuery('deep hit'); // 31 auto-expands (ancestor of 99)
      expect(store.treeRows().map(r => r.node.number)).toContain(99);

      // Caret advertises collapse (aria-expanded=true) — the click must
      // collapse, not pollute expandedIds with inverted parity.
      store.toggleExpanded(31);
      expect(store.expandedIds()).not.toContain(31);
      expect(store.treeRows().map(r => r.node.number)).not.toContain(99);

      // Re-expand: the id rejoins the auto-expansion.
      store.toggleExpanded(31);
      expect(store.treeRows().map(r => r.node.number)).toContain(99);
      expect(store.expandedIds()).not.toContain(31); // still not manual

      // Clearing restores exactly the manual set — no leaked parity.
      store.setQuery('');
      expect(store.expandedIds()).toEqual([2]);
    });

    it('expandAll clears suppressions; collapseAll wins over auto-expansion', async () => {
      const store = storeWith({ getLifecycleTree$: jest.fn(() => of(TREE)) });
      await store.refresh();
      store.selectTopic(2);
      store.setQuery('deep hit');
      store.toggleExpanded(31); // suppress the auto-ancestor
      store.expandAll();
      expect(store.treeRows().map(r => r.node.number)).toContain(99);

      store.collapseAll();
      expect(store.treeRows().map(r => r.node.number)).toEqual([2]);
      // And a cleared query leaves nothing suppressed or expanded.
      store.setQuery('');
      expect(store.treeRows().map(r => r.node.number)).toEqual([2]);
    });

    it('a closed match is hidden until showClosed, then revealed', async () => {
      const f = resp([{
        name: 'A',
        topics: [node(2, {}, [node(20, {}, [node(30, { state: 'closed', title: 'Deep hit' })])])],
      }]);
      const store = storeWith({ getLifecycleTree$: jest.fn(() => of(f)) });
      await store.refresh();
      store.selectTopic(2);
      store.setQuery('deep hit');
      expect(store.matchSet().size).toBe(0);
      store.setShowClosed(true);
      expect(store.matchSet().size).toBe(1);
      expect(store.treeRows().map(r => r.node.number)).toEqual([2, 20, 30]);
    });
  });

  describe('all-topics view', () => {
    const ALL = resp([
      { name: 'A', topics: [node(1, {}, [node(10)])] },
      { name: 'B', topics: [node(5, {}, [node(50)])] },
    ]);

    it('flattens every filtered section with depth; roots collapsed by default', async () => {
      const store = storeWith({ getLifecycleTree$: jest.fn(() => of(ALL)) });
      await store.refresh();
      store.setShowAllTopics(true);
      const all = store.allSectionsRows();
      expect(all.map(s => s.name)).toEqual(['A', 'B']);
      expect(all[0].rows.map(r => [r.node.number, r.depth])).toEqual([[1, 0]]);
      store.toggleExpanded(1);
      expect(store.allSectionsRows()[0].rows.map(r => r.node.number)).toEqual([1, 10]);
    });

    it('expandableIds spans all trees in all-topics mode', async () => {
      const store = storeWith({ getLifecycleTree$: jest.fn(() => of(ALL)) });
      await store.refresh();
      expect(store.expandableIds()).toEqual([]);
      store.setShowAllTopics(true);
      expect(store.expandableIds().sort()).toEqual([1, 5]);
      store.expandAll();
      expect(store.allSectionsRows().flatMap(s => s.rows.map(r => r.node.number)))
        .toEqual([1, 10, 5, 50]);
    });

    it('query filters the all-topics rows too', async () => {
      const store = storeWith({ getLifecycleTree$: jest.fn(() => of(ALL)) });
      await store.refresh();
      store.setShowAllTopics(true);
      store.setQuery('issue 5');
      const all = store.allSectionsRows();
      expect(all.map(s => s.name)).toEqual(['B']);
    });
  });

  describe('label patch + write', () => {
    it('applyLabelUpdate patches only the named node; siblings untouched', async () => {
      const store = storeWith({ getLifecycleTree$: jest.fn(() => of(FIXTURE)) });
      await store.refresh();
      store.applyLabelUpdate(20, ['FE', 'IMPL']);
      const res = store.response()!;
      const n20 = res.topics[1].children[0];
      expect(n20.labels).toEqual(['FE', 'IMPL']);
      expect(res.topics[1].children[0].children[0].labels).toEqual([]);
      expect(res.topics[0].labels).toEqual([]);
    });

    it('applyLabelUpdate on an absent number leaves the response untouched', async () => {
      const store = storeWith({ getLifecycleTree$: jest.fn(() => of(FIXTURE)) });
      await store.refresh();
      const before = store.response();
      store.applyLabelUpdate(424242, ['X']);
      expect(store.response()).toBe(before);
    });

    it('updateIssueLabels calls the service and patches the response labels', async () => {
      const updateIssueLabels$ = jest.fn(() =>
        of({ labels: ['IMPL'], created: [] }));
      const store = storeWith({
        getLifecycleTree$: jest.fn(() => of(FIXTURE)),
        updateIssueLabels$,
      });
      await store.refresh();
      const res = await store.updateIssueLabels(20, ['IMPL'], []);
      expect(updateIssueLabels$).toHaveBeenCalledWith({
        owner: 'rinebob', repo: 'rel-str',
        issueNumber: 20, add: ['IMPL'], remove: [],
      });
      expect(res?.labels).toEqual(['IMPL']);
      expect(store.response()!.topics[1].children[0].labels).toEqual(['IMPL']);
      expect(store.error()).toBeNull();
    });

    it('a failed write leaves the response untouched and sets error', async () => {
      const updateIssueLabels$ = jest.fn(() =>
        throwError(() => Object.assign(new Error('denied'), { code: 'permission-denied' })));
      const store = storeWith({
        getLifecycleTree$: jest.fn(() => of(FIXTURE)),
        updateIssueLabels$,
      });
      await store.refresh();
      const res = await store.updateIssueLabels(20, ['IMPL'], []);
      expect(res).toBeNull();
      expect(store.error()).toBe('permission-denied: denied');
      expect(store.response()!.topics[1].children[0].labels).toEqual([]);
    });
  });

  it('selectRepo resets the query (new dataset)', async () => {
    const getLifecycleTree$ = jest.fn(() => of(FIXTURE));
    const store = storeWith({ getLifecycleTree$ });
    await store.refresh();
    store.setQuery('lifecycle');
    await store.selectRepo(1);
    expect(store.query()).toBe('');
  });
});

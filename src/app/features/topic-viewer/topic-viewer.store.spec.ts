/**
 * TopicViewerStore spec (task #642 + lazy-loading rework #1637) —
 * section assembly, closed filtering, selection, expand/collapse,
 * stale-response guard, error retention, index/memo split, ensureTopic
 * dedupe, all-topics fetch queue, refresh scoping. Deep issue-number
 * resolution (#1696) lives in topic-viewer-deep-resolve.spec.ts.
 */

jest.mock('@angular/fire/functions', () => ({
  Functions: class {},
  httpsCallable: jest.fn(),
}));

import { TestBed } from '@angular/core/testing';
import { of, Subject, throwError } from 'rxjs';

import { TopicViewerStore } from './topic-viewer.store';
import { TopicViewerService } from './topic-viewer.service';
import type {
  LifecycleNode,
  LifecycleTopicTreeRequest,
  LifecycleTreeResponse,
} from '@lifecycle/contracts';
import {
  indexOf,
  lazyStub,
  node,
  resp,
  storeWith,
  treeOf,
  flush,
} from './topic-viewer.store.testbed';

const FIXTURE = resp([
  node(1),
  node(2, { state: 'open' }, [
    node(20, { nodeType: 'thread' }, [node(30), node(31)]),
  ]),
  node(3, { state: 'closed' }),
]);

/** Flattened topic numbers out of visibleTopics (#1667 — flat issue-#
 *  ascending list is the only mode). */
const vmTopics = (store: ReturnType<typeof storeWith>): number[] =>
  store.visibleTopics().map(t => t.number);

describe('TopicViewerStore', () => {
  beforeEach(() => TestBed.resetTestingModule());

  it('flat rows in issue-# order; closed filtered unless showClosed', async () => {
    const store = storeWith(lazyStub(FIXTURE));
    await store.refresh();

    expect(vmTopics(store)).toEqual([1, 2]); // #3 closed → hidden

    store.setShowClosed(true);
    expect(vmTopics(store)).toEqual([1, 2, 3]);
    expect(store.visibleTopics()[2].closed).toBe(true);
  });

  it('sorts the flat list by issue number ascending (#1667)', async () => {
    const f = resp([node(3), node(1), node(2)]);
    const store = storeWith(lazyStub(f));
    await store.refresh();
    expect(vmTopics(store)).toEqual([1, 2, 3]);
  });

  it('closed topics drop out of the list unless showClosed', async () => {
    const empty = resp([node(9, { state: 'closed' })]);
    const store = storeWith(lazyStub(empty));
    await store.refresh();
    expect(store.visibleTopics()).toEqual([]);
    store.setShowClosed(true);
    expect(store.visibleTopics().map(t => t.number)).toEqual([9]);
  });

  it('treeRows flatten visible nodes honoring expandedIds', async () => {
    const store = storeWith(lazyStub(FIXTURE));
    await store.refresh();
    store.selectTopic(2);
    await store.ensureTopic(2);

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
    const f = resp([
      node(2, {}, [node(20, {}, [node(30, { state: 'closed' })])]),
    ]);
    const store = storeWith(lazyStub(f));
    await store.refresh();
    store.selectTopic(2);
    await store.ensureTopic(2);
    store.expandAll();
    // 20's only child is closed → not expandable under showClosed=false
    expect(store.treeRows().map(r => r.node.number)).toEqual([2, 20]);
    store.setShowClosed(true);
    store.expandAll();
    expect(store.treeRows().map(r => r.node.number)).toEqual([2, 20, 30]);
  });

  it('a late-arriving earlier index response is discarded (stale guard)', async () => {
    const slow = new Subject<LifecycleTreeResponse>();
    let call = 0;
    const index$ = jest.fn(() =>
      ++call === 1 ? slow.asObservable() : of(indexOf(resp([
  node(7),
]))));
    const store = storeWith({
      getLifecycleTopicIndex$: index$,
      getLifecycleTopicTree$: jest.fn(() => of({ topics: [], fetchedAt: '' })),
    });

    const p1 = store.refresh();          // seq 1 — stays in-flight
    await store.refresh();               // seq 2 — resolves immediately
    expect(store.selectedTopicNumber()).toBeNull();
    // seq-1 resolves late — must be discarded, not overwrite seq-2's index
    slow.next(indexOf(resp([
  node(99),
])));
    slow.complete();
    await p1;

    expect(vmTopics(store)).toEqual([7]);
    expect(store.loading()).toBe(false);
  });

  it('failed refresh preserves the previous index AND memo, and sets error', async () => {
    let call = 0;
    const index$ = jest.fn(() =>
      ++call === 1 ? of(indexOf(FIXTURE)) : throwError(() => new Error('boom')));
    const store = storeWith({
      getLifecycleTopicIndex$: index$,
      getLifecycleTopicTree$: jest.fn((req: LifecycleTopicTreeRequest) =>
        of(treeOf(FIXTURE, req.topicNumber))),
    });
    await store.refresh();
    await store.ensureTopic(2);
    expect(store.visibleTopics().length).toBe(2);
    expect(store.trees()[2]?.number).toBe(2);

    await store.refresh();
    expect(store.error()).toBe('boom');
    expect(store.visibleTopics().length).toBe(2); // index still there
    expect(store.trees()[2]?.number).toBe(2);     // memo survives a failed refresh
    expect(store.loading()).toBe(false);
  });

  it('refresh clears error on success and updates fetchedAt', async () => {
    let call = 0;
    const index$ = jest.fn(() =>
      ++call === 1
        ? throwError(() => new Error('first'))
        : of(indexOf(resp([
  node(5),
]))));
    const store = storeWith({
      getLifecycleTopicIndex$: index$,
      getLifecycleTopicTree$: jest.fn(() => of({ topics: [], fetchedAt: '' })),
    });
    await store.refresh();
    expect(store.error()).toBe('first');

    await store.refresh();
    expect(store.error()).toBeNull();
    expect(store.fetchedAt()).toBe('2026-09-28T12:00:00Z');
  });

  it('selection drops when the topic vanishes in a refresh', async () => {
    let call = 0;
    const index$ = jest.fn(() =>
      ++call === 1 ? of(indexOf(FIXTURE)) : of(indexOf(resp([
  node(7),
]))));
    const store = storeWith({
      getLifecycleTopicIndex$: index$,
      getLifecycleTopicTree$: jest.fn((req: LifecycleTopicTreeRequest) =>
        of(treeOf(FIXTURE, req.topicNumber))),
    });
    await store.refresh();
    store.selectTopic(2);
    await store.ensureTopic(2);
    expect(store.selectedTopic()?.number).toBe(2);

    await store.refresh();
    expect(store.selectedTopicNumber()).toBeNull();
  });

  // ── v2 view state (task #1531) ───────────────────────────────────────────

  describe('flat issue-# list (#1667)', () => {
    it('emits one issue-number ascending list — the only mode', async () => {
      const f = resp([
        node(9), node(2),
        node(5), node(1, { state: 'closed' }),
      ]);
      const store = storeWith(lazyStub(f));
      await store.refresh();
      expect(vmTopics(store)).toEqual([2, 5, 9]);
      store.setShowClosed(true);
      expect(vmTopics(store)).toEqual([1, 2, 5, 9]);
    });
  });

  describe('query predicates', () => {
    const QFIX = resp([
      node(1, { title: 'Lifecycle viewer', labels: ['INTERNAL'] }),
      node(154, { title: 'Scanner fix', labels: ['BACKTEST'] }), node(9, { title: 'Other' }),
    ]);

    it('title substring filters case-insensitively', async () => {
      const store = storeWith(lazyStub(QFIX));
      await store.refresh();
      store.setQuery('lifecycle');
      expect(vmTopics(store)).toEqual([1]);
    });

    it("numeric query '154' and '#154' match the issue number", async () => {
      const store = storeWith(lazyStub(QFIX));
      await store.refresh();
      store.setQuery('154');
      expect(vmTopics(store)).toEqual([154]);
      store.setQuery('#154');
      expect(vmTopics(store)).toEqual([154]);
    });

    it('label substring matches label carriers', async () => {
      const store = storeWith(lazyStub(QFIX));
      await store.refresh();
      store.setQuery('backtest');
      expect(vmTopics(store)).toEqual([154]);
    });

    it('empty query disables filtering', async () => {
      const store = storeWith(lazyStub(QFIX));
      await store.refresh();
      store.setQuery('zz');
      expect(vmTopics(store)).toEqual([]);
      store.setQuery('   ');
      expect(vmTopics(store)).toEqual([1, 9, 154]);
    });

    it('non-matching topics drop out of the flat list', async () => {
      const store = storeWith(lazyStub(QFIX));
      await store.refresh();
      store.setQuery('lifecycle');
      expect(vmTopics(store)).toEqual([1]);
    });

    it('selection survives the selected topic being filtered out of the list', async () => {
      const store = storeWith(lazyStub(QFIX));
      await store.refresh();
      store.selectTopic(9);
      await store.ensureTopic(9);
      store.setQuery('lifecycle'); // #9 no longer in the visible list
      expect(store.selectedTopicNumber()).toBe(9);
      expect(store.selectedTopic()?.number).toBe(9); // right pane unaffected
      store.setQuery('');
      expect(store.selectedTopicNumber()).toBe(9);
    });
  });

  describe('in-tree match', () => {
    const TREE = resp([
      node(2, {}, [
        node(20, { nodeType: 'thread' }, [
          node(30),
          node(31, {}, [node(99, { title: 'Deep hit' })]),
        ]),
        node(21, { nodeType: 'thread' }, [node(40)]),
      ]),
    ]);

    it('matchSet + ancestor expansion reveals a depth-3 hit, unrelated subtrees stay collapsed', async () => {
      const store = storeWith(lazyStub(TREE));
      await store.refresh();
      store.selectTopic(2);
      await store.ensureTopic(2);
      store.setQuery('deep hit');
      // 99 matches; ancestors 2→20→31 expand; sibling rows still render,
      // 21 stays collapsed (40 never appears)
      expect([...store.matchSet()]).toEqual([99]);
      expect(store.treeRows().map(r => r.node.number)).toEqual([2, 20, 30, 31, 99, 21]);
      expect(store.matchCount()).toBe(1);
    });

    it('clearing the query restores the prior expandedIds', async () => {
      const store = storeWith(lazyStub(TREE));
      await store.refresh();
      store.selectTopic(2);
      await store.ensureTopic(2);
      store.setQuery('deep hit');
      store.setQuery('');
      expect(store.expandedIds()).toEqual([2]);
      expect(store.treeRows().map(r => r.node.number)).toEqual([2, 20, 21]);
      expect(store.matchSet().size).toBe(0);
    });

    it('collapsing an auto-expanded ancestor works and restores on query clear', async () => {
      const store = storeWith(lazyStub(TREE));
      await store.refresh();
      store.selectTopic(2);
      await store.ensureTopic(2);
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
      const store = storeWith(lazyStub(TREE));
      await store.refresh();
      store.selectTopic(2);
      await store.ensureTopic(2);
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
      const f = resp([
        node(2, {}, [node(20, {}, [node(30, { state: 'closed', title: 'Deep hit' })])]),
      ]);
      const store = storeWith(lazyStub(f));
      await store.refresh();
      store.selectTopic(2);
      await store.ensureTopic(2);
      store.setQuery('deep hit');
      expect(store.matchSet().size).toBe(0);
      store.setShowClosed(true);
      expect(store.matchSet().size).toBe(1);
      expect(store.treeRows().map(r => r.node.number)).toEqual([2, 20, 30]);
    });
  });

  describe('all-topics view', () => {
    const ALL = resp([
  node(1, {}, [node(10)]),
  node(5, {}, [node(50)]),
]);

    it('flattens every filtered topic with depth; roots collapsed by default', async () => {
      const store = storeWith(lazyStub(ALL));
      await store.refresh();
      store.setShowAllTopics(true);
      await store.ensureTopic(1);
      await store.ensureTopic(5);
      const all = store.allTopicsBlocks();
      expect(all.map(b => b.topic.number)).toEqual([1, 5]);
      expect(all[0].rows.map(r => [r.node.number, r.depth])).toEqual([[1, 0]]);
      store.toggleExpanded(1);
      expect(store.allTopicsBlocks()[0].rows.map(r => r.node.number)).toEqual([1, 10]);
    });

    it('expandableIds spans all fetched trees in all-topics mode', async () => {
      const store = storeWith(lazyStub(ALL));
      await store.refresh();
      expect(store.expandableIds()).toEqual([]);
      store.setShowAllTopics(true);
      await store.ensureTopic(1);
      await store.ensureTopic(5);
      expect(store.expandableIds().sort()).toEqual([1, 5]);
      store.expandAll();
      expect(store.allTopicsBlocks().flatMap(b => b.rows).map(r => r.node.number))
        .toEqual([1, 10, 5, 50]);
    });

    it('query filters the all-topics rows too', async () => {
      const store = storeWith(lazyStub(ALL));
      await store.refresh();
      store.setShowAllTopics(true);
      await store.ensureTopic(1);
      await store.ensureTopic(5);
      store.setQuery('issue 5');
      const all = store.allTopicsBlocks();
      expect(all.map(b => b.topic.number)).toEqual([5]);
    });

    it('match scope spans every rendered tree in all-topics mode (#1532)', async () => {
      const ALL2 = resp([
        node(1, {}, [node(10)]),
        node(5, { title: 'Deep hit root' }, [
          node(50, {}, [node(51, { title: 'Deep hit leaf' })]),
        ]),
      ]);
      const store = storeWith(lazyStub(ALL2));
      await store.refresh();
      store.setShowAllTopics(true);
      await store.ensureTopic(1);
      await store.ensureTopic(5);
      store.setQuery('deep hit');
      // Hits = root 5 (title) + leaf 51; ancestors 5+50 auto-expand
      // inside section B's rows — no selection, no manual expansion.
      expect([...store.matchSet()].sort()).toEqual([5, 51]);
      expect(store.matchCount()).toBe(2);
      expect([...store.matchAncestorIds()].sort()).toEqual([5, 50]);
      const all = store.allTopicsBlocks();
      expect(all.map(b => b.topic.number)).toEqual([5]); // #1 filtered out
      expect(all[0].rows.map(r => r.node.number)).toEqual([5, 50, 51]);
    });

    it('descendant-only query in all-topics: topic filtered out → 0 matches, never a phantom count', async () => {
      // The hit lives inside topic 5 but 5's own fields don't match —
      // filteredTopics drops it, nothing renders, count is honestly 0.
      const DEEP = resp([
        node(5, {}, [node(50, {}, [node(51, { title: 'Deep hit' })])]),
      ]);
      const store = storeWith(lazyStub(DEEP));
      await store.refresh();
      store.setShowAllTopics(true);
      await store.ensureTopic(5);
      store.setQuery('deep hit');
      expect(store.filteredTopics().length).toBe(0);
      expect(store.matchCount()).toBe(0);
      expect(store.allTopicsBlocks()).toEqual([]);
    });

    it('selectTopic seeds expansion additively in all-topics mode (#1532)', async () => {
      const store = storeWith(lazyStub(ALL));
      await store.refresh();
      store.setShowAllTopics(true);
      store.toggleExpanded(1); // manual expansion of section A's root
      store.selectTopic(5);
      await store.ensureTopic(5);
      expect(store.selectedTopicNumber()).toBe(5);
      expect(store.expandedIds()).toContain(1); // prior expansion kept
      expect(store.expandedIds()).toContain(5);
    });

    it('allTopicsBlocks carries per-topic status — loading / error / ready (#1638)', async () => {
      const s1 = new Subject<LifecycleTreeResponse>();
      const store = storeWith({
        getLifecycleTopicIndex$: jest.fn(() => of(indexOf(ALL))),
        getLifecycleTopicTree$: jest.fn((req: LifecycleTopicTreeRequest) =>
          req.topicNumber === 1
            ? s1.asObservable()
            : throwError(() => Object.assign(new Error('boom'), { code: 'functions/internal' }))),
      });
      await store.refresh();
      store.setShowAllTopics(true);
      await flush();

      let all = store.allTopicsBlocks();
      expect(all[0].status).toBe('loading');  // 1 in flight → skeleton
      expect(all[1].status).toBe('error');    // 5 failed → its own retry
      expect(all[1].error).toContain('internal');
      expect(all[1].rows).toEqual([]);

      s1.next(treeOf(ALL, 1)); s1.complete(); await flush();
      all = store.allTopicsBlocks();
      expect(all[0].status).toBe('ready');
      expect(all[0].rows.map(r => r.node.number)).toEqual([1]);
    });
  });

  describe('label patch + write', () => {
    it('applyLabelUpdate patches the node inside its memoized tree; siblings untouched', async () => {
      const store = storeWith(lazyStub(FIXTURE));
      await store.refresh();
      await store.ensureTopic(2);
      store.applyLabelUpdate(20, ['FE', 'IMPL']);
      const tree = store.trees()[2];
      expect(tree.children[0].labels).toEqual(['FE', 'IMPL']);
      expect(tree.children[0].children[0].labels).toEqual([]);
      expect(store.response()!.topics[1].labels).toEqual([]); // index root untouched
    });

    it('applyLabelUpdate on a root patches BOTH the index entry and the memo tree', async () => {
      const store = storeWith(lazyStub(FIXTURE));
      await store.refresh();
      await store.ensureTopic(2);
      store.applyLabelUpdate(2, ['TOPIC-LABEL']);
      expect(store.response()!.topics[1].labels).toEqual(['TOPIC-LABEL']);
      expect(store.trees()[2].labels).toEqual(['TOPIC-LABEL']);
    });

    it('applyLabelUpdate on an absent number leaves every container untouched', async () => {
      const store = storeWith(lazyStub(FIXTURE));
      await store.refresh();
      await store.ensureTopic(2);
      const resBefore = store.response();
      const memoBefore = store.trees();
      store.applyLabelUpdate(424242, ['X']);
      expect(store.response()).toBe(resBefore);
      expect(store.trees()).toBe(memoBefore);
    });

    it('updateIssueLabels calls the service and patches the memoized labels', async () => {
      const updateIssueLabels$ = jest.fn(() =>
        of({ labels: ['IMPL'], created: [] }));
      const store = storeWith({
        ...lazyStub(FIXTURE),
        updateIssueLabels$,
      });
      await store.refresh();
      await store.ensureTopic(2);
      const res = await store.updateIssueLabels(20, ['IMPL'], []);
      expect(updateIssueLabels$).toHaveBeenCalledWith({
        owner: 'rinebob', repo: 'rel-str',
        issueNumber: 20, add: ['IMPL'], remove: [],
      });
      expect(res?.labels).toEqual(['IMPL']);
      expect(store.trees()[2].children[0].labels).toEqual(['IMPL']);
      expect(store.error()).toBeNull();
    });

    it('a failed write leaves the memo untouched and sets error', async () => {
      const updateIssueLabels$ = jest.fn(() =>
        throwError(() => Object.assign(new Error('denied'), { code: 'permission-denied' })));
      const store = storeWith({
        ...lazyStub(FIXTURE),
        updateIssueLabels$,
      });
      await store.refresh();
      await store.ensureTopic(2);
      const res = await store.updateIssueLabels(20, ['IMPL'], []);
      expect(res).toBeNull();
      expect(store.error()).toBe('permission-denied: denied');
      expect(store.trees()[2].children[0].labels).toEqual([]);
    });

    it('a write resolving after a repo switch must not label the new repo\'s same-numbered issue', async () => {
      const pending = new Subject<{ labels: string[]; created: string[] }>();
      const store = storeWith({
        ...lazyStub(FIXTURE),
        updateIssueLabels$: jest.fn(() => pending.asObservable()),
      });
      await store.refresh();
      await store.ensureTopic(2);
      const write = store.updateIssueLabels(20, ['IMPL'], []);

      await store.selectRepo(1); // memo dropped, epoch bumped
      await store.ensureTopic(2); // repo B's topic — node 20 also exists here

      pending.next({ labels: ['IMPL'], created: [] });
      pending.complete();
      const res = await write;
      expect(res?.labels).toEqual(['IMPL']); // the write itself succeeded
      // ...but its labels must NOT land on repo B's issue #20
      expect(store.trees()[2].children[0].labels).toEqual([]);
    });
  });

  // ── lazy loading (task #1637) ────────────────────────────────────────────

  describe('lazy loading', () => {
    it('load patches the index only — zero subtree calls, left pane live', async () => {
      const svc = lazyStub(FIXTURE);
      const store = storeWith(svc);
      await store.refresh();

      expect(svc.getLifecycleTopicIndex$).toHaveBeenCalledTimes(1);
      expect(svc.getLifecycleTopicIndex$).toHaveBeenCalledWith(
        { owner: 'rinebob', repo: 'rel-str' });
      expect(svc.getLifecycleTopicTree$).not.toHaveBeenCalled();
      // left pane renders from index data alone
      expect(vmTopics(store)).toEqual([1, 2]);
      // no subtree memoized — the right pane is honestly empty
      expect(store.selectedTopic()).toBeNull();
      expect(store.treeRows()).toEqual([]);
      expect(store.treeLoading()).toEqual([]);
    });

    it('selectTopic fetches the subtree; a memo revisit issues no call', async () => {
      const svc = lazyStub(FIXTURE);
      const store = storeWith(svc);
      await store.refresh();

      store.selectTopic(2);
      expect(store.treeLoadingSet().has(2)).toBe(true); // skeleton signal
      await store.ensureTopic(2);
      expect(svc.getLifecycleTopicTree$).toHaveBeenCalledTimes(1);
      expect(svc.getLifecycleTopicTree$).toHaveBeenCalledWith(
        { owner: 'rinebob', repo: 'rel-str', topicNumber: 2 });
      expect(store.selectedTopic()?.number).toBe(2);
      expect(store.treeLoading()).toEqual([]);
      expect(store.treeFetchedAt()[2]).toBe('2026-09-28T12:00:00Z');

      // away and back — memo serves, zero calls
      store.selectTopic(1);
      await store.ensureTopic(1);
      store.selectTopic(2);
      await store.ensureTopic(2);
      expect(svc.getLifecycleTopicTree$).toHaveBeenCalledTimes(2);
    });

    it('concurrent triggers coalesce into one fetch', async () => {
      const svc = lazyStub(FIXTURE);
      const store = storeWith(svc);
      await store.refresh();

      const [a, b, c] = await Promise.all([
        store.ensureTopic(2), store.ensureTopic(2), store.ensureTopic(2),
      ]);
      expect(svc.getLifecycleTopicTree$).toHaveBeenCalledTimes(1);
      expect(a).not.toBeNull();
      expect(a).toBe(b);
      expect(b).toBe(c);
    });

    it('a failed subtree fetch marks treeErrors[n] — siblings and the banner unaffected', async () => {
      const svc = lazyStub(FIXTURE);
      const base = svc.getLifecycleTopicTree$;
      svc.getLifecycleTopicTree$ = jest.fn((req: LifecycleTopicTreeRequest) =>
        req.topicNumber === 2
          ? throwError(() => Object.assign(new Error('denied'), { code: 'functions/permission-denied' }))
          : base(req));
      const store = storeWith(svc);
      await store.refresh();

      await store.ensureTopic(2);
      await store.ensureTopic(1);
      expect(store.treeErrors()[2]).toContain('denied');
      expect(store.trees()[2]).toBeUndefined();
      expect(store.trees()[1]?.number).toBe(1);   // sibling fine
      expect(store.error()).toBeNull();           // page banner untouched

      // retry clears the error and refetches
      svc.getLifecycleTopicTree$ = base;
      await store.ensureTopic(2);
      expect(store.treeErrors()[2]).toBeUndefined();
      expect(store.trees()[2]?.number).toBe(2);
    });

    it('an empty subtree response marks treeErrors[n]', async () => {
      const store = storeWith({
        getLifecycleTopicIndex$: jest.fn(() => of(indexOf(FIXTURE))),
        getLifecycleTopicTree$: jest.fn(() =>
          of({ topics: [], fetchedAt: '' })),
      });
      await store.refresh();
      await store.ensureTopic(99);
      expect(store.treeErrors()[99]).toBe('empty subtree response');
      expect(store.treeLoading()).toEqual([]);
    });

    it('page-state signals: selectedTreeLoading / selectedTreeError / anyTreeLoading / anyTreeError', async () => {
      const pending = new Subject<LifecycleTreeResponse>();
      const svc = lazyStub(FIXTURE);
      const base = svc.getLifecycleTopicTree$;
      svc.getLifecycleTopicTree$ = jest.fn((req: LifecycleTopicTreeRequest) =>
        req.topicNumber === 2 ? pending.asObservable() : base(req));
      const store = storeWith(svc);
      await store.refresh();
      expect(store.anyTreeLoading()).toBe(false);

      store.selectTopic(2); // dispatches the fetch — topic 2's subject hangs
      await flush();
      expect(store.selectedTreeLoading()).toBe(true);
      expect(store.anyTreeLoading()).toBe(true);
      expect(store.selectedTreeError()).toBeNull();

      // a different selection has no loading flag (its fetch isn't ours)
      pending.next(treeOf(FIXTURE, 2)); pending.complete();
      await flush();
      expect(store.selectedTreeLoading()).toBe(false);
      expect(store.selectedTopic()?.number).toBe(2);

      // error path: topic 1 fails — error signal set, loading cleared
      svc.getLifecycleTopicTree$ = jest.fn((_req: LifecycleTopicTreeRequest) =>
        throwError(() => Object.assign(new Error('denied'), { code: 'x' })));
      store.selectTopic(1);
      await store.ensureTopic(1);
      expect(store.selectedTreeError()).toContain('denied');
      expect(store.selectedTreeLoading()).toBe(false);
      expect(store.anyTreeError()).toBe(true);
    });

    it('a subtree fetch resolving after a repo switch is discarded (epoch guard)', async () => {
      const subj = new Subject<LifecycleTreeResponse>();
      const store = storeWith({
        getLifecycleTopicIndex$: jest.fn(() => of(indexOf(FIXTURE))),
        getLifecycleTopicTree$: jest.fn(() => subj.asObservable()),
      });
      await store.refresh();
      store.selectTopic(2); // fires the fetch — stays in-flight

      await store.selectRepo(1); // switch before it lands
      subj.next(treeOf(FIXTURE, 2));
      subj.complete();
      await flush();

      expect(store.trees()).toEqual({}); // discarded — not in the memo
    });
  });

  describe('all-topics fetch queue', () => {
    const MANY = resp([
  node(1), node(2), node(3), node(4),
  node(5), node(6), node(7),
]);

    it('enabling all-topics queues unfetched filtered topics at bounded concurrency', async () => {
      const subjects = new Map<number, Subject<LifecycleTreeResponse>>();
      const tree$ = jest.fn((req: LifecycleTopicTreeRequest) => {
        const s = new Subject<LifecycleTreeResponse>();
        subjects.set(req.topicNumber, s);
        return s.asObservable();
      });
      const store = storeWith({
        getLifecycleTopicIndex$: jest.fn(() => of(indexOf(MANY))),
        getLifecycleTopicTree$: tree$,
      });
      await store.refresh();
      const p1 = store.ensureTopic(1); // memo-hit topics are never queued
      subjects.get(1)!.next(treeOf(MANY, 1));
      subjects.get(1)!.complete();
      await p1;
      expect(tree$).toHaveBeenCalledTimes(1);

      store.setShowAllTopics(true);
      await flush();
      // 4 dispatched (1 memoized → 2,3,4,5), rest wait — never more than 4 in flight
      const inflight = tree$.mock.calls.map(c => c[0].topicNumber).sort();
      expect(inflight).toEqual([1, 2, 3, 4, 5]); // the memo + 4 queue-dispatched
      expect([...store.treeLoading()].sort((a, b) => a - b)).toEqual([2, 3, 4, 5]);

      // completing one pulls the next off the queue
      subjects.get(2)!.next(treeOf(MANY, 2)); subjects.get(2)!.complete();
      await flush();
      expect(tree$).toHaveBeenCalledTimes(6); // topic 6 dispatched

      // drain the remainder — every filtered topic fetched exactly once
      for (const n of [3, 4, 5, 6]) {
        subjects.get(n)!.next(treeOf(MANY, n));
        subjects.get(n)!.complete();
      }
      await flush(); // a freed slot dispatches 7
      subjects.get(7)!.next(treeOf(MANY, 7));
      subjects.get(7)!.complete();
      await flush();
      expect(tree$).toHaveBeenCalledTimes(7);
      expect(store.treeLoading()).toEqual([]);
    });

    it('a rate-limit-class error drains the queue and flags the page', async () => {
      const subjects = new Map<number, Subject<LifecycleTreeResponse>>();
      let rateLimited = false; // topic 2 rate-limits ONCE — the retry succeeds
      const tree$ = jest.fn((req: LifecycleTopicTreeRequest) => {
        if (req.topicNumber === 2 && !rateLimited) {
          rateLimited = true;
          return throwError(() => Object.assign(new Error('slow down'), { code: 'functions/resource-exhausted' }));
        }
        const s = new Subject<LifecycleTreeResponse>();
        subjects.set(req.topicNumber, s);
        return s.asObservable();
      });
      const store = storeWith({
        getLifecycleTopicIndex$: jest.fn(() => of(indexOf(MANY))),
        getLifecycleTopicTree$: tree$,
      });
      await store.refresh();

      store.setShowAllTopics(true);
      await flush();
      expect(tree$).toHaveBeenCalledTimes(4); // 1,2,3,4 dispatched

      expect(store.allTopicsDrained()).toBe(true);
      expect(store.treeErrors()[2]).toContain('resource-exhausted');

      // actives may resolve — the drained queue dispatches nothing more
      for (const n of [1, 3, 4]) {
        subjects.get(n)!.next(treeOf(MANY, n));
        subjects.get(n)!.complete();
      }
      await flush();
      expect(tree$).toHaveBeenCalledTimes(4); // 5,6,7 never dispatched

      // re-enabling retries: the flag clears and only unfetched topics
      // re-queue (2,5,6,7 — 1,3,4 are memoized)
      store.setShowAllTopics(false);
      store.setShowAllTopics(true);
      await flush();
      const dispatched = new Set(tree$.mock.calls.map(c => c[0].topicNumber));
      expect(dispatched).toEqual(new Set([1, 2, 3, 4, 5, 6, 7]));
      expect(store.allTopicsDrained()).toBe(false); // cleared on re-enable
      for (const n of [2, 5, 6, 7]) {
        subjects.get(n)!.next(treeOf(MANY, n));
        subjects.get(n)!.complete();
      }
      await flush();
      expect(Object.keys(store.trees()).sort()).toEqual(['1', '2', '3', '4', '5', '6', '7']);
    });

    it('resumeAllTopics re-arms a drained queue — the notice\'s Resume path (#1638)', async () => {
      const subjects = new Map<number, Subject<LifecycleTreeResponse>>();
      let rateLimited = false;
      const tree$ = jest.fn((req: LifecycleTopicTreeRequest) => {
        if (req.topicNumber === 2 && !rateLimited) {
          rateLimited = true;
          return throwError(() => Object.assign(new Error('slow down'), { code: 'functions/resource-exhausted' }));
        }
        const s = new Subject<LifecycleTreeResponse>();
        subjects.set(req.topicNumber, s);
        return s.asObservable();
      });
      const store = storeWith({
        getLifecycleTopicIndex$: jest.fn(() => of(indexOf(MANY))),
        getLifecycleTopicTree$: tree$,
      });
      await store.refresh();
      store.setShowAllTopics(true);
      await flush();
      expect(store.allTopicsDrained()).toBe(true);
      for (const n of [1, 3, 4]) {
        subjects.get(n)!.next(treeOf(MANY, n));
        subjects.get(n)!.complete();
      }
      await flush();
      expect(tree$).toHaveBeenCalledTimes(4); // queue drained — 5,6,7 never dispatched

      store.resumeAllTopics();
      await flush();
      expect(store.allTopicsDrained()).toBe(false); // cleared on re-arm
      const dispatched = new Set(tree$.mock.calls.map(c => c[0].topicNumber));
      expect(dispatched).toEqual(new Set([1, 2, 3, 4, 5, 6, 7])); // 2,5,6,7 re-queued
      for (const n of [2, 5, 6, 7]) {
        subjects.get(n)!.next(treeOf(MANY, n));
        subjects.get(n)!.complete();
      }
      await flush();
      expect(Object.keys(store.trees()).sort()).toEqual(['1', '2', '3', '4', '5', '6', '7']);
    });

    it('resumeAllTopics is a no-op with all-topics off', async () => {
      const svc = lazyStub(MANY);
      const store = storeWith(svc);
      await store.refresh();
      (svc.getLifecycleTopicTree$ as jest.Mock).mockClear();
      store.resumeAllTopics();
      await flush();
      expect(svc.getLifecycleTopicTree$).not.toHaveBeenCalled();
    });

    it('non-rate-limit errors isolate to their section — the queue continues', async () => {
      const tree$ = jest.fn((req: LifecycleTopicTreeRequest) =>
        req.topicNumber === 2
          ? throwError(() => Object.assign(new Error('boom'), { code: 'functions/internal' }))
          : of(treeOf(MANY, req.topicNumber)));
      const store = storeWith({
        getLifecycleTopicIndex$: jest.fn(() => of(indexOf(MANY))),
        getLifecycleTopicTree$: tree$,
      });
      await store.refresh();

      store.setShowAllTopics(true);
      await flush(); // queue-dispatched calls only — manual ensureTopics would mask pump

      expect(tree$).toHaveBeenCalledTimes(7);            // everything attempted
      expect(store.treeErrors()[2]).toContain('internal'); // only its own section
      expect(store.allTopicsDrained()).toBe(false);
      expect(Object.keys(store.trees()).sort()).toEqual(['1', '3', '4', '5', '6', '7']);
    });

    it('filter changes top up the queue — widening reveals and fetches new topics', async () => {
      const svc = lazyStub(MANY);
      const store = storeWith(svc);
      await store.refresh();

      store.setQuery('issue 1');
      store.setShowAllTopics(true);
      await flush(); // queue dispatches the one filtered topic
      expect(svc.getLifecycleTopicTree$).toHaveBeenCalledTimes(1);

      store.setQuery(''); // widen — the queue must top up the rest itself
      await flush();
      expect(svc.getLifecycleTopicTree$).toHaveBeenCalledTimes(7);
      expect(Object.keys(store.trees()).length).toBe(7);
    });
  });

  describe('refresh scoping', () => {
    it('refresh refetches the index, drops the memo, refetches only the selection', async () => {
      const svc = lazyStub(FIXTURE);
      const store = storeWith(svc);
      await store.refresh();
      store.selectTopic(2);
      await store.ensureTopic(2);
      await store.ensureTopic(1); // fetched but not part of the rendered set
      expect(svc.getLifecycleTopicTree$).toHaveBeenCalledTimes(2);

      await store.refresh();
      expect(svc.getLifecycleTopicIndex$).toHaveBeenCalledTimes(2);
      // rendered set = the selection only — 1 is NOT refetched
      expect(svc.getLifecycleTopicTree$).toHaveBeenCalledTimes(3);
      expect(svc.getLifecycleTopicTree$).toHaveBeenLastCalledWith(
        { owner: 'rinebob', repo: 'rel-str', topicNumber: 2 });
      // memo was dropped — 1's entry gone until re-fetched
      await store.ensureTopic(2); // join the refresh-driven fetch
      expect(store.selectedTopic()?.number).toBe(2);
      expect(store.trees()[1]).toBeUndefined();
    });

    it('refresh in all-topics mode refetches the filtered set only', async () => {
      const MANY = resp([
  node(1), node(2),
  node(5),
]);
      const svc = lazyStub(MANY);
      const store = storeWith(svc);
      await store.refresh();
      store.setShowAllTopics(true);
      await Promise.all([1, 2, 5].map(n => store.ensureTopic(n)));
      expect(svc.getLifecycleTopicTree$).toHaveBeenCalledTimes(3);

      store.setQuery('issue 1'); // rendered set narrows to topic 1
      await store.refresh();
      expect(svc.getLifecycleTopicIndex$).toHaveBeenCalledTimes(2);
      // Queue-dispatched only — assert before any manual ensureTopic.
      expect(svc.getLifecycleTopicTree$).toHaveBeenCalledTimes(4); // only 1 refetched
      expect(svc.getLifecycleTopicTree$).toHaveBeenLastCalledWith(
        { owner: 'rinebob', repo: 'rel-str', topicNumber: 1 });
      await flush();
      expect(store.trees()[1]?.number).toBe(1);
      expect(store.trees()[2]).toBeUndefined(); // dropped, not refetched
    });
  });

  it('refresh while queue fetches are in-flight — stale settles cannot free phantom slots or clobber the new epoch\'s dedupe entry', async () => {
    // Regression for review M1/M2: dropMemo resets queueActive/inFlight
    // while old promises still settle. Their finallys must no-op.
    const waves = new Map<number, Subject<LifecycleTreeResponse>[]>();
    const tree$ = jest.fn((req: LifecycleTopicTreeRequest) => {
      const s = new Subject<LifecycleTreeResponse>();
      waves.set(req.topicNumber, [...(waves.get(req.topicNumber) ?? []), s]);
      return s.asObservable();
    });
    const MANY = resp([
  node(1), node(2), node(3), node(4),
  node(5), node(6), node(7),
]);
    const store = storeWith({
      getLifecycleTopicIndex$: jest.fn(() => of(indexOf(MANY))),
      getLifecycleTopicTree$: tree$,
    });
    await store.refresh();
    store.setShowAllTopics(true);
    await flush();
    expect(tree$).toHaveBeenCalledTimes(4); // first wave in-flight, 3 queued

    await store.refresh(); // index refetch → dropMemo → re-queue all 7
    await flush();
    expect(tree$).toHaveBeenCalledTimes(8); // new epoch dispatches its own 4

    // Stale wave settles — finallys must NOT decrement the new counter
    // (no phantom slots → no extra dispatches) and must NOT delete the
    // new epoch's inFlight entries (a trigger now must join, not refire).
    for (const [n, subs] of waves) { subs[0].next(treeOf(MANY, n)); subs[0].complete(); }
    void store.ensureTopic(1); // would fire call 9 if its dedupe entry were clobbered
    await flush();
    expect(tree$).toHaveBeenCalledTimes(8);
    expect(store.trees()[1]).toBeUndefined(); // stale-epoch data discarded

    // New wave settles — the remaining queued topics (5,6,7) dispatch.
    for (const [n, subs] of waves) { subs[1]?.next(treeOf(MANY, n)); subs[1]?.complete(); }
    await flush();
    expect(tree$).toHaveBeenCalledTimes(11); // 4 stale + 7 new epoch

    // Drain the last wave — all seven trees land, queue empties.
    for (const [n, subs] of waves) {
      const last = subs[subs.length - 1];
      last.next(treeOf(MANY, n)); last.complete();
    }
    await flush();
    expect(store.treeLoading()).toEqual([]);
    expect(Object.keys(store.trees()).length).toBe(7);
  });

  it('setShowClosed(true) with all-topics on tops up newly-visible closed topics', async () => {
    const svc = lazyStub(FIXTURE);
    const store = storeWith(svc);
    await store.refresh();
    store.setShowAllTopics(true);
    await flush(); // topics 1,2 fetched — closed topic 3 filtered out
    expect(svc.getLifecycleTopicTree$).toHaveBeenCalledTimes(2);

    store.setShowClosed(true);
    await flush(); // queue must dispatch 3 without any manual ensureTopic
    expect(svc.getLifecycleTopicTree$).toHaveBeenCalledTimes(3);
    expect(svc.getLifecycleTopicTree$).toHaveBeenLastCalledWith(
      { owner: 'rinebob', repo: 'rel-str', topicNumber: 3 });
  });

  it('showClosed filters the index only — no subtree calls from the toggle alone', async () => {
    const svc = lazyStub(FIXTURE);
    const store = storeWith(svc);
    await store.refresh();
    store.setShowClosed(true);
    expect(svc.getLifecycleTopicTree$).not.toHaveBeenCalled();
    expect(vmTopics(store)).toEqual([1, 2, 3]);
  });

  it('match counts only fetched trees in all-topics mode (PRD caveat)', async () => {
    const CAV = resp([
  node(1, { title: 'Deep hit A' }, [node(10, { title: 'Deep hit leaf' })]),
  node(5, { title: 'Deep hit B' }, [node(50, { title: 'Deep hit leaf' })]),
]);
    const hanging = new Subject<LifecycleTreeResponse>();
    const store = storeWith({
      getLifecycleTopicIndex$: jest.fn(() => of(indexOf(CAV))),
      getLifecycleTopicTree$: jest.fn((req: LifecycleTopicTreeRequest) =>
        req.topicNumber === 1 ? hanging.asObservable() : of(treeOf(CAV, req.topicNumber))),
    });
    await store.refresh();
    store.setShowAllTopics(true);
    await store.ensureTopic(5); // topic 1 still in-flight — unfetched
    store.setQuery('deep hit');
    // Topic 1's tree never landed — neither its root match nor its leaf
    // can contribute. The badge counts fetched trees only.
    expect([...store.matchSet()].sort()).toEqual([5, 50]);
    expect(store.matchCount()).toBe(2);
  });

  it('selectRepo with all-topics on re-queues the new repo\'s filtered set', async () => {
    const svc = lazyStub(FIXTURE);
    const store = storeWith(svc);
    await store.refresh();
    store.setShowAllTopics(true);
    await Promise.all([1, 2].map(n => store.ensureTopic(n))); // 3 closed → not queued
    expect(svc.getLifecycleTopicTree$).toHaveBeenCalledTimes(2);

    await store.selectRepo(1); // all-topics stays on — the new repo must re-queue
    await flush(); // no explicit ensureTopic — only queue-dispatched calls count
    expect(svc.getLifecycleTopicTree$).toHaveBeenCalledTimes(4);
    expect(svc.getLifecycleTopicTree$).toHaveBeenLastCalledWith(
      { owner: 'rinebob', repo: 'av-proxy-api', topicNumber: 2 });
  });

  it('selectRepo resets the query (new dataset) and drops the memo', async () => {
    const svc = lazyStub(FIXTURE);
    const store = storeWith(svc);
    await store.refresh();
    await store.ensureTopic(2);
    store.setQuery('lifecycle');
    await store.selectRepo(1);
    expect(store.query()).toBe('');
    expect(store.trees()).toEqual({});
    expect(svc.getLifecycleTopicIndex$).toHaveBeenCalledTimes(2);
    expect(svc.getLifecycleTopicTree$).toHaveBeenCalledTimes(1); // no fetch on the new repo
  });
});

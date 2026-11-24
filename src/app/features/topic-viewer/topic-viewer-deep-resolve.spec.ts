/**
 * Deep issue-number resolution spec (#1696) — digit-query → issueMap /
 * resolveLifecycleIssue orchestration: map hit → select+fetch+expand+
 * highlight; miss/stale → single callable fallback; not-in-tree /
 * not-found / error phases; seq supersession guards; resolved-root
 * visibility; suppression interplay.
 */



jest.mock('@angular/fire/functions', () => ({
  Functions: class {},
  httpsCallable: jest.fn(),
}));

import { from, of, throwError } from 'rxjs';

import type {
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
} from './topic-viewer.store.testbed';

/** The deep-resolution fixture — root 2 owns thread 20 → issues 30/31;
 *  root 4 is a sibling for miss/epoch paths. `issueMap` pre-seeds 30→2. */
const DEEP: LifecycleTreeResponse = {
  ...resp([{
    name: 'A',
    topics: [
      node(2, { nodeType: 'topic' }, [
        node(20, { nodeType: 'thread' }, [node(30), node(31)]),
      ]),
      node(4, { nodeType: 'topic' }),
    ],
  }]),
  issueMap: { 30: 2 },
};

/** Lazy stub + resolver seam — resolver behavior configured per spec. */
const svc = (
  res: LifecycleTreeResponse = DEEP,
  resolve: jest.Mock = jest.fn(),
) => ({ ...lazyStub(res), resolveLifecycleIssue$: resolve });



/**
 * Issue-number deep resolution (#1696) — digit queries that miss every
 * visible root resolve through the index's issueMap, then through
 * resolveLifecycleIssue on a cold/stale miss. Successful resolution
 * selects the root, expands ancestors, and marks the node `resolved`
 * (a highlight distinct from the query `.match` tint).
 */


describe('issue-number deep resolution (#1696)', () => {


  it('map hit: selects the root, expands ancestors, marks resolved — no callable', async () => {
    const s = svc();
    const store = storeWith(s);
    await store.refresh();

    await store.resolveIssueNumber(30);

    expect(s.resolveLifecycleIssue$).not.toHaveBeenCalled();
    expect(store.selectedTopicNumber()).toBe(2);
    expect(store.resolvedNodeNumber()).toBe(30);
    expect(store.effectiveExpandedIds().has(20)).toBe(true);
    expect(store.effectiveExpandedIds().has(2)).toBe(true);
    expect(store.issueResolution()).toMatchObject({
      issueNumber: 30, phase: 'resolved', rootNumber: 2,
    });
  });

  it('reports resolving while the subtree fetch is in flight', async () => {
    let resolveTree!: (v: LifecycleTreeResponse) => void;
    const s = {
      getLifecycleTopicIndex$: jest.fn(() => of(indexOf(DEEP))),
      getLifecycleTopicTree$: jest.fn(() => from(
        new Promise<LifecycleTreeResponse>(r => { resolveTree = r; }))),
      resolveLifecycleIssue$: jest.fn(),
    };
    const store = storeWith(s);
    await store.refresh();

    const p = store.resolveIssueNumber(30);
    await Promise.resolve();
    expect(store.issueResolution()?.phase).toBe('resolving');

    resolveTree(treeOf(DEEP, 2));
    await p;
    expect(store.issueResolution()?.phase).toBe('resolved');
  });

  it('resolution expands via the manual set — collapse behaves like a user collapse', async () => {
    const s = svc();
    const store = storeWith(s);
    await store.refresh();
    await store.resolveIssueNumber(30);

    store.toggleExpanded(20); // manual collapse — no suppression bookkeeping
    expect(store.effectiveExpandedIds().has(20)).toBe(false);
    expect(store.suppressedIds()).toEqual([]);

    store.toggleExpanded(20); // and re-expands manually
    expect(store.effectiveExpandedIds().has(20)).toBe(true);
  });

  it('every landed path number learns its root — mirrors the BE map upsert', async () => {
    const s = svc();
    const store = storeWith(s);
    await store.refresh();
    await store.resolveIssueNumber(30);
    expect(store.response()?.issueMap).toMatchObject({ 2: 2, 20: 2, 30: 2 });
  });

  it('map miss → resolver path selects root, expands ancestors, highlights', async () => {
    const noMap: LifecycleTreeResponse = { ...DEEP, issueMap: undefined };
    const resolve = jest.fn(() => of({
      issue: {
        number: 30, title: 'Issue 30', state: 'open' as const,
        url: 'u30', labels: [],
      },
      path: [2, 20, 30],
    }));
    const s = svc(noMap, resolve);
    const store = storeWith(s);
    await store.refresh();

    await store.resolveIssueNumber(30);
    expect(resolve).toHaveBeenCalledTimes(1);
    expect(store.selectedTopicNumber()).toBe(2);
    expect(store.resolvedNodeNumber()).toBe(30);
    expect(store.effectiveExpandedIds().has(20)).toBe(true);
    expect(store.response()?.issueMap).toMatchObject({ 2: 2, 20: 2, 30: 2 });
    expect(store.issueResolution()?.phase).toBe('resolved');
  });

  it('resolver self-root path selects the topic itself', async () => {
    const noMap: LifecycleTreeResponse = { ...DEEP, issueMap: undefined };
    const resolve = jest.fn(() => of({
      issue: {
        number: 4, title: 'Topic: B', state: 'open' as const,
        url: 'u4', labels: [],
      },
      path: [4],
    }));
    const s = svc(noMap, resolve);
    const store = storeWith(s);
    await store.refresh();

    await store.resolveIssueNumber(4);
    expect(store.selectedTopicNumber()).toBe(4);
    expect(store.resolvedNodeNumber()).toBe(4);
    expect(store.issueResolution()?.phase).toBe('resolved');
  });

  it('resolver pathless response → honest not-in-tree note with the title', async () => {
    const noMap: LifecycleTreeResponse = { ...DEEP, issueMap: undefined };
    const resolve = jest.fn(() => of({
      issue: {
        number: 77, title: 'A standalone issue', state: 'open' as const,
        url: 'u77', labels: [],
      },
      // no path — exists but under no Topic root
    }));
    const s = svc(noMap, resolve);
    const store = storeWith(s);
    await store.refresh();

    await store.resolveIssueNumber(77);
    const r = store.issueResolution();
    expect(r?.phase).toBe('not-in-tree');
    expect(r?.message).toContain('#77');
    expect(r?.message).toContain('A standalone issue');
    expect(store.resolvedNodeNumber()).toBeNull();
  });

  it('resolver not-found error → honest doesn\'t-exist note', async () => {
    const noMap: LifecycleTreeResponse = { ...DEEP, issueMap: undefined };
    const resolve = jest.fn(() => throwError(() =>
      Object.assign(new Error('no issue'), { code: 'functions/not-found' })));
    const s = svc(noMap, resolve);
    const store = storeWith(s);
    await store.refresh();

    await store.resolveIssueNumber(999999);
    const r = store.issueResolution();
    expect(r?.phase).toBe('not-found');
    expect(r?.message).toContain("doesn't exist");
    expect(r?.message).toContain('rinebob/rel-str');
  });

  it('resolver infra failure → error phase with the message', async () => {
    const noMap: LifecycleTreeResponse = { ...DEEP, issueMap: undefined };
    const resolve = jest.fn(() => throwError(() =>
      Object.assign(new Error('quota blown'), { code: 'functions/resource-exhausted' })));
    const s = svc(noMap, resolve);
    const store = storeWith(s);
    await store.refresh();

    await store.resolveIssueNumber(30);
    const r = store.issueResolution();
    expect(r?.phase).toBe('error');
    expect(r?.message).toContain('quota blown');
  });

  it('stale map entry → resolver once, lands via the corrected root', async () => {
    // Map claims 30 lives under root 4, but root 4's tree lacks it;
    // the resolver returns the real path under root 2.
    const staleMap: LifecycleTreeResponse = { ...DEEP, issueMap: { 30: 4 } };
    const resolve = jest.fn(() => of({
      issue: {
        number: 30, title: 'Issue 30', state: 'open' as const,
        url: 'u30', labels: [],
      },
      path: [2, 20, 30],
    }));
    const s = svc(staleMap, resolve);
    const store = storeWith(s);
    await store.refresh();

    await store.resolveIssueNumber(30);
    expect(resolve).toHaveBeenCalledTimes(1); // exactly one fallback
    expect(store.selectedTopicNumber()).toBe(2);
    expect(store.resolvedNodeNumber()).toBe(30);
    expect(store.issueResolution()?.phase).toBe('resolved');
    expect(store.response()?.issueMap?.[30]).toBe(2); // self-healed locally too
  });

  it('stale entry + resolver path contradicted by the fetched tree → not-in-tree, no loop', async () => {
    const staleMap: LifecycleTreeResponse = { ...DEEP, issueMap: { 30: 4 } };
    const resolve = jest.fn(() => of({
      issue: {
        number: 30, title: 'Issue 30', state: 'open' as const,
        url: 'u30', labels: [],
      },
      path: [4, 30], // resolver insists — but root 4's tree lacks it
    }));
    const s = svc(staleMap, resolve);
    const store = storeWith(s);
    await store.refresh();

    await store.resolveIssueNumber(30);
    expect(resolve).toHaveBeenCalledTimes(1); // no second call — no loop
    const r = store.issueResolution();
    expect(r?.phase).toBe('not-in-tree');
    expect(r?.message).toContain('#4');
    expect(store.resolvedNodeNumber()).toBeNull();
  });
});

describe('deep resolution guards + query trigger (#1696)', () => {

  it('setQuery digit branch fires the resolver after the debounce — once', async () => {
    jest.useFakeTimers();
    try {
      const resolve = jest.fn(() => of({
        issue: {
          number: 30, title: 'Issue 30', state: 'open' as const,
          url: 'u30', labels: [],
        },
        path: [2, 20, 30],
      }));
      const noMap: LifecycleTreeResponse = { ...DEEP, issueMap: undefined };
      const s = svc(noMap, resolve);
      const store = storeWith(s);
      await store.refresh();

      store.setQuery('3');   // still typing
      store.setQuery('30');
      await jest.advanceTimersByTimeAsync(400);

      expect(resolve).toHaveBeenCalledTimes(1);
      expect(resolve).toHaveBeenCalledWith(expect.objectContaining({ issueNumber: 30 }));
      expect(store.resolvedNodeNumber()).toBe(30);
      expect(store.issueResolution()?.phase).toBe('resolved');
    } finally {
      jest.useRealTimers();
    }
  });

  it('map hit through setQuery skips the callable entirely', async () => {
    jest.useFakeTimers();
    try {
      const resolve = jest.fn();
      const s = svc(DEEP, resolve);
      const store = storeWith(s);
      await store.refresh();
      store.setQuery('#30'); // '#'-prefix digits count too
      await jest.advanceTimersByTimeAsync(400);
      expect(resolve).not.toHaveBeenCalled();
      expect(store.resolvedNodeNumber()).toBe(30);
    } finally {
      jest.useRealTimers();
    }
  });

  it('a digit query matching a VISIBLE root stays on the index path', async () => {
    jest.useFakeTimers();
    try {
      const resolve = jest.fn();
      const s = svc(DEEP, resolve);
      const store = storeWith(s);
      await store.refresh();
      store.setQuery('4'); // root 4 is visible → no deep resolution
      await jest.advanceTimersByTimeAsync(400);
      expect(resolve).not.toHaveBeenCalled();
      expect(store.issueResolution()).toBeNull();
    } finally {
      jest.useRealTimers();
    }
  });

  it('a non-digit query retires the resolution state and supersedes in-flight work', async () => {
    jest.useFakeTimers();
    try {
      const resolve = jest.fn(() => of({
        issue: {
          number: 30, title: 'Issue 30', state: 'open' as const,
          url: 'u30', labels: [],
        },
        path: [2, 20, 30],
      }));
      const noMap: LifecycleTreeResponse = { ...DEEP, issueMap: undefined };
      const s = svc(noMap, resolve);
      const store = storeWith(s);
      await store.refresh();

      store.setQuery('30');
      await jest.advanceTimersByTimeAsync(400);
      expect(store.resolvedNodeNumber()).toBe(30);

      store.setQuery('abc');
      await jest.advanceTimersByTimeAsync(400);
      expect(store.issueResolution()).toBeNull();
      expect(store.resolvedNodeNumber()).toBeNull();
    } finally {
      jest.useRealTimers();
    }
  });

  it('a superseding keystroke inside the debounce window kills the pending resolution', async () => {
    jest.useFakeTimers();
    try {
      // Review fix (#1696 AC6): the pending timer carries no
      // issueResolution yet — '30' → '30x' must still cancel it.
      const resolve = jest.fn(() => of({
        issue: {
          number: 30, title: 'Issue 30', state: 'open' as const,
          url: 'u30', labels: [],
        },
        path: [2, 20, 30],
      }));
      const noMap: LifecycleTreeResponse = { ...DEEP, issueMap: undefined };
      const s = svc(noMap, resolve);
      const store = storeWith(s);
      await store.refresh();

      store.setQuery('30');   // debounce armed
      store.setQuery('30x');  // superseded before it fires
      await jest.advanceTimersByTimeAsync(400);

      expect(resolve).not.toHaveBeenCalled();
      expect(store.issueResolution()).toBeNull();
      expect(store.resolvedNodeNumber()).toBeNull();
    } finally {
      jest.useRealTimers();
    }
  });

  it('a tree-fetch failure on the resolved root reports error, not silence', async () => {
    const failingTree: jest.Mock = jest.fn(
      (req: LifecycleTopicTreeRequest) =>
        req.topicNumber === 2
          ? throwError(() => new Error('tree boom'))
          : of(treeOf(DEEP, req.topicNumber)),
    );
    const s = {
      ...lazyStub(DEEP),
      getLifecycleTopicTree$: failingTree,
      resolveLifecycleIssue$: jest.fn(),
    };
    const store = storeWith(s);
    await store.refresh();

    await store.resolveIssueNumber(30); // map hit → fetch root 2 fails
    const r = store.issueResolution();
    expect(r?.phase).toBe('error');
    expect(r?.rootNumber).toBe(2);
    expect(r?.message).toContain('tree boom');
  });

  it('an emptied query clears the resolved highlight too', async () => {
    const s = svc();
    const store = storeWith(s);
    await store.refresh();
    await store.resolveIssueNumber(30);
    expect(store.resolvedNodeNumber()).toBe(30);
    store.setQuery('');
    expect(store.issueResolution()).toBeNull();
    expect(store.resolvedNodeNumber()).toBeNull();
  });

  it('a superseding resolution wins — the stale continuation cannot clobber it', async () => {
    // First resolution parks inside the tree fetch; the second must own
    // the state when the first resumes.
    let resolveTree!: (v: LifecycleTreeResponse) => void;
    const s = {
      getLifecycleTopicIndex$: jest.fn(() => of(indexOf(DEEP))),
      getLifecycleTopicTree$: jest.fn((req: LifecycleTopicTreeRequest) =>
        req.topicNumber === 2
          ? from(new Promise<LifecycleTreeResponse>(r => { resolveTree = r; }))
          : of(treeOf(DEEP, req.topicNumber))),
      resolveLifecycleIssue$: jest.fn(() => of({
        issue: {
          number: 31, title: 'Issue 31', state: 'open' as const,
          url: 'u31', labels: [],
        },
        path: [2, 20, 31],
      })),
    };
    const store = storeWith(s);
    await store.refresh();

    const p1 = store.resolveIssueNumber(30); // parks on root 2's fetch
    const p2 = store.resolveIssueNumber(31); // supersedes — parks on the same fetch
    resolveTree(treeOf(DEEP, 2));
    await Promise.all([p1, p2]);

    // Whichever continuation ran last, state belongs to issue 31.
    expect(store.issueResolution()?.issueNumber).toBe(31);
    expect(store.resolvedNodeNumber()).toBe(31);
  });

  it('repo switch mid-resolution discards the landing and clears state', async () => {
    let resolveTree!: (v: LifecycleTreeResponse) => void;
    const s = {
      getLifecycleTopicIndex$: jest.fn(() => of(indexOf(DEEP))),
      getLifecycleTopicTree$: jest.fn(() => from(
        new Promise<LifecycleTreeResponse>(r => { resolveTree = r; }))),
      resolveLifecycleIssue$: jest.fn(),
    };
    const store = storeWith(s);
    await store.refresh();

    const p = store.resolveIssueNumber(30); // parked on root 2's fetch
    await store.selectRepo(1);              // dropMemo bumps resolveSeq
    resolveTree(treeOf(DEEP, 2));           // the old fetch resolves late
    await p;

    expect(store.issueResolution()).toBeNull();
    expect(store.resolvedNodeNumber()).toBeNull();
    expect(store.selectedTopicNumber()).toBeNull(); // repo switch clears selection
  });

  it('resolved issue hidden by the closed filter → honest note on resolved', async () => {
    const closedFixture: LifecycleTreeResponse = {
      ...resp([{
        name: 'A',
        topics: [
          node(2, { nodeType: 'topic' }, [
            node(20, { nodeType: 'thread' }, [node(30, { state: 'closed' })]),
          ]),
        ],
      }]),
      issueMap: { 30: 2 },
    };
    const s = svc(closedFixture);
    const store = storeWith(s);
    await store.refresh();

    await store.resolveIssueNumber(30);
    const r = store.issueResolution();
    expect(r?.phase).toBe('resolved');
    expect(r?.message).toContain('Show closed');
    expect(store.resolvedNodeNumber()).toBe(30); // still marked — the note explains the hide
  });

  it('retyping the already-resolved number is a no-op', async () => {
    const s = svc();
    const store = storeWith(s);
    await store.refresh();
    await store.resolveIssueNumber(30);
    const seq = store.resolveSeq();
    store.setQuery('30'); // same number, resolved → no reschedule
    expect(store.resolveSeq()).toBe(seq);
    expect(store.issueResolution()?.phase).toBe('resolved');
  });
});

describe('resolved-root visibility (#1696)', () => {

  it('single mode — the resolved root stays in the left pane despite the digit filter', async () => {
    const store = storeWith(svc());
    await store.refresh();
    await store.resolveIssueNumber(30);

    const vm = store.visibleTopics();
    expect(vm.mode).toBe('grouped');
    if (vm.mode !== 'grouped') return;
    const all = vm.sections.flatMap(s => s.topics.map(t => t.number));
    // Root 2 doesn't match '30' textually but must render — the landing
    // needs a visible selected row.
    expect(all).toContain(2);
    expect(store.selectedTopicNumber()).toBe(2);
  });

  it('all-topics mode — the resolved root\'s section renders the landing row', async () => {
    const store = storeWith(svc());
    await store.refresh();
    store.setShowAllTopics(true);
    await store.ensureTopic(2); // simulate the section fetched
    await store.resolveIssueNumber(30);

    const sections = store.allTopicsSections();
    const block = sections
      .flatMap(s => s.topics)
      .find(b => b.topic.number === 2);
    expect(block).toBeTruthy();
    expect(block!.status).toBe('ready');
    expect(block!.rows.map(r => r.node.number)).toContain(30);
  });

  it('a not-found resolution pulls no phantom root into the list', async () => {
    jest.useFakeTimers(); // setQuery schedules a debounce — keep it inert
    try {
      const noMap: LifecycleTreeResponse = { ...DEEP, issueMap: undefined };
      const s = {
        ...lazyStub(noMap),
        resolveLifecycleIssue$: jest.fn(() => throwError(() =>
          Object.assign(new Error('nope'), { code: 'functions/not-found' }))),
      };
      const store = storeWith(s);
      await store.refresh();
      store.setQuery('999'); // digit filter — no root matches
      await store.resolveIssueNumber(999);

      const vm = store.visibleTopics();
      const all = vm.mode === 'grouped'
        ? vm.sections.flatMap(x => x.topics.map(t => t.number))
        : vm.topics.map(t => t.number);
      expect(all).toEqual([]); // no phantom root pulled in for not-found
      expect(store.issueResolution()?.phase).toBe('not-found');
    } finally {
      jest.useRealTimers();
    }
  });
});

describe('resolution vs suppression (#1696)', () => {

  it('a resolution lifts suppressions that would hide its ancestors', async () => {
    const s = svc();
    const store = storeWith(s);
    await store.refresh();
    store.selectTopic(2);
    await store.ensureTopic(2);

    // Suppress ancestor 20 the way a user collapse of a match ancestor
    // records it — drive the real seam: query-match auto-expands, then
    // toggleExpanded records the suppression.
    store.setQuery('Issue 30');   // 30 matches → 20 auto-expands
    store.toggleExpanded(20);     // user collapse → suppression
    expect(store.suppressedIds()).toContain(20);

    await store.resolveIssueNumber(30);

    // Navigation intent wins — 20 is expanded again so the landing shows.
    expect(store.suppressedIds()).not.toContain(20);
    expect(store.effectiveExpandedIds().has(20)).toBe(true);
    expect(store.resolvedNodeNumber()).toBe(30);
  });
});

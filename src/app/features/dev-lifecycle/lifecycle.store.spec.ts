/**
 * LifecycleStore spec (task #642) — section assembly, closed filtering,
 * selection, expand/collapse, stale-response guard, error retention.
 */

jest.mock('@angular/fire/functions', () => ({
  Functions: class {},
  httpsCallable: jest.fn(),
}));

import { TestBed } from '@angular/core/testing';
import { firstValueFrom, of, Subject, throwError } from 'rxjs';

import { LifecycleStore } from './lifecycle.store';
import { DevLifecycleService } from './dev-lifecycle.service';
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

const resp = (sections: { name: string; topics: LifecycleNode[] }[]): LifecycleTreeResponse => ({
  sections, fetchedAt: '2026-09-28T12:00:00Z', truncatedNodes: 0,
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

function storeWith(service: Partial<DevLifecycleService>) {
  return TestBed.configureTestingModule({
    providers: [
      LifecycleStore,
      { provide: DevLifecycleService, useValue: service },
    ],
  }).inject(LifecycleStore);
}

describe('LifecycleStore', () => {
  beforeEach(() => TestBed.resetTestingModule());

  it('maps sections to view rows; closed filtered unless showClosed', async () => {
    const getLifecycleTree$ = jest.fn(() => of(FIXTURE));
    const store = storeWith({ getLifecycleTree$ });
    await store.refresh();

    let sections = store.topicSections();
    expect(sections.map(s => s.name)).toEqual(['A. Group', 'Ungrouped']);
    expect(sections[1].topics.map(t => t.number)).toEqual([2]); // #3 closed → hidden

    store.toggleShowClosed();
    sections = store.topicSections();
    expect(sections[1].topics.map(t => t.number)).toEqual([2, 3]);
    expect(sections[1].topics[1].closed).toBe(true);
  });

  it('emptied sections drop out of the list', async () => {
    const empty = resp([{ name: 'A', topics: [node(9, { state: 'closed' })] }]);
    const store = storeWith({ getLifecycleTree$: jest.fn(() => of(empty)) });
    await store.refresh();
    expect(store.topicSections()).toEqual([]);
    store.toggleShowClosed();
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
    expect(store.treeRows().map(r => r.node.number)).toEqual([2, 20]);
    store.toggleShowClosed();
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
});

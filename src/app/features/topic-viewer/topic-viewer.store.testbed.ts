/**
 * Shared TopicViewerStore spec helpers — fixtures, response-shape
 * adapters (index vs tree contract), the lazy-loading service stub, and
 * the TestBed store factory used by topic-viewer.store.spec.ts and
 * topic-viewer-deep-resolve.spec.ts.
 */

import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';

import { TopicViewerStore } from './topic-viewer.store';
import { TopicViewerService } from './topic-viewer.service';
import type {
  LifecycleNode,
  LifecycleTopicTreeRequest,
  LifecycleTreeResponse,
} from '@lifecycle/contracts';

export const node = (
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
export const resp = (
  groups: { name: string; topics: LifecycleNode[] }[],
): LifecycleTreeResponse => ({
  topics: groups.flatMap(s =>
    s.topics.map(t => ({ ...t, group: s.name }))),
  groupOrder: groups.map(s => s.name),
  fetchedAt: '2026-09-28T12:00:00Z',
});

/** Strip children off every root — the shape getLifecycleTopicIndex
 *  serves for a full-tree fixture (#1635 contract). */
export const indexOf = (
  res: LifecycleTreeResponse,
): LifecycleTreeResponse => ({
  ...res,
  topics: res.topics.map(t => ({ ...t, children: [] })),
});

/** One populated root — the shape getLifecycleTopicTree serves
 *  for the requested topicNumber (#1636 contract). */
export const treeOf = (
  res: LifecycleTreeResponse,
  topicNumber: number,
): LifecycleTreeResponse => ({
  topics: res.topics.filter(t => t.number === topicNumber),
  groupOrder: res.groupOrder,
  fetchedAt: res.fetchedAt,
});

/** The lazy-loading stub (#1637): index callable serves childless
 *  roots; the tree callable serves the fixture's populated root for
 *  the requested number — the same seam the real callables provide. */
export function lazyStub(res: LifecycleTreeResponse) {
  return {
    getLifecycleTopicIndex$: jest.fn(() => of(indexOf(res))),
    getLifecycleTopicTree$: jest.fn((req: LifecycleTopicTreeRequest) =>
      of(treeOf(res, req.topicNumber))),
  };
}

/** Deterministic microtask+queue drain — the all-topics pump's finally
 *  chain settles within one macrotask. */
export const flush = () => new Promise<void>(r => setTimeout(r, 0));

export function storeWith(service: Partial<TopicViewerService>) {
  return TestBed.configureTestingModule({
    providers: [
      TopicViewerStore,
      { provide: TopicViewerService, useValue: service },
    ],
  }).inject(TopicViewerStore);
}

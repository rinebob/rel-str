/**
 * Fixture-driven tests for the gh-lifecycle BFS fetch shell (task #639).
 * A fake Gql transport returns fixture pages — never mocks fetch internals.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  fetchLifecycleData,
  type Gql,
} from '../../../functions/src/gh-lifecycle/github-client';
import type { SupportedRepo } from '../../../functions/src/gh-lifecycle/config';

const REPO: SupportedRepo = { owner: 'rinebob', repo: 'rel-str', projectNumber: 1 };

/** A fixture issue as the GraphQL layer returns it. */
interface FxIssue {
  id: string;
  number: number;
  title: string;
  state: 'OPEN' | 'CLOSED';
  url: string;
  updatedAt: string;
  labels: { nodes: { name: string }[] };
  projectItems: { nodes: unknown[] };
  subIssues: {
    nodes: { number: number; id: string }[];
    totalCount: number;
    pageInfo: { hasNextPage: boolean; endCursor: string | null };
  };
}

interface Fx {
  roots: number[];
  issues: Map<number, FxIssue>;
  /** Extra subIssues pages a node reports before completing (numbers). */
  extraSubPages: Map<number, number[][]>;
  /** Nodes whose subpage query returns repository.issue === null. */
  missingSubpage: Set<number>;
  /** Search reports hasNextPage:true with a null endCursor (can't page). */
  searchStuck: boolean;
  searchPages: number; // how many search pages to spread roots over
  calls: string[];
}

function fxIssue(n: number, subs: number[] = [], extra: Partial<FxIssue> = {}): FxIssue {
  return {
    id: `I_${n}`,
    number: n,
    title: `Issue ${n}`,
    state: 'OPEN',
    url: `https://github.com/o/r/issues/${n}`,
    updatedAt: '2026-09-01T00:00:00Z',
    labels: { nodes: [] },
    projectItems: { nodes: [] },
    subIssues: {
      nodes: subs.map(s => ({ number: s, id: `I_${s}` })),
      totalCount: subs.length,
      pageInfo: { hasNextPage: false, endCursor: null },
    },
    ...extra,
  };
}

function fakeGql(fx: Fx): Gql {
  return async (query: string, variables?: Record<string, unknown>) => {
    const v = (variables ?? {}) as Record<string, unknown>;
    // Search (roots)
    if (typeof v.q === 'string') {
      const after = (v.after as string | null) ?? null;
      const perPage = Math.ceil(fx.roots.length / fx.searchPages) || fx.roots.length;
      const pageIdx = after ? Number(after) : 0;
      const slice = fx.roots.slice(pageIdx * perPage, (pageIdx + 1) * perPage);
      const more = (pageIdx + 1) * perPage < fx.roots.length;
      fx.calls.push('search');
      return {
        search: {
          issueCount: fx.roots.length,
          nodes: slice.map(n => ({ number: n, id: `I_${n}` })),
          pageInfo: fx.searchStuck
            ? { hasNextPage: true, endCursor: null }
            : { hasNextPage: more, endCursor: more ? String(pageIdx + 1) : null },
        },
      };
    }
    // Single-node subIssues pagination
    if (typeof v.issueNumber === 'number') {
      const n = v.issueNumber;
      if (fx.missingSubpage.has(n)) {
        fx.calls.push(`subpage:${n}`);
        return { repository: { issue: null } };
      }
      const pending = fx.extraSubPages.get(n) ?? [];
      const page = pending.shift() ?? [];
      fx.extraSubPages.set(n, pending);
      const issue = fx.issues.get(n)!;
      const count = issue.subIssues.totalCount + pending.flat().length + page.length;
      fx.calls.push(`subpage:${n}`);
      return {
        repository: {
          issue: {
            subIssues: {
              nodes: page.map(s => ({ number: s, id: `I_${s}` })),
              totalCount: count,
              pageInfo: { hasNextPage: pending.length > 0, endCursor: pending.length > 0 ? `c${pending.length}` : null },
            },
          },
        },
      };
    }
    // Batched nodes(ids)
    if (Array.isArray(v.ids)) {
      fx.calls.push(`nodes:${(v.ids as string[]).length}`);
      return {
        nodes: (v.ids as string[]).map(id =>
          [...fx.issues.values()].find(i => i.id === id) ?? null),
      };
    }
    throw new Error(`unhandled gql variables: ${JSON.stringify(v)}`);
  };
}

function fx(overrides: Partial<Fx> = {}): Fx {
  return {
    roots: [],
    issues: new Map(),
    extraSubPages: new Map(),
    missingSubpage: new Set(),
    searchStuck: false,
    searchPages: 1,
    calls: [],
    ...overrides,
  };
}

describe('fetchLifecycleData — roots', () => {
  it('paginates search past the first page', async () => {
    const f = fx({ roots: [1, 2, 3], searchPages: 2 });
    f.issues.set(1, fxIssue(1)); f.issues.set(2, fxIssue(2)); f.issues.set(3, fxIssue(3));
    const res = await fetchLifecycleData(REPO, fakeGql(f));
    assert.deepEqual(res.roots.map(r => r.number), [1, 2, 3]);
    assert.equal(f.calls.filter(c => c === 'search').length, 2);
  });

  it('empty repo → empty result, no batch calls', async () => {
    const res = await fetchLifecycleData(REPO, fakeGql(fx()));
    assert.deepEqual(res.roots, []);
    assert.equal(res.truncatedNodes, 0);
  });
});

describe('fetchLifecycleData — BFS', () => {
  it('builds childrenOf across levels, leaves carry empty lists', async () => {
    const f = fx({ roots: [1] });
    f.issues.set(1, fxIssue(1, [10]));
    f.issues.set(10, fxIssue(10, [20, 21]));
    f.issues.set(20, fxIssue(20)); f.issues.set(21, fxIssue(21));
    const res = await fetchLifecycleData(REPO, fakeGql(f));
    assert.deepEqual(res.childrenOf.get(1)!.map(c => c.number), [10]);
    assert.deepEqual(res.childrenOf.get(10)!.map(c => c.number), [20, 21]);
    assert.deepEqual(res.childrenOf.get(20), []);
    assert.equal(res.roots[0].title, 'Issue 1');
  });

  it('paginates a node\'s subIssues past the first page', async () => {
    const f = fx({ roots: [1] });
    f.issues.set(1, fxIssue(1, [2]));
    f.issues.set(2, fxIssue(2)); f.issues.set(3, fxIssue(3));
    f.extraSubPages.set(1, [[3]]);
    // First page lies that there is one more page of subIssues.
    f.issues.get(1)!.subIssues.pageInfo = { hasNextPage: true, endCursor: 'c1' };
    const res = await fetchLifecycleData(REPO, fakeGql(f));
    assert.deepEqual(res.childrenOf.get(1)!.map(c => c.number), [2, 3]);
    assert.ok(f.calls.includes('subpage:1'));
    assert.equal(res.truncatedNodes, 0);
  });

  it('counts truncation when totalCount exceeds what paging returns', async () => {
    const f = fx({ roots: [1] });
    f.issues.set(1, fxIssue(1, [2]));
    f.issues.set(2, fxIssue(2));
    f.issues.get(1)!.subIssues.totalCount = 1000; // reports far more than it ever pages
    const res = await fetchLifecycleData(REPO, fakeGql(f));
    assert.equal(res.truncatedNodes, 1);
  });

  it('expands a node appearing under two parents only once', async () => {
    const f = fx({ roots: [1, 2] });
    f.issues.set(1, fxIssue(1, [9]));
    f.issues.set(2, fxIssue(2, [9]));
    f.issues.set(9, fxIssue(9, [50]));
    f.issues.set(50, fxIssue(50));
    const res = await fetchLifecycleData(REPO, fakeGql(f));
    // Both parents list 9 as a child (buildTree dedups at render),
    // but 9's subtree is walked once.
    assert.deepEqual(res.childrenOf.get(9)!.map(c => c.number), [50]);
    const nineBatches = f.calls.filter(c => c === 'nodes:1');
    assert.equal(nineBatches.length, 2); // level0: nodes:2, level1: [9], level2: [50]
  });

  it('drops null nodes() slots (deleted/inaccessible issues) as truncated', async () => {
    const f = fx({ roots: [1] });
    f.issues.set(1, fxIssue(1, [9])); // 9 referenced but never fixture-fetched → null slot
    const res = await fetchLifecycleData(REPO, fakeGql(f));
    assert.deepEqual(res.childrenOf.get(1), []);
    assert.equal(res.truncatedNodes, 1);
  });

  it('counts search pagination that cannot advance (null endCursor)', async () => {
    const f = fx({ roots: [1], searchStuck: true });
    f.issues.set(1, fxIssue(1));
    const res = await fetchLifecycleData(REPO, fakeGql(f));
    assert.equal(res.truncatedNodes, 1);
  });

  it('drops null slots inside the subIssues connection (vanished child)', async () => {
    const f = fx({ roots: [1] });
    f.issues.set(1, fxIssue(1, [2]));
    f.issues.set(2, fxIssue(2));
    const conn = f.issues.get(1)!.subIssues;
    conn.nodes.push(null as unknown as { number: number; id: string });
    conn.totalCount = 2; // server says 2 children, one slot is null
    const res = await fetchLifecycleData(REPO, fakeGql(f));
    assert.deepEqual(res.childrenOf.get(1)!.map(c => c.number), [2]);
    assert.equal(res.truncatedNodes, 1);
  });

  it('treats a vanished mid-walk issue (null repository.issue) as truncated', async () => {
    const f = fx({ roots: [1] });
    f.issues.set(1, fxIssue(1, [2]));
    f.issues.set(2, fxIssue(2));
    f.issues.get(1)!.subIssues.pageInfo = { hasNextPage: true, endCursor: 'c1' };
    f.missingSubpage.add(1); // deleted between batch fetch and subpage query
    const res = await fetchLifecycleData(REPO, fakeGql(f));
    assert.equal(res.truncatedNodes, 1);
    assert.deepEqual(res.childrenOf.get(1)!.map(c => c.number), [2]);
  });

  it('batches levels into ceil(N/batchSize) nodes() queries', async () => {
    const f = fx({ roots: [1] });
    const many = Array.from({ length: 51 }, (_, i) => 100 + i);
    f.issues.set(1, fxIssue(1, many));
    for (const n of many) f.issues.set(n, fxIssue(n));
    const res = await fetchLifecycleData(REPO, fakeGql(f));
    assert.deepEqual(res.childrenOf.get(1)!.length, 51);
    const batchCalls = f.calls.filter(c => c.startsWith('nodes:'));
    // level0 = 1 node (1 call), level1 = 51 nodes (2 calls at batchSize 50)
    assert.deepEqual(batchCalls, ['nodes:1', 'nodes:50', 'nodes:1']);
  });
});

describe('fetchLifecycleData — status decode', () => {
  const withStatus = (n: number, statusName: string | null, projectNumber = 1) =>
    fxIssue(n, [], {
      projectItems: {
        nodes: [{
          project: { number: projectNumber },
          fieldValues: { nodes: statusName === null ? [] : [{ name: statusName, field: { name: 'Status' } }] },
        }],
      },
    });

  it('reads the Status field by name for the configured project', async () => {
    const f = fx({ roots: [1, 2] });
    f.issues.set(1, withStatus(1, 'IN PROGRESS'));
    f.issues.set(2, withStatus(2, 'NOT STARTED'));
    const res = await fetchLifecycleData(REPO, fakeGql(f));
    assert.equal(res.statusOf.get(1), 'IN PROGRESS');
    assert.equal(res.statusOf.get(2), 'NOT STARTED');
  });

  it('ignores items from other projects', async () => {
    const f = fx({ roots: [1] });
    f.issues.set(1, withStatus(1, 'IN PROGRESS', 99));
    const res = await fetchLifecycleData(REPO, fakeGql(f));
    assert.equal(res.statusOf.has(1), false);
  });

  it('unset Status → absent, never invented', async () => {
    const f = fx({ roots: [1] });
    f.issues.set(1, withStatus(1, null));
    const res = await fetchLifecycleData(REPO, fakeGql(f));
    assert.equal(res.statusOf.has(1), false);
  });

  it('repo without projectNumber skips the lookup entirely', async () => {
    const f = fx({ roots: [1] });
    f.issues.set(1, withStatus(1, 'IN PROGRESS'));
    const res = await fetchLifecycleData({ owner: 'o', repo: 'r' }, fakeGql(f));
    assert.equal(res.statusOf.size, 0);
  });
});

/**
 * Issue-number map + resolveIssue (#1695 / Blueprint #1694): deps-injected
 * handler tests + pure map transforms + the parent-chain fetch parser.
 * GitHub transport and Firestore are never invoked.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  handleGetLifecycleTopicIndex,
  handleGetLifecycleTopicTree,
  type GhLifecycleDeps,
} from '../../../functions/src/gh-lifecycle/callables';
import { handleResolveLifecycleIssue } from '../../../functions/src/gh-lifecycle/resolve-callable';
import {
  buildTreeIssueMap,
  mapDocId,
  readIssueMap,
  staleMapDeletions,
  syncIssueMapFromTree,
  upsertIssueMapEntries,
} from '../../../functions/src/gh-lifecycle/issue-map';
import { fetchIssueAncestorChain } from '../../../functions/src/gh-lifecycle/lifecycle-fetch';
import { GitHubApiError } from '../../../functions/src/gh-lifecycle/github-client';
import type { IssueAncestorChain } from '../../../functions/src/gh-lifecycle/lifecycle-fetch';
import type { LifecycleFetchResult } from '../../../functions/src/gh-lifecycle/lifecycle-fetch';
import type { LifecycleRawIssue } from '../../../shared/lifecycle-tree';
import type { SupportedRepo } from '../../../functions/src/gh-lifecycle/config';

const ENTRY: SupportedRepo = {
  owner: 'rinebob',
  repo: 'rel-str',
  projectNumber: 1,
};

const USER_REQ = <T>(data: unknown): T =>
  ({ data, auth: { uid: 'u1' } }) as unknown as T;

const raw = (n: number, title = `Issue ${n}`): LifecycleRawIssue => ({
  number: n,
  title,
  state: 'OPEN',
  url: `https://github.com/rinebob/rel-str/issues/${n}`,
  labels: [],
  updatedAt: '2026-11-23T00:00:00Z',
});

function code(err: unknown): string {
  return (err as { code?: string })?.code ?? `non-https: ${err}`;
}

// ── pure transforms ────────────────────────────────────────────────────────

describe('buildTreeIssueMap — childrenOf inversion', () => {
  const tree: LifecycleFetchResult = {
    roots: [raw(619, 'Topic: UI')],
    childrenOf: new Map([
      [619, [raw(1609), raw(621)]],
      [1609, [raw(1694)]],
      [621, []],
      [1694, [raw(1695)]],
      [1695, []],
    ]),
    statusOf: new Map(),
    truncatedNodes: 0,
  };

  it('maps every node — roots included — to its topic root', () => {
    const map = buildTreeIssueMap(tree);
    assert.deepEqual(map, { 619: 619, 1609: 619, 621: 619, 1694: 619, 1695: 619 });
  });

  it('empty roots → empty map', () => {
    assert.deepEqual(buildTreeIssueMap({ ...tree, roots: [] }), {});
  });
});

describe('staleMapDeletions — reparent cleanup', () => {
  it('deletes entries that point at this root but are absent from the fetched tree', () => {
    // Map says 1697 lives under 619, but 619's fetched tree no longer
    // contains it (reparented to another topic or deleted from the tree).
    const stored = { 619: 619, 1609: 619, 1697: 619, 500: 553 };
    const live = new Set([619, 1609]);
    assert.deepEqual(staleMapDeletions(stored, live, 619), [1697]);
  });

  it('never touches entries pointing at other roots', () => {
    const stored = { 500: 553, 501: 553 };
    assert.deepEqual(staleMapDeletions(stored, new Set([619]), 619), []);
  });

  it('the root itself is never deleted', () => {
    assert.deepEqual(staleMapDeletions({ 619: 619 }, new Set([619]), 619), []);
  });
});

describe('mapDocId', () => {
  it('keys the doc by owner-repo', () => {
    assert.equal(mapDocId(ENTRY), 'rinebob-rel-str');
  });
});

// ── deps + handler seams ───────────────────────────────────────────────────

function deps(overrides: Partial<GhLifecycleDeps> = {}): GhLifecycleDeps {
  const tree: LifecycleFetchResult = {
    roots: [raw(619, 'Topic: GitHub read-only issue UI')],
    childrenOf: new Map([
      [619, [raw(1609, 'Thread: perf')]],
      [1609, []],
    ]),
    statusOf: new Map([[619, 'IN PROGRESS']]),
    truncatedNodes: 0,
  };
  const chain: IssueAncestorChain = {
    issue: raw(1696, 'FE-IMPL: digit-query'),
    ancestors: [raw(1694), raw(1609), raw(619, 'Topic: GitHub read-only issue UI')],
  };
  return {
    fetchData: async () => tree,
    fetchIndexData: async () => ({
      roots: tree.roots,
      childrenOf: new Map(),
      statusOf: tree.statusOf,
      truncatedNodes: 0,
    }),
    fetchTopicRef: async (_e, n) =>
      n === 619 ? { number: 619, id: 'I_619', title: 'Topic: GitHub read-only issue UI' } : null,
    fetchSubtreeData: async () => tree,
    readIssueMap: async () => ({ 1609: 619 }),
    syncIssueMapFromTree: async () => undefined,
    upsertIssueMapEntries: async () => undefined,
    fetchIssueChain: async () => chain,
    ...overrides,
  };
}

describe('getLifecycleTopicIndex — issueMap emit', () => {
  const REQ = { owner: 'rinebob', repo: 'rel-str' };

  it('emits readIssueMap on the index response', async () => {
    const res = await handleGetLifecycleTopicIndex(
      USER_REQ(REQ), deps({ readIssueMap: async () => ({ 1695: 619, 1609: 619 }) }));
    assert.deepEqual(res.issueMap, { 1695: 619, 1609: 619 });
  });

  it('omits issueMap when the map doc is missing/empty', async () => {
    const res = await handleGetLifecycleTopicIndex(
      USER_REQ(REQ), deps({ readIssueMap: async () => ({}) }));
    assert.equal(res.issueMap, undefined);
  });

  it('a map-read failure degrades to omit — the index still returns topics', async () => {
    const res = await handleGetLifecycleTopicIndex(
      USER_REQ(REQ), deps({ readIssueMap: async () => { throw new Error('firestore down'); } }));
    assert.equal(res.issueMap, undefined);
    assert.equal(res.topics[0].number, 619);
  });
});

describe('getLifecycleTopicTree — map maintenance', () => {
  const REQ = { owner: 'rinebob', repo: 'rel-str', topicNumber: 619 };

  it('syncs the fetched subtree into the map after a successful response', async () => {
    let synced: LifecycleFetchResult | undefined;
    const res = await handleGetLifecycleTopicTree(
      USER_REQ(REQ),
      deps({ syncIssueMapFromTree: async (_e, data) => { synced = data; } }),
    );
    assert.equal(res.topics[0].number, 619);
    assert.equal(synced?.roots[0].number, 619);
    assert.deepEqual(buildTreeIssueMap(synced!), { 619: 619, 1609: 619 });
  });

  it('a sync failure never fails the tree response', async () => {
    const res = await handleGetLifecycleTopicTree(
      USER_REQ(REQ),
      deps({ syncIssueMapFromTree: async () => { throw new Error('firestore down'); } }),
    );
    assert.equal(res.topics[0].number, 619);
  });

  it('a truncated fetch never reaches the map — missing nodes would look stale', async () => {
    let syncCalled = false;
    const truncated: LifecycleFetchResult = {
      roots: [raw(619, 'Topic: GitHub read-only issue UI')],
      childrenOf: new Map([[619, [raw(1609)]]]),
      statusOf: new Map(),
      truncatedNodes: 2,
    };
    const err = await handleGetLifecycleTopicTree(
      USER_REQ(REQ),
      deps({
        fetchSubtreeData: async () => truncated,
        syncIssueMapFromTree: async () => { syncCalled = true; },
      }),
    ).catch(e => e);
    assert.equal(code(err), 'internal');
    assert.equal(syncCalled, false);
  });
});

describe('resolveLifecycleIssue — chain resolution', () => {
  const REQ = { owner: 'rinebob', repo: 'rel-str', issueNumber: 1696 };

  it('unauthenticated → unauthenticated', async () => {
    const err = await handleResolveLifecycleIssue(
      { data: REQ, auth: undefined } as any, deps()).catch(e => e);
    assert.equal(code(err), 'unauthenticated');
  });

  it('missing/non-positive/non-safe issueNumber → invalid-argument', async () => {
    for (const data of [
      { owner: 'rinebob', repo: 'rel-str' },
      { ...REQ, issueNumber: 'x' },
      { ...REQ, issueNumber: 0 },
      { ...REQ, issueNumber: -3 },
      { ...REQ, issueNumber: 1.5 },
      { ...REQ, issueNumber: 3_000_000_000 },
      null, undefined,
    ]) {
      const err = await handleResolveLifecycleIssue(USER_REQ(data), deps()).catch(e => e);
      assert.equal(code(err), 'invalid-argument', `data=${JSON.stringify(data)}`);
    }
  });

  it('unknown issue → not-found', async () => {
    const err = await handleResolveLifecycleIssue(
      USER_REQ({ ...REQ, issueNumber: 999999 }),
      deps({ fetchIssueChain: async () => null }),
    ).catch(e => e);
    assert.equal(code(err), 'not-found');
  });

  it('resolves a deep issue to its Topic root with the full path root→issue', async () => {
    let upserted: Record<number, number> | undefined;
    const res = await handleResolveLifecycleIssue(
      USER_REQ(REQ),
      deps({ upsertIssueMapEntries: async (_e, entries) => { upserted = entries; } }),
    );
    assert.equal(res.issue.number, 1696);
    assert.deepEqual(res.path, [619, 1609, 1694, 1696]);
    assert.deepEqual(upserted, { 619: 619, 1609: 619, 1694: 619, 1696: 619 });
  });

  it('issue with no parent → no path (not in any lifecycle tree)', async () => {
    const res = await handleResolveLifecycleIssue(
      USER_REQ(REQ),
      deps({ fetchIssueChain: async () => ({ issue: raw(42), ancestors: [] }) }),
    );
    assert.equal(res.issue.number, 42);
    assert.equal(res.path, undefined);
  });

  it('a Topic root resolves to itself — the map self-maps roots', async () => {
    let upserted: Record<number, number> | undefined;
    const res = await handleResolveLifecycleIssue(
      USER_REQ({ ...REQ, issueNumber: 700 }),
      deps({
        fetchIssueChain: async () => ({ issue: raw(700, 'Topic: New area'), ancestors: [] }),
        upsertIssueMapEntries: async (_e, entries) => { upserted = entries; },
      }),
    );
    assert.equal(res.issue.number, 700);
    assert.deepEqual(res.path, [700]);
    assert.deepEqual(upserted, { 700: 700 });
  });

  it('top ancestor that is not a Topic root → no path', async () => {
    const res = await handleResolveLifecycleIssue(
      USER_REQ(REQ),
      deps({ fetchIssueChain: async () => ({ issue: raw(7), ancestors: [raw(8, 'Just an issue')] }) }),
    );
    assert.equal(res.path, undefined);
  });

  it('GitHub transport error → mapped error', async () => {
    const err = await handleResolveLifecycleIssue(
      USER_REQ(REQ),
      deps({ fetchIssueChain: async () => { throw new GitHubApiError(429, true, 'rate limited'); } }),
    ).catch(e => e);
    assert.equal(code(err), 'resource-exhausted');
  });

  it('map upsert failure never fails the resolution', async () => {
    const res = await handleResolveLifecycleIssue(
      USER_REQ(REQ),
      deps({ upsertIssueMapEntries: async () => { throw new Error('firestore down'); } }),
    );
    assert.deepEqual(res.path, [619, 1609, 1694, 1696]);
  });
});

// ── fetchIssueAncestorChain — GraphQL parse/edge behavior ──────────────────

describe('fetchIssueAncestorChain — gql layer', () => {
  const chainGql = (issue: unknown) => async () =>
    ({ repository: { issue } }) as Record<string, any>;

  it('parses the nested parent chain into issue + ordered ancestors', async () => {
    const issue = {
      number: 1696, id: 'I1696', title: 'FE task', state: 'OPEN',
      url: 'u', updatedAt: 't', labels: { nodes: [] }, projectItems: { nodes: [] },
      parent: {
        number: 1694, id: 'I1694', title: 'Blueprint',
        parent: {
          number: 1609, id: 'I1609', title: 'Thread: perf',
          parent: { number: 619, id: 'I619', title: 'Topic: UI', parent: null },
        },
      },
    };
    const chain = await fetchIssueAncestorChain(ENTRY, 1696, chainGql(issue));
    assert.equal(chain?.issue.number, 1696);
    assert.equal(chain?.issue.title, 'FE task');
    assert.deepEqual(chain?.ancestors.map(a => a.number), [1694, 1609, 619]);
  });

  it('NOT_FOUND error → null; other errors propagate', async () => {
    const notFound = async () => { throw new GitHubApiError(200, false, 'nf', 'NOT_FOUND'); };
    assert.equal(await fetchIssueAncestorChain(ENTRY, 9, notFound), null);
    const boom = async () => { throw new GitHubApiError(500, false, 'server'); };
    await assert.rejects(fetchIssueAncestorChain(ENTRY, 9, boom));
  });

  it('null issue → null', async () => {
    assert.equal(await fetchIssueAncestorChain(ENTRY, 9, chainGql(null)), null);
  });
});

// ── real Firestore helpers against a structural fake ─────────────────────
// The dep-seam specs above can't pin the document shape — the dotted-key
// bug escaped them once already. A structural fake captures the actual
// set() args so merge/nesting/sentinels are asserted directly. `Db` is
// derived from the function signature so the spec never imports
// firebase-admin (not installed at the repo root for tsx).

type Db = Parameters<typeof readIssueMap>[0];

function fakeDb(storedEntries: Record<string, unknown> = {}) {
  const writes: { data: Record<string, unknown>; opts: { merge?: boolean } }[] = [];
  const doc = {
    get: async () => ({ data: () => ({ entries: storedEntries }) }),
    set: async (data: Record<string, unknown>, opts: { merge?: boolean }) => {
      writes.push({ data, opts });
    },
  };
  const db = {
    collection: () => ({ doc: () => doc }),
    runTransaction: async (
      fn: (t: {
        get: (ref: unknown) => ReturnType<typeof doc.get>;
        set: (ref: unknown, data: Record<string, unknown>, opts: { merge?: boolean }) => Promise<void>;
      }) => Promise<void>,
    ) => fn({ get: () => doc.get(), set: (_r, data, opts) => doc.set(data, opts) }),
  };
  return { db: db as unknown as Db, writes };
}

// firebase-admin FieldValue sentinels are named transform classes
// (DeleteTransform / ServerTimestampTransform) — asserted structurally
// since FieldValue can't be imported here.
const isDeleteSentinel = (v: unknown): boolean =>
  (v as object | null)?.constructor?.name === 'DeleteTransform';

describe('syncIssueMapFromTree — real write shape', () => {
  const tree: LifecycleFetchResult = {
    roots: [raw(619, 'Topic: UI')],
    childrenOf: new Map([[619, [raw(1609)]], [1609, []]]),
    statusOf: new Map(),
    truncatedNodes: 0,
  };

  it('upserts nested entries under set(merge) and deletes stale entries via sentinel', async () => {
    const { db, writes } = fakeDb({ '1697': 619, '500': 553 });
    await syncIssueMapFromTree(db, ENTRY, tree);
    assert.equal(writes.length, 1);
    assert.equal(writes[0].opts.merge, true);
    const entries = writes[0].data.entries as Record<string, unknown>;
    assert.equal(entries['619'], 619);
    assert.equal(entries['1609'], 619);
    assert.ok(isDeleteSentinel(entries['1697']), 'stale entry must be a FieldValue.delete()');
    assert.equal(entries['500'], undefined, 'other roots untouched');
    assert.ok('updatedAt' in writes[0].data);
  });

  it('skips the write entirely when the stored map already agrees', async () => {
    const { db, writes } = fakeDb({ '619': 619, '1609': 619 });
    await syncIssueMapFromTree(db, ENTRY, tree);
    assert.equal(writes.length, 0);
  });
});

describe('upsertIssueMapEntries — real write shape', () => {
  it('writes a nested entries object under set(merge)', async () => {
    const { db, writes } = fakeDb();
    await upsertIssueMapEntries(db, ENTRY, { 1696: 619, 619: 619 });
    assert.equal(writes.length, 1);
    assert.equal(writes[0].opts.merge, true);
    assert.deepEqual(writes[0].data.entries, { '1696': 619, '619': 619 });
    assert.ok('updatedAt' in writes[0].data);
  });

  it('no-ops on an empty entries object', async () => {
    const { db, writes } = fakeDb();
    await upsertIssueMapEntries(db, ENTRY, {});
    assert.equal(writes.length, 0);
  });
});

describe('readIssueMap — coercion', () => {
  it('drops malformed keys and non-number values', async () => {
    const { db } = fakeDb({ '1609': 619, 'bad': 'x', '1.5': 7, '1694': 619 });
    assert.deepEqual(await readIssueMap(db, ENTRY), { 1609: 619, 1694: 619 });
  });
});

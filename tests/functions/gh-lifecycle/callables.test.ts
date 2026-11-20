/**
 * Deps-injected handler tests for the getLifecycleTree callable (task #640).
 * Deps supply fixture fetch results; GitHub transport is never invoked.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  handleGetLifecycleTree,
  handleGetLifecycleTopicIndex,
  handleGetLifecycleTopicTree,
  type GhLifecycleDeps,
} from '../../../functions/src/gh-lifecycle/callables';
import { GitHubApiError } from '../../../functions/src/gh-lifecycle/github-client';
import type { LifecycleFetchResult } from '../../../functions/src/gh-lifecycle/lifecycle-fetch';
import type { LifecycleRawIssue } from '../../../shared/lifecycle-tree';

// `firebase-functions` isn't resolvable from tests/ — the generic
// infers the handler's CallableRequest type at the call site.
const USER_REQ = <T>(data: unknown): T =>
  ({ data, auth: { uid: 'u1' } }) as unknown as T;

const raw = (n: number, title = `Issue ${n}`): LifecycleRawIssue => ({
  number: n, title, state: 'OPEN',
  url: `https://github.com/rinebob/rel-str/issues/${n}`,
  labels: [], updatedAt: '2026-09-28T00:00:00Z',
});

function deps(overrides: Partial<GhLifecycleDeps> = {}): GhLifecycleDeps {
  const tree: LifecycleFetchResult = {
    roots: [raw(619, 'Topic: GitHub read-only issue UI')],
    childrenOf: new Map([[619, [raw(621, 'Thread: Lifecycle viewer')]], [621, []]]),
    statusOf: new Map([[619, 'IN PROGRESS']]),
    truncatedNodes: 0,
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
    fetchInventoryDoc: async () => null,
    ...overrides,
  };
}

// HttpsError.code is the FunctionsErrorCode string ('unauthenticated', …).
// Read the property instead of importing firebase-functions — the test
// file resolves node_modules from the repo root where it isn't installed.
function code(err: unknown): string {
  const c = (err as { code?: string })?.code;
  return c ?? `non-https: ${err}`;
}

describe('handleGetLifecycleTree — validation', () => {
  it('unauthenticated → unauthenticated', async () => {
    const err = await handleGetLifecycleTree({ data: { owner: 'a', repo: 'b' }, auth: undefined } as any, deps()).catch(e => e);
    assert.equal(code(err), 'unauthenticated');
  });

  it('missing/malformed fields → invalid-argument', async () => {
    for (const data of [
      { owner: 'rinebob' },           // missing repo
      { repo: 'rel-str' },            // missing owner
      { owner: 1, repo: 'rel-str' },  // non-string
      null, undefined,                // no data object
    ]) {
      const err = await handleGetLifecycleTree(USER_REQ(data), deps()).catch(e => e);
      assert.equal(code(err), 'invalid-argument', `data=${JSON.stringify(data)}`);
    }
  });

  it('unsupported repo → invalid-argument naming the pair', async () => {
    const err = await handleGetLifecycleTree(USER_REQ({ owner: 'x', repo: 'y' }), deps()).catch(e => e);
    assert.equal(code(err), 'invalid-argument');
    assert.match(err.message, /x\/y/);
  });
});

describe('handleGetLifecycleTree — happy path', () => {
  it('returns flat topics + groupOrder + fetchedAt', async () => {
    const res = await handleGetLifecycleTree(
      USER_REQ({ owner: 'rinebob', repo: 'rel-str' }), deps());
    assert.equal(res.topics.length, 1);
    const topic = res.topics[0];
    assert.equal(topic.nodeType, 'topic');
    assert.equal(topic.number, 619);
    assert.equal(topic.group, 'Ungrouped');
    assert.deepEqual(res.groupOrder, []);
    assert.equal(topic.children[0].number, 621);
    assert.equal(topic.children[0].nodeType, 'thread');
    assert.equal(topic.status, 'IN PROGRESS');
    assert.match(res.fetchedAt, /^\d{4}-\d{2}-\d{2}T/);
    assert.equal(res.groupingWarning, undefined);
  });

  it('stamps the inventory group + doc-order groupOrder when the doc parses', async () => {
    const md = `## Open Topics\n\n### A. Named Group\n\n- **[#619 - x](https://github.com/rinebob/rel-str/issues/619)** — note\n\n## Closed Topics\n`;
    const res = await handleGetLifecycleTree(
      USER_REQ({ owner: 'rinebob', repo: 'rel-str' }),
      deps({ fetchInventoryDoc: async () => md }));
    assert.equal(res.topics[0].group, 'A. Named Group');
    assert.deepEqual(res.groupOrder, ['A. Named Group']);
  });
});

describe('handleGetLifecycleTree — truncation and grouping failures', () => {
  it('truncatedNodes > 0 → internal with the count', async () => {
    const err = await handleGetLifecycleTree(
      USER_REQ({ owner: 'rinebob', repo: 'rel-str' }),
      deps({
        fetchData: async () => ({
          roots: [raw(619, 'Topic: x')], childrenOf: new Map(),
          statusOf: new Map(), truncatedNodes: 3,
        }),
      })).catch(e => e);
    assert.equal(code(err), 'internal');
    assert.match(err.message, /3/);
  });

  it('inventory doc 404 (null) → all Ungrouped, no warning', async () => {
    const res = await handleGetLifecycleTree(
      USER_REQ({ owner: 'rinebob', repo: 'rel-str' }),
      deps({ fetchInventoryDoc: async () => null }));
    assert.equal(res.topics[0].group, 'Ungrouped');
    assert.deepEqual(res.groupOrder, []);
    assert.equal(res.groupingWarning, undefined);
  });

  it('inventory doc error → groupingWarning set, tree still returns', async () => {
    const res = await handleGetLifecycleTree(
      USER_REQ({ owner: 'rinebob', repo: 'rel-str' }),
      deps({ fetchInventoryDoc: async () => { throw new GitHubApiError(500, false, 'GitHub 500: raw-body-blob'); } }));
    assert.equal(res.topics[0].group, 'Ungrouped');
    // Sanitized — the raw upstream body never reaches the client payload.
    assert.match(res.groupingWarning!, /GitHub 500/);
    assert.ok(!res.groupingWarning!.includes('raw-body-blob'));
  });

  it('inventory doc parsing to zero groups → groupingWarning', async () => {
    const res = await handleGetLifecycleTree(
      USER_REQ({ owner: 'rinebob', repo: 'rel-str' }),
      deps({ fetchInventoryDoc: async () => '# nothing parseable' }));
    assert.match(res.groupingWarning!, /zero|no groups|ungrouped/i);
  });

  it('doc parses but lists no fetched topics → stale-doc groupingWarning', async () => {
    const md = `## Open Topics\n\n### A. Named Group\n\n- **[#9999 - x](https://github.com/rinebob/rel-str/issues/9999)** — note\n\n## Closed Topics\n`;
    const res = await handleGetLifecycleTree(
      USER_REQ({ owner: 'rinebob', repo: 'rel-str' }),
      deps({ fetchInventoryDoc: async () => md }));
    assert.equal(res.topics[0].group, 'Ungrouped');
    assert.match(res.groupingWarning!, /stale/);
  });
});

describe('handleGetLifecycleTree — error mapping', () => {
  const failing = (err: unknown) => deps({
    fetchData: async () => { throw err; },
  });

  it('401 → unauthenticated with token hint', async () => {
    const err = await handleGetLifecycleTree(
      USER_REQ({ owner: 'rinebob', repo: 'rel-str' }),
      failing(new GitHubApiError(401, false, 'Bad credentials'))).catch(e => e);
    assert.equal(code(err), 'unauthenticated');
    assert.match(err.message, /token|GITHUB_READ_TOKEN/i);
  });

  it('403 → permission-denied', async () => {
    const err = await handleGetLifecycleTree(
      USER_REQ({ owner: 'rinebob', repo: 'rel-str' }),
      failing(new GitHubApiError(403, false, 'Forbidden'))).catch(e => e);
    assert.equal(code(err), 'permission-denied');
  });

  it('rate-limited → resource-exhausted', async () => {
    const err = await handleGetLifecycleTree(
      USER_REQ({ owner: 'rinebob', repo: 'rel-str' }),
      failing(new GitHubApiError(429, true, 'rate limit'))).catch(e => e);
    assert.equal(code(err), 'resource-exhausted');
  });

  it('unknown error → internal', async () => {
    const err = await handleGetLifecycleTree(
      USER_REQ({ owner: 'rinebob', repo: 'rel-str' }),
      failing(new Error('wat'))).catch(e => e);
    assert.equal(code(err), 'internal');
  });

  it('missing GITHUB_READ_TOKEN → failed-precondition naming the secret', async () => {
    const saved = process.env.GITHUB_READ_TOKEN;
    delete process.env.GITHUB_READ_TOKEN;
    try {
      const { ghLifecycleDeps } = await import('../../../functions/src/gh-lifecycle/callables');
      const err = await Promise.resolve().then(() => ghLifecycleDeps()).catch(e => e);
      assert.equal(code(err), 'failed-precondition');
      assert.match(err.message, /GITHUB_READ_TOKEN/);
    } finally {
      if (saved !== undefined) process.env.GITHUB_READ_TOKEN = saved;
    }
  });
});

describe('handleGetLifecycleTopicIndex — validation (#1635)', () => {
  it('unauthenticated → unauthenticated', async () => {
    const err = await handleGetLifecycleTopicIndex({ data: { owner: 'a', repo: 'b' }, auth: undefined } as any, deps()).catch(e => e);
    assert.equal(code(err), 'unauthenticated');
  });

  it('missing/malformed fields → invalid-argument', async () => {
    for (const data of [
      { owner: 'rinebob' },
      { repo: 'rel-str' },
      { owner: 1, repo: 'rel-str' },
      null, undefined,
    ]) {
      const err = await handleGetLifecycleTopicIndex(USER_REQ(data), deps()).catch(e => e);
      assert.equal(code(err), 'invalid-argument', `data=${JSON.stringify(data)}`);
    }
  });

  it('unsupported repo → invalid-argument naming the pair', async () => {
    const err = await handleGetLifecycleTopicIndex(USER_REQ({ owner: 'x', repo: 'y' }), deps()).catch(e => e);
    assert.equal(code(err), 'invalid-argument');
    assert.match(err.message, /x\/y/);
  });
});

describe('handleGetLifecycleTopicIndex — index semantics (#1635)', () => {
  it('returns topic roots with children: [] — no subtree expansion', async () => {
    // The dep's index result has an empty childrenOf even though the
    // underlying issue has sub-issues — buildTree must yield [].
    const res = await handleGetLifecycleTopicIndex(
      USER_REQ({ owner: 'rinebob', repo: 'rel-str' }), deps());
    assert.equal(res.topics.length, 1);
    assert.equal(res.topics[0].number, 619);
    assert.equal(res.topics[0].nodeType, 'topic');
    assert.deepEqual(res.topics[0].children, []);
    assert.equal(res.topics[0].status, 'IN PROGRESS');
    assert.match(res.fetchedAt, /^\d{4}-\d{2}-\d{2}T/);
  });

  it('calls fetchIndexData, never fetchData', async () => {
    const res = await handleGetLifecycleTopicIndex(
      USER_REQ({ owner: 'rinebob', repo: 'rel-str' }),
      deps({ fetchData: async () => { throw new Error('must not be called'); } }));
    assert.equal(res.topics.length, 1);
  });

  it('grouping parity: inventory doc stamps group + groupOrder', async () => {
    const md = `## Open Topics\n\n### A. Named Group\n\n- **[#619 - x](https://github.com/rinebob/rel-str/issues/619)** — note\n\n## Closed Topics\n`;
    const res = await handleGetLifecycleTopicIndex(
      USER_REQ({ owner: 'rinebob', repo: 'rel-str' }),
      deps({ fetchInventoryDoc: async () => md }));
    assert.equal(res.topics[0].group, 'A. Named Group');
    assert.deepEqual(res.groupOrder, ['A. Named Group']);
    assert.equal(res.groupingWarning, undefined);
  });

  it('grouping parity: inventory doc groups + stale-doc warning apply', async () => {
    const md = `## Open Topics\n\n### A. Named Group\n\n- **[#9999 - x](https://github.com/rinebob/rel-str/issues/9999)** — note\n\n## Closed Topics\n`;
    const res = await handleGetLifecycleTopicIndex(
      USER_REQ({ owner: 'rinebob', repo: 'rel-str' }),
      deps({ fetchInventoryDoc: async () => md }));
    assert.equal(res.topics[0].group, 'Ungrouped');
    assert.match(res.groupingWarning!, /stale/);
  });

  it('truncatedNodes > 0 → internal with the count', async () => {
    const err = await handleGetLifecycleTopicIndex(
      USER_REQ({ owner: 'rinebob', repo: 'rel-str' }),
      deps({
        fetchIndexData: async () => ({
          roots: [raw(619, 'Topic: x')], childrenOf: new Map(),
          statusOf: new Map(), truncatedNodes: 2,
        }),
      })).catch(e => e);
    assert.equal(code(err), 'internal');
    assert.match(err.message, /2/);
  });

  it('rate-limited fetch → resource-exhausted', async () => {
    const err = await handleGetLifecycleTopicIndex(
      USER_REQ({ owner: 'rinebob', repo: 'rel-str' }),
      deps({ fetchIndexData: async () => { throw new GitHubApiError(429, true, 'rate limit'); } })).catch(e => e);
    assert.equal(code(err), 'resource-exhausted');
  });
});

describe('handleGetLifecycleTopicTree — per-topic subtree (#1636)', () => {
  const TOPIC_REQ = { owner: 'rinebob', repo: 'rel-str', topicNumber: 619 };

  it('unauthenticated → unauthenticated', async () => {
    const err = await handleGetLifecycleTopicTree({ data: TOPIC_REQ, auth: undefined } as any, deps()).catch(e => e);
    assert.equal(code(err), 'unauthenticated');
  });

  it('missing/malformed topicNumber → invalid-argument', async () => {
    for (const data of [
      { owner: 'rinebob', repo: 'rel-str' },                        // absent
      { ...TOPIC_REQ, topicNumber: '619' },                          // string
      { ...TOPIC_REQ, topicNumber: 619.5 },                          // non-integer
      { ...TOPIC_REQ, topicNumber: 0 }, { ...TOPIC_REQ, topicNumber: -3 }, // non-positive
      { ...TOPIC_REQ, topicNumber: Number.NaN },
      { ...TOPIC_REQ, topicNumber: 2_147_483_648 }, // past GraphQL Int32

    ]) {
      const err = await handleGetLifecycleTopicTree(USER_REQ(data), deps()).catch(e => e);
      assert.equal(code(err), 'invalid-argument', `data=${JSON.stringify(data)}`);
    }
  });

  it('unsupported repo → invalid-argument before any fetch', async () => {
    const err = await handleGetLifecycleTopicTree(
      USER_REQ({ owner: 'x', repo: 'y', topicNumber: 619 }),
      deps({ fetchTopicRef: async () => { throw new Error('must not be called'); } })).catch(e => e);
    assert.equal(code(err), 'invalid-argument');
  });

  it('unknown topicNumber → not-found', async () => {
    const err = await handleGetLifecycleTopicTree(
      USER_REQ({ ...TOPIC_REQ, topicNumber: 9999 }), deps()).catch(e => e);
    assert.equal(code(err), 'not-found');
    assert.match(err.message, /9999/);
  });

  it('a non-Topic: issue → invalid-argument naming the number', async () => {
    const err = await handleGetLifecycleTopicTree(
      USER_REQ({ ...TOPIC_REQ, topicNumber: 697 }),
      deps({ fetchTopicRef: async () => ({ number: 697, id: 'I_697', title: 'Thread: not a root' }) })).catch(e => e);
    assert.equal(code(err), 'invalid-argument');
    assert.match(err.message, /697/);
  });

  it('happy path — one fully-populated topic through the shared pipeline', async () => {
    const res = await handleGetLifecycleTopicTree(USER_REQ(TOPIC_REQ), deps());
    assert.equal(res.topics.length, 1);
    assert.equal(res.topics[0].number, 619);
    assert.equal(res.topics[0].children[0].number, 621); // subtree actually walked
    assert.equal(res.topics[0].status, 'IN PROGRESS');
    assert.match(res.fetchedAt, /^\d{4}-\d{2}-\d{2}T/);
  });

  it('probes the exact requested number, fetches the returned ref', async () => {
    let probed = 0; let fetchedId = '';
    await handleGetLifecycleTopicTree(
      USER_REQ(TOPIC_REQ),
      deps({
        fetchTopicRef: async (_e, n) => { probed = n; return { number: n, id: 'I_619', title: 'Topic: x' }; },
        fetchSubtreeData: async (_e, root) => { fetchedId = root.id; return { roots: [], childrenOf: new Map(), statusOf: new Map(), truncatedNodes: 0 }; },
      }));
    assert.equal(probed, 619);
    assert.equal(fetchedId, 'I_619');
  });

  it('subtree truncation → internal with the count', async () => {
    const err = await handleGetLifecycleTopicTree(
      USER_REQ(TOPIC_REQ),
      deps({ fetchSubtreeData: async () => ({ roots: [], childrenOf: new Map(), statusOf: new Map(), truncatedNodes: 2 }) })).catch(e => e);
    assert.equal(code(err), 'internal');
    assert.match(err.message, /2/);
  });

  it('probe transport failure → mapped GitHub error', async () => {
    const err = await handleGetLifecycleTopicTree(
      USER_REQ(TOPIC_REQ),
      deps({ fetchTopicRef: async () => { throw new GitHubApiError(429, true, 'rate limit'); } })).catch(e => e);
    assert.equal(code(err), 'resource-exhausted');
  });

  it('calls fetchSubtreeData — never fetchData or fetchIndexData', async () => {
    const res = await handleGetLifecycleTopicTree(
      USER_REQ(TOPIC_REQ),
      deps({
        fetchData: async () => { throw new Error('monolith must not be called'); },
        fetchIndexData: async () => { throw new Error('index must not be called'); },
      }));
    assert.equal(res.topics.length, 1);
  });
});

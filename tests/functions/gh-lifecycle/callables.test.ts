/**
 * Deps-injected handler tests for the getLifecycleTree callable (task #640).
 * Deps supply fixture fetch results; GitHub transport is never invoked.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  handleGetLifecycleTree,
  type GhLifecycleDeps,
} from '../../../functions/src/gh-lifecycle/callables';
import { GitHubApiError, type LifecycleFetchResult } from '../../../functions/src/gh-lifecycle/github-client';
import type { LifecycleRawIssue } from '../../../shared/lifecycle-tree';
import type { CallableRequest } from 'firebase-functions/v2/https';
import type { LifecycleRepoRequest } from '../../../shared/lifecycle-contracts';

const USER_REQ = (data: unknown) =>
  ({ data, auth: { uid: 'u1' } }) as unknown as CallableRequest<LifecycleRepoRequest>;

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
  it('returns sections + fetchedAt + truncatedNodes', async () => {
    const res = await handleGetLifecycleTree(
      USER_REQ({ owner: 'rinebob', repo: 'rel-str' }), deps());
    assert.equal(res.truncatedNodes, 0);
    assert.equal(res.sections.length, 1);
    assert.equal(res.sections[0].name, 'Ungrouped');
    const topic = res.sections[0].topics[0];
    assert.equal(topic.nodeType, 'topic');
    assert.equal(topic.number, 619);
    assert.equal(topic.children[0].number, 621);
    assert.equal(topic.children[0].nodeType, 'thread');
    assert.equal(topic.status, 'IN PROGRESS');
    assert.match(res.fetchedAt, /^\d{4}-\d{2}-\d{2}T/);
    assert.equal(res.groupingWarning, undefined);
  });

  it('groups via the inventory doc when it parses', async () => {
    const md = `## Open Topics\n\n### A. Named Group\n\n- **[#619 - x](https://github.com/rinebob/rel-str/issues/619)** — note\n\n## Closed Topics\n`;
    const res = await handleGetLifecycleTree(
      USER_REQ({ owner: 'rinebob', repo: 'rel-str' }),
      deps({ fetchInventoryDoc: async () => md }));
    assert.equal(res.sections[0].name, 'A. Named Group');
    assert.equal(res.sections[0].topics[0].number, 619);
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

  it('inventory doc 404 (null) → flat Ungrouped, no warning', async () => {
    const res = await handleGetLifecycleTree(
      USER_REQ({ owner: 'rinebob', repo: 'rel-str' }),
      deps({ fetchInventoryDoc: async () => null }));
    assert.equal(res.sections[0].name, 'Ungrouped');
    assert.equal(res.groupingWarning, undefined);
  });

  it('inventory doc error → groupingWarning set, tree still returns', async () => {
    const res = await handleGetLifecycleTree(
      USER_REQ({ owner: 'rinebob', repo: 'rel-str' }),
      deps({ fetchInventoryDoc: async () => { throw new GitHubApiError(500, false, 'GitHub 500: raw-body-blob'); } }));
    assert.equal(res.sections[0].name, 'Ungrouped');
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

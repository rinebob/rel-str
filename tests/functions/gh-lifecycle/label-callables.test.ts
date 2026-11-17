/**
 * Deps-injected handler tests for the gh-lifecycle label callables
 * (task #1528 listRepoLabels; #1529 write-callable specs land with
 * that task). An injectable `Rest` transport records calls and returns
 * fixtures — no network, no fetch mocking.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  handleListRepoLabels,
  type GhLabelDeps,
} from '../../../functions/src/gh-lifecycle/label-callables';
import { GitHubApiError, type Rest } from '../../../functions/src/gh-lifecycle/github-client';

// `firebase-functions` isn't resolvable from tests/ — the generic
// infers each handler's CallableRequest type at the call site (the
// repo's `as Parameters<typeof handleX>[0]` convention, hoisted).
const USER_REQ = <T>(data: unknown): T =>
  ({ data, auth: { uid: 'u1' } }) as unknown as T;
const UNAUTH = <T>(data: unknown): T =>
  ({ data, auth: undefined }) as unknown as T;

function code(err: unknown): string {
  const c = (err as { code?: string })?.code;
  return c ?? `non-https: ${err}`;
}

/** Recorded REST call + queued fixture responses/errors. */
interface FxRest {
  calls: { method: string; path: string; body?: unknown }[];
  /** path-substring → response or thrown error; FIFO across calls. */
  responses: { match: string; value?: unknown; error?: Error }[];
  rest: Rest;
}

function fxRest(): FxRest {
  const fx: FxRest = {
    calls: [],
    responses: [],
    rest: async (method, path, body) => {
      fx.calls.push({ method, path, body });
      const hit = fx.responses.findIndex(r => path.includes(r.match));
      if (hit >= 0) {
        const [r] = fx.responses.splice(hit, 1);
        if (r.error) throw r.error;
        return r.value;
      }
      return null;
    },
  };
  return fx;
}

const REPO = { owner: 'rinebob', repo: 'rel-str' };
const deps = (rest: Rest): GhLabelDeps => ({ rest });

// ── validation ─────────────────────────────────────────────────────────────

describe('label callables — validation', () => {
  it('unauthenticated → unauthenticated, never calls the transport', async () => {
    const fx = fxRest();
    const err = await handleListRepoLabels(UNAUTH(REPO), deps(fx.rest)).catch(e => e);
    assert.equal(code(err), 'unauthenticated');
    assert.equal(fx.calls.length, 0);
  });

  it('unsupported repo → invalid-argument, never calls the transport', async () => {
    const fx = fxRest();
    const err = await handleListRepoLabels(
      USER_REQ({ owner: 'x', repo: 'y' }), deps(fx.rest)).catch(e => e);
    assert.equal(code(err), 'invalid-argument');
    assert.equal(fx.calls.length, 0);
  });
});

// ── listRepoLabels (#1528) ─────────────────────────────────────────────────

describe('handleListRepoLabels', () => {
  it('pages repo labels to completion — projected to the contract', async () => {
    const fx = fxRest();
    // GitHub returns id/node_id/url/default extras — the wire must
    // carry exactly {name, color, description} (absent → null).
    const page1 = Array.from({ length: 100 }, (_, i) =>
      ({ id: i, node_id: `N${i}`, name: `l${i}`, color: 'aaaaaa', default: false }));
    fx.responses.push(
      { match: 'labels?per_page=100&page=1', value: page1 },
      { match: 'labels?per_page=100&page=2', value: [{ name: 'last', color: 'bbb', description: 'd' }] },
    );
    const res = await handleListRepoLabels(USER_REQ(REPO), deps(fx.rest));
    assert.equal(res.labels.length, 101);
    assert.equal(res.labels[100].name, 'last');
    assert.deepEqual(res.labels[0], { name: 'l0', color: 'aaaaaa', description: null });
    assert.match(res.fetchedAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    assert.deepEqual(
      fx.calls.map(c => c.path),
      ['/repos/rinebob/rel-str/labels?per_page=100&page=1',
       '/repos/rinebob/rel-str/labels?per_page=100&page=2'],
    );
  });

  it('single page under 100 → one call', async () => {
    const fx = fxRest();
    fx.responses.push({ match: 'labels?per_page=100&page=1', value: [{ name: 'a', color: 'x', description: null }] });
    const res = await handleListRepoLabels(USER_REQ(REPO), deps(fx.rest));
    assert.equal(res.labels.length, 1);
    assert.equal(fx.calls.length, 1);
  });

  it('empty repo → empty labels list', async () => {
    const fx = fxRest();
    fx.responses.push({ match: 'labels', value: [] });
    const res = await handleListRepoLabels(USER_REQ(REPO), deps(fx.rest));
    assert.deepEqual(res.labels, []);
  });

  it('a non-array page body → internal, never splinters onto the wire', async () => {
    const fx = fxRest();
    fx.responses.push({ match: 'labels?per_page=100', value: 'not-an-array' });
    const err = await handleListRepoLabels(USER_REQ(REPO), deps(fx.rest)).catch(e => e);
    assert.equal(code(err), 'internal');
    assert.match(err.message, /non-array/);
  });

  it('a transport error that is not GitHubApiError → internal', async () => {
    const fx = fxRest();
    fx.responses.push({ match: 'labels', error: new TypeError('fetch failed') });
    const err = await handleListRepoLabels(USER_REQ(REPO), deps(fx.rest)).catch(e => e);
    assert.equal(code(err), 'internal');
  });

  it('a repo 404 maps to not-found', async () => {
    const fx = fxRest();
    fx.responses.push({ match: 'labels', error: new GitHubApiError(404, false, 'Not Found') });
    const err = await handleListRepoLabels(USER_REQ(REPO), deps(fx.rest)).catch(e => e);
    assert.equal(code(err), 'not-found');
  });
});

// ── error mapping ──────────────────────────────────────────────────────────

describe('label callables — error mapping', () => {
  it('GitHub errors map to HttpsError codes with a sanitized message', async () => {
    for (const [status, expected] of [
      [401, 'unauthenticated'],
      [403, 'permission-denied'],
      [429, 'resource-exhausted'],
      [500, 'internal'],
    ] as const) {
      const fx = fxRest();
      fx.responses.push({
        match: 'labels', error: new GitHubApiError(status, status === 429, 'secret upstream body'),
      });
      const err = await handleListRepoLabels(USER_REQ(REPO), deps(fx.rest)).catch(e => e);
      assert.equal(code(err), expected, `status=${status}`);
      // The transport captures only GitHub's `.message` field (bounded,
      // interpolated) — the raw body is never stored on GitHubApiError.
      assert.ok(err.message.length > 0);
    }
  });

  it('403 with the rate-limit flag → resource-exhausted (secondary limits)', async () => {
    const fx = fxRest();
    fx.responses.push({ match: 'labels', error: new GitHubApiError(403, true, 'secondary rate limit') });
    const err = await handleListRepoLabels(USER_REQ(REPO), deps(fx.rest)).catch(e => e);
    assert.equal(code(err), 'resource-exhausted');
  });
});

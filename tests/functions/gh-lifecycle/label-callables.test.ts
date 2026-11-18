/**
 * Deps-injected handler tests for the gh-lifecycle label callables
 * (tasks #1528 listRepoLabels, #1529 updateIssueLabels + manageRepoLabel).
 * An injectable `Rest` transport records calls and returns fixtures —
 * no network, no fetch mocking.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  handleListRepoLabels,
  handleManageRepoLabel,
  handleUpdateIssueLabels,
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
const ISSUE = { ...REPO, issueNumber: 1522 };
const deps = (rest: Rest): GhLabelDeps => ({ rest });

// ── validation ─────────────────────────────────────────────────────────────

describe('label callables — validation', () => {
  it('unauthenticated → unauthenticated on all three', async () => {
    const fx = fxRest();
    for (const h of [
      () => handleListRepoLabels(UNAUTH(REPO), deps(fx.rest)),
      () => handleUpdateIssueLabels(UNAUTH({ ...ISSUE, add: ['x'], remove: [] }), deps(fx.rest)),
      () => handleManageRepoLabel(UNAUTH({ ...REPO, op: 'create', name: 'x' }), deps(fx.rest)),
    ]) {
      const err = await h().catch(e => e);
      assert.equal(code(err), 'unauthenticated');
    }
    assert.equal(fx.calls.length, 0);
  });

  it('unsupported repo → invalid-argument on all three', async () => {
    const fx = fxRest();
    const bad = { owner: 'x', repo: 'y' };
    for (const h of [
      () => handleListRepoLabels(USER_REQ(bad), deps(fx.rest)),
      () => handleUpdateIssueLabels(USER_REQ({ ...bad, issueNumber: 1, add: ['x'] }), deps(fx.rest)),
      () => handleManageRepoLabel(USER_REQ({ ...bad, op: 'delete', name: 'x' }), deps(fx.rest)),
    ]) {
      const err = await h().catch(e => e);
      assert.equal(code(err), 'invalid-argument');
    }
    assert.equal(fx.calls.length, 0);
  });

  it('updateIssueLabels: non-integer issueNumber → invalid-argument', async () => {
    const fx = fxRest();
    for (const issueNumber of [0, -1, 1.5, '7', undefined]) {
      const err = await handleUpdateIssueLabels(
        USER_REQ({ ...REPO, issueNumber, add: ['x'] }), deps(fx.rest)).catch(e => e);
      assert.equal(code(err), 'invalid-argument', `issueNumber=${issueNumber}`);
    }
  });

  it('updateIssueLabels: empty add+remove → invalid-argument', async () => {
    const fx = fxRest();
    const err = await handleUpdateIssueLabels(
      USER_REQ({ ...ISSUE, add: [], remove: [] }), deps(fx.rest)).catch(e => e);
    assert.equal(code(err), 'invalid-argument');
  });

  it('updateIssueLabels: same name in add and remove → invalid-argument', async () => {
    const fx = fxRest();
    const err = await handleUpdateIssueLabels(
      USER_REQ({ ...ISSUE, add: ['dup'], remove: ['dup'] }),
      deps(fx.rest)).catch(e => e);
    assert.equal(code(err), 'invalid-argument');
  });

  it('updateIssueLabels: stage label in add → invalid-argument, never sent', async () => {
    const fx = fxRest();
    for (const name of ['5_IMPLEMENT', '1_IDEA', '8_LIVE']) {
      const err = await handleUpdateIssueLabels(
        USER_REQ({ ...ISSUE, add: [name], remove: [] }), deps(fx.rest)).catch(e => e);
      assert.equal(code(err), 'invalid-argument', name);
    }
    assert.equal(fx.calls.length, 0);
  });

  it('updateIssueLabels: stage label in remove → invalid-argument, never sent', async () => {
    const fx = fxRest();
    // Detaching a stage label erases workflow state — same guard as add.
    const err = await handleUpdateIssueLabels(
      USER_REQ({ ...ISSUE, add: [], remove: ['7_QA'] }), deps(fx.rest)).catch(e => e);
    assert.equal(code(err), 'invalid-argument');
    assert.equal(fx.calls.length, 0);
  });

  it('manageRepoLabel: missing name / unknown op → invalid-argument', async () => {
    const fx = fxRest();
    for (const data of [
      { ...REPO, op: 'create' },
      { ...REPO, op: 'create', name: '' },
      { ...REPO, op: 'rename', name: 'x' },
      { ...REPO, name: 'x' },
    ]) {
      const err = await handleManageRepoLabel(USER_REQ(data), deps(fx.rest)).catch(e => e);
      assert.equal(code(err), 'invalid-argument', JSON.stringify(data));
    }
    assert.equal(fx.calls.length, 0);
  });

  it('manageRepoLabel: system-label ops → invalid-argument, never sent', async () => {
    const fx = fxRest();
    for (const data of [
      { ...REPO, op: 'create', name: '5_FAKE_STAGE' },  // mint a stage-looking label
      { ...REPO, op: 'update', name: 'INTERNAL' },      // rename taxonomy
      { ...REPO, op: 'delete', name: 'DEV-TOOLS' },     // delete taxonomy
      { ...REPO, op: 'update', name: 'scratch', newName: '8_LIVE' }, // rename INTO taxonomy
    ]) {
      const err = await handleManageRepoLabel(USER_REQ(data), deps(fx.rest)).catch(e => e);
      assert.equal(code(err), 'invalid-argument', JSON.stringify(data));
    }
    assert.equal(fx.calls.length, 0);
  });

  it('updateIssueLabels: empty/whitespace names → invalid-argument, never sent', async () => {
    const fx = fxRest();
    // '' would DELETE .../labels/ (trailing slash) — a silent no-op the
    // response reports as a successful remove; ' ' mints a whitespace label.
    for (const data of [
      { ...ISSUE, add: [''], remove: [] },
      { ...ISSUE, add: ['  '], remove: [] },
      { ...ISSUE, add: [], remove: [''] },
      { ...ISSUE, add: [], remove: ['  '] },
    ]) {
      const err = await handleUpdateIssueLabels(USER_REQ(data), deps(fx.rest)).catch(e => e);
      assert.equal(code(err), 'invalid-argument', JSON.stringify(data));
    }
    assert.equal(fx.calls.length, 0);
  });

  it('manageRepoLabel: malformed newName → invalid-argument, never sent', async () => {
    const fx = fxRest();
    // A non-string newName used to TypeError inside isSystemLabel → 'internal'.
    for (const data of [
      { ...REPO, op: 'update', name: 'scratch', newName: 42 },
      { ...REPO, op: 'update', name: 'scratch', newName: '' },
      { ...REPO, op: 'update', name: 'scratch', newName: '  ' },
    ]) {
      const err = await handleManageRepoLabel(USER_REQ(data), deps(fx.rest)).catch(e => e);
      assert.equal(code(err), 'invalid-argument', JSON.stringify(data));
    }
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

// ── updateIssueLabels (#1529) ──────────────────────────────────────────────

describe('handleUpdateIssueLabels', () => {
  const labelSet = (names: string[]) =>
    names.map(name => ({ name, color: 'aaa', description: null }));

  it('add of existing repo labels → attach only, no create', async () => {
    const fx = fxRest();
    fx.responses.push(
      { match: 'labels?per_page=100&page=1', value: labelSet(['INTERNAL', 'DEV-TOOLS']) },
      { match: 'issues/1522/labels', value: labelSet(['INTERNAL', 'DEV-TOOLS']) },
    );
    const res = await handleUpdateIssueLabels(
      USER_REQ({ ...ISSUE, add: ['DEV-TOOLS'], remove: [] }), deps(fx.rest));
    assert.deepEqual(
      fx.calls.map(c => `${c.method} ${c.path}`),
      ['GET /repos/rinebob/rel-str/labels?per_page=100&page=1',
       'POST /repos/rinebob/rel-str/issues/1522/labels'],
    );
    assert.deepEqual(res.created, []);
    assert.deepEqual(res.labels, ['INTERNAL', 'DEV-TOOLS']);
  });

  it('add of a missing name → create then attach, in that order', async () => {
    const fx = fxRest();
    fx.responses.push(
      { match: 'labels?per_page=100&page=1', value: labelSet(['INTERNAL']) },
      { match: '/labels', value: { name: 'scratch', color: 'ededed', description: '' } }, // POST /labels (create)
      { match: 'issues/1522/labels', value: labelSet(['INTERNAL', 'scratch']) },          // POST attach
    );
    const res = await handleUpdateIssueLabels(
      USER_REQ({ ...ISSUE, add: ['scratch'], remove: [] }), deps(fx.rest));
    assert.deepEqual(
      fx.calls.map(c => `${c.method} ${c.path}`),
      ['GET /repos/rinebob/rel-str/labels?per_page=100&page=1',
       'POST /repos/rinebob/rel-str/labels',
       'POST /repos/rinebob/rel-str/issues/1522/labels'],
    );
    assert.equal(fx.calls[1].body && (fx.calls[1].body as { name?: string }).name, 'scratch');
    assert.deepEqual(res.created, ['scratch']);
  });

  it('remove success → finalLabels from the DELETE response, no trailing GET', async () => {
    const fx = fxRest();
    fx.responses.push(
      { match: 'issues/1522/labels/gone', value: [{ name: 'A' }, { name: 'B' }] },
    );
    const res = await handleUpdateIssueLabels(
      USER_REQ({ ...ISSUE, add: [], remove: ['gone'] }), deps(fx.rest));
    assert.equal(fx.calls.length, 1);
    assert.equal(fx.calls[0].method, 'DELETE');
    assert.deepEqual(res.labels, ['A', 'B']);
  });

  it('combined add+remove — remove runs first, final labels from the attach', async () => {
    const fx = fxRest();
    const labelSet = (names: string[]) =>
      names.map(name => ({ name, color: 'aaa', description: null }));
    fx.responses.push(
      { match: 'issues/1522/labels/gone', value: labelSet(['A']) },          // remove returns remaining
      { match: 'labels?per_page=100&page=1', value: labelSet(['A', 'x']) },  // 'x' already a repo label
      { match: 'issues/1522/labels', value: labelSet(['A', 'x']) },          // attach response wins
    );
    const res = await handleUpdateIssueLabels(
      USER_REQ({ ...ISSUE, add: ['x'], remove: ['gone'] }), deps(fx.rest));
    assert.deepEqual(
      fx.calls.map(c => `${c.method} ${c.path}`),
      ['DELETE /repos/rinebob/rel-str/issues/1522/labels/gone',
       'GET /repos/rinebob/rel-str/labels?per_page=100&page=1',
       'POST /repos/rinebob/rel-str/issues/1522/labels'],
    );
    assert.deepEqual(res.labels, ['A', 'x']);
    assert.deepEqual(res.created, []);
  });

  it('remove → DELETE per name; 404 detach is a no-op', async () => {
    const fx = fxRest();
    fx.responses.push(
      { match: 'issues/1522/labels/gone', error: new GitHubApiError(404, false, 'not found') },
      { match: 'issues/1522/labels', value: labelSet(['INTERNAL']) }, // final read
    );
    const res = await handleUpdateIssueLabels(
      USER_REQ({ ...ISSUE, add: [], remove: ['gone'] }), deps(fx.rest));
    assert.deepEqual(
      fx.calls.map(c => `${c.method} ${c.path}`),
      ['DELETE /repos/rinebob/rel-str/issues/1522/labels/gone',
       'GET /repos/rinebob/rel-str/issues/1522/labels'],
    );
    assert.deepEqual(res.labels, ['INTERNAL']);
  });

  it('a 422 on create means the label raced into existence — attach anyway', async () => {
    const fx = fxRest();
    fx.responses.push(
      { match: 'labels?per_page=100&page=1', value: labelSet([]) },
      { match: '/labels', error: new GitHubApiError(422, false, 'already_exists') }, // create
      { match: 'issues/1522/labels', value: labelSet(['scratch']) },                 // attach
    );
    const res = await handleUpdateIssueLabels(
      USER_REQ({ ...ISSUE, add: ['scratch'], remove: [] }), deps(fx.rest));
    assert.deepEqual(res.labels, ['scratch']);
    assert.deepEqual(res.created, []); // raced — not minted by us
  });
});

// ── manageRepoLabel (#1529) ────────────────────────────────────────────────

describe('handleManageRepoLabel', () => {
  it('create → POST with default color when absent', async () => {
    const fx = fxRest();
    fx.responses.push({ match: '/labels', value: { name: 'scratch', color: 'ededed', description: 'x' } });
    const res = await handleManageRepoLabel(
      USER_REQ({ ...REPO, op: 'create', name: 'scratch', description: 'x' }), deps(fx.rest));
    assert.equal(fx.calls.length, 1);
    assert.equal(fx.calls[0].method, 'POST');
    const body = fx.calls[0].body as { name: string; color: string };
    assert.equal(body.name, 'scratch');
    assert.equal(typeof body.color, 'string');
    assert.equal(res.op, 'create');
  });

  it('create on an existing name → already-exists', async () => {
    const fx = fxRest();
    fx.responses.push({ match: '/labels', error: new GitHubApiError(422, false, 'already_exists') });
    const err = await handleManageRepoLabel(
      USER_REQ({ ...REPO, op: 'create', name: 'documentation' }), deps(fx.rest)).catch(e => e);
    assert.equal(code(err), 'already-exists');
  });

  it('update → PATCH with new_name/color/description', async () => {
    const fx = fxRest();
    fx.responses.push({ match: '/labels/old', value: { name: 'new' } });
    await handleManageRepoLabel(
      USER_REQ({ ...REPO, op: 'update', name: 'old', newName: 'new', color: 'ff0000' }),
      deps(fx.rest));
    assert.equal(fx.calls[0].method, 'PATCH');
    assert.equal(fx.calls[0].path, '/repos/rinebob/rel-str/labels/old');
    assert.deepEqual(fx.calls[0].body, { new_name: 'new', color: 'ff0000', description: undefined });
  });

  it('delete → usage count collected before the DELETE', async () => {
    const fx = fxRest();
    fx.responses.push(
      { match: 'issues?labels=', value: [{ number: 1 }, { number: 2 }, { number: 3 }] },
      { match: '/labels/scratch', value: null },
    );
    const res = await handleManageRepoLabel(
      USER_REQ({ ...REPO, op: 'delete', name: 'scratch' }), deps(fx.rest));
    assert.equal(res.usageCount, 3);
    assert.equal(fx.calls[1].method, 'DELETE');
    assert.equal(fx.calls[1].path, '/repos/rinebob/rel-str/labels/scratch');
  });

  it('a 422 on a non-create op → invalid-argument, not already-exists', async () => {
    const fx = fxRest();
    // PATCH validation failure (bad color/new_name) is a rejected
    // payload — must not misreport as a name conflict.
    fx.responses.push({ match: '/labels/old', error: new GitHubApiError(422, false, 'validation failed') });
    const err = await handleManageRepoLabel(
      USER_REQ({ ...REPO, op: 'update', name: 'old', newName: 'x' }), deps(fx.rest)).catch(e => e);
    assert.equal(code(err), 'invalid-argument');
  });

  it('update/delete of a missing label → not-found', async () => {
    const fx = fxRest();
    fx.responses.push({ match: '/labels', error: new GitHubApiError(404, false, 'not found') });
    const err = await handleManageRepoLabel(
      USER_REQ({ ...REPO, op: 'update', name: 'ghost', newName: 'x' }), deps(fx.rest)).catch(e => e);
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

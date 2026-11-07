/**
 * Unit tests for `handleOptionsReplayDelete` — the `optionsReplayDelete`
 * callable core (Topic #1238, task #1439). All effects go through the
 * injectable `ReplayDeleteDeps` seam (TEST-BE): fixture existence flags,
 * captured delete invocations — no Firestore.
 *
 * Covers:
 * - auth: no request.auth → unauthenticated
 * - validation: missing/malformed runId → invalid-argument
 * - full cascade: run + list + N result docs → one deleteAll with all ids
 * - idempotency: partial state (run only) and empty state (nothing
 *   exists) both succeed — the latter skips deleteAll entirely
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { handleOptionsReplayDelete } from '../../../functions/src/options-replay/delete';
import type { ReplayDeleteDeps } from '../../../functions/src/options-replay/delete';

/** HttpsError.code is the FunctionsErrorCode string — read the property
 *  instead of importing firebase-functions (resolution walks up from this
 *  file, which has no functions/node_modules path). */
function code(e: unknown): string | undefined {
  return (e as { code?: string }).code;
}

// ==========================
// Fakes
// ==========================

const RUN_ID = '2026-11-06_fri_120220_manual_yntnf9_ZZZZZ';

function makeDeps(opts: {
  runExists?: boolean;
  listExists?: boolean;
  resultIds?: string[];
} = {}): {
  deps: ReplayDeleteDeps;
  deletions: { runId: string; resultDocIds: string[] }[];
} {
  const deletions: { runId: string; resultDocIds: string[] }[] = [];
  return {
    deletions,
    deps: {
      runExists: async () => opts.runExists ?? true,
      listExists: async () => opts.listExists ?? true,
      resultDocIds: async () => opts.resultIds ?? [],
      deleteAll: async (runId, resultDocIds) => {
        deletions.push({ runId, resultDocIds });
      },
    },
  };
}

function request(data: unknown) {
  return { data, auth: { uid: 'u1' } } as Parameters<typeof handleOptionsReplayDelete>[0];
}

/** auth:undefined — a JS default parameter can't express this (passing
 *  undefined re-triggers the default), so the unauthenticated fixture
 *  gets its own helper. */
function unauthRequest(data: unknown) {
  return { data, auth: undefined } as Parameters<typeof handleOptionsReplayDelete>[0];
}

// ==========================
// Tests
// ==========================

describe('handleOptionsReplayDelete — validation', () => {
  it('unauthenticated → unauthenticated', async () => {
    const err = await handleOptionsReplayDelete(
      unauthRequest({ runId: RUN_ID }),
      makeDeps().deps,
    ).catch((e) => e);
    assert.equal(code(err), 'unauthenticated');
  });

  it('missing/malformed runId → invalid-argument', async () => {
    for (const data of [
      {},
      { runId: '' },
      { runId: '   ' },
      { runId: 42 },
      null,
      undefined,
    ]) {
      const err = await handleOptionsReplayDelete(request(data), makeDeps().deps).catch((e) => e);
      assert.equal(code(err), 'invalid-argument', JSON.stringify(data));
    }
  });
});

describe('handleOptionsReplayDelete — cascade', () => {
  it('deletes run + list + every result doc in one commit', async () => {
    const resultIds = [`${RUN_ID}_target-90`, `${RUN_ID}_expiry`];
    const { deps, deletions } = makeDeps({ resultIds });

    const res = await handleOptionsReplayDelete(request({ runId: RUN_ID }), deps);

    assert.deepEqual(res, { deletedRun: true, deletedLists: 1, deletedResults: 2 });
    assert.deepEqual(deletions, [{ runId: RUN_ID, resultDocIds: resultIds }]);
  });

  it('partial state — run only (failed before the list landed)', async () => {
    const { deps, deletions } = makeDeps({ listExists: false });

    const res = await handleOptionsReplayDelete(request({ runId: RUN_ID }), deps);

    assert.deepEqual(res, { deletedRun: true, deletedLists: 0, deletedResults: 0 });
    assert.equal(deletions.length, 1);
    assert.equal(deletions[0].runId, RUN_ID);
  });

  it('orphaned results only (run + list already gone) → cleans them, deletedRun false', async () => {
    const resultIds = [`${RUN_ID}_target-90`];
    const { deps, deletions } = makeDeps({
      runExists: false,
      listExists: false,
      resultIds,
    });

    const res = await handleOptionsReplayDelete(request({ runId: RUN_ID }), deps);

    assert.deepEqual(res, { deletedRun: false, deletedLists: 0, deletedResults: 1 });
    assert.deepEqual(deletions, [{ runId: RUN_ID, resultDocIds: resultIds }]);
  });

  it('fully-missing docs → all-zero counts, deleteAll not invoked', async () => {
    const { deps, deletions } = makeDeps({
      runExists: false,
      listExists: false,
      resultIds: [],
    });

    const res = await handleOptionsReplayDelete(request({ runId: RUN_ID }), deps);

    assert.deepEqual(res, { deletedRun: false, deletedLists: 0, deletedResults: 0 });
    assert.equal(deletions.length, 0);
  });
});

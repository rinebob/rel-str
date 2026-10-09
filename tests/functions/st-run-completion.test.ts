/**
 * @topic #553 — Paper Trading Infra (task #917)
 *
 * Run-completion evaluation: the single-writer transaction body that flips
 * a run to its final status and yields the payload for the post-commit
 * `stAutoPaperIngest` enqueue. Pins the exactly-once contract — a result
 * (and therefore an enqueue) only on the final-status path, never on
 * incomplete runs, missing runs, or an already-claimed completion.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { evalRunCompletion } from '../../functions/src/st-cloud-function/run-progress';
import { StRunStatus } from '../../functions/src/common/st-runs';

const RUN_REF = { ref: 'run' };
const STATUS_REF = { ref: 'status' };
const REFS = { runRef: RUN_REF, statusRef: STATUS_REF };

interface Write {
  ref: unknown;
  data: Record<string, unknown>;
}

function makeTx(run: Record<string, unknown> | undefined) {
  const writes: Write[] = [];
  const t = {
    async get(ref: unknown) {
      if (ref === RUN_REF && run !== undefined) {
        return { exists: true, data: () => run };
      }
      return { exists: false, data: () => undefined };
    },
    set(ref: unknown, data: unknown) {
      writes.push({ ref, data: data as Record<string, unknown> });
    },
  };
  return { t, writes };
}

const BASE_RUN = {
  marketDate: '2026-10-08',
  triggeredBy: 'nightly',
  totalSymbols: 3,
  successCount: 3,
  failureCount: 0,
};

describe('evalRunCompletion', () => {
  it('returns nothing when the run doc is missing', async () => {
    const { t, writes } = makeTx(undefined);
    const result = await evalRunCompletion(t, REFS, 'r1');
    assert.equal(result, undefined);
    assert.equal(writes.length, 0);
  });

  it('returns nothing while jobs are still in flight', async () => {
    const { t, writes } = makeTx({ ...BASE_RUN, successCount: 1 });
    const result = await evalRunCompletion(t, REFS, 'r1');
    assert.equal(result, undefined);
    assert.equal(writes.length, 0);
  });

  it('returns nothing when completionProcessed was already claimed', async () => {
    const { t, writes } = makeTx({ ...BASE_RUN, completionProcessed: true });
    const result = await evalRunCompletion(t, REFS, 'r1');
    assert.equal(result, undefined);
    assert.equal(writes.length, 0);
  });

  it('completes SUCCESS when all jobs finished clean', async () => {
    const { t, writes } = makeTx({ ...BASE_RUN, signalsGenerated: 7 });
    const result = await evalRunCompletion(t, REFS, 'r1');
    assert.equal(result?.finalStatus, StRunStatus.SUCCESS);

    const runWrite = writes.find((w) => w.ref === RUN_REF);
    assert.equal(runWrite?.data.status, StRunStatus.SUCCESS);
    assert.equal(runWrite?.data.completionProcessed, true);

    const statusWrite = writes.find((w) => w.ref === STATUS_REF);
    assert.equal(statusWrite?.data.lastRunId, 'r1');
    assert.equal(statusWrite?.data.lastRunStatus, StRunStatus.SUCCESS);
  });

  it('completes PARTIAL when any job failed — still a completion result', async () => {
    const { t } = makeTx({ ...BASE_RUN, successCount: 2, failureCount: 1 });
    const result = await evalRunCompletion(t, REFS, 'r1');
    assert.equal(result?.finalStatus, StRunStatus.PARTIAL);
  });

  it('carries marketDate and triggeredBy for the ingest payload', async () => {
    const { t } = makeTx(BASE_RUN);
    const result = await evalRunCompletion(t, REFS, 'r1');
    assert.equal(result?.marketDate, '2026-10-08');
    assert.equal(result?.triggeredBy, 'nightly');
  });

  it('yields no payload fields from a run that lacks them', async () => {
    const { t } = makeTx({ totalSymbols: 1, successCount: 1 });
    const result = await evalRunCompletion(t, REFS, 'r1');
    assert.equal(result?.finalStatus, StRunStatus.SUCCESS);
    assert.equal(result?.marketDate, undefined);
    assert.equal(result?.triggeredBy, undefined);
  });
});

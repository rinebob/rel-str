/**
 * @task #1444 — stOverviewSyncAdmin auth guard
 *
 * Public-invoker admin callable that used to accept anonymous calls and
 * enqueue a full backfill — the largest billed-work hole in the sweep.
 * Guard must fire before loadEnabledSymbolIds or any enqueue.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { handleStOverviewSyncAdmin } from '../../../functions/src/st-cloud-function/overview-sync-orchestrator';

const code = (e: unknown) => (e as { code?: string }).code;

function request(data: unknown) {
  return { data, auth: { uid: 'u1' } } as Parameters<typeof handleStOverviewSyncAdmin>[0];
}

/** auth:undefined — Firebase treats the call as unauthenticated. */
function unauthRequest(data: unknown) {
  return { data, auth: undefined } as Parameters<typeof handleStOverviewSyncAdmin>[0];
}

function makeDeps() {
  const calls: string[] = [];
  const enqueued: { symbols: string[]; forceRefresh: boolean }[] = [];
  const deps = {
    async loadEnabledSymbolIds() {
      calls.push('loadEnabledSymbolIds');
      return ['QQQ', 'SPY'];
    },
    async enqueueOverviewTasks(symbols: string[], forceRefresh: boolean) {
      calls.push('enqueueOverviewTasks');
      enqueued.push({ symbols, forceRefresh });
      return { enqueued: symbols.length, skipped: 0 };
    },
  };
  return { deps, calls, enqueued };
}

describe('stOverviewSyncAdmin — auth guard (#1444)', () => {
  it('unauthenticated → unauthenticated, zero deps touched', async () => {
    const { deps, calls, enqueued } = makeDeps();
    const err = await handleStOverviewSyncAdmin(unauthRequest({}), deps).catch((e) => e);
    assert.equal(code(err), 'unauthenticated');
    assert.deepEqual(calls, []);
    assert.equal(enqueued.length, 0);
  });
});

describe('stOverviewSyncAdmin — wiring', () => {
  it('no symbols → loads the enabled set and enqueues all', async () => {
    const { deps, enqueued } = makeDeps();
    const res = await handleStOverviewSyncAdmin(request({}), deps);
    assert.equal(res.total, 2);
    assert.equal(res.enqueued, 2);
    assert.deepEqual(enqueued[0].symbols, ['QQQ', 'SPY']);
    assert.equal(enqueued[0].forceRefresh, true);
  });

  it('explicit symbols skip the enabled-set load', async () => {
    const { deps, calls, enqueued } = makeDeps();
    const res = await handleStOverviewSyncAdmin(
      request({ symbols: ['AAPL'], forceRefresh: false }),
      deps,
    );
    assert.equal(res.total, 1);
    assert.deepEqual(calls, ['enqueueOverviewTasks']);
    assert.equal(enqueued[0].forceRefresh, false);
  });
});

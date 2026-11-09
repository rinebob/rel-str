/**
 * @task #1444 — stBacktestStart auth guard
 *
 * Public-invoker callable that used to accept anonymous billed work — a
 * run doc write plus one Cloud Task per symbol. The guard must fire
 * inside the testable core, before validation or any dep.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { handleStBacktestStart } from '../../../functions/src/st-cloud-function/backtest/backtest-orchestrator';
import type { BacktestPermutationPayload } from '../../../functions/src/st-cloud-function/backtest/backtest-types';

const code = (e: unknown) => (e as { code?: string }).code;

function request(data: unknown) {
  return { data, auth: { uid: 'u1' } } as Parameters<typeof handleStBacktestStart>[0];
}

/** auth:undefined — Firebase treats the call as unauthenticated. */
function unauthRequest(data: unknown) {
  return { data, auth: undefined } as Parameters<typeof handleStBacktestStart>[0];
}

const VALID = { symbols: ['QQQ', 'SPY'], strategyId: 'st-trend-rider' };

function makeDeps(opts: { enqueueFails?: boolean } = {}) {
  const runs: unknown[] = [];
  const enqueued: BacktestPermutationPayload[] = [];
  const deps = {
    async createRun(runId: string, doc: unknown) {
      runs.push({ runId, doc });
    },
    async enqueue(payload: BacktestPermutationPayload, _delaySeconds: number) {
      if (opts.enqueueFails) throw new Error('queue unavailable');
      enqueued.push(payload);
    },
  };
  return { deps, runs, enqueued };
}

describe('stBacktestStart — auth guard (#1444)', () => {
  it('unauthenticated → unauthenticated, zero deps touched', async () => {
    const { deps, runs, enqueued } = makeDeps();
    const err = await handleStBacktestStart(unauthRequest(VALID), deps).catch((e) => e);
    assert.equal(code(err), 'unauthenticated');
    assert.equal(runs.length, 0);
    assert.equal(enqueued.length, 0);
  });
});

describe('stBacktestStart — wiring', () => {
  it('empty symbols → invalid-argument, no run doc written', async () => {
    const { deps, runs } = makeDeps();
    const err = await handleStBacktestStart(
      request({ symbols: [], strategyId: 'st-trend-rider' }),
      deps,
    ).catch((e) => e);
    assert.equal(code(err), 'invalid-argument');
    assert.equal(runs.length, 0);
  });

  it('unknown strategy → invalid-argument, no run doc written', async () => {
    const { deps, runs } = makeDeps();
    const err = await handleStBacktestStart(
      request({ symbols: ['QQQ'], strategyId: 'no-such-strategy' }),
      deps,
    ).catch((e) => e);
    assert.equal(code(err), 'invalid-argument');
    assert.equal(runs.length, 0);
  });

  it('creates the run doc and enqueues one task per symbol', async () => {
    const { deps, runs, enqueued } = makeDeps();
    const res = await handleStBacktestStart(request(VALID), deps);
    assert.equal(runs.length, 1);
    assert.equal(enqueued.length, 2);
    assert.deepEqual(res, {
      runId: res.runId,
      enqueued: 2,
      failed: 0,
      total: 2,
    });
    assert.deepEqual(enqueued.map((p) => p.symbol), ['QQQ', 'SPY']);
    assert.equal(enqueued[0].runId, res.runId);
  });

  it('an enqueue failure counts as failed, not thrown', async () => {
    const { deps, enqueued } = makeDeps({ enqueueFails: true });
    const res = await handleStBacktestStart(request(VALID), deps);
    assert.equal(enqueued.length, 0);
    assert.equal(res.failed, 2);
    assert.equal(res.enqueued, 0);
  });
});

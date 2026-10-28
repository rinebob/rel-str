/**
 * Unit tests for `runReplayPermutation` — the `optionsReplayPermutation`
 * task-handler core (Topic #1238, task #1280). All effects go through the
 * injectable `ReplayPermutationDeps` seam (TEST-BE seam 3): fixture list
 * docs, fixture trading days, fixture pick-doc client.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  runReplayPermutation,
  resolveRunCloseOut,
} from '../../../functions/src/options-replay/permutation';
import type {
  ReplayPermutationDeps,
  ContractListWrite,
} from '../../../functions/src/options-replay/permutation';
import { PartnerHttpError } from '../../../functions/src/partner-infrastructure';
import type { PickDocument, OptionsContractListDoc } from '@options-replay/contracts';
import { OptionType } from '@options/common';
import { TradeSide } from '@common';

// ==========================
// Fixtures
// ==========================

const PAYLOAD = {
  runId: 'run-1',
  symbol: 'SPY',
  templateId: 'csp-45-20',
  startDate: '2026-01-05',
};

function pickDoc(): PickDocument {
  return {
    type: OptionType.PUT,
    targetDelta: -0.2,
    expiry: { mode: 'nearestDte', dte: 45 },
    symbol: 'SPY',
    gridVersion: 2,
    firstDate: '2026-01-05',
    lastDate: '2026-01-07',
    pickCount: 1,
    missCount: 0,
    days: {
      '2026-01-05': {
        underlyingClose: 580, contractId: 'SPY260220P00580000', expiration: '2026-02-20',
        dte: 45, strike: 580, delta: -0.2, iv: 0.22, mark: 9.5, bid: 9.4, ask: 9.6,
        volume: 100, openInterest: 5000,
      },
      '2026-01-06': { status: 'no_match' },
    },
  };
}

function makeDeps(overrides: Partial<ReplayPermutationDeps> = {}): {
  deps: ReplayPermutationDeps;
  writes: { docId: string; fields: ContractListWrite }[];
  closeOuts: { runId: string; symbol: string; outcome: string }[];
} {
  const writes: { docId: string; fields: ContractListWrite }[] = [];
  const closeOuts: { runId: string; symbol: string; outcome: string }[] = [];
  const deps: ReplayPermutationDeps = {
    resolveTemplate: (id) =>
      id === 'csp-45-20'
        ? { id, name: 'n', description: 'd', side: TradeSide.SHORT, coordinate: { type: OptionType.PUT, targetDelta: -0.2, expiry: { mode: 'nearestDte', dte: 45 } } }
        : undefined,
    getListDoc: async () => undefined,
    writeListDoc: async (docId, fields) => {
      writes.push({ docId, fields });
    },
    loadTradingDays: async () => ['2026-01-05', '2026-01-06', '2026-01-07'],
    fetchPickDoc: async () => pickDoc(),
    closeOutList: async (runId, symbol, outcome) => {
      closeOuts.push({ runId, symbol, outcome });
    },
    ...overrides,
  };
  return { deps, writes, closeOuts };
}

const SUCCESS_DOC: Pick<OptionsContractListDoc, 'status'> = { status: 'success' };

describe('runReplayPermutation', () => {
  it('happy path — running write, mapped rows, pickDocMeta, success close-out', async () => {
    const env = makeDeps();
    await runReplayPermutation(PAYLOAD, env.deps, true);

    const docId = 'run-1_SPY';
    assert.equal(env.writes.length, 2);
    assert.equal(env.writes[0].docId, docId);
    assert.equal(env.writes[0].fields.status, 'running');

    const final = env.writes[1].fields;
    assert.equal(final.status, 'success');
    assert.equal(final.rows?.length, 3);
    assert.equal(final.rows?.[0].kind, 'pick');
    assert.equal(final.rows?.[1].kind, 'no-selection');
    assert.equal(final.pickDocMeta?.gridVersion, 2);
    assert.equal(final.pickDocMeta?.pickCount, 1);
    assert.equal(final.pickDocMeta?.firstDate, '2026-01-05');
    assert.equal(final.pickDocMeta?.lastDate, '2026-01-07');
    assert.deepEqual(env.closeOuts, [{ runId: 'run-1', symbol: 'SPY', outcome: 'success' }]);
  });

  it('fetches the pick doc for [startDate, latest trading day]', async () => {
    const seen: { startDate?: string; endDate?: string } = {};
    const env = makeDeps({
      fetchPickDoc: async (input) => {
        seen.startDate = input.startDate;
        seen.endDate = input.endDate;
        return pickDoc();
      },
    });
    await runReplayPermutation(PAYLOAD, env.deps, true);
    assert.equal(seen.startDate, '2026-01-05');
    assert.equal(seen.endDate, '2026-01-07');
  });

  it('short-circuits when the list doc is already success — but still ensures close-out', async () => {
    const env = makeDeps({ getListDoc: async () => SUCCESS_DOC });
    await runReplayPermutation(PAYLOAD, env.deps, true);
    // No re-fetch/re-write, but the idempotent close-out runs — a prior
    // attempt may have written the doc and died before close-out.
    assert.equal(env.writes.length, 0);
    assert.deepEqual(env.closeOuts, [{ runId: 'run-1', symbol: 'SPY', outcome: 'success' }]);
  });

  it('short-circuits a failed doc — ensures close-out with the failed outcome', async () => {
    const env = makeDeps({ getListDoc: async () => ({ status: 'failed' }) });
    await runReplayPermutation(PAYLOAD, env.deps, true);
    assert.equal(env.writes.length, 0);
    assert.deepEqual(env.closeOuts, [{ runId: 'run-1', symbol: 'SPY', outcome: 'failed' }]);
  });

  it('missing pick doc (404) → failed doc + failed close-out, no retry', async () => {
    const env = makeDeps({
      fetchPickDoc: async () => {
        throw new PartnerHttpError('pick doc fetch failed for SPY-put-20-45: no year shard', 404);
      },
    });
    // Not final attempt — 404 must still resolve now (retrying can't help).
    await runReplayPermutation(PAYLOAD, env.deps, false);

    const failed = env.writes.find((w) => w.fields.status === 'failed');
    assert.ok(failed);
    assert.match(String(failed.fields.error), /SPY-put-20-45/);
    assert.deepEqual(env.closeOuts, [{ runId: 'run-1', symbol: 'SPY', outcome: 'failed' }]);
  });

  it('transient error before final attempt → rethrows for task retry, no failed write', async () => {
    const env = makeDeps({
      fetchPickDoc: async () => {
        throw new PartnerHttpError('upstream 502', 502);
      },
    });
    await assert.rejects(runReplayPermutation(PAYLOAD, env.deps, false), /502/);
    assert.equal(env.writes.filter((w) => w.fields.status === 'failed').length, 0);
    assert.equal(env.closeOuts.length, 0);
  });

  it('transient error on final attempt → failed doc + failed close-out, rethrows', async () => {
    const env = makeDeps({
      fetchPickDoc: async () => {
        throw new PartnerHttpError('upstream 502', 502);
      },
    });
    await assert.rejects(runReplayPermutation(PAYLOAD, env.deps, true), /502/);
    assert.equal(env.writes.filter((w) => w.fields.status === 'failed').length, 1);
    assert.deepEqual(env.closeOuts, [{ runId: 'run-1', symbol: 'SPY', outcome: 'failed' }]);
  });

  it('no trading days → retriable error (bars may lag)', async () => {
    const env = makeDeps({ loadTradingDays: async () => [] });
    await assert.rejects(runReplayPermutation(PAYLOAD, env.deps, false), /daily bars/i);
  });

  it('unknown template → failed doc + failed close-out, no retry', async () => {
    const env = makeDeps();
    await runReplayPermutation({ ...PAYLOAD, templateId: 'nope' }, env.deps, false);
    const failed = env.writes.find((w) => w.fields.status === 'failed');
    assert.ok(failed);
    assert.match(String(failed.fields.error), /templateId/);
    assert.deepEqual(env.closeOuts, [{ runId: 'run-1', symbol: 'SPY', outcome: 'failed' }]);
  });
});

describe('resolveRunCloseOut', () => {
  it('increments the right counter and stays open below totalLists', () => {
    const r = resolveRunCloseOut({ completedLists: 1, failedLists: 0, totalLists: 3 }, 'success');
    assert.deepEqual(r, { completedLists: 2, failedLists: 0, done: false });
  });

  it('flips completed when all lists succeed', () => {
    const r = resolveRunCloseOut({ completedLists: 2, failedLists: 0, totalLists: 3 }, 'success');
    assert.deepEqual(r, { completedLists: 3, failedLists: 0, done: true, status: 'completed' });
  });

  it('completes (not fails) with partial failures', () => {
    const r = resolveRunCloseOut({ completedLists: 2, failedLists: 0, totalLists: 3 }, 'failed');
    assert.deepEqual(r, { completedLists: 2, failedLists: 1, done: true, status: 'completed' });
  });

  it('fails only when every list failed', () => {
    const r = resolveRunCloseOut({ completedLists: 0, failedLists: 2, totalLists: 3 }, 'failed');
    assert.deepEqual(r, { completedLists: 0, failedLists: 3, done: true, status: 'failed' });
  });
});

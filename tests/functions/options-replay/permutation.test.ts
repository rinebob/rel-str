/**
 * Unit tests for `runReplayPermutation` — the `optionsReplayPermutation`
 * task-handler core (Topic #1238, task #1280; multi-leg worker #1499).
 * All effects go through the injectable `ReplayPermutationDeps` seam
 * (TEST-BE seam 3): fixture list docs, fixture trading days, fixture
 * pick-doc client.
 *
 * #1499: the worker resolves legs off the run doc's `variantSnapshot`
 * (self-describing — no registry call), fetches one pick doc per option
 * leg bounded-parallel, and writes `schemaVersion: 2` docs with
 * `legMetas[]`. Missing/malformed snapshot = permanent failure.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  runReplayPermutation,
  resolveCloseOutStatus,
} from '../../../functions/src/options-replay/permutation';
import type {
  ReplayPermutationDeps,
  ContractListWrite,
} from '../../../functions/src/options-replay/permutation';
import {
  PartnerHttpError,
  PARTNER_CODE_NOT_FOUND,
} from '../../../functions/src/partner-infrastructure';
import type {
  OptionsContractListDoc,
  PickDocCoordinate,
  PickDocument,
  VariantLeg,
} from '@options-replay/contracts';
import { OptionType } from '@options/common';
import { TradeSide } from '@common';

// ==========================
// Fixtures
// ==========================

const PAYLOAD = {
  runId: 'run-1',
  symbol: 'SPY',
};

const LEG_SHORT_PUT_20: VariantLeg = {
  kind: 'option', type: OptionType.PUT, targetDelta: -0.2, dte: 45, side: TradeSide.SHORT,
};
const LEG_LONG_PUT_5: VariantLeg = {
  kind: 'option', type: OptionType.PUT, targetDelta: -0.05, dte: 45, side: TradeSide.LONG,
};

const RUN = {
  symbol: 'SPY',
  templateId: 'csp-45-20',
  startDate: '2026-01-05',
  variantSnapshot: {
    name: '45DTE 20Δ put (CSP)',
    legs: [LEG_SHORT_PUT_20],
  },
};

function pickDoc(overrides: Partial<PickDocument> = {}): PickDocument {
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
    ...overrides,
  };
}

function makeDeps(overrides: Partial<ReplayPermutationDeps> = {}): {
  deps: ReplayPermutationDeps;
  writes: { docId: string; fields: ContractListWrite }[];
  closeOuts: { runId: string; outcome: string }[];
} {
  const writes: { docId: string; fields: ContractListWrite }[] = [];
  const closeOuts: { runId: string; outcome: string; error?: string }[] = [];
  const deps: ReplayPermutationDeps = {
    getRun: async () => RUN,
    getListDoc: async () => undefined,
    writeListDoc: async (docId, fields) => {
      writes.push({ docId, fields });
    },
    loadTradingDays: async () => ['2026-01-05', '2026-01-06', '2026-01-07'],
    fetchPickDoc: async () => pickDoc(),
    closeOutRun: async (runId, outcome, error) => {
      // Mirror prod — ignoreUndefinedProperties drops an absent error.
      closeOuts.push(error === undefined ? { runId, outcome } : { runId, outcome, error });
    },
    ...overrides,
  };
  return { deps, writes, closeOuts };
}

const SUCCESS_DOC: Pick<OptionsContractListDoc, 'status'> = { status: 'success' };

describe('runReplayPermutation', () => {
  it('happy path — running write, position rows, legMetas, schemaVersion 2, success close-out', async () => {
    const env = makeDeps();
    await runReplayPermutation(PAYLOAD, env.deps, true);

    // Under single-symbol runs (#1430) the list doc id IS the runId.
    const docId = 'run-1';
    assert.equal(env.writes.length, 2);
    assert.equal(env.writes[0].docId, docId);
    assert.equal(env.writes[0].fields.status, 'running');
    assert.equal(env.writes[0].fields.schemaVersion, 2);
    // Merge-hygiene sentinels — stale v1 pickDocMeta and a prior
    // attempt's legMetas/error are deleted on the running write.
    assert.ok(env.writes[0].fields.pickDocMeta !== undefined);
    assert.ok(env.writes[0].fields.legMetas !== undefined);
    assert.ok(env.writes[0].fields.error !== undefined);

    const final = env.writes[1].fields;
    assert.equal(final.status, 'success');
    assert.equal(final.schemaVersion, 2);
    assert.equal(final.rows?.length, 3);
    assert.equal(final.rows?.[0].kind, 'position');
    const leg = final.rows?.[0].kind === 'position' ? final.rows[0].legs[0] : undefined;
    assert.equal(leg?.kind, 'option');
    assert.equal(final.rows?.[1].kind, 'no-selection');
    assert.equal(final.legMetas?.length, 1);
    assert.equal(final.legMetas?.[0].gridVersion, 2);
    assert.equal(final.legMetas?.[0].pickCount, 1);
    assert.equal(final.legMetas?.[0].firstDate, '2026-01-05');
    assert.equal(final.legMetas?.[0].lastDate, '2026-01-07');
    assert.deepEqual(env.closeOuts, [{ runId: 'run-1', outcome: 'success' }]);
  });

  it('fetches the pick doc for [startDate, latest trading day] at the leg coordinate', async () => {
    const seen: { startDate?: string; endDate?: string; coordinate?: unknown } = {};
    const env = makeDeps({
      fetchPickDoc: async (input) => {
        seen.startDate = input.startDate;
        seen.endDate = input.endDate;
        seen.coordinate = input.coordinate;
        return pickDoc();
      },
    });
    await runReplayPermutation(PAYLOAD, env.deps, true);
    assert.equal(seen.startDate, '2026-01-05');
    assert.equal(seen.endDate, '2026-01-07');
    assert.deepEqual(seen.coordinate, {
      type: OptionType.PUT,
      targetDelta: -0.2,
      expiry: { mode: 'nearestDte', dte: 45 },
    });
  });

  it('multi-leg variant — one fetch per option leg, legs joined atomically, legMetas ordered', async () => {
    const run = {
      ...RUN,
      templateId: 'pcs-45-20-5',
      variantSnapshot: { name: 'pcs', legs: [LEG_SHORT_PUT_20, LEG_LONG_PUT_5] },
    };
    const coords: unknown[] = [];
    const env = makeDeps({
      getRun: async () => run,
      fetchPickDoc: async (input) => {
        coords.push(input.coordinate);
        // Distinct docs per leg — legMetas ordering is only
        // distinguishable when each leg's provenance differs (the SA-
        // served coordinate echoes back, so leg 1's doc reports Δ5).
        return (input.coordinate as PickDocCoordinate).targetDelta === -0.05
          ? pickDoc({ targetDelta: -0.05 })
          : pickDoc();
      },
    });
    await runReplayPermutation(PAYLOAD, env.deps, true);

    assert.equal(coords.length, 2);
    assert.deepEqual(coords[0], { type: OptionType.PUT, targetDelta: -0.2, expiry: { mode: 'nearestDte', dte: 45 } });
    assert.deepEqual(coords[1], { type: OptionType.PUT, targetDelta: -0.05, expiry: { mode: 'nearestDte', dte: 45 } });
    const final = env.writes[1].fields;
    assert.equal(final.status, 'success');
    assert.equal(final.legMetas?.length, 2);
    // Declared order — legMetas[0] is the Δ20 leg's doc, legMetas[1] Δ5.
    assert.equal(final.legMetas?.[0].coordinate.targetDelta, -0.2);
    assert.equal(final.legMetas?.[1].coordinate.targetDelta, -0.05);
    const row = final.rows?.[0];
    assert.equal(row?.kind, 'position');
    if (row?.kind === 'position') {
      assert.equal(row.legs.length, 2);
      assert.equal(row.legs[0].kind, 'option');
      assert.equal(row.legs[1].kind, 'option');
    }
  });

  it('one leg miss → no-selection row with legMisses naming that leg', async () => {
    const run = {
      ...RUN,
      variantSnapshot: { name: 'pcs', legs: [LEG_SHORT_PUT_20, LEG_LONG_PUT_5] },
    };
    let call = 0;
    const env = makeDeps({
      getRun: async () => run,
      fetchPickDoc: async () => {
        call++;
        // Second leg misses day 1.
        return call === 2 ? pickDoc({ days: { '2026-01-05': { status: 'no_match' } } }) : pickDoc();
      },
    });
    await runReplayPermutation(PAYLOAD, env.deps, true);
    const row = env.writes[1].fields.rows?.[0];
    assert.equal(row?.kind, 'no-selection');
    if (row?.kind === 'no-selection') {
      assert.equal(row.legMisses.length, 1);
      assert.equal(row.legMisses[0].legIndex, 1);
      assert.equal(row.legMisses[0].reason, 'miss');
    }
  });

  it('stock leg resolves off the pick doc — no fetch, position legs keep declared order', async () => {
    const run = {
      ...RUN,
      variantSnapshot: {
        name: 'cov',
        legs: [{ kind: 'stock', side: TradeSide.LONG } as VariantLeg, LEG_SHORT_PUT_20],
      },
    };
    let fetches = 0;
    const env = makeDeps({
      getRun: async () => run,
      fetchPickDoc: async () => {
        fetches++;
        return pickDoc();
      },
    });
    await runReplayPermutation(PAYLOAD, env.deps, true);
    assert.equal(fetches, 1);
    const row = env.writes[1].fields.rows?.[0];
    assert.equal(row?.kind, 'position');
    if (row?.kind === 'position') {
      assert.equal(row.legs[0].kind, 'stock');
      assert.equal(row.legs[1].kind, 'option');
      const stock = row.legs[0];
      if (stock.kind === 'stock') assert.equal(stock.underlyingClose, 580);
    }
  });

  it('missing variantSnapshot → permanent failure — run predates the model or was hand-built', async () => {
    const { variantSnapshot: _omit, ...preModelRun } = RUN;
    let fetches = 0;
    const env = makeDeps({
      getRun: async () => preModelRun,
      fetchPickDoc: async () => {
        fetches++;
        return pickDoc();
      },
    });
    await runReplayPermutation(PAYLOAD, env.deps, false);
    assert.equal(fetches, 0);
    const failed = env.writes.find((w) => w.fields.status === 'failed');
    assert.ok(failed);
    assert.match(String(failed.fields.error), /variantSnapshot/);
    assert.equal(env.closeOuts[0].outcome, 'failed');
  });

  it('malformed snapshot legs → permanent failure naming the leg errors', async () => {
    const env = makeDeps({
      getRun: async () => ({
        ...RUN,
        variantSnapshot: { name: 'x', legs: [{ kind: 'option', type: 'put', targetDelta: -0.21, dte: 45, side: 'short' }] },
      }),
    });
    await runReplayPermutation(PAYLOAD, env.deps, false);
    const failed = env.writes.find((w) => w.fields.status === 'failed');
    assert.ok(failed);
    assert.match(String(failed.fields.error), /leg 0/);
  });

  it('stock-only snapshot → permanent failure — nothing to select', async () => {
    const env = makeDeps({
      getRun: async () => ({
        ...RUN,
        variantSnapshot: { name: 'x', legs: [{ kind: 'stock', side: 'long' }] },
      }),
    });
    await runReplayPermutation(PAYLOAD, env.deps, false);
    const failed = env.writes.find((w) => w.fields.status === 'failed');
    assert.ok(failed);
    assert.match(String(failed.fields.error), /option leg/);
  });

  it('short-circuits when the list doc is already success — but still ensures close-out', async () => {
    const env = makeDeps({ getListDoc: async () => SUCCESS_DOC });
    await runReplayPermutation(PAYLOAD, env.deps, true);
    // No re-fetch/re-write, but the idempotent close-out runs — a prior
    // attempt may have written the doc and died before close-out.
    assert.equal(env.writes.length, 0);
    assert.deepEqual(env.closeOuts, [{ runId: 'run-1', outcome: 'success' }]);
  });

  it('short-circuits a failed doc — ensures close-out with the failed outcome and its error', async () => {
    const env = makeDeps({ getListDoc: async () => ({ status: 'failed', error: 'upstream 502' }) });
    await runReplayPermutation(PAYLOAD, env.deps, true);
    assert.equal(env.writes.length, 0);
    assert.deepEqual(env.closeOuts, [{ runId: 'run-1', outcome: 'failed', error: 'upstream 502' }]);
  });

  it('missing pick doc (404) → failed doc naming the leg coordinate, no retry', async () => {
    const env = makeDeps({
      fetchPickDoc: async () => {
        throw new PartnerHttpError('pick doc fetch failed for SPY-put-20-45: no year shard', 404, PARTNER_CODE_NOT_FOUND);
      },
    });
    // Not final attempt — coded 404 must still resolve now (retrying can't help).
    await runReplayPermutation(PAYLOAD, env.deps, false);

    const failed = env.writes.find((w) => w.fields.status === 'failed');
    assert.ok(failed);
    assert.match(String(failed.fields.error), /SPY-put-20-45/);
    assert.match(String(failed.fields.error), /leg 0/);
    assert.match(String(env.closeOuts[0].error ?? ''), /leg 0/);
  });

  it('multi-leg: the failing leg is named by index + coordinate', async () => {
    const run = {
      ...RUN,
      variantSnapshot: { name: 'pcs', legs: [LEG_SHORT_PUT_20, LEG_LONG_PUT_5] },
    };
    let call = 0;
    const env = makeDeps({
      getRun: async () => run,
      fetchPickDoc: async () => {
        call++;
        if (call === 2) {
          throw new PartnerHttpError('no shard', 404, PARTNER_CODE_NOT_FOUND);
        }
        return pickDoc();
      },
    });
    await runReplayPermutation(PAYLOAD, env.deps, false);
    const failed = env.writes.find((w) => w.fields.status === 'failed');
    assert.ok(failed);
    assert.match(String(failed.fields.error), /leg 1/);
  });

  it('404 with an unrecognized partner code → still permanent — a coded answer means the partner app responded deliberately (#1401)', async () => {
    const env = makeDeps({
      fetchPickDoc: async () => {
        throw new PartnerHttpError('shard stale', 404, 'SHARD_STALE');
      },
    });
    await runReplayPermutation(PAYLOAD, env.deps, false);
    const failed = env.writes.find((w) => w.fields.status === 'failed');
    assert.ok(failed);
    assert.match(String(env.closeOuts[0].error ?? ''), /shard stale/);
  });

  it('bare 404 (no partnerCode) → rethrows for task retry — infra miss is not a data gap (#1401)', async () => {
    const env = makeDeps({
      fetchPickDoc: async () => {
        throw new PartnerHttpError('partnerPickDoc upstream 404: <html>Page not found</html>', 404);
      },
    });
    // A bare 404 is a transport/config failure — the endpoint may appear
    // within backoff, so it must take the retry path like any 502.
    await assert.rejects(runReplayPermutation(PAYLOAD, env.deps, false), /404/);
    assert.equal(env.writes.filter((w) => w.fields.status === 'failed').length, 0);
    assert.equal(env.closeOuts.length, 0);
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
    assert.deepEqual(env.closeOuts, [
      { runId: 'run-1', outcome: 'failed', error: 'leg 0 pick doc (put Δ-0.2 45dte): upstream 502' },
    ]);
  });

  it('no trading days → retriable error (bars may lag)', async () => {
    const env = makeDeps({ loadTradingDays: async () => [] });
    await assert.rejects(runReplayPermutation(PAYLOAD, env.deps, false), /daily bars/i);
  });

  it('missing run doc → permanent failure — payload carries only identity (#1491)', async () => {
    const env = makeDeps({ getRun: async () => undefined });
    await runReplayPermutation(PAYLOAD, env.deps, false);
    const failed = env.writes.find((w) => w.fields.status === 'failed');
    assert.ok(failed);
    assert.match(String(failed.fields.error), /Missing run doc/);
    assert.deepEqual(env.closeOuts, [
      { runId: 'run-1', outcome: 'failed', error: "Missing run doc 'run-1'" },
    ]);
  });

  it('run doc missing selection inputs → permanent failure, no retries burned', async () => {
    // A run doc without startDate must fail fast — letting it reach
    // loadTradingDays produces a retriable 'no bars' error that spends
    // all MAX_ATTEMPTS rethrows to land in the same place.
    const env = makeDeps({ getRun: async () => ({ ...RUN, startDate: undefined }) });
    await runReplayPermutation(PAYLOAD, env.deps, false);
    // Exactly one write — the failed stub; a 'running' write leaking
    // before the guard would leave the doc stuck.
    assert.equal(env.writes.length, 1);
    const failed = env.writes.find((w) => w.fields.status === 'failed');
    assert.ok(failed);
    assert.match(String(failed.fields.error), /selection inputs/);
    assert.deepEqual(env.closeOuts, [{ runId: 'run-1', outcome: 'failed', error: failed.fields.error as string }]);
  });

  for (const [name, run] of [
    ['missing templateId', { ...RUN, templateId: undefined }],
    ['missing symbol', { ...RUN, symbol: undefined }],
    ['malformed startDate (truthy non-date)', { ...RUN, startDate: 'garbage' }],
    ['malformed startDate (whitespace)', { ...RUN, startDate: '   ' }],
  ] as const) {
    it(`malformed run doc (${name}) → permanent failure before any fetch`, async () => {
      // Shape, not just presence — a corrupt-but-truthy startDate is
      // equally unfillable and must not spend the retry budget (#1491).
      const seen = { fetchCalls: 0 };
      const env = makeDeps({
        getRun: async () => run,
        fetchPickDoc: async () => {
          seen.fetchCalls++;
          return pickDoc();
        },
      });
      await runReplayPermutation(PAYLOAD, env.deps, false);
      assert.equal(seen.fetchCalls, 0);
      assert.equal(env.writes.length, 1);
      assert.equal(env.writes[0].fields.status, 'failed');
    });
  }

  it('the data path uses run.symbol, not payload.symbol — the run doc is the selection source of truth', async () => {
    // payload {runId:'run-1', symbol:'SPY'} but the run doc says QQQ —
    // bars/picks/writes must all carry QQQ (or a forged payload could
    // fetch and persist under the wrong symbol, silently).
    const seen: { barsSymbol?: string; pickDocSymbol?: string } = {};
    const env = makeDeps({
      getRun: async () => ({ ...RUN, symbol: 'QQQ' }),
      loadTradingDays: async (symbol) => {
        seen.barsSymbol = symbol;
        return ['2026-01-05'];
      },
      fetchPickDoc: async (input) => {
        seen.pickDocSymbol = input.symbol;
        return pickDoc();
      },
    });
    await runReplayPermutation(PAYLOAD, env.deps, true);
    assert.equal(seen.barsSymbol, 'QQQ');
    assert.equal(seen.pickDocSymbol, 'QQQ');
    assert.equal(env.writes[0].fields.symbol, 'QQQ');
  });
});

describe('resolveCloseOutStatus — run status for a terminal list outcome (#1430)', () => {
  it('maps list outcome → run status: success→completed, failed→failed', () => {
    assert.equal(resolveCloseOutStatus('running', 'success'), 'completed');
    assert.equal(resolveCloseOutStatus('running', 'failed'), 'failed');
    assert.equal(resolveCloseOutStatus('pending', 'success'), 'completed');
    assert.equal(resolveCloseOutStatus('pending', 'failed'), 'failed');
  });

  it('terminal-skip — an already-terminal run is never regressed', () => {
    // completed stays completed even on a late 'failed' outcome; failed
    // stays failed even on a late 'success' (lost-ack enqueue edge).
    assert.equal(resolveCloseOutStatus('completed', 'success'), null);
    assert.equal(resolveCloseOutStatus('completed', 'failed'), null);
    assert.equal(resolveCloseOutStatus('failed', 'success'), null);
    assert.equal(resolveCloseOutStatus('failed', 'failed'), null);
  });

  it('cancelled and missing-doc runs are skipped — no resurrection, no NOT_FOUND', () => {
    // 'cancelled' is unreachable today, but a late worker must never
    // resurrect it; a missing run doc (deleted mid-flight) must not die
    // on tx.update — skip quietly instead of burning task retries.
    assert.equal(resolveCloseOutStatus('cancelled', 'success'), null);
    assert.equal(resolveCloseOutStatus('cancelled', 'failed'), null);
    assert.equal(resolveCloseOutStatus(undefined, 'success'), null);
    assert.equal(resolveCloseOutStatus(undefined, 'failed'), null);
  });
});

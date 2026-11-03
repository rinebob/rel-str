/**
 * Unit tests for `runReplayRetry` — the `optionsReplayRetry` callable core
 * (Topic #1238, Thread #1266, task #1369). All effects go through the
 * injectable `ReplayRetryDeps` seam (TEST-BE): fixture run docs, captured
 * list-doc resets / run resets / enqueued payloads — no Firestore, no
 * Cloud Tasks.
 *
 * Covers TEST-BE §`optionsReplayRetry`:
 * - mixed run: only failed list docs reset + re-enqueued; success untouched
 * - no failed lists → `{retriedSymbols:[]}`, zero writes, zero tasks
 * - run pending/running/cancelled → no-op
 * - missing run → not-found; bad input → invalid-argument
 * - enqueue failure → run marked failed + internal surfaced
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  runReplayRetry,
  shouldResetForRetry,
} from '../../../functions/src/options-replay/retry';
import type {
  ReplayRetryDeps,
  ReplayRetryRunView,
} from '../../../functions/src/options-replay/retry';
import type { OptionsReplayPermutationPayload } from '@options-replay/contracts';

/** HttpsError.code is the FunctionsErrorCode string — read the property
 *  instead of importing firebase-functions (resolution walks up from this
 *  file, which has no functions/node_modules path). */
function code(e: unknown): string | undefined {
  return (e as { code?: string }).code;
}

// ==========================
// Fakes
// ==========================

const RUN_ID = 'or-2026-11-02_tue_1200_manual_x9';

function runView(overrides: Partial<ReplayRetryRunView> = {}): ReplayRetryRunView {
  return {
    status: 'completed',
    templateId: 'csp-45-20',
    startDate: '2026-01-05',
    listOutcomes: { QQQ: 'failed', SPY: 'success', IWM: 'failed' },
    ...overrides,
  };
}

/** Pass `null` for a missing run doc (undefined would hit the default). */
function makeDeps(
  run: ReplayRetryRunView | null = runView(),
  opts: { resetReturns?: string[] } = {},
): {
  deps: ReplayRetryDeps;
  listResets: string[];
  runResets: { runId: string; symbols: string[] }[];
  enqueued: OptionsReplayPermutationPayload[];
  failures: { runId: string; error: string; unEnqueued: string[] }[];
  order: string[];
} {
  const listResets: string[] = [];
  const runResets: { runId: string; symbols: string[] }[] = [];
  const enqueued: OptionsReplayPermutationPayload[] = [];
  const failures: { runId: string; error: string; unEnqueued: string[] }[] = [];
  const order: string[] = [];
  return {
    listResets,
    runResets,
    enqueued,
    failures,
    order,
    deps: {
      async getRun() {
        order.push('getRun');
        return run ?? undefined;
      },
      async resetListDoc(docId) {
        listResets.push(docId);
        order.push(`resetList:${docId}`);
      },
      async resetRunForRetry(runId, symbols) {
        runResets.push({ runId, symbols });
        order.push(`resetRun:${symbols.join(',')}`);
        return opts.resetReturns ?? symbols;
      },
      async enqueue(payload) {
        enqueued.push(payload);
        order.push(`enqueue:${payload.symbol}`);
      },
      async failRun(runId, error, unEnqueued) {
        failures.push({ runId, error, unEnqueued });
        order.push(`failRun`);
      },
    },
  };
}

// ==========================
// Reset predicate (#1370 review — the safety-critical guard inside the
// resetListDoc transaction, extracted for direct coverage)
// ==========================

describe('shouldResetForRetry', () => {
  it('resets failed, pending, and missing docs only', () => {
    assert.equal(shouldResetForRetry('failed'), true);
    assert.equal(shouldResetForRetry('pending'), true);
    assert.equal(shouldResetForRetry(undefined), true);
    assert.equal(shouldResetForRetry('success'), false);
    assert.equal(shouldResetForRetry('running'), false);
  });
});

// ==========================
// Happy path — mixed run
// ==========================

describe('runReplayRetry — mixed success/failed run', () => {
  it('resets only the failed list docs, re-enqueues only failed symbols', async () => {
    const { deps, listResets, runResets, enqueued, order } = makeDeps();
    const res = await runReplayRetry({ runId: RUN_ID }, deps);

    assert.deepEqual(res.retriedSymbols, ['IWM', 'QQQ']);
    // Failed docs reset via the canonical doc-key builder — SPY untouched.
    assert.deepEqual(listResets.sort(), [`${RUN_ID}_IWM`, `${RUN_ID}_QQQ`]);
    assert.equal(runResets.length, 1);
    assert.equal(runResets[0].runId, RUN_ID);
    assert.deepEqual(runResets[0].symbols, ['IWM', 'QQQ']);
    // Payloads carry the run's templateId + startDate.
    assert.deepEqual(enqueued.map((p) => p.symbol), ['IWM', 'QQQ']);
    for (const p of enqueued) {
      assert.equal(p.runId, RUN_ID);
      assert.equal(p.templateId, 'csp-45-20');
      assert.equal(p.startDate, '2026-01-05');
    }
    // Ordering: every reset lands before the first enqueue — a worker that
    // dispatches early must never see a still-'failed' doc (terminal skip).
    const lastReset = Math.max(
      ...order.map((o, i) => (o.startsWith('reset') ? i : -1)),
    );
    const firstEnqueue = order.findIndex((o) => o.startsWith('enqueue:'));
    assert.ok(lastReset !== -1 && lastReset < firstEnqueue, 'resets must precede enqueue');
  });
});

// ==========================
// No-op paths
// ==========================

describe('runReplayRetry — no-op paths', () => {
  it('returns empty when no lists failed — zero writes, zero tasks', async () => {
    const { deps, listResets, runResets, enqueued, failures } = makeDeps(
      runView({ listOutcomes: { SPY: 'success', IWM: 'success' } }),
    );
    const res = await runReplayRetry({ runId: RUN_ID }, deps);
    assert.deepEqual(res.retriedSymbols, []);
    assert.equal(listResets.length, 0);
    assert.equal(runResets.length, 0);
    assert.equal(enqueued.length, 0);
    assert.equal(failures.length, 0);
  });

  for (const status of ['pending', 'running', 'cancelled'] as const) {
    it(`no-ops while run status is '${status}'`, async () => {
      const { deps, listResets, runResets, enqueued } = makeDeps(runView({ status }));
      const res = await runReplayRetry({ runId: RUN_ID }, deps);
      assert.deepEqual(res.retriedSymbols, []);
      assert.equal(listResets.length, 0);
      assert.equal(runResets.length, 0);
      assert.equal(enqueued.length, 0);
    });
  }

  it('still retries on a failed run (that is the point)', async () => {
    const { deps, enqueued } = makeDeps(runView({ status: 'failed' }));
    const res = await runReplayRetry({ runId: RUN_ID }, deps);
    assert.deepEqual(res.retriedSymbols, ['IWM', 'QQQ']);
    assert.equal(enqueued.length, 2);
  });

  it('no-ops when the transaction resets nothing (concurrent retry claimed the outcomes)', async () => {
    const { deps, enqueued } = makeDeps(runView(), { resetReturns: [] });
    const res = await runReplayRetry({ runId: RUN_ID }, deps);
    assert.deepEqual(res.retriedSymbols, []);
    assert.equal(enqueued.length, 0);
  });

  it('enqueues only the symbols the transaction actually reset', async () => {
    const { deps, enqueued } = makeDeps(runView(), { resetReturns: ['QQQ'] });
    const res = await runReplayRetry({ runId: RUN_ID }, deps);
    assert.deepEqual(res.retriedSymbols, ['QQQ']);
    assert.deepEqual(enqueued.map((p) => p.symbol), ['QQQ']);
  });
});

// ==========================
// Validation
// ==========================

describe('runReplayRetry — validation', () => {
  it('missing run doc → not-found', async () => {
    const { deps } = makeDeps(null);
    await assert.rejects(
      runReplayRetry({ runId: RUN_ID }, deps),
      (e: unknown) => code(e) === 'not-found',
    );
  });

  for (const bad of [undefined, {}, { runId: '' }, { runId: '   ' }, { runId: 42 }]) {
    it(`invalid input ${JSON.stringify(bad)} → invalid-argument`, async () => {
      const { deps } = makeDeps();
      await assert.rejects(
        runReplayRetry(bad as never, deps),
        (e: unknown) => code(e) === 'invalid-argument',
      );
    });
  }
});

// ==========================
// Enqueue failure
// ==========================

describe('runReplayRetry — enqueue failure', () => {
  it('marks the run failed, restores the un-enqueued outcomes, and surfaces internal', async () => {
    const { deps, failures, enqueued } = makeDeps();
    deps.enqueue = async (p) => {
      enqueued.push(p);
      if (p.symbol === 'QQQ') throw new Error('queue exploded');
    };
    await assert.rejects(
      runReplayRetry({ runId: RUN_ID }, deps),
      (e: unknown) => code(e) === 'internal',
    );
    assert.equal(failures.length, 1);
    assert.equal(failures[0].runId, RUN_ID);
    assert.match(failures[0].error, /queue exploded/);
    // Only the rejected symbol is handed back for outcome restoration —
    // a landed task resolves its own doc.
    assert.deepEqual(failures[0].unEnqueued, ['QQQ']);
  });
});

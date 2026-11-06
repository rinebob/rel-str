/**
 * Unit tests for `runReplayRetry` — the `optionsReplayRetry` callable core
 * (Topic #1238, Thread #1266, task #1369; single-symbol runs #1430). All
 * effects go through the injectable `ReplayRetryDeps` seam (TEST-BE):
 * fixture run docs, captured claims / enqueued payloads — no Firestore,
 * no Cloud Tasks.
 *
 * Covers:
 * - failed run: one atomic claim (list reset + run flip in one tx) +
 *   one payload re-enqueued
 * - non-failed statuses → `{retriedSymbol:null}`, zero writes, zero tasks
 * - missing run → not-found; bad input → invalid-argument
 * - enqueue failure → failRun restores + internal surfaced
 * - concurrent claim (claimRetry returns false) → no-op
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

const RUN_ID = 'or-2026-11-02_tue_1200_manual_x9_SPY';

function runView(overrides: Partial<ReplayRetryRunView> = {}): ReplayRetryRunView {
  return {
    status: 'failed',
    templateId: 'csp-45-20',
    startDate: '2026-01-05',
    symbol: 'SPY',
    ...overrides,
  };
}

/** Pass `null` for a missing run doc (undefined would hit the default). */
function makeDeps(
  run: ReplayRetryRunView | null = runView(),
  opts: { claimed?: boolean } = {},
): {
  deps: ReplayRetryDeps;
  claims: string[];
  enqueued: OptionsReplayPermutationPayload[];
  failures: { runId: string; error: string }[];
  order: string[];
} {
  const claims: string[] = [];
  const enqueued: OptionsReplayPermutationPayload[] = [];
  const failures: { runId: string; error: string }[] = [];
  const order: string[] = [];
  return {
    claims,
    enqueued,
    failures,
    order,
    deps: {
      async getRun() {
        order.push('getRun');
        return run ?? undefined;
      },
      async claimRetry(runId) {
        claims.push(runId);
        order.push(`claim:${runId}`);
        return opts.claimed ?? true;
      },
      async enqueue(payload) {
        enqueued.push(payload);
        order.push(`enqueue:${payload.symbol}`);
      },
      async failRun(runId, error) {
        failures.push({ runId, error });
        order.push(`failRun`);
      },
    },
  };
}

// ==========================
// Reset predicate (#1370 review — the safety-critical guard inside the
// claimRetry transaction, extracted for direct coverage)
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
// Happy path
// ==========================

describe('runReplayRetry — failed run', () => {
  it('claims the run atomically (list reset + run flip in one tx) and re-enqueues one payload', async () => {
    const { deps, claims, enqueued, order } = makeDeps();
    const res = await runReplayRetry({ runId: RUN_ID }, deps);

    assert.equal(res.retriedSymbol, 'SPY');
    assert.deepEqual(claims, [RUN_ID]);
    assert.equal(enqueued.length, 1);
    assert.deepEqual(enqueued[0], {
      runId: RUN_ID,
      symbol: 'SPY',
      templateId: 'csp-45-20',
      startDate: '2026-01-05',
    });
    // Ordering: the claim commits before enqueue — a worker that
    // dispatches early must never see a still-'failed' doc (terminal skip).
    const claimIdx = order.findIndex((o) => o.startsWith('claim:'));
    const firstEnqueue = order.findIndex((o) => o.startsWith('enqueue:'));
    assert.ok(claimIdx !== -1 && claimIdx < firstEnqueue, 'claim must precede enqueue');
  });
});

// ==========================
// No-op paths
// ==========================

describe('runReplayRetry — no-op paths', () => {
  for (const status of ['pending', 'running', 'cancelled', 'completed'] as const) {
    it(`no-ops while run status is '${status}'`, async () => {
      const { deps, claims, enqueued } = makeDeps(runView({ status }));
      const res = await runReplayRetry({ runId: RUN_ID }, deps);
      assert.equal(res.retriedSymbol, null);
      assert.equal(claims.length, 0);
      assert.equal(enqueued.length, 0);
    });
  }

  it('no-ops a legacy failed run with no scalar symbol (pre-migration doc)', async () => {
    // Legacy runs carry symbols[] — they can't carry a single-symbol
    // payload; retry must no-op rather than enqueue symbol:undefined.
    const legacy = { ...runView() } as Partial<ReplayRetryRunView>;
    delete legacy.symbol;
    const { deps, claims, enqueued } = makeDeps(legacy as ReplayRetryRunView);
    const res = await runReplayRetry({ runId: RUN_ID }, deps);
    assert.equal(res.retriedSymbol, null);
    assert.equal(claims.length, 0);
    assert.equal(enqueued.length, 0);
  });

  it('no-ops when the transaction does not claim the run (concurrent retry won)', async () => {
    const { deps, enqueued } = makeDeps(runView(), { claimed: false });
    const res = await runReplayRetry({ runId: RUN_ID }, deps);
    assert.equal(res.retriedSymbol, null);
    assert.equal(enqueued.length, 0);
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
  it('restores the run to failed via failRun and surfaces internal', async () => {
    const { deps, failures } = makeDeps();
    deps.enqueue = async () => {
      throw new Error('queue exploded');
    };
    await assert.rejects(
      runReplayRetry({ runId: RUN_ID }, deps),
      (e: unknown) => code(e) === 'internal',
    );
    assert.equal(failures.length, 1);
    assert.equal(failures[0].runId, RUN_ID);
    assert.match(failures[0].error, /queue exploded/);
  });
});

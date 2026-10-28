/**
 * Unit tests for `startReplay` — the `optionsReplayStart` callable core
 * (Topic #1238, task #1281). The onCall wrapper stays a thin adapter; all
 * Firestore + task-queue effects go through the injectable `ReplayStartDeps`
 * seam so these tests run with fakes (TEST-BE: validation + fanout shape).
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { startReplay } from '../../../functions/src/options-replay/start';
import type {
  ReplayStartDeps,
  OptionsReplayRunWrite,
} from '../../../functions/src/options-replay/start';
import type { OptionsReplayPermutationPayload } from '@options-replay/contracts';

// ==========================
// Fake deps
// ==========================

interface CapturedCall {
  markStatus?: string;
  markError?: string;
}

function makeDeps(): {
  deps: ReplayStartDeps;
  runs: Map<string, OptionsReplayRunWrite>;
  calls: CapturedCall[];
  enqueued: OptionsReplayPermutationPayload[];
  order: string[];
  } {
  const runs = new Map<string, OptionsReplayRunWrite>();
  const calls: CapturedCall[] = [];
  const enqueued: OptionsReplayPermutationPayload[] = [];
  const order: string[] = [];
  return {
    runs,
    calls,
    enqueued,
    order,
    deps: {
      async createRun(runId, doc) {
        runs.set(runId, doc);
        order.push(`create:${doc.status}`);
      },
      async markRunStatus(runId, status, error) {
        calls.push({ markStatus: status, markError: error });
        order.push(`mark:${status}`);
      },
      async enqueue(payload) {
        enqueued.push(payload);
        order.push(`enqueue:${payload.symbol}`);
      },
    },
  };
}

const VALID = {
  templateId: 'csp-45-20',
  symbols: ['SPY', 'qqq'],
  startDate: '2026-01-05',
};

// ==========================
// Tests
// ==========================

describe('startReplay', () => {
  it('creates a pending run doc, enqueues one task per symbol, marks running', async () => {
    const { deps, runs, calls, enqueued, order } = makeDeps();

    const resp = await startReplay(VALID, deps);

    assert.equal(runs.size, 1);
    const [runId, doc] = [...runs.entries()][0];
    assert.equal(resp.runId, runId);
    assert.equal(doc.runId, runId);
    assert.equal(doc.templateId, 'csp-45-20');
    assert.deepEqual(doc.symbols, ['SPY', 'QQQ']);
    assert.equal(doc.startDate, '2026-01-05');
    assert.equal(doc.status, 'pending');
    assert.equal(doc.totalLists, 2);
    assert.equal(doc.completedLists, 0);
    assert.equal(doc.failedLists, 0);

    assert.equal(enqueued.length, 2);
    assert.deepEqual(enqueued[0], {
      runId,
      symbol: 'SPY',
      templateId: 'csp-45-20',
      startDate: '2026-01-05',
    });
    assert.equal(enqueued[1].symbol, 'QQQ');

    assert.deepEqual(calls, [{ markStatus: 'running', markError: undefined }]);
    // 'running' lands before any task exists — a fast worker can't regress it.
    assert.deepEqual(order, [
      'create:pending',
      'mark:running',
      'enqueue:SPY',
      'enqueue:QQQ',
    ]);
  });

  it('rejects an unknown templateId with invalid-argument and no side effects', async () => {
    const { deps, runs, enqueued } = makeDeps();
    await assert.rejects(
      startReplay({ ...VALID, templateId: 'nope' }, deps),
      (e) => (e as { code?: string }).code === 'invalid-argument',
    );
    assert.equal(runs.size, 0);
    assert.equal(enqueued.length, 0);
  });

  it('rejects a missing templateId with invalid-argument', async () => {
    const { deps, runs } = makeDeps();
    await assert.rejects(
      startReplay({ ...VALID, templateId: '' }, deps),
      (e) => (e as { code?: string }).code === 'invalid-argument',
    );
    assert.equal(runs.size, 0);
  });

  it('rejects empty symbols with invalid-argument and no side effects', async () => {
    const { deps, runs, enqueued } = makeDeps();
    await assert.rejects(
      startReplay({ ...VALID, symbols: [' ', ''] }, deps),
      (e) => (e as { code?: string }).code === 'invalid-argument',
    );
    assert.equal(runs.size, 0);
    assert.equal(enqueued.length, 0);
  });

  it('rejects non-request-shaped input with invalid-argument, not internal', async () => {
    const { deps, runs } = makeDeps();
    await assert.rejects(
      startReplay(undefined, deps),
      (e) => (e as { code?: string }).code === 'invalid-argument',
    );
    await assert.rejects(
      startReplay({ ...VALID, symbols: 'SPY' as unknown as string[] }, deps),
      (e) => (e as { code?: string }).code === 'invalid-argument',
    );
    await assert.rejects(
      startReplay({ ...VALID, templateId: 42 as unknown as string }, deps),
      (e) => (e as { code?: string }).code === 'invalid-argument',
    );
    assert.equal(runs.size, 0);
  });

  it('rejects a malformed startDate — never creates a run', async () => {
    const { deps, runs } = makeDeps();
    for (const startDate of ['not-a-date', '2026-13-45', '2026-02-30']) {
      await assert.rejects(
        startReplay({ ...VALID, startDate }, deps),
        (e) => (e as { code?: string }).code === 'invalid-argument',
        `expected invalid-argument for ${startDate}`,
      );
    }
    assert.equal(runs.size, 0);
  });

  it('normalizes symbols and dedupes so one list doc maps to one task', async () => {
    const { deps, runs, enqueued } = makeDeps();
    await startReplay({ ...VALID, symbols: [' spy ', 'SPY', 'qqq'] }, deps);
    const doc = [...runs.values()][0];
    assert.deepEqual(doc.symbols, ['SPY', 'QQQ']);
    assert.equal(doc.totalLists, 2);
    assert.equal(enqueued.length, 2);
  });

  it('marks the run failed and surfaces internal when an enqueue throws', async () => {
    const { deps, runs, calls } = makeDeps();
    deps.enqueue = async () => {
      throw new Error('queue down');
    };
    await assert.rejects(
      startReplay(VALID, deps),
      (e) => (e as { code?: string }).code === 'internal',
    );
    assert.equal(runs.size, 1);
    assert.deepEqual(calls.map((c) => c.markStatus), ['running', 'failed']);
    assert.match(calls[1].markError ?? '', /queue down/);
  });
});

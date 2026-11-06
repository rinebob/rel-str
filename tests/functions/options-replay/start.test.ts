/**
 * Unit tests for `startReplay` — the `optionsReplayStart` callable core
 * (Topic #1238, task #1281; single-symbol runs #1430). The onCall wrapper
 * stays a thin adapter; all Firestore + task-queue effects go through the
 * injectable `ReplayStartDeps` seam so these tests run with fakes
 * (TEST-BE: validation + per-symbol fanout shape).
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
  runId: string;
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
        order.push(`create:${doc.symbol}:${doc.status}`);
      },
      async markRunEnqueueFailed(runId, error) {
        calls.push({ runId, markError: error });
        order.push(`mark-failed`);
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

/** runId's `_{SYMBOL}` suffix — `endsWith`, never a split-parse of the id. */
function runIdEndsWithSymbol(runId: string, symbol: string): boolean {
  return runId.endsWith(`_${symbol}`);
}

// ==========================
// Tests
// ==========================

describe('startReplay', () => {
  it('creates one independent run doc per symbol, enqueues one task each', async () => {
    const { deps, runs, enqueued } = makeDeps();

    const resp = await startReplay(VALID, deps);

    assert.equal(runs.size, 2);
    assert.equal(resp.runIds.length, 2);
    assert.deepEqual([...runs.keys()].sort(), [...resp.runIds].sort());

    for (const [runId, doc] of runs) {
      assert.equal(doc.runId, runId);
      assert.equal(doc.templateId, 'csp-45-20');
      assert.equal(doc.startDate, '2026-01-05');
      assert.equal(doc.status, 'running');
      // The runId embeds the (uppercased, normalized) symbol.
      assert.ok(runIdEndsWithSymbol(runId, doc.symbol));
      assert.match(doc.symbol, /^[A-Z]+$/);
    }
    const docSymbols = [...runs.values()].map((d) => d.symbol).sort();
    assert.deepEqual(docSymbols, ['QQQ', 'SPY']);

    // One permutation task per run — each payload carries its own runId.
    assert.equal(enqueued.length, 2);
    for (const p of enqueued) {
      assert.ok(runs.has(p.runId), `payload runId ${p.runId} must match a created run`);
      assert.equal(p.templateId, 'csp-45-20');
      assert.equal(p.startDate, '2026-01-05');
      assert.ok(runIdEndsWithSymbol(p.runId, p.symbol));
    }
    assert.deepEqual(enqueued.map((p) => p.symbol).sort(), ['QQQ', 'SPY']);
  });

  it('creates each run running BEFORE its own enqueue — a fast worker cannot regress it', async () => {
    const { deps, order } = makeDeps();

    await startReplay({ ...VALID, symbols: ['SPY'] }, deps);

    // Born running — there is no blind post-create status write to guard.
    assert.deepEqual(order, [
      'create:SPY:running',
      'enqueue:SPY',
    ]);
  });

  it('a failed enqueue fails only that run — remaining symbols still fan out', async () => {
    const { deps, runs, calls, enqueued } = makeDeps();
    deps.enqueue = async (p) => {
      enqueued.push(p);
      if (p.symbol === 'QQQ') throw new Error('queue down');
    };

    const resp = await startReplay({ ...VALID, symbols: ['SPY', 'QQQ', 'IWM'] }, deps);

    // All three run docs exist; the callable does NOT throw.
    assert.equal(resp.runIds.length, 3);
    const bySymbol = new Map([...runs.values()].map((d) => [d.symbol, d.runId]));
    for (const sym of ['SPY', 'QQQ', 'IWM']) assert.ok(bySymbol.has(sym));

    const failedMark = calls.find((c) => c.markError);
    assert.ok(failedMark);
    assert.equal(failedMark.runId, bySymbol.get('QQQ'));
    assert.match(failedMark.markError ?? '', /queue down/);
    // SPY and IWM had no failure mark — created running and left alone.
    for (const sym of ['SPY', 'IWM']) {
      const marks = calls.filter((c) => c.runId === bySymbol.get(sym));
      assert.equal(marks.length, 0);
    }
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

  it('rejects symbols outside the ticker charset — a doc-path-illegal symbol must not poison the fanout (#1430 R3)', async () => {
    const { deps, runs, enqueued } = makeDeps();
    // '/' would land in the runId → invalid Firestore doc path → createRun
    // rejects mid-fanout, failing the callable for ALL symbols.
    for (const symbols of [['SPY/QQQ'], ['SPY', 'BAD/'], ['BRK\\B'], ['$SPY'], ['TOOLONGTICKERXX']]) {
      await assert.rejects(
        startReplay({ ...VALID, symbols }, deps),
        (e) => (e as { code?: string }).code === 'invalid-argument',
        `expected invalid-argument for ${JSON.stringify(symbols)}`,
      );
    }
    assert.equal(runs.size, 0);
    assert.equal(enqueued.length, 0);
    // The legal suffix alphabet still passes.
    const resp = await startReplay({ ...VALID, symbols: ['BRK.B', 'BF-B'] }, deps);
    assert.equal(resp.runIds.length, 2);
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

  it('normalizes and dedupes symbols — one run doc per distinct symbol', async () => {
    const { deps, runs, enqueued } = makeDeps();
    const resp = await startReplay({ ...VALID, symbols: [' spy ', 'SPY', 'qqq'] }, deps);
    assert.equal(runs.size, 2);
    assert.equal(resp.runIds.length, 2);
    assert.equal(enqueued.length, 2);
    assert.deepEqual([...runs.values()].map((d) => d.symbol).sort(), ['QQQ', 'SPY']);
  });
});

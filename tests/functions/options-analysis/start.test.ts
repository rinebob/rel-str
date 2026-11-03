/**
 * Unit tests for `runAnalysisStart` — the `optionsAnalysisStart` callable
 * core (Topic #1238, Thread #1266, task #1370). All effects go through
 * the injectable `AnalysisStartDeps` seam (TEST-BE): fixture list docs,
 * captured enqueued payloads — no Firestore, no Cloud Tasks.
 *
 * Covers TEST-BE §`optionsAnalysisStart`:
 * - missing doc / non-'success' status → failed-precondition
 * - valid → task payload carries contractListDocId, runId, symbol,
 *   templateId, registryVersion (current EXIT_REGISTRY_VERSION)
 * - response `{analysisId: contractListDocId}`
 * - re-invocation enqueues a fresh task (idempotent overwrite)
 * - malformed input → invalid-argument
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { runAnalysisStart } from '../../../functions/src/options-analysis/start';
import type {
  AnalysisStartDeps,
  AnalysisStartListView,
} from '../../../functions/src/options-analysis/start';
import type { OptionsAnalysisTaskPayload } from '@options-analysis/contracts';
import { EXIT_REGISTRY_VERSION } from '@options-analysis/registry';

/** HttpsError.code is the FunctionsErrorCode string — read the property
 *  instead of importing firebase-functions (resolution walks up from this
 *  file, which has no functions/node_modules path). */
function code(e: unknown): string | undefined {
  return (e as { code?: string }).code;
}

// ==========================
// Fakes
// ==========================

const DOC_ID = 'or-2026-11-02_tue_1200_manual_x9_QQQ';

function listView(overrides: Partial<AnalysisStartListView> = {}): AnalysisStartListView {
  return {
    runId: 'or-2026-11-02_tue_1200_manual_x9',
    symbol: 'QQQ',
    templateId: 'csp-45-20',
    status: 'success',
    ...overrides,
  };
}

/** Pass `null` for a missing list doc (undefined would hit the default). */
function makeDeps(
  doc: AnalysisStartListView | null = listView(),
  opts: { enqueueFails?: boolean } = {},
): { deps: AnalysisStartDeps; enqueued: OptionsAnalysisTaskPayload[] } {
  const enqueued: OptionsAnalysisTaskPayload[] = [];
  return {
    enqueued,
    deps: {
      async getListDoc() {
        return doc ?? undefined;
      },
      async enqueue(payload) {
        if (opts.enqueueFails) throw new Error('queue unavailable');
        enqueued.push(payload);
      },
    },
  };
}

// ==========================
// Specs
// ==========================

describe('runAnalysisStart — success path', () => {
  it('enqueues one analysis task carrying all five payload fields', async () => {
    const { deps, enqueued } = makeDeps();
    const res = await runAnalysisStart({ contractListDocId: DOC_ID }, deps);
    assert.equal(enqueued.length, 1);
    assert.deepEqual(enqueued[0], {
      contractListDocId: DOC_ID,
      runId: 'or-2026-11-02_tue_1200_manual_x9',
      symbol: 'QQQ',
      templateId: 'csp-45-20',
      registryVersion: EXIT_REGISTRY_VERSION,
    });
    assert.deepEqual(res, { analysisId: DOC_ID });
  });

  it('payload fields come from the doc, not parsed from the docId', async () => {
    const { deps, enqueued } = makeDeps(
      listView({ runId: 'other-run', symbol: 'SPY' }),
    );
    await runAnalysisStart({ contractListDocId: 'unrelated-id' }, deps);
    assert.equal(enqueued[0].runId, 'other-run');
    assert.equal(enqueued[0].symbol, 'SPY');
  });

  it('re-invocation enqueues a fresh task (idempotent overwrite)', async () => {
    const { deps, enqueued } = makeDeps();
    await runAnalysisStart({ contractListDocId: DOC_ID }, deps);
    await runAnalysisStart({ contractListDocId: DOC_ID }, deps);
    assert.equal(enqueued.length, 2);
    assert.deepEqual(enqueued[0], enqueued[1]);
  });
});

describe('runAnalysisStart — failed-precondition', () => {
  it('missing doc → failed-precondition, zero enqueues', async () => {
    const { deps, enqueued } = makeDeps(null);
    await assert.rejects(
      runAnalysisStart({ contractListDocId: 'nope' }, deps),
      (e) => code(e) === 'failed-precondition',
    );
    assert.equal(enqueued.length, 0);
  });

  for (const status of ['pending', 'running', 'failed'] as const) {
    it(`status '${status}' → failed-precondition, zero enqueues`, async () => {
      const { deps, enqueued } = makeDeps(listView({ status }));
      await assert.rejects(
        runAnalysisStart({ contractListDocId: DOC_ID }, deps),
        (e) => code(e) === 'failed-precondition',
      );
      assert.equal(enqueued.length, 0);
    });
  }
});

describe('runAnalysisStart — validation', () => {
  const badInputs: [string, unknown][] = [
    ['undefined', undefined],
    ['empty object', {}],
    ['empty string', { contractListDocId: '' }],
    ['whitespace', { contractListDocId: '   ' }],
    ['non-string', { contractListDocId: 42 }],
  ];
  for (const [label, input] of badInputs) {
    it(`${label} → invalid-argument`, async () => {
      const { deps, enqueued } = makeDeps();
      await assert.rejects(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        runAnalysisStart(input as any, deps),
        (e) => code(e) === 'invalid-argument',
      );
      assert.equal(enqueued.length, 0);
    });
  }
});

describe('runAnalysisStart — enqueue failure', () => {
  it('surfaces internal and preserves the cause message', async () => {
    const { deps } = makeDeps(listView(), { enqueueFails: true });
    await assert.rejects(
      runAnalysisStart({ contractListDocId: DOC_ID }, deps),
      (e) =>
        code(e) === 'internal' &&
        (e as Error).message.includes('queue unavailable'),
    );
  });
});

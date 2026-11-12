import { convertAnalysisResultDoc } from './options-analysis-firestore-converter';
import { EXIT_REGISTRY_VERSION } from '@options-analysis/registry';

describe('options-analysis-firestore-converter', () => {
  it('maps a full success doc', () => {
    const doc = convertAnalysisResultDoc({
      contractListDocId: 'run-1_SPY',
      runId: 'run-1',
      symbol: 'SPY',
      templateId: 'csp-45-20',
      exitId: 'target-90',
      registryVersion: EXIT_REGISTRY_VERSION,
      status: 'success',
      trades: [{ outcome: 'exit', pickDate: '2026-06-10' }],
      aggregate: { exitId: 'target-90', contractCount: 10, exitedCount: 7, expiredCount: 2, errorCount: 1 },
      generatedAt: '2026-11-05T00:00:00Z',
    });

    expect(doc.contractListDocId).toBe('run-1_SPY');
    expect(doc.exitId).toBe('target-90');
    expect(doc.registryVersion).toBe(EXIT_REGISTRY_VERSION);
    expect(doc.status).toBe('success');
    expect(doc.trades.length).toBe(1);
    expect(doc.aggregate.contractCount).toBe(10);
    expect(doc.generatedAt).toBe('2026-11-05T00:00:00Z');
    expect(doc.error).toBeUndefined();
  });

  it('a missing status fails safe to failed — never success', () => {
    // A malformed doc must not flip the card to dead-end View Results.
    const doc = convertAnalysisResultDoc({ exitId: 'target-90' });
    expect(doc.status).toBe('failed');
    expect(doc.trades).toEqual([]);
  });

  it('fills defaults for a sparse doc', () => {
    const doc = convertAnalysisResultDoc({});
    expect(doc.contractListDocId).toBe('');
    expect(doc.exitId).toBe('');
    expect(doc.registryVersion).toBe(0);
    expect(doc.aggregate).toEqual({
      exitId: '', contractCount: 0, exitedCount: 0, expiredCount: 0, openCount: 0, errorCount: 0,
    });
    expect(doc.generatedAt).toBe('');
    expect(doc.error).toBeUndefined();
  });

  it('keeps explicit statuses — failed docs surface their error', () => {
    const doc = convertAnalysisResultDoc({ status: 'failed', error: 'series fetch failed' });
    expect(doc.status).toBe('failed');
    expect(doc.error).toBe('series fetch failed');
  });

  it('non-array trades coerces to empty — no crash on malformed snapshots', () => {
    expect(convertAnalysisResultDoc({ trades: 'junk' }).trades).toEqual([]);
    expect(convertAnalysisResultDoc({ trades: 42 }).trades).toEqual([]);
  });

  it('an invalid status fails safe to failed — never renders a dead end', () => {
    expect(convertAnalysisResultDoc({ status: 'garbage' }).status).toBe('failed');
    expect(convertAnalysisResultDoc({ status: 42 }).status).toBe('failed');
    // Valid statuses pass through.
    expect(convertAnalysisResultDoc({ status: 'success' }).status).toBe('success');
  });

  it('a v1 aggregate missing openCount backfills 0 — required field, sparse snapshot', () => {
    const doc = convertAnalysisResultDoc({
      aggregate: { exitId: 'x', contractCount: 3, exitedCount: 1, expiredCount: 1, errorCount: 1 },
    });
    expect(doc.aggregate.openCount).toBe(0);
    expect(doc.aggregate.contractCount).toBe(3);
  });

  it('a truthy non-object aggregate falls back to the zeroed default', () => {
    const doc = convertAnalysisResultDoc({ exitId: 'x', aggregate: 'junk' });
    expect(doc.aggregate).toEqual({
      exitId: 'x', contractCount: 0, exitedCount: 0, expiredCount: 0, openCount: 0, errorCount: 0,
    });
  });
});

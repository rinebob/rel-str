/**
 * @topic #553 — Paper Trading Infra · Thread #1059 (task #1076)
 *
 * generateTradeDataset callable: validate → mint datasetId → write the
 * 'generating' index doc → enqueue analysisDatasetTask → return the id.
 * Invalid input must produce a 4xx-class HttpsError and write nothing.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  PaperTradingKind,
} from '../../../shared/paper-trading-contracts';
import type {
  AnalysisDatasetDoc,
  AnalysisDatasetTaskPayload,
  GenerateTradeDatasetRequest,
} from '../../../shared/analysis-dataset-contracts';
import {
  handleGenerateTradeDataset,
  type GenerateDatasetDeps,
} from '../../../functions/src/paper-trading/analysis/analysis-callables';

const NOW = new Date('2026-10-20T15:30:00.000Z');

const VALID: GenerateTradeDatasetRequest = {
  origin: 'live',
  symbolScope: ['AMAT', 'GOOG'],
  signalTypes: ['D_ST_TREND_RIDER_V2_LONG'],
  exitRule: 'trailing-8',
  barRange: { from: '2023-01-01', to: '2026-10-20' },
  entryConvention: 'signal-bar-close',
};

interface Capture {
  docs: { id: string; doc: AnalysisDatasetDoc }[];
  updates: { id: string; fields: Partial<AnalysisDatasetDoc> }[];
  enqueued: AnalysisDatasetTaskPayload[];
}

function deps(c: Capture, overrides: Partial<GenerateDatasetDeps> = {}): GenerateDatasetDeps {
  return {
    createIndexDoc: async (id, doc) => { c.docs.push({ id, doc }); },
    updateIndexDoc: async (id, fields) => { c.updates.push({ id, fields }); },
    enqueueTask: async (p) => { c.enqueued.push(p); },
    now: () => NOW,
    nonce: () => 'a1b2c3',
    ...overrides,
  };
}

const authed = (data: unknown) => ({ data, auth: { uid: 'u-1' } });

async function errCode(fn: () => Promise<unknown>): Promise<string> {
  try {
    await fn();
    assert.fail('expected HttpsError');
  } catch (e) {
    const code = (e as { code?: string }).code;
    assert.ok(code, `expected HttpsError, got ${e}`);
    return code!;
  }
  return '';
}

describe('handleGenerateTradeDataset', () => {
  it('rejects unauthenticated callers and writes nothing', async () => {
    const c: Capture = { docs: [], updates: [], enqueued: [] };
    const code = await errCode(() =>
      handleGenerateTradeDataset({ data: VALID }, deps(c)));
    assert.equal(code, 'unauthenticated');
    assert.equal(c.docs.length, 0);
    assert.equal(c.enqueued.length, 0);
  });

  it('rejects invalid exit-rule grammar — invalid-argument, no index doc', async () => {
    const c: Capture = { docs: [], updates: [], enqueued: [] };
    const code = await errCode(() =>
      handleGenerateTradeDataset(
        authed({ ...VALID, exitRule: 'banana-9' }), deps(c)));
    assert.equal(code, 'invalid-argument');
    assert.equal(c.docs.length, 0);
    assert.equal(c.enqueued.length, 0);
  });

  it('rejects grammar-valid but non-firing families — limit-sd parses yet stays stubbed', async () => {
    const c: Capture = { docs: [], updates: [], enqueued: [] };
    const code = await errCode(() =>
      handleGenerateTradeDataset(
        authed({ ...VALID, exitRule: 'limit-sd1' }), deps(c)));
    assert.equal(code, 'invalid-argument');
    assert.equal(c.docs.length, 0);
  });

  it('accepts all three PRD grammar families', async () => {
    const c: Capture = { docs: [], updates: [], enqueued: [] };
    for (const exitRule of ['initial-stop-10', 'trailing-8', 'time-30d']) {
      const res = await handleGenerateTradeDataset(authed({ ...VALID, exitRule }), deps(c));
      assert.match(res.datasetId, /^ds-20261020-live-/);
    }
    assert.equal(c.docs.length, 3);
    assert.equal(c.enqueued.length, 3);
  });

  it('rejects non-object entryFilters', async () => {
    const c: Capture = { docs: [], updates: [], enqueued: [] };
    assert.equal(await errCode(() =>
      handleGenerateTradeDataset(
        authed({ ...VALID, entryFilters: 'zoneV2>=4' }), deps(c))),
      'invalid-argument');
    assert.equal(await errCode(() =>
      handleGenerateTradeDataset(
        authed({ ...VALID, entryFilters: [1] }), deps(c))),
      'invalid-argument');
    assert.equal(c.docs.length, 0);
  });

  it('blank symbolScope entries are dropped, not scoped to the empty string', async () => {
    const c: Capture = { docs: [], updates: [], enqueued: [] };
    await handleGenerateTradeDataset(
      authed({ ...VALID, symbolScope: ['AMAT', '  '] }), deps(c));
    assert.deepEqual(c.docs[0].doc.symbolScope, ['AMAT']);
  });

  it('rejects a bad barRange — non-ISO, impossible, and inverted all fail', async () => {
    const c: Capture = { docs: [], updates: [], enqueued: [] };
    assert.equal(await errCode(() =>
      handleGenerateTradeDataset(
        authed({ ...VALID, barRange: { from: '10/20/2026', to: '2026-10-20' } }), deps(c))),
      'invalid-argument');
    assert.equal(await errCode(() =>
      handleGenerateTradeDataset(
        authed({ ...VALID, barRange: { from: '2026-10-20', to: '2023-01-01' } }), deps(c))),
      'invalid-argument');
    // ISO-shaped but not a real calendar date
    assert.equal(await errCode(() =>
      handleGenerateTradeDataset(
        authed({ ...VALID, barRange: { from: '2023-01-01', to: '2026-13-45' } }), deps(c))),
      'invalid-argument');
    assert.equal(c.docs.length, 0);
  });

  it('rejects unknown origin and entryConvention values', async () => {
    const c: Capture = { docs: [], updates: [], enqueued: [] };
    assert.equal(await errCode(() =>
      handleGenerateTradeDataset(
        authed({ ...VALID, origin: 'sideways' }), deps(c))),
      'invalid-argument');
    assert.equal(await errCode(() =>
      handleGenerateTradeDataset(
        authed({ ...VALID, entryConvention: 'next-open' }), deps(c))),
      'invalid-argument');
    assert.equal(c.docs.length, 0);
  });

  it('rejects signal types outside the manifest whitelist', async () => {
    const c: Capture = { docs: [], updates: [], enqueued: [] };
    assert.equal(await errCode(() =>
      handleGenerateTradeDataset(
        authed({ ...VALID, signalTypes: ['D_ST_TREND_RIDER_V2_LONG', 'BOGUS'] }), deps(c))),
      'invalid-argument');
    assert.equal(c.docs.length, 0);
  });

  it('valid run: generating index doc carries full params, task enqueued, id returned', async () => {
    const c: Capture = { docs: [], updates: [], enqueued: [] };
    const res = await handleGenerateTradeDataset(authed(VALID), deps(c));

    assert.match(res.datasetId, /^ds-20261020-live-[0-9a-z]+$/);
    assert.equal(c.docs.length, 1);
    const doc = c.docs[0].doc;
    assert.equal(doc.id, res.datasetId);
    assert.equal(doc.kind, PaperTradingKind.ANALYSIS_DATASET);
    assert.equal(doc.status, 'generating');
    assert.equal(doc.origin, 'live');
    assert.deepEqual(doc.symbolScope, ['AMAT', 'GOOG']);
    assert.deepEqual(doc.signalTypes, ['D_ST_TREND_RIDER_V2_LONG']);
    assert.equal(doc.exitRule, 'trailing-8');
    assert.deepEqual(doc.barRange, { from: '2023-01-01', to: '2026-10-20' });
    assert.equal(doc.entryConvention, 'signal-bar-close');
    assert.equal(doc.gcsPath, `analysis-datasets/${res.datasetId}.csv`);
    assert.deepEqual(doc.tags, []);
    assert.equal(doc.createdAt, NOW.toISOString());

    assert.equal(c.enqueued.length, 1);
    assert.equal(c.enqueued[0].datasetId, res.datasetId);
    assert.deepEqual(c.enqueued[0].params, VALID);
  });

  it('two same-day runs produce two distinct dataset ids', async () => {
    const c: Capture = { docs: [], updates: [], enqueued: [] };
    let n = 0;
    const d = deps(c, { nonce: () => `n${n++}` });
    const a = await handleGenerateTradeDataset(authed(VALID), d);
    const b = await handleGenerateTradeDataset(authed(VALID), d);
    assert.notEqual(a.datasetId, b.datasetId);
    assert.equal(c.docs.length, 2);
  });

  it('normalizes symbolScope to uppercase — the ledger keys symbols uppercase', async () => {
    const c: Capture = { docs: [], updates: [], enqueued: [] };
    await handleGenerateTradeDataset(
      authed({ ...VALID, symbolScope: [' amat ', 'goog'] }), deps(c));
    assert.deepEqual(c.docs[0].doc.symbolScope, ['AMAT', 'GOOG']);
    assert.deepEqual(c.enqueued[0].params.symbolScope, ['AMAT', 'GOOG']);
  });

  it('enqueue failure flips the doc to failed and surfaces unavailable — never wedges at generating', async () => {
    const c: Capture = { docs: [], updates: [], enqueued: [] };
    const code = await errCode(() =>
      handleGenerateTradeDataset(authed(VALID), deps(c, {
        enqueueTask: async () => { throw new Error('tasks api down'); },
      })));
    assert.equal(code, 'unavailable');
    assert.equal(c.updates.length, 1);
    assert.equal(c.updates[0].fields.status, 'failed');
    assert.match(c.updates[0].fields.error ?? '', /enqueue failed: tasks api down/);
  });

  it('empty symbolScope/signalTypes are accepted (meaning: all)', async () => {
    const c: Capture = { docs: [], updates: [], enqueued: [] };
    const res = await handleGenerateTradeDataset(
      authed({ ...VALID, symbolScope: [], signalTypes: [] }), deps(c));
    assert.match(res.datasetId, /^ds-20261020-live-/);
    assert.equal(c.docs[0].doc.symbolScope.length, 0);
  });
});

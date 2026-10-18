/**
 * @topic #553 — Paper Trading Infra · Thread #1059 (task #1076)
 *
 * Dataset writer: serialize rows → GCS object → index doc status
 * transition. The doc must never sit at 'generating' after a failure —
 * every error path attempts the failed transition and rethrows.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { TradeSide } from '../../../shared/common';
import {
  PaperTradingKind,
  PaperTradeStatus,
} from '../../../shared/paper-trading-contracts';
import {
  AnalysisCohort,
  type AnalysisDatasetDoc,
  type TradeAnalysisRow,
} from '../../../shared/analysis-dataset-contracts';
import { serializeDataset } from '../../../shared/analysis-csv';
import { analysisDatasetGcsPath } from '../../../shared/paper-trading-ids';
import {
  writeDataset,
  type DatasetWriterDeps,
} from '../../../functions/src/paper-trading/analysis/dataset-writer';

const DATASET_ID = 'ds-20261020-live-ab12cd34';
const NOW = new Date('2026-10-20T15:30:00.000Z');

function makeRow(tradeId: string): TradeAnalysisRow {
  return {
    datasetId: DATASET_ID,
    tradeId,
    signalId: 'sig-1',
    signalType: 'D_ST_TREND_RIDER_V2_LONG',
    cohortId: 'co-1',
    positionGroupId: null,
    symbol: 'AMAT',
    direction: TradeSide.LONG,
    expression: 'EQ',
    captureList: 'PRIMARY',
    sector: 'Technology',
    industry: 'Semis',
    capTier: 'large',
    source: 'live',
    analysisCohort: AnalysisCohort.SIGNAL_EQUITY,
    status: PaperTradeStatus.CLOSED,
    signalStatus: 'CONFIRMED',
    signalBarDate: '2026-10-01',
    entryDate: '2026-10-01',
    entryPrice: 100.25,
    exitDate: '2026-10-10',
    exitPrice: 110.5,
    qty: 10,
    daysHeld: 9,
    exitReason: 'trailing-8',
    tradeRetPct: 10.22,
    symbolMovePct: 10.22,
    realizedPnl: 102.5,
    capitalRequired: 1002.5,
    mfePct: 12,
    maePct: -2,
    mfeDate: '2026-10-08',
    maeDate: '2026-10-02',
    daysToMfe: 7,
    givebackRatio: 0.148,
    excursionSource: 'marks',
    'ind.delta': 1,
    'ind.windowV2': 3,
    'ind.zoneV1': 4,
    'ind.zoneV1Prev': 3,
    'ind.zoneV2': 4,
    'ind.zoneV2Prev': 4,
    'strength.diPlus': 30,
    'strength.diMinus': 10,
    'strength.diHist': 20,
    'strength.adx': 35,
  };
}

interface Capture {
  writes: { path: string; body: string; contentType: string }[];
  updates: { id: string; fields: Partial<AnalysisDatasetDoc> }[];
}

function deps(c: Capture, overrides: Partial<DatasetWriterDeps> = {}): DatasetWriterDeps {
  return {
    writeObject: async (path, body, contentType) => {
      c.writes.push({ path, body: body.toString(), contentType });
    },
    updateIndex: async (id, fields) => {
      c.updates.push({ id, fields });
    },
    now: () => NOW,
    ...overrides,
  };
}

describe('writeDataset', () => {
  it('uploads the serialized CSV then flips the index doc to ready', async () => {
    const c: Capture = { writes: [], updates: [] };
    const rows = [makeRow('t-1'), makeRow('t-2')];

    await writeDataset(rows, DATASET_ID, deps(c));

    assert.equal(c.writes.length, 1);
    assert.equal(c.writes[0].path, analysisDatasetGcsPath(DATASET_ID));
    assert.equal(c.writes[0].contentType, 'text/csv');
    assert.equal(c.writes[0].body, serializeDataset(rows));

    assert.equal(c.updates.length, 1);
    assert.equal(c.updates[0].id, DATASET_ID);
    assert.equal(c.updates[0].fields.status, 'ready');
    assert.equal(c.updates[0].fields.rowCount, 2);
    assert.equal(c.updates[0].fields.gcsPath, analysisDatasetGcsPath(DATASET_ID));
    assert.equal(c.updates[0].fields.generatedAt, NOW.toISOString());
  });

  it('upload failure → index flips to failed with error, error rethrows', async () => {
    const c: Capture = { writes: [], updates: [] };
    const boom = new Error('gcs unavailable');

    await assert.rejects(
      writeDataset([makeRow('t-1')], DATASET_ID, deps(c, {
        writeObject: async () => { throw boom; },
      })),
      boom,
    );

    assert.equal(c.updates.length, 1);
    assert.equal(c.updates[0].fields.status, 'failed');
    assert.equal(c.updates[0].fields.error, 'gcs unavailable');
    assert.equal(c.updates[0].fields.generatedAt, NOW.toISOString());
  });

  it('ready-update failure → failed transition still attempted', async () => {
    const c: Capture = { writes: [], updates: [] };
    let calls = 0;
    await assert.rejects(
      writeDataset([makeRow('t-1')], DATASET_ID, deps(c, {
        updateIndex: async (id, fields) => {
          c.updates.push({ id, fields });
          if (++calls === 1) throw new Error('firestore unavailable');
        },
      })),
    );
    assert.equal(c.updates.length, 2);
    assert.equal(c.updates[1].fields.status, 'failed');
  });

  it('empty row set still lands ready — header-only CSV, rowCount 0', async () => {
    const c: Capture = { writes: [], updates: [] };
    await writeDataset([], DATASET_ID, deps(c));
    assert.equal(c.writes[0].body, serializeDataset([]));
    assert.equal(c.updates[0].fields.status, 'ready');
    assert.equal(c.updates[0].fields.rowCount, 0);
  });

  it('a failed-transition throw surfaces (generating can still wedge — logged, not swallowed)', async () => {
    const c: Capture = { writes: [], updates: [] };
    await assert.rejects(
      writeDataset([makeRow('t-1')], DATASET_ID, deps(c, {
        updateIndex: async () => { throw new Error('doc gone'); },
      })),
      /doc gone/,
    );
  });
});

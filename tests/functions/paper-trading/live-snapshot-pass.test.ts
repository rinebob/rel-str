/**
 * @topic #553 — Paper Trading Infra · Thread #1059 (task #1077)
 *
 * Live-snapshot pass: enumerate the paper-trade ledger → map each trade
 * to a TradeAnalysisRow (ledger-observed lifecycle, stamped ind.*,
 * strength.* computed from daily bars, excursion from marks) →
 * writeDataset. Signal-linked equity rows are the analysis cohort;
 * manual/option-expression rows stay in the file flagged `excluded`.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  PaperTradeStatus,
  PaperTradeSource,
  PaperTradingKind,
  type PaperTrade,
} from '../../../shared/paper-trading-contracts';
import { TradeSide } from '../../../shared/common';
import { AnalysisCohort } from '../../../shared/analysis-dataset-contracts';
import type { OhlcBar } from '../../../functions/src/common/market-data-types';
import {
  runLiveSnapshot,
  tradeToRow,
  type LiveSnapshotDeps,
} from '../../../functions/src/paper-trading/analysis/live-snapshot';

const DS = 'ds-20261020-live-deadbeef';

const BASE_TRADE: PaperTrade = {
  kind: PaperTradingKind.TRADE,
  id: 't-sig-long',
  createdAt: '2026-09-01T20:00:00Z',
  updatedAt: '2026-09-10T20:00:00Z',
  status: PaperTradeStatus.CLOSED,
  source: PaperTradeSource.SIGNAL,
  signalId: 'sig-1',
  symbol: 'AMAT',
  expression: 'EQ',
  governingVariant: 'trailing-8',
  order: { side: TradeSide.LONG, type: 'MARKET', quantity: 10 },
  fills: [
    { fillId: 'f1', role: 'entry', date: '2026-09-01', price: 100, quantity: 10 },
    { fillId: 'f2', role: 'exit', date: '2026-09-11', price: 110, quantity: 10 },
  ],
  legs: [],
  marks: {
    '2026-09-01': { underlyingClose: 100 },
    '2026-09-05': { underlyingClose: 115 },
    '2026-09-08': { underlyingClose: 97 },
    '2026-09-11': { underlyingClose: 110 },
  },
  variantRuns: [],
  variantKeys: ['trailing-8'],
  realizedPnl: 100,
  unrealizedPnl: 0,
  capitalRequired: 1000,
  signalType: 'D_ST_TREND_RIDER_V2_LONG',
  signalBarDate: '2026-09-01',
  signalStatus: 'CONFIRMED',
  signalIndicators: { zoneV2: 4, zoneV2Prev: 3, windowV2: 1, delta: 1 },
  sector: 'Technology',
  industry: 'Semiconductors',
  marketCapTier: 'large',
  captureList: 'PRIMARY',
};

/** N bars ending `end` — linear uptrend so DI+ dominates. */
function uptrendBars(end: string, n = 40): OhlcBar[] {
  const endMs = Date.parse(`${end}T00:00:00Z`);
  return Array.from({ length: n }, (_, i) => {
    const d = new Date(endMs - (n - 1 - i) * 86400000).toISOString().slice(0, 10);
    const c = 50 + i;
    return { d, o: c - 0.5, h: c + 1, l: c - 1.5, c };
  });
}

function deps(overrides: Partial<LiveSnapshotDeps> = {}): LiveSnapshotDeps & {
  rows: import('../../../shared/analysis-dataset-contracts').TradeAnalysisRow[];
} {
  const state = { rows: [] as import('../../../shared/analysis-dataset-contracts').TradeAnalysisRow[] };
  return Object.assign(state, {
    listTrades: async () => [],
    loadDailyBars: async () => uptrendBars('2026-09-01'),
    writeDataset: async (rows) => { state.rows = rows; },
    ...overrides,
  });
}

const PARAMS = {
  origin: 'live' as const,
  symbolScope: [],
  signalTypes: [],
  exitRule: 'trailing-8',
  barRange: { from: '2020-01-01', to: '2030-01-01' },
  entryConvention: 'signal-bar-close' as const,
};

describe('tradeToRow — live ledger mapping', () => {
  it('signal-linked equity trade → signal-equity cohort, ind.* stamped, lifecycle + outcomes mapped', () => {
    const row = tradeToRow(BASE_TRADE, DS, null);
    assert.equal(row.datasetId, DS);
    assert.equal(row.tradeId, 't-sig-long');
    assert.equal(row.signalId, 'sig-1');
    assert.equal(row.signalType, 'D_ST_TREND_RIDER_V2_LONG');
    assert.equal(row.symbol, 'AMAT');
    assert.equal(row.direction, TradeSide.LONG);
    assert.equal(row.expression, 'EQ');
    assert.equal(row.source, 'live');
    assert.equal(row.analysisCohort, AnalysisCohort.SIGNAL_EQUITY);
    assert.equal(row.status, PaperTradeStatus.CLOSED);
    assert.equal(row.signalStatus, 'CONFIRMED');
    assert.equal(row.signalBarDate, '2026-09-01');
    assert.equal(row.entryDate, '2026-09-01');
    assert.equal(row.entryPrice, 100);
    assert.equal(row.exitDate, '2026-09-11');
    assert.equal(row.exitPrice, 110);
    assert.equal(row.qty, 10);
    assert.equal(row.daysHeld, 10);
    assert.equal(row.exitReason, 'trailing-8');
    assert.equal(row.tradeRetPct, 10);
    assert.equal(row.symbolMovePct, 10);
    assert.equal(row.realizedPnl, 100);
    assert.equal(row.capitalRequired, 1000);
    assert.equal(row['ind.zoneV2'], 4);
    assert.equal(row['ind.zoneV2Prev'], 3);
    assert.equal(row['ind.windowV2'], 1);
    assert.equal(row['ind.delta'], 1);
    assert.equal(row.sector, 'Technology');
    assert.equal(row.capTier, 'large');
    assert.equal(row.captureList, 'PRIMARY');
    assert.equal(row.excursionSource, 'marks');
  });

  it('excursion comes from marks — MFE/MAE direction-aware with dates', () => {
    const row = tradeToRow(BASE_TRADE, DS, null);
    assert.equal(row.mfePct, 15);            // 115 on 2026-09-05
    assert.equal(row.mfeDate, '2026-09-05');
    assert.equal(row.maePct, -3);            // 97 on 2026-09-08
    assert.equal(row.maeDate, '2026-09-08');
    assert.equal(row.daysToMfe, 4);
    assert.equal(row.givebackRatio, (15 - 10) / 15);
  });

  it('short trade flips the sign — a falling symbol is a gain', () => {
    const t: PaperTrade = {
      ...BASE_TRADE,
      order: { side: TradeSide.SHORT, type: 'MARKET', quantity: 5 },
      signalType: 'D_ST_TREND_RIDER_V2_SHORT',
      fills: [
        { fillId: 'f1', role: 'entry', date: '2026-09-01', price: 100, quantity: 5 },
        { fillId: 'f2', role: 'exit', date: '2026-09-11', price: 90, quantity: 5 },
      ],
      marks: {
        '2026-09-02': { underlyingClose: 95 },
        '2026-09-05': { underlyingClose: 103 },
      },
    };
    const row = tradeToRow(t, DS, null);
    assert.equal(row.tradeRetPct, 10);        // short gained as price fell
    assert.equal(row.symbolMovePct, -10);     // direction-neutral symbol move
    assert.equal(row.mfePct, 5);              // 95 was the favorable extreme
    assert.equal(row.maePct, -3);             // 103 was adverse
  });

  it('open trade → ret vs latest mark, exit fields null', () => {
    const t: PaperTrade = {
      ...BASE_TRADE,
      status: PaperTradeStatus.OPEN,
      fills: [{ fillId: 'f1', role: 'entry', date: '2026-09-01', price: 100, quantity: 10 }],
      marks: {
        '2026-09-01': { underlyingClose: 100 },
        '2026-09-10': { underlyingClose: 108.5 },
      },
      realizedPnl: 0,
      unrealizedPnl: 85,
    };
    const row = tradeToRow(t, DS, null);
    assert.equal(row.exitDate, null);
    assert.equal(row.exitPrice, null);
    assert.equal(row.daysHeld, null);
    assert.equal(row.exitReason, null);
    assert.equal(row.tradeRetPct, 8.5);
    assert.equal(row.mfePct, 8.5);
    assert.equal(row.givebackRatio, null);    // no exit → nothing surrendered yet
  });

  it('manual trade → excluded cohort, ind.* null', () => {
    const t: PaperTrade = {
      ...BASE_TRADE,
      source: PaperTradeSource.MANUAL,
      signalId: undefined,
      signalType: undefined,
      signalBarDate: undefined,
      signalStatus: undefined,
      signalIndicators: undefined,
      captureList: undefined,
    };
    const row = tradeToRow(t, DS, null);
    assert.equal(row.analysisCohort, AnalysisCohort.EXCLUDED);
    assert.equal(row.signalType, null);
    assert.equal(row['ind.zoneV2'], null);
    assert.equal(row['ind.delta'], null);
    assert.equal(row.captureList, null);
  });

  it('option-expression row from a signal → excluded cohort (premium-basis %)', () => {
    const t: PaperTrade = {
      ...BASE_TRADE,
      expression: 'CSP',
      strike: 95,
      optionType: 'put' as PaperTrade['optionType'],
    };
    const row = tradeToRow(t, DS, null);
    assert.equal(row.analysisCohort, AnalysisCohort.EXCLUDED);
    // still keeps its provenance stamps — excluded, not anonymized
    assert.equal(row['ind.zoneV2'], 4);
    assert.equal(row.signalType, 'D_ST_TREND_RIDER_V2_LONG');
  });

  it('unfilled trade (no entry fill) → lifecycle fields null, row still emitted', () => {
    const t: PaperTrade = { ...BASE_TRADE, status: PaperTradeStatus.PENDING, fills: [], marks: {} };
    const row = tradeToRow(t, DS, null);
    assert.equal(row.entryDate, null);
    assert.equal(row.tradeRetPct, null);
    assert.equal(row.mfePct, null);
    assert.equal(row.status, PaperTradeStatus.PENDING);
  });
});

describe('runLiveSnapshot — pass behavior', () => {
  it('every in-scope trade produces exactly one row; writeDataset receives them all', async () => {
    const manual: PaperTrade = { ...BASE_TRADE, id: 't-manual', source: PaperTradeSource.MANUAL, signalType: undefined, signalId: undefined, expression: 'EQ' };
    const csp: PaperTrade = { ...BASE_TRADE, id: 't-csp', expression: 'CSP' };
    const d = deps({ listTrades: async () => [BASE_TRADE, manual, csp] });
    await runLiveSnapshot(PARAMS, DS, d);
    assert.equal(d.rows.length, 3);
    assert.deepEqual(d.rows.map((r) => r.tradeId).sort(), ['t-csp', 't-manual', 't-sig-long']);
    assert.equal(d.rows.find((r) => r.tradeId === 't-sig-long')!.analysisCohort, AnalysisCohort.SIGNAL_EQUITY);
    assert.equal(d.rows.find((r) => r.tradeId === 't-manual')!.analysisCohort, AnalysisCohort.EXCLUDED);
    assert.equal(d.rows.find((r) => r.tradeId === 't-csp')!.analysisCohort, AnalysisCohort.EXCLUDED);
  });

  it('strength.* computed from daily bars at the signal bar — bars load once per symbol', async () => {
    let loads = 0;
    const secondSignal: PaperTrade = { ...BASE_TRADE, id: 't-sig-2', signalBarDate: '2026-09-10' };
    const d = deps({
      listTrades: async () => [BASE_TRADE, secondSignal],
      loadDailyBars: async (sym) => { loads++; assert.equal(sym, 'AMAT'); return uptrendBars('2026-10-01', 60); },
    });
    await runLiveSnapshot(PARAMS, DS, d);
    const row = d.rows[0];
    assert.ok(typeof row['strength.diPlus'] === 'number' && row['strength.diPlus'] > 0);
    assert.ok(typeof row['strength.adx'] === 'number');
    // one symbol → one load even with two different anchors
    assert.equal(loads, 1);
    assert.ok(d.rows[1]['strength.diPlus'] !== null);
  });

  it('excluded rows with no anchor date → strength.* null, no bar load', async () => {
    let loads = 0;
    const manual: PaperTrade = {
      ...BASE_TRADE,
      id: 't-manual',
      source: PaperTradeSource.MANUAL,
      signalType: undefined,
      signalId: undefined,
      signalBarDate: undefined,
      signalIndicators: undefined,
      fills: [],
      marks: {},
    };
    const d = deps({
      listTrades: async () => [manual],
      loadDailyBars: async () => { loads++; return []; },
    });
    await runLiveSnapshot(PARAMS, DS, d);
    assert.equal(loads, 0);
    assert.equal(d.rows[0]['strength.adx'], null);
  });

  it('scope filters: symbolScope ∩ signalTypes ∩ barRange', async () => {
    const goog: PaperTrade = { ...BASE_TRADE, id: 't-goog', symbol: 'GOOG' };
    const old: PaperTrade = { ...BASE_TRADE, id: 't-old', signalBarDate: '2010-01-01', fills: [{ fillId: 'f1', role: 'entry', date: '2010-01-05', price: 10, quantity: 1 }] };
    const otherType: PaperTrade = { ...BASE_TRADE, id: 't-v1', signalType: 'D_ST_TREND_RIDER_V1_LONG' };
    const d = deps({ listTrades: async () => [BASE_TRADE, goog, old, otherType] });
    await runLiveSnapshot({ ...PARAMS, symbolScope: ['AMAT'], signalTypes: ['D_ST_TREND_RIDER_V2_LONG'], barRange: { from: '2026-01-01', to: '2026-12-31' } }, DS, d);
    assert.deepEqual(d.rows.map((r) => r.tradeId), ['t-sig-long']);
  });

  it('barRange bounds manual trades too — by entryDate when no signalBarDate', async () => {
    const manualOld: PaperTrade = {
      ...BASE_TRADE, id: 't-man-old', source: PaperTradeSource.MANUAL,
      signalType: undefined, signalId: undefined, signalBarDate: undefined,
      fills: [{ fillId: 'f1', role: 'entry', date: '2019-03-01', price: 10, quantity: 1 }],
    };
    const manualInRange: PaperTrade = {
      ...BASE_TRADE, id: 't-man-in', source: PaperTradeSource.MANUAL,
      signalType: undefined, signalId: undefined, signalBarDate: undefined,
      fills: [{ fillId: 'f1', role: 'entry', date: '2026-06-01', price: 10, quantity: 1 }],
    };
    const d = deps({ listTrades: async () => [manualOld, manualInRange] });
    await runLiveSnapshot({ ...PARAMS, barRange: { from: '2026-01-01', to: '2026-12-31' } }, DS, d);
    assert.deepEqual(d.rows.map((r) => r.tradeId), ['t-man-in']);
  });
});

/**
 * @topic #553 — Paper Trading Infra · Thread #1059 Trade Analysis & Forensics
 *         (task #1073)
 *
 * Specs for the shared analysis contracts: the `ANALYSIS_COLUMNS` manifest
 * is the single ordered source of truth (CSV header order, FE table/filter
 * dispatch); `TradeAnalysisRow` keys are the manifest keys verbatim — flat,
 * dot-named for `ind.*`/`strength.*` groups; the anchor-path helpers pin the
 * Firestore/GCS locations.
 */
import { TradeSide } from './common';
import {
  isAnalysisDatasetDoc,
  isAnalysisSliceDoc,
  PaperTradeStatus,
  type PaperTradingDoc,
} from './paper-trading-contracts';
import {
  ANALYSIS_COLUMNS,
  AnalysisCohort,
  type AnalysisSlice,
  type SliceFilter,
  type TradeAnalysisRow,
} from './analysis-dataset-contracts';
import {
  analysisDatasetGcsPath,
  analysisDatasetsPath,
  analysisSlicesPath,
  paperTradingDocPath,
  PaperTradingKind,
} from './paper-trading-ids';

/** A row with every key populated — used to pin manifest ⇄ schema bijection. */
const FULL_ROW: TradeAnalysisRow = {
  datasetId: 'ds-261020-live-01',
  tradeId: '261015-sig-AMAT-EQV2S',
  signalId: 'AMAT_D_ST_TREND_RIDER_V2_SHORT_2026-10-15',
  signalType: 'D_ST_TREND_RIDER_V2_SHORT',
  cohortId: 'cohort-261015-AMAT-01',
  positionGroupId: 'AMAT-261015-grp-01',
  symbol: 'AMAT',
  direction: TradeSide.SHORT,
  expression: 'EQ',
  captureList: 'PRIMARY',
  sector: 'Technology',
  industry: 'Semiconductors',
  capTier: 'large',
  source: 'replay',
  analysisCohort: AnalysisCohort.SIGNAL_EQUITY,
  status: PaperTradeStatus.CLOSED,
  signalStatus: 'CONFIRMED',
  signalBarDate: '2026-10-15',
  entryDate: '2026-10-15',
  entryPrice: 212.34,
  exitDate: '2026-11-20',
  exitPrice: 198.5,
  qty: 100,
  daysHeld: 36,
  exitReason: 'trailing-8',
  tradeRetPct: 6.51,
  symbolMovePct: -6.51,
  realizedPnl: 1384,
  capitalRequired: 21234,
  mfePct: 9.12,
  maePct: -3.44,
  mfeDate: '2026-11-10',
  maeDate: '2026-10-22',
  daysToMfe: 26,
  givebackRatio: 0.28,
  excursionSource: 'replay',
  'ind.delta': -1,
  'ind.windowV2': -2,
  'ind.zoneV1': null,
  'ind.zoneV1Prev': null,
  'ind.zoneV2': -2,
  'ind.zoneV2Prev': -1,
  'strength.diPlus': 16.18,
  'strength.diMinus': 31.89,
  'strength.diHist': -15.71,
  'strength.adx': 31.02,
};

const SPARSE_ROW: TradeAnalysisRow = {
  ...FULL_ROW,
  signalId: null,
  signalType: null,
  cohortId: null,
  positionGroupId: null,
  captureList: null,
  sector: null,
  industry: null,
  capTier: null,
  signalStatus: null,
  signalBarDate: null,
  exitDate: null,
  exitPrice: null,
  daysHeld: null,
  exitReason: null,
  tradeRetPct: null,
  symbolMovePct: null,
  capitalRequired: null,
  mfePct: null,
  maePct: null,
  mfeDate: null,
  maeDate: null,
  daysToMfe: null,
  givebackRatio: null,
};

describe('anchor paths (paper-trading/analysis-*/items)', () => {
  it('analysisDatasetsPath resolves the datasets items collection', () => {
    expect(analysisDatasetsPath()).toBe('paper-trading/analysis-datasets/items');
  });

  it('analysisSlicesPath resolves the slices items collection', () => {
    expect(analysisSlicesPath()).toBe('paper-trading/analysis-slices/items');
  });

  it('doc paths are even-segment under the same anchors', () => {
    expect(
      paperTradingDocPath(PaperTradingKind.ANALYSIS_DATASET, 'ds-1'),
    ).toBe('paper-trading/analysis-datasets/items/ds-1');
    expect(
      paperTradingDocPath(PaperTradingKind.ANALYSIS_SLICE, 'slice-1'),
    ).toBe('paper-trading/analysis-slices/items/slice-1');
  });

  it('analysisDatasetGcsPath resolves analysis-datasets/{id}.csv', () => {
    expect(analysisDatasetGcsPath('ds-261020-live-01')).toBe(
      'analysis-datasets/ds-261020-live-01.csv',
    );
  });
});

describe('ANALYSIS_COLUMNS manifest', () => {
  it('has no duplicate keys', () => {
    const keys = ANALYSIS_COLUMNS.map((c) => c.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('manifest ⇄ row-schema bijection: every row key appears exactly once', () => {
    const manifestKeys = ANALYSIS_COLUMNS.map((c) => c.key).sort();
    const rowKeys = Object.keys(FULL_ROW).sort();
    expect(manifestKeys).toEqual(rowKeys);
  });

  it('sparse rows still carry every manifest key (null = absent)', () => {
    expect(Object.keys(SPARSE_ROW).sort()).toEqual(
      ANALYSIS_COLUMNS.map((c) => c.key).sort(),
    );
  });

  it('enum columns declare enumValues; non-enum columns do not', () => {
    for (const col of ANALYSIS_COLUMNS) {
      if (col.kind === 'enum') {
        expect(col.enumValues?.length).toBeGreaterThan(0);
      } else {
        expect(col.enumValues).toBeUndefined();
      }
    }
  });

  it('every column has a label and consistent flags', () => {
    for (const col of ANALYSIS_COLUMNS) {
      expect(col.label.length).toBeGreaterThan(0);
      expect(typeof col.filterable).toBe('boolean');
      expect(typeof col.defaultVisible).toBe('boolean');
    }
  });

  it('direction/status/analysisCohort enum values match the domain enums', () => {
    const byKey = new Map(ANALYSIS_COLUMNS.map((c) => [c.key, c]));
    expect(byKey.get('direction')?.enumValues).toEqual(['long', 'short']);
    expect(byKey.get('status')?.enumValues).toEqual([
      'PENDING', 'OPEN', 'CLOSED', 'EXPIRED', 'ASSIGNED', 'CANCELLED',
    ]);
    expect(byKey.get('analysisCohort')?.enumValues).toEqual([
      'signal-equity', 'excluded',
    ]);
    expect(byKey.get('source')?.enumValues).toEqual(['live', 'replay']);
    expect(byKey.get('excursionSource')?.enumValues).toEqual([
      'marks', 'replay',
    ]);
  });
});

describe('AnalysisSlice / SliceFilter', () => {
  it('serializes to JSON and back verbatim — all three ops round-trip', () => {
    const slice: AnalysisSlice = {
      kind: PaperTradingKind.ANALYSIS_SLICE,
      id: 'slice-v2-adverse',
      createdAt: '2026-10-20T00:00:00Z',
      updatedAt: '2026-10-20T00:00:00Z',
      name: 'V2 shorts, adverse zone',
      filters: [
        { column: 'signalType', op: 'in', value: ['D_ST_TREND_RIDER_V2_SHORT'] },
        { column: 'ind.zoneV2', op: 'range', value: { max: -1 } },
        { column: 'entryDate', op: 'dateRange', value: { from: '2023-01-01' } },
      ],
    };
    const back = JSON.parse(JSON.stringify(slice)) as AnalysisSlice;
    expect(back).toEqual(slice);
    expect(back.filters.map((f) => f.op)).toEqual(['in', 'range', 'dateRange']);
  });

  it('every op discriminates on a manifest column', () => {
    const manifestKeys = new Set(ANALYSIS_COLUMNS.map((c) => c.key));
    const filters: SliceFilter[] = [
      { column: 'symbol', op: 'in', value: ['AMAT'] },
      { column: 'tradeRetPct', op: 'range', value: { min: -5, max: 5 } },
      { column: 'entryDate', op: 'dateRange', value: { to: '2026-10-20' } },
    ];
    for (const f of filters) expect(manifestKeys.has(f.column)).toBe(true);
  });
});

describe('kind guards (repository pattern)', () => {
  const datasetDoc = {
    kind: PaperTradingKind.ANALYSIS_DATASET,
    id: 'ds-1',
  } as PaperTradingDoc;
  const sliceDoc = {
    kind: PaperTradingKind.ANALYSIS_SLICE,
    id: 'slice-1',
  } as PaperTradingDoc;
  const tradeDoc = { kind: PaperTradingKind.TRADE, id: 't' } as PaperTradingDoc;

  it('isAnalysisDatasetDoc narrows on kind', () => {
    expect(isAnalysisDatasetDoc(datasetDoc)).toBe(true);
    expect(isAnalysisDatasetDoc(sliceDoc)).toBe(false);
    expect(isAnalysisDatasetDoc(tradeDoc)).toBe(false);
  });

  it('isAnalysisSliceDoc narrows on kind', () => {
    expect(isAnalysisSliceDoc(sliceDoc)).toBe(true);
    expect(isAnalysisSliceDoc(datasetDoc)).toBe(false);
    expect(isAnalysisSliceDoc(tradeDoc)).toBe(false);
  });
});

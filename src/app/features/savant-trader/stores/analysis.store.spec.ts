/**
 * AnalysisStore spec (Thread #1059, task #1081).
 *
 * Store seams: dataset library load/open/delete, row filters composing
 * AND (enum ∈, numeric range, date range), sort chain (asc→desc→removed,
 * additive shift), slice save/apply with missing-column skip + notice,
 * compare dataset, loading/error states. AnalysisService is mocked at
 * its public boundary.
 */
import { TestBed } from '@angular/core/testing';
import { of, Subject, throwError } from 'rxjs';

import { AnalysisStore } from './analysis.store';
import { AnalysisService } from '../services/analysis.service';
import { MatSnackBar } from '@angular/material/snack-bar';
import { PaperTradingKind, PaperTradeStatus } from '@paper-trading/contracts';
import type {
  AnalysisDatasetDoc,
  AnalysisRunParams,
  AnalysisSlice,
  SliceFilter,
  TradeAnalysisRow,
} from '@paper-trading/analysis';
import { AnalysisCohort } from '@paper-trading/analysis';
import { TradeSide } from '@common';

function datasetDoc(over: Partial<AnalysisDatasetDoc> = {}): AnalysisDatasetDoc {
  return {
    kind: PaperTradingKind.ANALYSIS_DATASET,
    id: 'ds-1',
    createdAt: '2026-10-20T00:00:00Z',
    updatedAt: '2026-10-20T00:00:00Z',
    origin: 'replay',
    status: 'ready',
    rowCount: 3,
    symbolScope: ['AMAT'],
    signalTypes: [],
    exitRule: 'trailing-8',
    barRange: { from: '2023-01-01', to: '2026-10-16' },
    entryConvention: 'signal-bar-close',
    generatedAt: '2026-10-20T12:00:00Z',
    gcsPath: 'analysis-datasets/ds-1.csv',
    tags: [],
    ...over,
  };
}

function runParams(over: Partial<AnalysisRunParams> = {}): AnalysisRunParams {
  return {
    origin: 'replay',
    symbolScope: ['AMAT'],
    signalTypes: ['D_ST_TREND_RIDER_V1_LONG'],
    exitRule: 'trailing-8',
    barRange: { from: '2023-01-01', to: '2026-10-20' },
    entryConvention: 'signal-bar-close',
    ...over,
  };
}

function row(over: Partial<TradeAnalysisRow> = {}): TradeAnalysisRow {
  return {
    datasetId: 'ds-1',
    tradeId: 'tr-1',
    signalId: 'sig-1',
    signalType: 'D_ST_TREND_RIDER_V1_LONG',
    cohortId: null,
    positionGroupId: null,
    symbol: 'AMAT',
    direction: TradeSide.LONG,
    expression: 'EQ',
    captureList: 'PRIMARY',
    sector: 'Tech',
    industry: 'Semis',
    capTier: 'LARGE',
    source: 'replay',
    analysisCohort: AnalysisCohort.SIGNAL_EQUITY,
    status: PaperTradeStatus.CLOSED,
    signalStatus: 'CONFIRMED',
    signalBarDate: '2024-10-08',
    entryDate: '2024-10-08',
    entryPrice: 200.88,
    exitDate: '2024-10-15',
    exitPrice: 191.02,
    qty: 1,
    daysHeld: 7,
    exitReason: 'trailing-8',
    tradeRetPct: -4.91,
    symbolMovePct: -4.91,
    realizedPnl: -9.86,
    capitalRequired: 200.88,
    mfePct: 7.38,
    maePct: -5.63,
    mfeDate: '2024-10-09',
    maeDate: '2024-10-14',
    daysToMfe: 1,
    givebackRatio: -0.67,
    excursionSource: 'replay',
    'ind.delta': 22.06,
    'ind.windowV2': 18.74,
    'ind.zoneV1': 3.32,
    'ind.zoneV1Prev': 9.71,
    'ind.zoneV2': 1,
    'ind.zoneV2Prev': 3,
    'strength.diPlus': 30,
    'strength.diMinus': 20,
    'strength.diHist': 10,
    'strength.adx': 25,
    ...over,
  };
}

function sliceDoc(over: Partial<AnalysisSlice> = {}): AnalysisSlice {
  return {
    kind: PaperTradingKind.ANALYSIS_SLICE,
    id: 'sl-1',
    createdAt: '2026-10-20T00:00:00Z',
    updatedAt: '2026-10-20T00:00:00Z',
    name: 'V2 longs',
    filters: [{ column: 'signalType', op: 'in', value: ['D_ST_TREND_RIDER_V2_LONG'] }],
    ...over,
  };
}

describe('AnalysisStore', () => {
  let store: InstanceType<typeof AnalysisStore>;
  let svc: {
    listDatasets$: jest.Mock;
    updateTagsNotes$: jest.Mock;
    deleteDataset$: jest.Mock;
    loadDataset$: jest.Mock;
    generateDataset$: jest.Mock;
    listSlices$: jest.Mock;
    saveSlice$: jest.Mock;
    updateSlice$: jest.Mock;
    deleteSlice$: jest.Mock;
  };

  const ds = datasetDoc();
  const ds2 = datasetDoc({ id: 'ds-2', gcsPath: 'analysis-datasets/ds-2.csv' });
  const rows = [
    row({ tradeId: 'tr-1', tradeRetPct: -4.91, signalType: 'D_ST_TREND_RIDER_V1_LONG' }),
    row({ tradeId: 'tr-2', tradeRetPct: 6.51, signalType: 'D_ST_TREND_RIDER_V2_LONG', entryDate: '2024-11-02' }),
    row({ tradeId: 'tr-3', tradeRetPct: 12.0, signalType: 'D_ST_TREND_RIDER_V1_SHORT', direction: TradeSide.SHORT, entryDate: '2025-01-15' }),
  ];

  beforeEach(() => {
    svc = {
      listDatasets$: jest.fn().mockReturnValue(of([ds, ds2])),
      updateTagsNotes$: jest.fn().mockReturnValue(of(undefined)),
      deleteDataset$: jest.fn().mockReturnValue(of(undefined)),
      loadDataset$: jest.fn().mockReturnValue(
        of({ rows, columns: ['tradeId', 'symbol', 'signalType', 'entryDate', 'tradeRetPct', 'direction'] }),
      ),
      generateDataset$: jest.fn().mockReturnValue(of('ds-new')),
      listSlices$: jest.fn().mockReturnValue(of([sliceDoc()])),
      saveSlice$: jest.fn().mockImplementation((name: string, filters: SliceFilter[], note?: string) =>
        of(sliceDoc({ id: 'sl-new', name, filters, note })),
      ),
      updateSlice$: jest.fn().mockReturnValue(of(undefined)),
      deleteSlice$: jest.fn().mockReturnValue(of(undefined)),
    };
    TestBed.configureTestingModule({
      providers: [
        AnalysisStore,
        { provide: AnalysisService, useValue: svc },
        { provide: MatSnackBar, useValue: { open: jest.fn() } },
      ],
    });
    store = TestBed.inject(AnalysisStore);
  });

  // ── dataset library ──────────────────────────────────────────────────

  it('loadDatasets populates the library', () => {
    store.loadDatasets();
    expect(store.datasets().map((d) => d.id)).toEqual(['ds-1', 'ds-2']);
  });

  it('openDataset loads rows + column headers and resets filters', () => {
    store.loadDatasets();
    store.openDataset(ds);
    expect(store.activeDataset()?.id).toBe('ds-1');
    expect(store.rows().length).toBe(3);
    expect(store.columns()).toContain('tradeRetPct');
    expect(store.filters()).toEqual([]);
  });

  it('updateTagsNotes patches the doc in the library', () => {
    store.loadDatasets();
    store.updateTagsNotes('ds-1', ['amat'], 'note');
    expect(svc.updateTagsNotes$).toHaveBeenCalledWith('ds-1', ['amat'], 'note');
    expect(store.datasets().find((d) => d.id === 'ds-1')?.tags).toEqual(['amat']);
  });

  it('deleteDataset removes the doc and clears it when active', () => {
    store.loadDatasets();
    store.openDataset(ds);
    store.deleteDataset(ds);
    expect(svc.deleteDataset$).toHaveBeenCalledWith(ds);
    expect(store.datasets().map((d) => d.id)).toEqual(['ds-2']);
    expect(store.activeDataset()).toBeNull();
    expect(store.rows()).toEqual([]);
  });

  it('deleteDataset keeps the open dataset when a different one is deleted', () => {
    store.loadDatasets();
    store.openDataset(ds);
    store.deleteDataset(ds2);
    expect(store.activeDataset()?.id).toBe('ds-1');
    expect(store.rows().length).toBe(3);
  });

  it('deleteDataset clears compare state when the deleted dataset was the compare target', () => {
    store.loadDatasets();
    store.openDataset(ds);
    store.loadCompareDataset(ds2);
    expect(store.compareDatasetId()).toBe('ds-2');
    store.deleteDataset(ds2);
    expect(store.compareDatasetId()).toBeNull();
    expect(store.compareRows()).toEqual([]);
  });

  it('openDataset cancels an in-flight load — a late previous result cannot overwrite the new dataset', () => {
    const pending: Subject<{ rows: TradeAnalysisRow[]; columns: string[] }>[] = [];
    svc.loadDataset$.mockImplementation(() => {
      const s = new Subject<{ rows: TradeAnalysisRow[]; columns: string[] }>();
      pending.push(s);
      return s;
    });
    store.openDataset(ds);
    store.openDataset(ds2);
    expect(store.activeDataset()?.id).toBe('ds-2');
    // Resolve the SECOND (current) load first, then the stale first one.
    pending[1].next({ rows: [row({ tradeId: 'ds2-row' })], columns: ['tradeId'] });
    expect(store.rows().map((r) => r.tradeId)).toEqual(['ds2-row']);
    pending[0].next({ rows: [row({ tradeId: 'stale' })], columns: ['tradeId'] });
    expect(store.rows().map((r) => r.tradeId)).toEqual(['ds2-row']);
  });

  // ── filteredRows — AND composition ─────────────────────────────────────

  it('enum "in" filter keeps only matching values', () => {
    store.openDataset(ds);
    store.addFilter({ column: 'signalType', op: 'in', value: ['D_ST_TREND_RIDER_V2_LONG'] });
    expect(store.filteredRows().map((r) => r.tradeId)).toEqual(['tr-2']);
  });

  it('numeric range filter bounds tradeRetPct', () => {
    store.openDataset(ds);
    store.addFilter({ column: 'tradeRetPct', op: 'range', value: { min: 0, max: 10 } });
    expect(store.filteredRows().map((r) => r.tradeId)).toEqual(['tr-2']);
  });

  it('open-ended numeric range works', () => {
    store.openDataset(ds);
    store.addFilter({ column: 'tradeRetPct', op: 'range', value: { min: 5 } });
    expect(store.filteredRows().map((r) => r.tradeId)).toEqual(['tr-2', 'tr-3']);
  });

  it('date range filter bounds entryDate inclusively', () => {
    store.openDataset(ds);
    store.addFilter({ column: 'entryDate', op: 'dateRange', value: { from: '2024-10-08', to: '2024-11-02' } });
    expect(store.filteredRows().map((r) => r.tradeId)).toEqual(['tr-1', 'tr-2']);
  });

  it('filters compose with AND semantics', () => {
    store.openDataset(ds);
    store.addFilter({ column: 'direction', op: 'in', value: [TradeSide.LONG] });
    store.addFilter({ column: 'tradeRetPct', op: 'range', value: { min: 0 } });
    // tr-2 is the only LONG with a positive return.
    expect(store.filteredRows().map((r) => r.tradeId)).toEqual(['tr-2']);
  });

  it('null row values never match a bounded filter', () => {
    store.openDataset(ds);
    const nullRow = row({ tradeId: 'tr-null', tradeRetPct: null });
    svc.loadDataset$.mockReturnValue(of({ rows: [nullRow], columns: ['tradeRetPct'] }));
    store.openDataset(ds2);
    store.addFilter({ column: 'tradeRetPct', op: 'range', value: { min: 0 } });
    expect(store.filteredRows()).toEqual([]);
  });

  it('removeFilter + clearFilters restore the full set', () => {
    store.openDataset(ds);
    store.addFilter({ column: 'direction', op: 'in', value: [TradeSide.LONG] });
    store.removeFilter(0);
    expect(store.filteredRows().length).toBe(3);
    store.addFilter({ column: 'direction', op: 'in', value: [TradeSide.LONG] });
    store.clearFilters();
    expect(store.filteredRows().length).toBe(3);
  });

  // ── sort chain ─────────────────────────────────────────────────────────

  it('sort cycles asc → desc → removed on plain toggle', () => {
    store.openDataset(ds);
    store.toggleSort('tradeRetPct');
    expect(store.sortedRows().map((r) => r.tradeId)).toEqual(['tr-1', 'tr-2', 'tr-3']);
    store.toggleSort('tradeRetPct');
    expect(store.sortedRows().map((r) => r.tradeId)).toEqual(['tr-3', 'tr-2', 'tr-1']);
    store.toggleSort('tradeRetPct');
    expect(store.sortedRows().map((r) => r.tradeId)).toEqual(['tr-1', 'tr-2', 'tr-3']);
  });

  it('additive toggle builds a multi-key chain', () => {
    store.openDataset(ds);
    store.toggleSort('direction');
    store.toggleSort('tradeRetPct', true);
    // direction asc: long,long → tradeRetPct asc within: tr-1(-4.91), tr-2(6.51); then short tr-3
    expect(store.sortedRows().map((r) => r.tradeId)).toEqual(['tr-1', 'tr-2', 'tr-3']);
    store.toggleSort('tradeRetPct', true);
    expect(store.sortedRows().map((r) => r.tradeId)).toEqual(['tr-2', 'tr-1', 'tr-3']);
    store.toggleSort('tradeRetPct', true); // removes secondary key
    expect(store.sorts().length).toBe(1);
  });

  // ── slices ─────────────────────────────────────────────────────────────

  it('saveSlice serializes the current filters', () => {
    store.openDataset(ds);
    store.addFilter({ column: 'direction', op: 'in', value: [TradeSide.SHORT] });
    store.saveSlice('shorts only');
    expect(svc.saveSlice$).toHaveBeenCalledWith(
      'shorts only',
      [{ column: 'direction', op: 'in', value: [TradeSide.SHORT] }],
      undefined,
    );
    expect(store.slices().map((s) => s.name)).toContain('shorts only');
  });

  it('applySlice installs its predicates as the active filters', () => {
    store.openDataset(ds);
    store.applySlice(sliceDoc());
    expect(store.filteredRows().map((r) => r.tradeId)).toEqual(['tr-2']);
    expect(store.skippedSliceColumns()).toEqual([]);
  });

  it('applySlice skips predicates on columns the dataset lacks, with a notice', () => {
    store.openDataset(ds); // columns: no 'ind.zoneV2'
    store.applySlice(
      sliceDoc({
        filters: [
          { column: 'ind.zoneV2', op: 'range', value: { min: 2 } },
          { column: 'signalType', op: 'in', value: ['D_ST_TREND_RIDER_V2_LONG'] },
        ],
      }),
    );
    expect(store.filters()).toEqual([
      { column: 'signalType', op: 'in', value: ['D_ST_TREND_RIDER_V2_LONG'] },
    ]);
    expect(store.skippedSliceColumns()).toEqual(['ind.zoneV2']);
  });

  it('deleteSlice removes it from the list', () => {
    store.loadSlices();
    store.deleteSlice('sl-1');
    expect(svc.deleteSlice$).toHaveBeenCalledWith('sl-1');
    expect(store.slices()).toEqual([]);
  });

  // ── compare ────────────────────────────────────────────────────────────

  it('compare dataset rows run through the same filters', () => {
    store.loadDatasets();
    store.openDataset(ds);
    const otherRows = [
      row({ tradeId: 'o-1', datasetId: 'ds-2', tradeRetPct: -1 }),
      row({ tradeId: 'o-2', datasetId: 'ds-2', tradeRetPct: 3 }),
    ];
    svc.loadDataset$.mockReturnValue(of({ rows: otherRows, columns: ['tradeRetPct'] }));
    store.loadCompareDataset(ds2);
    store.addFilter({ column: 'tradeRetPct', op: 'range', value: { min: 0 } });
    expect(store.compareDataset()?.id).toBe('ds-2');
    expect(store.filteredCompareRows().map((r) => r.tradeId)).toEqual(['o-2']);
  });

  it('clearCompare drops the compare set', () => {
    store.loadDatasets();
    store.loadCompareDataset(ds2);
    store.clearCompare();
    expect(store.compareDatasetId()).toBeNull();
    expect(store.compareRows()).toEqual([]);
  });

  // ── generation (task #1082) ──────────────────────────────────────────

  it('generateDataset calls the callable then refreshes the library', () => {
    const params = runParams();
    store.generateDataset(params);
    expect(svc.generateDataset$).toHaveBeenCalledWith(params);
    // the minted 'generating' index doc must surface in the library
    expect(svc.listDatasets$).toHaveBeenCalled();
    expect(store.isGenerating()).toBe(false);
  });

  it('generateDataset applies tags/notes meta on the new doc before refreshing', () => {
    store.generateDataset(runParams(), { tags: ['amat'], notes: 'first replay' });
    expect(svc.updateTagsNotes$).toHaveBeenCalledWith('ds-new', ['amat'], 'first replay');
    expect(svc.listDatasets$).toHaveBeenCalled();
  });

  it('generateDataset without meta skips the tags/notes write', () => {
    store.generateDataset(runParams());
    expect(svc.updateTagsNotes$).not.toHaveBeenCalled();
  });

  it('a failed generate surfaces the error and does not refresh', () => {
    svc.generateDataset$.mockReturnValue(throwError(() => new Error('denied')));
    store.generateDataset(runParams());
    expect(store.error()).toContain('Failed to start dataset generation');
    expect(svc.listDatasets$).not.toHaveBeenCalled();
    expect(store.isGenerating()).toBe(false);
  });

  // ── errors ─────────────────────────────────────────────────────────────

  it('a failed dataset load surfaces the error', () => {
    svc.loadDataset$.mockReturnValue(throwError(() => new Error('gcs down')));
    store.openDataset(ds);
    expect(store.error()).toContain('Failed to load dataset');
    expect(store.isLoadingRows()).toBe(false);
  });
});

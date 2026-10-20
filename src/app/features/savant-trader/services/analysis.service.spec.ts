/**
 * AnalysisService spec (Thread #1059, task #1081).
 *
 * Mocks at the @angular/fire boundary + global fetch; papaparse runs for
 * real on fixture CSV text (TEST doc integration boundary). Covers:
 * - dataset index CRUD (list ordered by generatedAt, tags/notes update,
 *   delete doc + storage object together)
 * - loadDataset: header-name binding survives column reorder/append,
 *   COLUMN_TYPES coercion, missing columns → null, malformed CSV → error
 * - slice CRUD on analysisSlicesPath
 */

const mockStorageRef = jest.fn((...args: unknown[]) => ({ path: args[1] }));

jest.mock('@angular/fire/firestore', () => ({
  Firestore: class {},
  collection: jest.fn((_fs: unknown, path: string) => ({ path })),
  // doc(collectionRef) mints an auto-id ref; doc(fs, path, id) addresses.
  doc: jest.fn((a: unknown, b?: string, c?: string) =>
    b === undefined
      ? { path: `${(a as { path: string }).path}/auto-id`, id: 'auto-id' }
      : { path: `${b}/${c}` }),
  getDocs: jest.fn(),
  query: jest.fn((...args: unknown[]) => ({ args })),
  orderBy: jest.fn((field: string, dir: string) => ({ field, dir })),
  setDoc: jest.fn(() => Promise.resolve()),
  updateDoc: jest.fn(() => Promise.resolve()),
  deleteDoc: jest.fn(() => Promise.resolve()),
}));
jest.mock('@angular/fire/storage', () => ({
  Storage: class {},
  ref: (s: unknown, path: string) => mockStorageRef(s, path),
  getDownloadURL: jest.fn(),
  deleteObject: jest.fn(() => Promise.resolve()),
}));
const mockCallableImpl = jest.fn();
jest.mock('@angular/fire/functions', () => ({
  Functions: class {},
  httpsCallable: jest.fn(() => mockCallableImpl),
}));
jest.mock('@angular/fire/auth', () => ({
  Auth: class {},
  authState: jest.fn(() => of({ uid: 'user-1' })),
}));

import { TestBed } from '@angular/core/testing';
import { firstValueFrom, of } from 'rxjs';
import {
  Firestore,
  collection,
  deleteDoc,
  getDocs,
  orderBy,
  setDoc,
  updateDoc,
} from '@angular/fire/firestore';
import {
  Storage,
  deleteObject,
  getDownloadURL,
} from '@angular/fire/storage';
import { Functions, httpsCallable } from '@angular/fire/functions';
import { Auth } from '@angular/fire/auth';

import { AnalysisService } from './analysis.service';
import { PaperTradingKind } from '@paper-trading/contracts';
import {
  analysisDatasetsPath,
  analysisSlicesPath,
} from '@paper-trading/ids';
import type {
  AnalysisDatasetDoc,
  AnalysisRunParams,
  AnalysisSlice,
} from '@paper-trading/analysis';
import { CallableName } from '../../../core/common/constants';
import { TradeSide } from '@common';
import { PaperTradeStatus } from '@paper-trading/contracts';

function datasetDoc(over: Partial<AnalysisDatasetDoc> = {}): AnalysisDatasetDoc {
  return {
    kind: PaperTradingKind.ANALYSIS_DATASET,
    id: 'ds-20261020-replay-abc123',
    createdAt: '2026-10-20T00:00:00Z',
    updatedAt: '2026-10-20T00:00:00Z',
    origin: 'replay',
    status: 'ready',
    rowCount: 99,
    symbolScope: ['AMAT'],
    signalTypes: [],
    exitRule: 'trailing-8',
    barRange: { from: '2023-01-01', to: '2026-10-16' },
    entryConvention: 'signal-bar-close',
    generatedAt: '2026-10-20T12:00:00Z',
    gcsPath: 'analysis-datasets/ds-20261020-replay-abc123.csv',
    tags: [],
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

function fetchCsv(csv: string): void {
  (global.fetch as jest.Mock) = jest.fn().mockResolvedValue({
    ok: true,
    text: () => Promise.resolve(csv),
  });
}

describe('AnalysisService', () => {
  let service: AnalysisService;

  beforeEach(() => {
    jest.clearAllMocks();
    (getDocs as jest.Mock).mockResolvedValue({ docs: [] });
    (deleteObject as jest.Mock).mockResolvedValue(undefined);
    (getDownloadURL as jest.Mock).mockResolvedValue('https://storage.example/ds.csv');
    global.fetch = jest.fn();
    TestBed.configureTestingModule({
      providers: [
        AnalysisService,
        { provide: Firestore, useValue: {} },
        { provide: Storage, useValue: {} },
        { provide: Functions, useValue: {} },
        { provide: Auth, useValue: {} },
      ],
    });
    service = TestBed.inject(AnalysisService);
  });

  // ── dataset index ──────────────────────────────────────────────────────

  it('listDatasets$ reads analysisDatasetsPath ordered by generatedAt desc', async () => {
    (getDocs as jest.Mock).mockResolvedValue({
      docs: [{ data: () => datasetDoc() }, { data: () => datasetDoc({ id: 'ds-2' }) }],
    });
    const datasets = await firstValueFrom(service.listDatasets$());
    expect(collection).toHaveBeenCalledWith(expect.anything(), analysisDatasetsPath());
    expect(orderBy).toHaveBeenCalledWith('generatedAt', 'desc');
    expect(datasets.map((d) => d.id)).toEqual([
      'ds-20261020-replay-abc123',
      'ds-2',
    ]);
  });

  it('updateTagsNotes$ merges tags + notes on the index doc', async () => {
    await firstValueFrom(service.updateTagsNotes$('ds-1', ['amat', 'v2'], 'first run'));
    expect(updateDoc).toHaveBeenCalledWith(
      expect.objectContaining({
        path: `${analysisDatasetsPath()}/ds-1`,
      }),
      expect.objectContaining({ tags: ['amat', 'v2'], notes: 'first run' }),
    );
  });

  it('updateTagsNotes$ without notes leaves the stored value untouched; null clears it', async () => {
    await firstValueFrom(service.updateTagsNotes$('ds-1', ['amat']));
    const patch = (updateDoc as jest.Mock).mock.calls[0][1];
    expect(patch).not.toHaveProperty('notes');
    (updateDoc as jest.Mock).mockClear();
    await firstValueFrom(service.updateTagsNotes$('ds-1', ['amat'], null));
    expect(updateDoc).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ notes: null }),
    );
  });

  it('deleteDataset$ removes the GCS object and the index doc', async () => {
    const ds = datasetDoc();
    await firstValueFrom(service.deleteDataset$(ds));
    expect(deleteObject).toHaveBeenCalledWith(
      expect.objectContaining({ path: ds.gcsPath }),
    );
    expect(deleteDoc).toHaveBeenCalledWith(
      expect.objectContaining({ path: `${analysisDatasetsPath()}/${ds.id}` }),
    );
  });

  it('deleteDataset$ still deletes the doc when the object is already gone', async () => {
    // 'generating'/'failed' datasets have a gcsPath but no object —
    // delete must remain idempotent.
    (deleteObject as jest.Mock).mockRejectedValue(
      Object.assign(new Error('not found'), { code: 'storage/object-not-found' }),
    );
    await firstValueFrom(service.deleteDataset$(datasetDoc({ status: 'failed' })));
    expect(deleteDoc).toHaveBeenCalled();
  });

  it('deleteDataset$ aborts without touching the doc on other object errors', async () => {
    (deleteObject as jest.Mock).mockRejectedValue(
      Object.assign(new Error('denied'), { code: 'storage/unauthorized' }),
    );
    await expect(firstValueFrom(service.deleteDataset$(datasetDoc()))).rejects.toThrow();
    expect(deleteDoc).not.toHaveBeenCalled();
  });

  // ── loadDataset ────────────────────────────────────────────────────────

  it('loadDataset$ fetches the gcsPath, parses by header name, and coerces via COLUMN_TYPES', async () => {
    // Reordered columns + an appended unknown column — rows must still
    // bind by header name and ignore the extra.
    const csv = [
      'symbol,tradeRetPct,direction,datasetId,tradeId,someFutureColumn',
      'AMAT,6.51,long,ds-1,tr-1,ignored',
      'AMAT,,short,ds-1,tr-2,ignored',
    ].join('\n');
    fetchCsv(csv);
    const loaded = await firstValueFrom(service.loadDataset$(datasetDoc()));
    expect(getDownloadURL).toHaveBeenCalledWith(
      expect.objectContaining({ path: datasetDoc().gcsPath }),
    );
    expect(loaded.columns).toContain('someFutureColumn');
    expect(loaded.rows).toHaveLength(2);
    const [r1, r2] = loaded.rows;
    expect(r1.tradeId).toBe('tr-1');
    expect(r1.direction).toBe(TradeSide.LONG);
    expect(r1.tradeRetPct).toBe(6.51);
    // Empty cell → null, and every manifest key exists on the row.
    expect(r2.tradeRetPct).toBeNull();
    expect(r1.datasetId).toBe('ds-1');
    expect('ind.zoneV2' in r1).toBe(true);
    expect(r1['ind.zoneV2']).toBeNull();
  });

  it('loadDataset$ reports the CSV columns actually present for slice-apply checks', async () => {
    fetchCsv('tradeId,symbol\ntr-1,AMAT\n');
    const loaded = await firstValueFrom(service.loadDataset$(datasetDoc()));
    expect(loaded.columns).toEqual(['tradeId', 'symbol']);
  });

  it('loadDataset$ surfaces a malformed CSV as an error', async () => {
    fetchCsv('tradeId,symbol\ntr-1\n');
    await expect(firstValueFrom(service.loadDataset$(datasetDoc()))).rejects.toThrow(/parse/i);
  });

  it('loadDataset$ fails on a non-ok fetch', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 403 });
    await expect(firstValueFrom(service.loadDataset$(datasetDoc()))).rejects.toThrow();
  });

  // ── slices ─────────────────────────────────────────────────────────────

  it('listSlices$ reads analysisSlicesPath', async () => {
    (getDocs as jest.Mock).mockResolvedValue({
      docs: [{ data: () => sliceDoc() }],
    });
    const slices = await firstValueFrom(service.listSlices$());
    expect(collection).toHaveBeenCalledWith(expect.anything(), analysisSlicesPath());
    expect(slices).toEqual([sliceDoc()]);
  });

  it('saveSlice$ writes a named slice doc with serialized filters', async () => {
    const slice = await firstValueFrom(
      service.saveSlice$('V2 longs', sliceDoc().filters, 'thesis A'),
    );
    expect(setDoc).toHaveBeenCalledWith(
      expect.objectContaining({ path: expect.stringContaining(analysisSlicesPath()) }),
      expect.objectContaining({
        kind: PaperTradingKind.ANALYSIS_SLICE,
        name: 'V2 longs',
        note: 'thesis A',
        filters: sliceDoc().filters,
      }),
    );
    expect(slice.name).toBe('V2 longs');
    expect(slice.id).toBeTruthy();
  });

  it('updateSlice$ merges fields on the slice doc', async () => {
    await firstValueFrom(service.updateSlice$('sl-1', { name: 'renamed' }));
    expect(updateDoc).toHaveBeenCalledWith(
      expect.objectContaining({ path: `${analysisSlicesPath()}/sl-1` }),
      expect.objectContaining({ name: 'renamed' }),
    );
  });

  it('deleteSlice$ removes the slice doc', async () => {
    await firstValueFrom(service.deleteSlice$('sl-1'));
    expect(deleteDoc).toHaveBeenCalledWith(
      expect.objectContaining({ path: `${analysisSlicesPath()}/sl-1` }),
    );
  });

  // ── generation callable (task #1082) ─────────────────────────────────

  it('generateDataset$ calls generateTradeDataset and resolves the datasetId', async () => {
    const params: AnalysisRunParams = {
      origin: 'replay',
      symbolScope: ['AMAT'],
      signalTypes: ['D_ST_TREND_RIDER_V1_LONG'],
      exitRule: 'trailing-8',
      barRange: { from: '2023-01-01', to: '2026-10-20' },
      entryConvention: 'signal-bar-close',
    };
    mockCallableImpl.mockResolvedValue({ data: { datasetId: 'ds-new-1' } });

    const id = await firstValueFrom(service.generateDataset$(params));

    expect(httpsCallable).toHaveBeenCalledWith(
      expect.anything(),
      CallableName.GENERATE_TRADE_DATASET,
    );
    expect(mockCallableImpl).toHaveBeenCalledWith(params);
    expect(id).toBe('ds-new-1');
  });
});

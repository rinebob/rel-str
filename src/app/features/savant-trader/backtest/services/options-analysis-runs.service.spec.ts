/**
 * Contract specs — pin the callable name/payload and the Firestore query
 * shape (TEST-FE: the `where` clause must match the declared index).
 */
import { TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { Firestore } from '@angular/fire/firestore';
import { Functions } from '@angular/fire/functions';
import { firstValueFrom, of } from 'rxjs';

import { OptionsAnalysisRunsService } from './options-analysis-runs.service';
import { ST_OPTIONS_ANALYSIS_RESULTS_ROOT } from '@st/collections';

const httpsCallableMock = jest.fn();
jest.mock('@angular/fire/functions', () => ({
  ...jest.requireActual('@angular/fire/functions'),
  httpsCallable: (fns: unknown, name: string) => httpsCallableMock(fns, name),
}));

const collectionMock = jest.fn((_fs: unknown, name: string) => ({ kind: 'collection', name }));
const whereMock = jest.fn((field: string, op: string, value: unknown) => ({ field, op, value }));
const queryMock = jest.fn((_ref: unknown, ...clauses: unknown[]) => ({ kind: 'query', clauses }));
const collectionDataMock = jest.fn((_q: unknown) => of([]));
jest.mock('@angular/fire/firestore', () => ({
  ...jest.requireActual('@angular/fire/firestore'),
  collection: (fs: unknown, name: string) => collectionMock(fs, name),
  collectionData: (q: unknown) => collectionDataMock(q),
  query: (ref: unknown, ...clauses: unknown[]) => queryMock(ref, ...clauses),
  where: (f: string, op: string, v: unknown) => whereMock(f, op, v),
}));

describe('OptionsAnalysisRunsService', () => {
  let service: OptionsAnalysisRunsService;

  beforeEach(async () => {
    jest.clearAllMocks();
    await TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        { provide: Firestore, useValue: {} },
        { provide: Functions, useValue: {} },
      ],
    }).compileComponents();
    service = TestBed.inject(OptionsAnalysisRunsService);
  });

  it('invokes optionsAnalysisStart with { contractListDocId } and unwraps .data', async () => {
    const callable = jest.fn(async () => ({ data: { analysisId: 'run-1_SPY' } }));
    httpsCallableMock.mockReturnValue(callable);

    const result = await firstValueFrom(service.startAnalysis('run-1_SPY'));

    expect(httpsCallableMock).toHaveBeenCalledWith(expect.anything(), 'optionsAnalysisStart');
    expect(callable).toHaveBeenCalledWith({ contractListDocId: 'run-1_SPY' });
    expect(result.analysisId).toBe('run-1_SPY');
  });

  it('queries st-options-analysis-results by runId only (single-field index)', async () => {
    await firstValueFrom(service.watchResultDocs('run-1'));

    expect(collectionMock).toHaveBeenCalledWith(expect.anything(), ST_OPTIONS_ANALYSIS_RESULTS_ROOT);
    expect(whereMock).toHaveBeenCalledTimes(1);
    expect(whereMock).toHaveBeenCalledWith('runId', '==', 'run-1');
  });

  it('queries st-options-analysis-results by contractListDocId for the results page', async () => {
    await firstValueFrom(service.watchListResultDocs('run-1_SPY'));

    expect(collectionMock).toHaveBeenCalledWith(expect.anything(), ST_OPTIONS_ANALYSIS_RESULTS_ROOT);
    expect(whereMock).toHaveBeenCalledTimes(1);
    expect(whereMock).toHaveBeenCalledWith('contractListDocId', '==', 'run-1_SPY');
  });
});

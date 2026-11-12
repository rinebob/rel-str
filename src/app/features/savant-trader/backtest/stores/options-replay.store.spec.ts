import { TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { DsToastService } from '../../../../shared/ds/ds-toast.service';
import { Subject, of, throwError } from 'rxjs';

import { OptionsReplayStore } from './options-replay.store';
import { OptionsReplayRunsService } from '../services/options-replay-runs.service';
import { OptionsAnalysisRunsService } from '../services/options-analysis-runs.service';
import type { OptionsContractListUi, OptionsReplayRunUi } from '../common/options-replay.types';
import type { AnalysisResultDoc } from '@options-analysis/contracts';

function makeRun(overrides: Partial<OptionsReplayRunUi> = {}): OptionsReplayRunUi {
  return {
    runId: 'run-1_SPY',
    templateId: 'csp-45-20',
    symbol: 'SPY',
    startDate: '2026-01-02',
    status: 'running',
    createdAtIso: '2026-10-28T15:00:00Z',
    ...overrides,
  };
}

function makeList(overrides: Partial<OptionsContractListUi> = {}): OptionsContractListUi {
  return {
    // Under single-symbol runs (#1430) the list doc id IS the runId.
    listId: 'run-1_SPY',
    runId: 'run-1_SPY',
    symbol: 'SPY',
    templateId: 'csp-45-20',
    status: 'success',
    rows: [],
    ...overrides,
  };
}

function makeResultDoc(overrides: Partial<AnalysisResultDoc> = {}): AnalysisResultDoc {
  return {
    contractListDocId: 'run-1_SPY',
    runId: 'run-1_SPY',
    symbol: 'SPY',
    templateId: 'csp-45-20',
    exitId: 'exit-1',
    registryVersion: 1,
    status: 'success',
    trades: [],
    aggregate: { exitId: 'exit-1', contractCount: 0, exitedCount: 0, expiredCount: 0, openCount: 0, errorCount: 0 },
    generatedAt: '2026-11-05T00:00:00Z',
    ...overrides,
  };
}

describe('OptionsReplayStore', () => {
  let runsSubject: Subject<OptionsReplayRunUi[]>;
  let listsSubject: Subject<OptionsContractListUi[]>;
  let resultsSubject: Subject<AnalysisResultDoc[]>;
  let toast: { open: jest.Mock };

  async function setup() {
    runsSubject = new Subject();
    listsSubject = new Subject();
    resultsSubject = new Subject();
    toast = { open: jest.fn() };

    const serviceStub = {
      watchRuns: jest.fn(() => runsSubject.asObservable()),
      watchContractLists: jest.fn(() => listsSubject.asObservable()),
      startReplay: jest.fn(() => of({ runIds: ['new-run-1_SPY'] })),
      retryRun: jest.fn(() => of({ retriedSymbol: 'SPY' })),
      deleteRun: jest.fn(() => of({ deletedRun: true, deletedLists: 1, deletedResults: 6 })),
    };

    const analysisStub = {
      watchAllResultDocs: jest.fn(() => resultsSubject.asObservable()),
      startAnalysis: jest.fn(() => of({ analysisId: 'run-1_SPY' })),
    };

    await TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        provideNoopAnimations(),
        { provide: OptionsReplayRunsService, useValue: serviceStub },
        { provide: OptionsAnalysisRunsService, useValue: analysisStub },
        { provide: DsToastService, useValue: toast },
      ],
    }).compileComponents();

    return TestBed.inject(OptionsReplayStore);
  }

  it('streams run docs into the runs signal', async () => {
    const store = await setup();
    store.loadRuns();

    runsSubject.next([makeRun()]);
    expect(store.runs().length).toBe(1);
    expect(store.runs()[0].runId).toBe('run-1_SPY');
    expect(store.runsStreaming()).toBe(false);
  });

  it('updates the runs signal live as docs change', async () => {
    const store = await setup();
    store.loadRuns();

    runsSubject.next([makeRun({ status: 'running' })]);
    runsSubject.next([makeRun({ status: 'completed' })]);
    expect(store.runs()[0].status).toBe('completed');
  });

  it('loadRuns is idempotent — one service subscription', async () => {
    const store = await setup();
    store.loadRuns();
    store.loadRuns();
    expect(TestBed.inject(OptionsReplayRunsService).watchRuns).toHaveBeenCalledTimes(1);
  });

  it('loadRuns also starts the collection-wide list + results streams', async () => {
    const store = await setup();

    store.loadRuns();

    const service = TestBed.inject(OptionsReplayRunsService);
    const analysisService = TestBed.inject(OptionsAnalysisRunsService);
    expect(service.watchContractLists).toHaveBeenCalledTimes(1);
    expect(analysisService.watchAllResultDocs).toHaveBeenCalledTimes(1);
  });

  it('streams contract-list docs into contractLists / contractListById', async () => {
    const store = await setup();
    store.loadRuns();

    listsSubject.next([makeList()]);

    expect(store.contractLists().length).toBe(1);
    expect(store.contractLists()[0].symbol).toBe('SPY');
    expect(store.contractListById().get('run-1_SPY')?.symbol).toBe('SPY');
  });

  it('startReplay calls the service and toasts the started count', async () => {
    const store = await setup();
    store.loadRuns();
    runsSubject.next([makeRun()]);

    store.startReplay({ templateId: 'csp-45-20', symbols: ['SPY'], startDate: '2026-01-02' });

    const service = TestBed.inject(OptionsReplayRunsService);
    expect(service.startReplay).toHaveBeenCalledWith({ templateId: 'csp-45-20', symbols: ['SPY'], startDate: '2026-01-02' });
    expect(toast.open).toHaveBeenCalledWith(expect.stringContaining('1 run'), 'Dismiss', { duration: 30000 });
  });

  it('startReplay failure snack-bars', async () => {
    const store = await setup();
    const service = TestBed.inject(OptionsReplayRunsService);
    (service.startReplay as jest.Mock).mockReturnValue(throwError(() => new Error('unavailable')));

    store.startReplay({ templateId: 'csp-45-20', symbols: ['SPY'], startDate: '2026-01-02' });

    expect(toast.open).toHaveBeenCalledWith(expect.stringContaining('Failed to start replay'), 'Dismiss', { duration: 30000 });
  });

  it('stream errors snack-bar and stop the streaming flag', async () => {
    const store = await setup();
    const service = TestBed.inject(OptionsReplayRunsService);
    (service.watchRuns as jest.Mock).mockReturnValue(throwError(() => new Error('denied')));

    store.loadRuns();
    expect(toast.open).toHaveBeenCalled();
    expect(store.runsStreaming()).toBe(false);
  });

  describe('runRows', () => {
    it('derives exactly one row per run — a run IS one symbol (#1430)', async () => {
      const store = await setup();
      store.loadRuns();
      runsSubject.next([
        makeRun({ runId: 'run-a_SPY', symbol: 'SPY' }),
        makeRun({ runId: 'run-b_QQQ', symbol: 'QQQ' }),
      ]);

      const rows = store.runRows();
      expect(rows.length).toBe(2);
      expect(rows.map((r) => [r.runId, r.symbol])).toEqual([
        ['run-a_SPY', 'SPY'],
        ['run-b_QQQ', 'QQQ'],
      ]);
    });

    it('maps the run status onto the row — completed presents as success', async () => {
      const store = await setup();
      store.loadRuns();
      runsSubject.next([
        makeRun({ runId: 'run-a_SPY', symbol: 'SPY', status: 'completed' }),
        makeRun({ runId: 'run-b_QQQ', symbol: 'QQQ', status: 'failed' }),
        makeRun({ runId: 'run-c_IWM', symbol: 'IWM', status: 'running' }),
      ]);

      const rows = store.runRows();
      expect(rows.find((r) => r.symbol === 'SPY')?.status).toBe('success');
      expect(rows.find((r) => r.symbol === 'QQQ')?.status).toBe('failed');
      expect(rows.find((r) => r.symbol === 'IWM')?.status).toBe('running');
    });

    it('a pending run produces a pending row — no outcomes map exists to consult', async () => {
      const store = await setup();
      store.loadRuns();
      runsSubject.next([makeRun({ status: 'pending' })]);
      expect(store.runRows()[0].status).toBe('pending');
    });

    it('carries run-level fields onto the row', async () => {
      const store = await setup();
      store.loadRuns();
      runsSubject.next([
        makeRun({
          templateId: 'csp-45-20',
          startDate: '2026-01-02',
          status: 'running',
          createdAtIso: '2026-10-28T15:00:00Z',
        }),
      ]);

      const row = store.runRows()[0];
      expect(row.templateId).toBe('csp-45-20');
      expect(row.startDate).toBe('2026-01-02');
      expect(row.createdAtIso).toBe('2026-10-28T15:00:00Z');
      expect(row.status).toBe('running');
    });
  });

  describe('filteredRows', () => {
    async function seededStore() {
      const store = await setup();
      store.loadRuns();
      runsSubject.next([
        makeRun({
          runId: 'run-a_SPY',
          symbol: 'SPY',
          templateId: 'csp-45-20',
          startDate: '2026-01-02',
          createdAtIso: '2026-10-28T15:00:00Z',
          status: 'completed',
        }),
        makeRun({
          runId: 'run-b_QQQ',
          symbol: 'QQQ',
          templateId: 'csp-30-15',
          startDate: '2026-02-01',
          createdAtIso: '2026-10-27T15:00:00Z',
          status: 'failed',
        }),
        makeRun({
          runId: 'run-c_IWM',
          symbol: 'IWM',
          templateId: 'csp-45-20',
          startDate: '2026-03-01',
          createdAtIso: '2026-10-26T15:00:00Z',
          status: 'pending',
        }),
      ]);
      return store;
    }

    it('returns all rows with default filters', async () => {
      const store = await seededStore();
      expect(store.filteredRows().length).toBe(3);
    });

    it('default sort is createdAt descending', async () => {
      const store = await seededStore();
      expect(store.filteredRows().map((r) => r.runId)).toEqual(['run-a_SPY', 'run-b_QQQ', 'run-c_IWM']);
    });

    it('status filter matches the row status', async () => {
      const store = await seededStore();
      store.setStatusFilter('failed');
      expect(store.filteredRows().map((r) => r.symbol)).toEqual(['QQQ']);

      store.setStatusFilter('pending');
      expect(store.filteredRows().map((r) => r.symbol)).toEqual(['IWM']);

      store.setStatusFilter('success');
      expect(store.filteredRows().map((r) => r.symbol)).toEqual(['SPY']);
    });

    it('template filter keeps only matching templateId rows', async () => {
      const store = await seededStore();
      store.setTemplateFilter('csp-45-20');
      expect(store.filteredRows().map((r) => r.symbol)).toEqual(['SPY', 'IWM']);
    });

    it('symbol search is a case-insensitive substring match', async () => {
      const store = await seededStore();
      store.setSymbolSearch('qq');
      expect(store.filteredRows().map((r) => r.symbol)).toEqual(['QQQ']);
    });

    it('filters compose — status × template × symbol', async () => {
      const store = await seededStore();
      store.setStatusFilter('pending');
      store.setTemplateFilter('csp-45-20');
      store.setSymbolSearch('iwm');
      expect(store.filteredRows().map((r) => r.symbol)).toEqual(['IWM']);

      store.setSymbolSearch('spy');
      expect(store.filteredRows().length).toBe(0);
    });

    it('sorts by createdAt ascending', async () => {
      const store = await seededStore();
      store.setSortBy('createdAt');
      store.setSortDirection('asc');
      expect(store.filteredRows().map((r) => r.runId)).toEqual(['run-c_IWM', 'run-b_QQQ', 'run-a_SPY']);
    });

    it('sorts by startDate in both directions', async () => {
      const store = await seededStore();
      store.setSortBy('startDate');
      store.setSortDirection('asc');
      expect(store.filteredRows().map((r) => r.symbol)).toEqual(['SPY', 'QQQ', 'IWM']);

      store.setSortDirection('desc');
      expect(store.filteredRows().map((r) => r.symbol)).toEqual(['IWM', 'QQQ', 'SPY']);
    });

    it('sorts by symbol in both directions', async () => {
      const store = await seededStore();
      store.setSortBy('symbol');
      store.setSortDirection('asc');
      expect(store.filteredRows().map((r) => r.symbol)).toEqual(['IWM', 'QQQ', 'SPY']);

      store.setSortDirection('desc');
      expect(store.filteredRows().map((r) => r.symbol)).toEqual(['SPY', 'QQQ', 'IWM']);
    });

    it('hasActiveFilters reflects non-default filters and resetFilters clears them', async () => {
      const store = await seededStore();
      expect(store.hasActiveFilters()).toBe(false);

      store.setStatusFilter('failed');
      expect(store.hasActiveFilters()).toBe(true);

      store.resetFilters();
      expect(store.hasActiveFilters()).toBe(false);
      expect(store.filteredRows().length).toBe(3);
    });

    it('sort changes do not count as active filters', async () => {
      const store = await seededStore();
      store.setSortBy('symbol');
      store.setSortDirection('asc');
      expect(store.hasActiveFilters()).toBe(false);
    });
  });

  describe('collection streams', () => {
    it('loadRuns is idempotent — aux streams subscribe once', async () => {
      const store = await setup();
      const service = TestBed.inject(OptionsReplayRunsService);
      const analysisService = TestBed.inject(OptionsAnalysisRunsService);

      store.loadRuns();
      store.loadRuns();

      expect(service.watchContractLists).toHaveBeenCalledTimes(1);
      expect(analysisService.watchAllResultDocs).toHaveBeenCalledTimes(1);
    });

    it('contract lists stream live for every run, not a selection', async () => {
      const store = await setup();
      store.loadRuns();

      listsSubject.next([makeList(), makeList({ listId: 'run-2_QQQ', runId: 'run-2_QQQ', symbol: 'QQQ' })]);

      expect(store.contractListById().size).toBe(2);
      expect(store.contractListById().get('run-2_QQQ')?.symbol).toBe('QQQ');
    });

    it('result docs mark their list ready — for any run in the window', async () => {
      const store = await setup();
      store.loadRuns();

      resultsSubject.next([
        makeResultDoc(),
        makeResultDoc({ contractListDocId: 'run-2_QQQ', runId: 'run-2_QQQ', symbol: 'QQQ' }),
      ]);

      expect(store.analysisReadyListIds().has('run-1_SPY')).toBe(true);
      expect(store.analysisReadyListIds().has('run-2_QQQ')).toBe(true);
    });

    it('a dead lists stream revives on the next loadRuns — a stream error completes the subscription', async () => {
      const store = await setup();
      const service = TestBed.inject(OptionsReplayRunsService);
      store.loadRuns();

      listsSubject.error(new Error('denied'));
      expect(store.contractLists()).toEqual([]);

      const revived = new Subject<OptionsContractListUi[]>();
      (service.watchContractLists as jest.Mock).mockReturnValue(revived.asObservable());
      store.loadRuns();

      expect(service.watchContractLists).toHaveBeenCalledTimes(2);
      revived.next([makeList()]);
      expect(store.contractListById().get('run-1_SPY')?.symbol).toBe('SPY');
    });

    it('a dead results stream revives on the next loadRuns', async () => {
      const store = await setup();
      const analysisService = TestBed.inject(OptionsAnalysisRunsService);
      store.loadRuns();

      resultsSubject.error(new Error('denied'));

      const revived = new Subject<AnalysisResultDoc[]>();
      (analysisService.watchAllResultDocs as jest.Mock).mockReturnValue(revived.asObservable());
      store.loadRuns();

      expect(analysisService.watchAllResultDocs).toHaveBeenCalledTimes(2);
      revived.next([makeResultDoc()]);
      expect(store.analysisReadyListIds().has('run-1_SPY')).toBe(true);
    });

    it('a dead runs stream re-subscribes on the next loadRuns', async () => {
      const store = await setup();
      const service = TestBed.inject(OptionsReplayRunsService);
      store.loadRuns();

      runsSubject.error(new Error('denied'));

      const revived = new Subject<OptionsReplayRunUi[]>();
      (service.watchRuns as jest.Mock).mockReturnValue(revived.asObservable());
      store.loadRuns();

      expect(service.watchRuns).toHaveBeenCalledTimes(2);
      revived.next([makeRun()]);
      expect(store.runs()[0].runId).toBe('run-1_SPY');
    });
  });

  describe('retryRun', () => {
    it('calls optionsReplayRetry with the runId and toasts the retried symbol', async () => {
      const store = await setup();
      const service = TestBed.inject(OptionsReplayRunsService);

      store.retryRun('run-1_SPY');

      expect(service.retryRun).toHaveBeenCalledWith('run-1_SPY');
      expect(toast.open).toHaveBeenCalledWith(expect.stringContaining('SPY'), 'Dismiss', { duration: 30000 });
    });

    it('marks the run retrying for the in-flight window and ignores a second click', async () => {
      const store = await setup();
      const service = TestBed.inject(OptionsReplayRunsService);
      const pending = new Subject<{ retriedSymbol: string | null }>();
      (service.retryRun as jest.Mock).mockReturnValue(pending.asObservable());

      store.retryRun('run-1_SPY');
      expect(store.retryingRunIds().has('run-1_SPY')).toBe(true);

      store.retryRun('run-1_SPY');
      expect(service.retryRun).toHaveBeenCalledTimes(1);

      // The flag is per-run — a different run's retry is not blocked.
      store.retryRun('run-2_QQQ');
      expect(service.retryRun).toHaveBeenCalledTimes(2);
      expect(service.retryRun).toHaveBeenLastCalledWith('run-2_QQQ');
    });

    it('holds the in-flight flag after a real retry until the snapshot fingerprint changes', async () => {
      const store = await setup();
      const service = TestBed.inject(OptionsReplayRunsService);
      const pending = new Subject<{ retriedSymbol: string | null }>();
      (service.retryRun as jest.Mock).mockReturnValue(pending.asObservable());
      store.loadRuns();
      runsSubject.next([makeRun({ status: 'failed', updatedAtIso: '2026-10-28T15:00:00Z' })]);

      store.retryRun('run-1_SPY');
      pending.next({ retriedSymbol: 'SPY' });
      // Response settled but the doc snapshot hasn't caught up — the
      // flag closes the re-click gap.
      expect(store.retryingRunIds().has('run-1_SPY')).toBe(true);

      // A stale pre-retry snapshot (same status + updatedAt fingerprint)
      // keeps it.
      runsSubject.next([makeRun({ status: 'failed', updatedAtIso: '2026-10-28T15:00:00Z' })]);
      expect(store.retryingRunIds().has('run-1_SPY')).toBe(true);

      // Post-retry snapshot — the retry tx flipped status + re-stamped
      // updatedAt; the fingerprint changed → prune.
      runsSubject.next([makeRun({ status: 'running', updatedAtIso: '2026-10-28T15:01:00Z' })]);
      expect(store.retryingRunIds().has('run-1_SPY')).toBe(false);
    });

    it('clears the flag when a fast re-failure coalesces into the post-retry snapshot', async () => {
      const store = await setup();
      const service = TestBed.inject(OptionsReplayRunsService);
      const pending = new Subject<{ retriedSymbol: string | null }>();
      (service.retryRun as jest.Mock).mockReturnValue(pending.asObservable());
      store.loadRuns();
      runsSubject.next([makeRun({ status: 'failed', updatedAtIso: '2026-10-28T15:00:00Z' })]);

      store.retryRun('run-1_SPY');
      pending.next({ retriedSymbol: 'SPY' });
      expect(store.retryingRunIds().has('run-1_SPY')).toBe(true);

      // A retried run that re-fails before the 'running' snapshot is
      // delivered lands 'failed' + a NEW updatedAt — the fingerprint
      // differs from the pre-retry doc, so the flag still prunes and the
      // rerun button re-enables (the run is retryable again).
      runsSubject.next([makeRun({ status: 'failed', updatedAtIso: '2026-10-28T15:02:00Z' })]);
      expect(store.retryingRunIds().has('run-1_SPY')).toBe(false);
    });

    it('prunes the flag when the run drops out of the snapshot', async () => {
      const store = await setup();
      const service = TestBed.inject(OptionsReplayRunsService);
      const pending = new Subject<{ retriedSymbol: string | null }>();
      (service.retryRun as jest.Mock).mockReturnValue(pending.asObservable());
      store.loadRuns();
      runsSubject.next([makeRun({ status: 'failed' })]);

      store.retryRun('run-1_SPY');
      pending.next({ retriedSymbol: 'SPY' });
      expect(store.retryingRunIds().has('run-1_SPY')).toBe(true);

      // Deleted doc / evicted from the top-50 window — nothing left to
      // protect; holding would leak a dead disable forever.
      runsSubject.next([]);
      expect(store.retryingRunIds().has('run-1_SPY')).toBe(false);
    });

    it('reports nothing-to-retry when the callable returns a null retriedSymbol', async () => {
      const store = await setup();
      const service = TestBed.inject(OptionsReplayRunsService);
      (service.retryRun as jest.Mock).mockReturnValue(of({ retriedSymbol: null }));

      store.retryRun('run-1_SPY');

      expect(toast.open).toHaveBeenCalledWith(expect.stringContaining('Nothing to retry'), 'Dismiss', { duration: 30000 });
      expect(store.retryingRunIds().has('run-1_SPY')).toBe(false);
    });

    it('toasts the failure and clears the in-flight flag on error', async () => {
      const store = await setup();
      const service = TestBed.inject(OptionsReplayRunsService);
      (service.retryRun as jest.Mock).mockReturnValue(throwError(() => new Error('unavailable')));

      store.retryRun('run-1_SPY');

      expect(toast.open).toHaveBeenCalledWith(expect.stringContaining('Retry failed'), 'Dismiss', { duration: 30000 });
      expect(store.retryingRunIds().has('run-1_SPY')).toBe(false);
    });
  });

  describe('deleteRun', () => {
    it('calls optionsReplayDelete with the runId and toasts the deleted symbol', async () => {
      const store = await setup();
      const service = TestBed.inject(OptionsReplayRunsService);
      store.loadRuns();
      runsSubject.next([makeRun({ runId: 'run-1_SPY', symbol: 'SPY' })]);

      store.deleteRun('run-1_SPY');

      expect(service.deleteRun).toHaveBeenCalledWith('run-1_SPY');
      expect(toast.open).toHaveBeenCalledWith(expect.stringContaining('Deleted run for SPY'), 'Dismiss', { duration: 30000 });
    });

    it('marks the run deleting in-flight and ignores a second click', async () => {
      const store = await setup();
      const service = TestBed.inject(OptionsReplayRunsService);
      const pending = new Subject<{ deletedRun: boolean; deletedLists: number; deletedResults: number }>();
      (service.deleteRun as jest.Mock).mockReturnValue(pending.asObservable());

      store.deleteRun('run-1_SPY');
      expect(store.deletingRunIds().has('run-1_SPY')).toBe(true);

      store.deleteRun('run-1_SPY');
      expect(service.deleteRun).toHaveBeenCalledTimes(1);

      // The flag is per-run — a different run's delete is not blocked.
      store.deleteRun('run-2_QQQ');
      expect(service.deleteRun).toHaveBeenCalledTimes(2);
      expect(service.deleteRun).toHaveBeenLastCalledWith('run-2_QQQ');
    });

    it('holds the flag after the response until the run leaves the snapshot', async () => {
      const store = await setup();
      const service = TestBed.inject(OptionsReplayRunsService);
      const pending = new Subject<{ deletedRun: boolean; deletedLists: number; deletedResults: number }>();
      (service.deleteRun as jest.Mock).mockReturnValue(pending.asObservable());
      store.loadRuns();
      runsSubject.next([makeRun({ runId: 'run-1_SPY' })]);

      store.deleteRun('run-1_SPY');
      pending.next({ deletedRun: true, deletedLists: 1, deletedResults: 6 });
      // Response settled but the doc snapshot hasn't caught up — the
      // flag closes the re-click gap.
      expect(store.deletingRunIds().has('run-1_SPY')).toBe(true);

      // A stale snapshot still containing the run keeps the flag.
      runsSubject.next([makeRun({ runId: 'run-1_SPY' })]);
      expect(store.deletingRunIds().has('run-1_SPY')).toBe(true);

      // The doc is gone → nothing left to disable → prune.
      runsSubject.next([]);
      expect(store.deletingRunIds().has('run-1_SPY')).toBe(false);
    });

    it('reports nothing-to-delete when the callable found no docs', async () => {
      const store = await setup();
      const service = TestBed.inject(OptionsReplayRunsService);
      (service.deleteRun as jest.Mock).mockReturnValue(of({ deletedRun: false, deletedLists: 0, deletedResults: 0 }));

      store.deleteRun('run-1_SPY');

      expect(toast.open).toHaveBeenCalledWith(expect.stringContaining('Nothing to delete'), 'Dismiss', { duration: 30000 });
    });

    it('toasts the failure and clears the in-flight flag on error', async () => {
      const store = await setup();
      const service = TestBed.inject(OptionsReplayRunsService);
      (service.deleteRun as jest.Mock).mockReturnValue(throwError(() => new Error('unavailable')));

      store.deleteRun('run-1_SPY');

      expect(toast.open).toHaveBeenCalledWith(expect.stringContaining('Delete failed'), 'Dismiss', { duration: 30000 });
      expect(store.deletingRunIds().has('run-1_SPY')).toBe(false);
    });
  });

  describe('analysis results stream', () => {
    it('streams all result docs into analysisResults', async () => {
      const store = await setup();
      store.loadRuns();

      resultsSubject.next([makeResultDoc()]);
      expect(store.analysisResults().length).toBe(1);
      expect(store.analysisReadyListIds().has('run-1_SPY')).toBe(true);
    });

    it('marks ready only on SUCCESS docs — a failed doc keeps Analyze enabled', async () => {
      const store = await setup();
      store.loadRuns();

      resultsSubject.next([makeResultDoc({ status: 'failed', error: 'series fetch failed' })]);
      expect(store.analysisResults().length).toBe(1);
      expect(store.analysisReadyListIds().has('run-1_SPY')).toBe(false);

      resultsSubject.next([makeResultDoc({ status: 'success' })]);
      expect(store.analysisReadyListIds().has('run-1_SPY')).toBe(true);
    });
  });

  describe('startAnalysis', () => {
    it('calls the callable and toasts success', async () => {
      const store = await setup();
      store.loadRuns();

      store.startAnalysis('run-1_SPY');

      const service = TestBed.inject(OptionsAnalysisRunsService);
      expect(service.startAnalysis).toHaveBeenCalledWith('run-1_SPY');
      expect(toast.open).toHaveBeenCalledWith(expect.stringContaining('Analysis started'), 'Dismiss', { duration: 30000 });
    });

    it('holds the in-flight flag until a result doc for that list lands', async () => {
      const store = await setup();
      const service = TestBed.inject(OptionsAnalysisRunsService);
      const pending = new Subject<{ analysisId: string }>();
      (service.startAnalysis as jest.Mock).mockReturnValue(pending.asObservable());
      store.loadRuns();

      store.startAnalysis('run-1_SPY');
      pending.next({ analysisId: 'run-1_SPY' });
      expect(store.analyzingListIds().has('run-1_SPY')).toBe(true);

      // The callable resolves before the worker writes — the flag holds
      // until the stream proves analysis output exists for this list.
      resultsSubject.next([makeResultDoc()]);
      expect(store.analyzingListIds().has('run-1_SPY')).toBe(false);
    });

    it('guards a duplicate click while a call for the same list is in flight', async () => {
      const store = await setup();
      const service = TestBed.inject(OptionsAnalysisRunsService);
      const pending = new Subject<{ analysisId: string }>();
      (service.startAnalysis as jest.Mock).mockReturnValue(pending.asObservable());
      store.loadRuns();

      store.startAnalysis('run-1_SPY');
      store.startAnalysis('run-1_SPY');

      expect(service.startAnalysis).toHaveBeenCalledTimes(1);
    });

    it('keeps the flag when a doc lands for a different list', async () => {
      const store = await setup();
      const service = TestBed.inject(OptionsAnalysisRunsService);
      const pending = new Subject<{ analysisId: string }>();
      (service.startAnalysis as jest.Mock).mockReturnValue(pending.asObservable());
      store.loadRuns();

      store.startAnalysis('run-1_SPY');
      pending.next({ analysisId: 'run-1_SPY' });

      // A doc for another list is progress elsewhere — not this flag's
      // completion signal.
      resultsSubject.next([makeResultDoc({ contractListDocId: 'run-2_QQQ', symbol: 'QQQ' })]);
      expect(store.analyzingListIds().has('run-1_SPY')).toBe(true);

      resultsSubject.next([makeResultDoc({ contractListDocId: 'run-2_QQQ', symbol: 'QQQ' }), makeResultDoc()]);
      expect(store.analyzingListIds().has('run-1_SPY')).toBe(false);
    });

    it('toasts the failure and clears the flag on error', async () => {
      const store = await setup();
      const service = TestBed.inject(OptionsAnalysisRunsService);
      (service.startAnalysis as jest.Mock).mockReturnValue(throwError(() => new Error('failed-precondition')));
      store.loadRuns();

      store.startAnalysis('run-1_SPY');

      expect(toast.open).toHaveBeenCalledWith(expect.stringContaining('Analysis failed to start'), 'Dismiss', { duration: 30000 });
      expect(store.analyzingListIds().has('run-1_SPY')).toBe(false);
    });
  });
});

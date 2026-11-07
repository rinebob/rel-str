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
    aggregate: { exitId: 'exit-1', contractCount: 0, exitedCount: 0, expiredCount: 0, errorCount: 0 },
    generatedAt: '2026-11-05T00:00:00Z',
    ...overrides,
  };
}

describe('OptionsReplayStore', () => {
  let runsSubject: Subject<OptionsReplayRunUi[]>;
  let listsSubject: Subject<OptionsContractListUi | null>;
  let resultsSubject: Subject<AnalysisResultDoc[]>;
  let toast: { open: jest.Mock };

  async function setup() {
    runsSubject = new Subject();
    listsSubject = new Subject();
    resultsSubject = new Subject();
    toast = { open: jest.fn() };

    const serviceStub = {
      watchRuns: jest.fn(() => runsSubject.asObservable()),
      watchContractList: jest.fn(() => listsSubject.asObservable()),
      startReplay: jest.fn(() => of({ runIds: ['new-run-1_SPY'] })),
      retryRun: jest.fn(() => of({ retriedSymbol: 'SPY' })),
      deleteRun: jest.fn(() => of({ deletedRun: true, deletedLists: 1, deletedResults: 6 })),
    };

    const analysisStub = {
      watchResultDocs: jest.fn(() => resultsSubject.asObservable()),
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

  it('selectRun streams the run\'s contract lists', async () => {
    const store = await setup();
    store.loadRuns();
    runsSubject.next([makeRun()]);

    store.selectRun('run-1_SPY');
    const service = TestBed.inject(OptionsReplayRunsService);
    expect(service.watchContractList).toHaveBeenCalledWith('run-1_SPY');

    listsSubject.next(makeList());
    expect(store.contractList()).toBeTruthy();
    expect(store.contractList()?.symbol).toBe('SPY');
    expect(store.listsStreaming()).toBe(false);
    expect(store.selectedRun()?.runId).toBe('run-1_SPY');
  });

  it('selectRun(null) clears lists and stops streaming', async () => {
    const store = await setup();
    store.selectRun('run-1_SPY');
    listsSubject.next(makeList());

    store.selectRun(null);
    expect(store.contractList()).toBeNull();
    expect(store.selectedRun()).toBeNull();
  });

  it('startReplay calls the service, selects the first new run, and streams its lists', async () => {
    const store = await setup();
    store.loadRuns();
    runsSubject.next([makeRun()]);

    store.startReplay({ templateId: 'csp-45-20', symbols: ['SPY'], startDate: '2026-01-02' });

    const service = TestBed.inject(OptionsReplayRunsService);
    expect(service.startReplay).toHaveBeenCalledWith({ templateId: 'csp-45-20', symbols: ['SPY'], startDate: '2026-01-02' });
    expect(store.selectedRunId()).toBe('new-run-1_SPY');
    expect(service.watchContractList).toHaveBeenCalledWith('new-run-1_SPY');
    expect(toast.open).toHaveBeenCalledWith(expect.stringContaining('1 run'), 'Dismiss', { duration: 30000 });
  });

  it('startReplay failure snack-bars and leaves selection untouched', async () => {
    const store = await setup();
    const service = TestBed.inject(OptionsReplayRunsService);
    (service.startReplay as jest.Mock).mockReturnValue(throwError(() => new Error('unavailable')));

    store.selectRun('existing-run');
    store.startReplay({ templateId: 'csp-45-20', symbols: ['SPY'], startDate: '2026-01-02' });

    expect(store.selectedRunId()).toBe('existing-run');
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

  describe('selectRow', () => {
    it('sets selectedRunId and streams the run\'s contract list', async () => {
      const store = await setup();
      store.loadRuns();
      runsSubject.next([makeRun()]);

      store.selectRow('run-1_SPY');
      expect(store.selectedRunId()).toBe('run-1_SPY');
      expect(TestBed.inject(OptionsReplayRunsService).watchContractList).toHaveBeenCalledWith('run-1_SPY');

      listsSubject.next(makeList());
      expect(store.contractList()?.symbol).toBe('SPY');
    });

    it('a same-run reselect keeps the existing list stream', async () => {
      const store = await setup();
      const service = TestBed.inject(OptionsReplayRunsService);

      store.selectRow('run-1_SPY');
      store.selectRow('run-1_SPY');

      expect(service.watchContractList).toHaveBeenCalledTimes(1);
      expect(store.selectedRunId()).toBe('run-1_SPY');
    });

    it('cross-run selection restreams that run\'s contract list', async () => {
      const store = await setup();
      const service = TestBed.inject(OptionsReplayRunsService);

      store.selectRow('run-1_SPY');
      store.selectRow('run-2_QQQ');

      expect(service.watchContractList).toHaveBeenCalledTimes(2);
      expect(service.watchContractList).toHaveBeenLastCalledWith('run-2_QQQ');
      expect(store.selectedRunId()).toBe('run-2_QQQ');
    });

    it('a same-run reselect restreams when the list stream died on an error', async () => {
      const store = await setup();
      const service = TestBed.inject(OptionsReplayRunsService);

      store.selectRow('run-1_SPY');
      expect(service.watchContractList).toHaveBeenCalledTimes(1);

      // watchStream's catchError swallows the error into of([]) → the
      // subscription completes → .closed — a same-run reselect must restream.
      listsSubject.error(new Error('denied'));

      store.selectRow('run-1_SPY');
      expect(service.watchContractList).toHaveBeenCalledTimes(2);
      expect(service.watchContractList).toHaveBeenLastCalledWith('run-1_SPY');
    });

    it('selectRun sets the selection to the runId', async () => {
      const store = await setup();
      store.selectRow('run-1_SPY');
      expect(store.selectedRunId()).toBe('run-1_SPY');

      store.selectRun('run-2_QQQ');
      expect(store.selectedRunId()).toBe('run-2_QQQ');
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

    it('clears the selection when the selected run is deleted', async () => {
      const store = await setup();
      store.selectRow('run-1_SPY');
      listsSubject.next(makeList());
      expect(store.selectedRunId()).toBe('run-1_SPY');

      store.deleteRun('run-1_SPY');

      expect(store.selectedRunId()).toBeNull();
      expect(store.contractList()).toBeNull();
    });

    it('keeps the selection when a different run is deleted', async () => {
      const store = await setup();
      store.selectRow('run-1_SPY');

      store.deleteRun('run-2_QQQ');

      expect(store.selectedRunId()).toBe('run-1_SPY');
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
    it('streams result docs for the selected run', async () => {
      const store = await setup();
      store.selectRun('run-1_SPY');

      const service = TestBed.inject(OptionsAnalysisRunsService);
      expect(service.watchResultDocs).toHaveBeenCalledWith('run-1_SPY');

      resultsSubject.next([makeResultDoc()]);
      expect(store.analysisResults().length).toBe(1);
      expect(store.analysisReadyListIds().has('run-1_SPY')).toBe(true);
    });

    it('marks ready only on SUCCESS docs — a failed doc keeps Analyze enabled', async () => {
      const store = await setup();
      store.selectRun('run-1_SPY');

      resultsSubject.next([makeResultDoc({ status: 'failed', error: 'series fetch failed' })]);
      expect(store.analysisResults().length).toBe(1);
      expect(store.analysisReadyListIds().has('run-1_SPY')).toBe(false);

      resultsSubject.next([makeResultDoc({ status: 'success' })]);
      expect(store.analysisReadyListIds().has('run-1_SPY')).toBe(true);
    });

    it('clears result docs when the selection is cleared', async () => {
      const store = await setup();
      store.selectRun('run-1_SPY');
      resultsSubject.next([makeResultDoc()]);

      store.selectRun(null);
      expect(store.analysisResults()).toEqual([]);
      expect(store.analysisReadyListIds().size).toBe(0);
    });

    it('restarts the stream on a run switch and clears stale docs up front', async () => {
      const store = await setup();
      store.selectRun('run-1_SPY');
      resultsSubject.next([makeResultDoc()]);
      expect(store.analysisResults().length).toBe(1);

      store.selectRun('run-2_QQQ');
      const service = TestBed.inject(OptionsAnalysisRunsService);
      expect(service.watchResultDocs).toHaveBeenCalledWith('run-2_QQQ');
      expect(store.analysisResults()).toEqual([]);
    });
  });

  describe('startAnalysis', () => {
    it('calls the callable and toasts success', async () => {
      const store = await setup();
      store.selectRun('run-1_SPY');

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
      store.selectRun('run-1_SPY');

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
      store.selectRun('run-1_SPY');

      store.startAnalysis('run-1_SPY');
      store.startAnalysis('run-1_SPY');

      expect(service.startAnalysis).toHaveBeenCalledTimes(1);
    });

    it('keeps the flag when a doc lands for a different list', async () => {
      const store = await setup();
      const service = TestBed.inject(OptionsAnalysisRunsService);
      const pending = new Subject<{ analysisId: string }>();
      (service.startAnalysis as jest.Mock).mockReturnValue(pending.asObservable());
      store.selectRun('run-1_SPY');

      store.startAnalysis('run-1_SPY');
      pending.next({ analysisId: 'run-1_SPY' });

      // A doc for another list is progress elsewhere — not this flag's
      // completion signal.
      resultsSubject.next([makeResultDoc({ contractListDocId: 'run-2_QQQ', symbol: 'QQQ' })]);
      expect(store.analyzingListIds().has('run-1_SPY')).toBe(true);

      resultsSubject.next([makeResultDoc({ contractListDocId: 'run-2_QQQ', symbol: 'QQQ' }), makeResultDoc()]);
      expect(store.analyzingListIds().has('run-1_SPY')).toBe(false);
    });

    it('prunes the flag when the list docs for that list all vanish', async () => {
      const store = await setup();
      const service = TestBed.inject(OptionsAnalysisRunsService);
      const pending = new Subject<{ analysisId: string }>();
      (service.startAnalysis as jest.Mock).mockReturnValue(pending.asObservable());
      store.selectRun('run-1_SPY');

      store.startAnalysis('run-1_SPY');
      pending.next({ analysisId: 'run-1_SPY' });
      expect(store.analyzingListIds().has('run-1_SPY')).toBe(true);

      // Selection cleared → stream torn down → nothing left to protect.
      store.selectRun(null);
      expect(store.analyzingListIds().has('run-1_SPY')).toBe(false);
    });

    it('toasts the failure and clears the flag on error', async () => {
      const store = await setup();
      const service = TestBed.inject(OptionsAnalysisRunsService);
      (service.startAnalysis as jest.Mock).mockReturnValue(throwError(() => new Error('failed-precondition')));
      store.selectRun('run-1_SPY');

      store.startAnalysis('run-1_SPY');

      expect(toast.open).toHaveBeenCalledWith(expect.stringContaining('Analysis failed to start'), 'Dismiss', { duration: 30000 });
      expect(store.analyzingListIds().has('run-1_SPY')).toBe(false);
    });
  });
});

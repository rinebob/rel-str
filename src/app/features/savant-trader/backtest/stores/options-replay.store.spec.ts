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
    runId: 'run-1',
    templateId: 'csp-45-20',
    symbols: ['SPY'],
    startDate: '2026-01-02',
    status: 'running',
    totalLists: 1,
    completedLists: 0,
    failedLists: 0,
    createdAtIso: '2026-10-28T15:00:00Z',
    ...overrides,
  };
}

function makeList(overrides: Partial<OptionsContractListUi> = {}): OptionsContractListUi {
  return {
    listId: 'run-1_SPY',
    runId: 'run-1',
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
    runId: 'run-1',
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
      startReplay: jest.fn(() => of({ runId: 'new-run-1' })),
      retryRun: jest.fn(() => of({ retriedSymbols: ['SPY'] })),
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
    expect(store.runs()[0].runId).toBe('run-1');
    expect(store.runsStreaming()).toBe(false);
  });

  it('updates the runs signal live as docs change', async () => {
    const store = await setup();
    store.loadRuns();

    runsSubject.next([makeRun({ status: 'running' })]);
    runsSubject.next([makeRun({ status: 'completed', completedLists: 1 })]);
    expect(store.runs()[0].status).toBe('completed');
    expect(store.runs()[0].completedLists).toBe(1);
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

    store.selectRun('run-1');
    const service = TestBed.inject(OptionsReplayRunsService);
    expect(service.watchContractLists).toHaveBeenCalledWith('run-1');

    listsSubject.next([makeList()]);
    expect(store.contractLists().length).toBe(1);
    expect(store.contractLists()[0].symbol).toBe('SPY');
    expect(store.listsStreaming()).toBe(false);
    expect(store.selectedRun()?.runId).toBe('run-1');
  });

  it('selectRun(null) clears lists and stops streaming', async () => {
    const store = await setup();
    store.selectRun('run-1');
    listsSubject.next([makeList()]);

    store.selectRun(null);
    expect(store.contractLists()).toEqual([]);
    expect(store.selectedRun()).toBeNull();
  });

  it('startReplay calls the service, selects the new run, and streams its lists', async () => {
    const store = await setup();
    store.loadRuns();
    runsSubject.next([makeRun()]);

    store.startReplay({ templateId: 'csp-45-20', symbols: ['SPY'], startDate: '2026-01-02' });

    const service = TestBed.inject(OptionsReplayRunsService);
    expect(service.startReplay).toHaveBeenCalledWith({ templateId: 'csp-45-20', symbols: ['SPY'], startDate: '2026-01-02' });
    expect(store.selectedRunId()).toBe('new-run-1');
    expect(service.watchContractLists).toHaveBeenCalledWith('new-run-1');
    expect(toast.open).toHaveBeenCalledWith(expect.stringContaining('new-run-1'), 'Dismiss', { duration: 30000 });
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
    it('derives one row per run.symbols entry — a multi-symbol run produces N rows', async () => {
      const store = await setup();
      store.loadRuns();
      runsSubject.next([makeRun({ symbols: ['SPY', 'QQQ', 'IWM'] })]);

      const rows = store.runRows();
      expect(rows.length).toBe(3);
      expect(rows.map((r) => r.symbol)).toEqual(['SPY', 'QQQ', 'IWM']);
      expect(rows.every((r) => r.runId === 'run-1')).toBe(true);
    });

    it('a single-symbol run produces exactly one row', async () => {
      const store = await setup();
      store.loadRuns();
      runsSubject.next([makeRun({ symbols: ['SPY'] })]);
      expect(store.runRows().length).toBe(1);
    });

    it('derives symbolStatus from listOutcomes', async () => {
      const store = await setup();
      store.loadRuns();
      runsSubject.next([
        makeRun({ symbols: ['SPY', 'QQQ'], listOutcomes: { SPY: 'success', QQQ: 'failed' } }),
      ]);

      const rows = store.runRows();
      expect(rows.find((r) => r.symbol === 'SPY')?.symbolStatus).toBe('success');
      expect(rows.find((r) => r.symbol === 'QQQ')?.symbolStatus).toBe('failed');
    });

    it('missing symbol entry in listOutcomes derives pending', async () => {
      const store = await setup();
      store.loadRuns();
      runsSubject.next([
        makeRun({ symbols: ['SPY', 'QQQ'], listOutcomes: { SPY: 'success' } }),
      ]);

      expect(store.runRows().find((r) => r.symbol === 'QQQ')?.symbolStatus).toBe('pending');
    });

    it('flips a failed row back to pending when the post-retry snapshot drops the outcome', async () => {
      const store = await setup();
      store.loadRuns();
      runsSubject.next([makeRun({ listOutcomes: { SPY: 'failed' } })]);
      expect(store.runRows()[0].symbolStatus).toBe('failed');

      // The retry tx deletes the failed entry outright — AC3's mechanism.
      runsSubject.next([makeRun({ status: 'running', listOutcomes: {} })]);
      expect(store.runRows()[0].symbolStatus).toBe('pending');
    });

    it('legacy runs with no listOutcomes produce pending rows without crashing', async () => {
      const store = await setup();
      store.loadRuns();
      runsSubject.next([makeRun({ symbols: ['SPY', 'QQQ'] })]);

      const rows = store.runRows();
      expect(rows.length).toBe(2);
      expect(rows.every((r) => r.symbolStatus === 'pending')).toBe(true);
    });

    it('carries run-level fields onto each row', async () => {
      const store = await setup();
      store.loadRuns();
      runsSubject.next([
        makeRun({
          templateId: 'csp-45-20',
          startDate: '2026-01-02',
          status: 'running',
          createdAtIso: '2026-10-28T15:00:00Z',
          completedLists: 1,
          failedLists: 0,
          totalLists: 2,
          symbols: ['SPY'],
        }),
      ]);

      const row = store.runRows()[0];
      expect(row.templateId).toBe('csp-45-20');
      expect(row.startDate).toBe('2026-01-02');
      expect(row.createdAtIso).toBe('2026-10-28T15:00:00Z');
      expect(row.runStatus).toBe('running');
      expect(row.completedLists).toBe(1);
      expect(row.totalLists).toBe(2);
    });
  });

  describe('filteredRows', () => {
    async function seededStore() {
      const store = await setup();
      store.loadRuns();
      runsSubject.next([
        makeRun({
          runId: 'run-a',
          symbols: ['SPY'],
          templateId: 'csp-45-20',
          startDate: '2026-01-02',
          createdAtIso: '2026-10-28T15:00:00Z',
          listOutcomes: { SPY: 'success' },
        }),
        makeRun({
          runId: 'run-b',
          symbols: ['QQQ'],
          templateId: 'csp-30-15',
          startDate: '2026-02-01',
          createdAtIso: '2026-10-27T15:00:00Z',
          listOutcomes: { QQQ: 'failed' },
        }),
        makeRun({
          runId: 'run-c',
          symbols: ['IWM'],
          templateId: 'csp-45-20',
          startDate: '2026-03-01',
          createdAtIso: '2026-10-26T15:00:00Z',
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
      expect(store.filteredRows().map((r) => r.runId)).toEqual(['run-a', 'run-b', 'run-c']);
    });

    it('status filter matches symbolStatus, not run status', async () => {
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
      expect(store.filteredRows().map((r) => r.runId)).toEqual(['run-c', 'run-b', 'run-a']);
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
    it('sets selectedRunId + selectedSymbol and streams the run\'s contract lists', async () => {
      const store = await setup();
      store.loadRuns();
      runsSubject.next([makeRun({ symbols: ['SPY', 'QQQ'] })]);

      store.selectRow({ runId: 'run-1', symbol: 'QQQ' });
      expect(store.selectedRunId()).toBe('run-1');
      expect(store.selectedSymbol()).toBe('QQQ');
      expect(TestBed.inject(OptionsReplayRunsService).watchContractLists).toHaveBeenCalledWith('run-1');

      listsSubject.next([makeList({ symbol: 'QQQ', listId: 'run-1_QQQ' })]);
      expect(store.contractLists()[0].symbol).toBe('QQQ');
    });

    it('same-run symbol hop keeps the existing list stream', async () => {
      const store = await setup();
      const service = TestBed.inject(OptionsReplayRunsService);

      store.selectRow({ runId: 'run-1', symbol: 'SPY' });
      store.selectRow({ runId: 'run-1', symbol: 'QQQ' });

      expect(service.watchContractLists).toHaveBeenCalledTimes(1);
      expect(store.selectedSymbol()).toBe('QQQ');
    });

    it('cross-run selection restreams that run\'s contract lists', async () => {
      const store = await setup();
      const service = TestBed.inject(OptionsReplayRunsService);

      store.selectRow({ runId: 'run-1', symbol: 'SPY' });
      store.selectRow({ runId: 'run-2', symbol: 'IWM' });

      expect(service.watchContractLists).toHaveBeenCalledTimes(2);
      expect(service.watchContractLists).toHaveBeenLastCalledWith('run-2');
      expect(store.selectedRunId()).toBe('run-2');
      expect(store.selectedSymbol()).toBe('IWM');
    });

    it('same-run hop restreams when the list stream died on an error', async () => {
      const store = await setup();
      const service = TestBed.inject(OptionsReplayRunsService);

      store.selectRow({ runId: 'run-1', symbol: 'SPY' });
      expect(service.watchContractLists).toHaveBeenCalledTimes(1);

      // watchStream's catchError swallows the error into of([]) → the
      // subscription completes → .closed — a same-run reselect must restream.
      listsSubject.error(new Error('denied'));

      store.selectRow({ runId: 'run-1', symbol: 'QQQ' });
      expect(service.watchContractLists).toHaveBeenCalledTimes(2);
      expect(service.watchContractLists).toHaveBeenLastCalledWith('run-1');
      expect(store.selectedSymbol()).toBe('QQQ');
    });

    it('selectRun clears selectedSymbol', async () => {
      const store = await setup();
      store.selectRow({ runId: 'run-1', symbol: 'SPY' });
      expect(store.selectedSymbol()).toBe('SPY');

      store.selectRun('run-1');
      expect(store.selectedSymbol()).toBeNull();
    });
  });

  describe('retryRun', () => {
    it('calls optionsReplayRetry with the runId and toasts the retried count', async () => {
      const store = await setup();
      const service = TestBed.inject(OptionsReplayRunsService);

      store.retryRun('run-1');

      expect(service.retryRun).toHaveBeenCalledWith('run-1');
      expect(toast.open).toHaveBeenCalledWith(expect.stringContaining('SPY'), 'Dismiss', { duration: 30000 });
    });

    it('marks the run retrying for the in-flight window and ignores a second click', async () => {
      const store = await setup();
      const service = TestBed.inject(OptionsReplayRunsService);
      const pending = new Subject<{ retriedSymbols: string[] }>();
      (service.retryRun as jest.Mock).mockReturnValue(pending.asObservable());

      store.retryRun('run-1');
      expect(store.retryingRunIds().has('run-1')).toBe(true);

      store.retryRun('run-1');
      expect(service.retryRun).toHaveBeenCalledTimes(1);

      // The flag is per-run — a different run's retry is not blocked.
      store.retryRun('run-2');
      expect(service.retryRun).toHaveBeenCalledTimes(2);
      expect(service.retryRun).toHaveBeenLastCalledWith('run-2');
    });

    it('holds the in-flight flag after a real retry until the runs snapshot shows the failed outcomes gone', async () => {
      const store = await setup();
      const service = TestBed.inject(OptionsReplayRunsService);
      const pending = new Subject<{ retriedSymbols: string[] }>();
      (service.retryRun as jest.Mock).mockReturnValue(pending.asObservable());
      store.loadRuns();
      runsSubject.next([makeRun({ status: 'failed', listOutcomes: { SPY: 'failed' } })]);

      store.retryRun('run-1');
      pending.next({ retriedSymbols: ['SPY'] });
      // Response settled but the doc snapshot hasn't caught up — the
      // flag closes the re-click gap.
      expect(store.retryingRunIds().has('run-1')).toBe(true);

      // A stale pre-retry snapshot (failed outcome still present) keeps it.
      runsSubject.next([makeRun({ status: 'failed', listOutcomes: { SPY: 'failed' } })]);
      expect(store.retryingRunIds().has('run-1')).toBe(true);

      // Post-retry snapshot — the BE deleted the failed outcome; prune.
      runsSubject.next([makeRun({ status: 'running', listOutcomes: {} })]);
      expect(store.retryingRunIds().has('run-1')).toBe(false);
    });

    it('clears the flag on a running snapshot even if a fast re-failure coalesces a failed outcome into it', async () => {
      const store = await setup();
      const service = TestBed.inject(OptionsReplayRunsService);
      const pending = new Subject<{ retriedSymbols: string[] }>();
      (service.retryRun as jest.Mock).mockReturnValue(pending.asObservable());
      store.loadRuns();
      runsSubject.next([makeRun({ status: 'failed', listOutcomes: { SPY: 'failed' } })]);

      store.retryRun('run-1');
      pending.next({ retriedSymbols: ['SPY'] });
      expect(store.retryingRunIds().has('run-1')).toBe(true);

      // A retried symbol that re-fails fast can land 'failed' back into
      // listOutcomes inside the same delivery as the post-tx 'running'
      // flip — the zero-failed predicate alone would strand the flag
      // forever. Status 'running' proves the retry landed.
      runsSubject.next([makeRun({ status: 'running', listOutcomes: { SPY: 'failed' } })]);
      expect(store.retryingRunIds().has('run-1')).toBe(false);
    });

    it('prunes the flag when the run drops out of the snapshot', async () => {
      const store = await setup();
      const service = TestBed.inject(OptionsReplayRunsService);
      const pending = new Subject<{ retriedSymbols: string[] }>();
      (service.retryRun as jest.Mock).mockReturnValue(pending.asObservable());
      store.loadRuns();
      runsSubject.next([makeRun({ status: 'failed', listOutcomes: { SPY: 'failed' } })]);

      store.retryRun('run-1');
      pending.next({ retriedSymbols: ['SPY'] });
      expect(store.retryingRunIds().has('run-1')).toBe(true);

      // Deleted doc / evicted from the top-50 window — nothing left to
      // protect; holding would leak a dead disable forever.
      runsSubject.next([]);
      expect(store.retryingRunIds().has('run-1')).toBe(false);
    });

    it('reports nothing-to-retry when the callable returns an empty symbol list', async () => {
      const store = await setup();
      const service = TestBed.inject(OptionsReplayRunsService);
      (service.retryRun as jest.Mock).mockReturnValue(of({ retriedSymbols: [] }));

      store.retryRun('run-1');

      expect(toast.open).toHaveBeenCalledWith(expect.stringContaining('Nothing to retry'), 'Dismiss', { duration: 30000 });
      expect(store.retryingRunIds().has('run-1')).toBe(false);
    });

    it('toasts the failure and clears the in-flight flag on error', async () => {
      const store = await setup();
      const service = TestBed.inject(OptionsReplayRunsService);
      (service.retryRun as jest.Mock).mockReturnValue(throwError(() => new Error('unavailable')));

      store.retryRun('run-1');

      expect(toast.open).toHaveBeenCalledWith(expect.stringContaining('Retry failed'), 'Dismiss', { duration: 30000 });
      expect(store.retryingRunIds().has('run-1')).toBe(false);
    });
  });

  describe('analysis results stream', () => {
    it('streams result docs for the selected run', async () => {
      const store = await setup();
      store.selectRun('run-1');

      const service = TestBed.inject(OptionsAnalysisRunsService);
      expect(service.watchResultDocs).toHaveBeenCalledWith('run-1');

      resultsSubject.next([makeResultDoc()]);
      expect(store.analysisResults().length).toBe(1);
      expect(store.analysisReadyListIds().has('run-1_SPY')).toBe(true);
    });

    it('marks ready only on SUCCESS docs — a failed doc keeps Analyze enabled', async () => {
      const store = await setup();
      store.selectRun('run-1');

      resultsSubject.next([makeResultDoc({ status: 'failed', error: 'series fetch failed' })]);
      expect(store.analysisResults().length).toBe(1);
      expect(store.analysisReadyListIds().has('run-1_SPY')).toBe(false);

      resultsSubject.next([makeResultDoc({ status: 'success' })]);
      expect(store.analysisReadyListIds().has('run-1_SPY')).toBe(true);
    });

    it('clears result docs when the selection is cleared', async () => {
      const store = await setup();
      store.selectRun('run-1');
      resultsSubject.next([makeResultDoc()]);

      store.selectRun(null);
      expect(store.analysisResults()).toEqual([]);
      expect(store.analysisReadyListIds().size).toBe(0);
    });

    it('restarts the stream on a run switch and clears stale docs up front', async () => {
      const store = await setup();
      store.selectRun('run-1');
      resultsSubject.next([makeResultDoc()]);
      expect(store.analysisResults().length).toBe(1);

      store.selectRun('run-2');
      const service = TestBed.inject(OptionsAnalysisRunsService);
      expect(service.watchResultDocs).toHaveBeenCalledWith('run-2');
      expect(store.analysisResults()).toEqual([]);
    });
  });

  describe('startAnalysis', () => {
    it('calls the callable and toasts success', async () => {
      const store = await setup();
      store.selectRun('run-1');

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
      store.selectRun('run-1');

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
      store.selectRun('run-1');

      store.startAnalysis('run-1_SPY');
      store.startAnalysis('run-1_SPY');

      expect(service.startAnalysis).toHaveBeenCalledTimes(1);
    });

    it('keeps the flag when a doc lands for a different list', async () => {
      const store = await setup();
      const service = TestBed.inject(OptionsAnalysisRunsService);
      const pending = new Subject<{ analysisId: string }>();
      (service.startAnalysis as jest.Mock).mockReturnValue(pending.asObservable());
      store.selectRun('run-1');

      store.startAnalysis('run-1_SPY');
      pending.next({ analysisId: 'run-1_SPY' });

      // A doc for another list is progress elsewhere — not this flag's
      // completion signal.
      resultsSubject.next([makeResultDoc({ contractListDocId: 'run-1_QQQ', symbol: 'QQQ' })]);
      expect(store.analyzingListIds().has('run-1_SPY')).toBe(true);

      resultsSubject.next([makeResultDoc({ contractListDocId: 'run-1_QQQ', symbol: 'QQQ' }), makeResultDoc()]);
      expect(store.analyzingListIds().has('run-1_SPY')).toBe(false);
    });

    it('prunes the flag when the list docs for that list all vanish', async () => {
      const store = await setup();
      const service = TestBed.inject(OptionsAnalysisRunsService);
      const pending = new Subject<{ analysisId: string }>();
      (service.startAnalysis as jest.Mock).mockReturnValue(pending.asObservable());
      store.selectRun('run-1');

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
      store.selectRun('run-1');

      store.startAnalysis('run-1_SPY');

      expect(toast.open).toHaveBeenCalledWith(expect.stringContaining('Analysis failed to start'), 'Dismiss', { duration: 30000 });
      expect(store.analyzingListIds().has('run-1_SPY')).toBe(false);
    });
  });
});

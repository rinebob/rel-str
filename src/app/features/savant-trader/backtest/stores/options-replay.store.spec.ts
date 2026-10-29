import { TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Subject, of, throwError } from 'rxjs';

import { OptionsReplayStore } from './options-replay.store';
import { OptionsReplayRunsService } from '../services/options-replay-runs.service';
import type { OptionsContractListUi, OptionsReplayRunUi } from '../common/options-replay.types';

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

describe('OptionsReplayStore', () => {
  let runsSubject: Subject<OptionsReplayRunUi[]>;
  let listsSubject: Subject<OptionsContractListUi[]>;
  let snackBar: { open: jest.Mock };

  async function setup() {
    runsSubject = new Subject();
    listsSubject = new Subject();
    snackBar = { open: jest.fn() };

    const serviceStub = {
      watchRuns: jest.fn(() => runsSubject.asObservable()),
      watchContractLists: jest.fn(() => listsSubject.asObservable()),
      startReplay: jest.fn(() => of({ runId: 'new-run-1' })),
    };

    await TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        provideNoopAnimations(),
        { provide: OptionsReplayRunsService, useValue: serviceStub },
        { provide: MatSnackBar, useValue: snackBar },
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
    expect(snackBar.open).toHaveBeenCalledWith(expect.stringContaining('new-run-1'), 'Dismiss', { duration: 30000 });
  });

  it('startReplay failure snack-bars and leaves selection untouched', async () => {
    const store = await setup();
    const service = TestBed.inject(OptionsReplayRunsService);
    (service.startReplay as jest.Mock).mockReturnValue(throwError(() => new Error('unavailable')));

    store.selectRun('existing-run');
    store.startReplay({ templateId: 'csp-45-20', symbols: ['SPY'], startDate: '2026-01-02' });

    expect(store.selectedRunId()).toBe('existing-run');
    expect(snackBar.open).toHaveBeenCalledWith(expect.stringContaining('Failed to start replay'), 'Dismiss', { duration: 30000 });
  });

  it('stream errors snack-bar and stop the streaming flag', async () => {
    const store = await setup();
    const service = TestBed.inject(OptionsReplayRunsService);
    (service.watchRuns as jest.Mock).mockReturnValue(throwError(() => new Error('denied')));

    store.loadRuns();
    expect(snackBar.open).toHaveBeenCalled();
    expect(store.runsStreaming()).toBe(false);
  });
});

import { TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection, signal, computed } from '@angular/core';
import { MatSnackBar } from '@angular/material/snack-bar';
import { of, Subject } from 'rxjs';

import { GroupStore } from './group.store';
import { StStore } from './st.store';
import { TriageStore } from './triage.store';
import { OccurrenceDecisionStore } from './occurrence-decision.store';
import { SymbolListStore } from './symbol-list.store';
import { SymbolHistoryStore } from './symbol-history.store';
import { SignalReviewUiStore } from './signal-review-ui.store';
import { SignalService } from '../services/signal.service';
import { isCompletedRun, type StRun } from '../services/types';

// =============================================================================
// Fixtures
// =============================================================================

function makeRun(overrides: Partial<StRun> = {}): StRun {
  return {
    id: 'run-1',
    status: 'SUCCESS',
    startedAt: '2026-08-25T13:00:00Z',
    completedAt: '2026-08-25T13:30:00Z',
    marketDate: '2026-08-25',
    ...overrides,
  };
}

describe('GroupStore', () => {
  let store: InstanceType<typeof GroupStore>;
  let runs: ReturnType<typeof signal<StRun[]>>;

  beforeEach(() => {
    runs = signal<StRun[]>([]);
    const latestCompletedRun = computed(() => runs().find(isCompletedRun) ?? null);

    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        {
          provide: SignalService,
          useValue: {
            getSymbolsWithSignals: jest.fn().mockReturnValue(of([])),
            getAllSymbols: jest.fn().mockReturnValue(of([])),
          },
        },
        { provide: MatSnackBar, useValue: { open: jest.fn() } },
        {
          provide: TriageStore,
          useValue: {
            resetForRun: jest.fn(),
            loadReviewFlags: jest.fn(),
            clearScreeningStatuses: jest.fn(),
            screeningStatuses: signal({}),
            reviewFlags: signal({}),
            reviewCount: signal(0),
          },
        },
        {
          provide: OccurrenceDecisionStore,
          useValue: {
            loadRecentDecisions: jest.fn(),
            markRunNotCurrent: jest.fn(),
            statusBySymbol: signal({}),
            latestBySymbol: signal({}),
            durableStatusCounts: signal({ ACCEPT: 0, REJECT: 0 }),
            acceptedCount: signal(0),
            acceptedSymbols: signal<string[]>([]),
            loading: signal(false),
          },
        },
        {
          provide: SymbolListStore,
          useValue: {
            symbolLists: signal({}),
            activeListFilter: signal('ALL'),
            loadSymbolLists: jest.fn(),
          },
        },
        {
          provide: SymbolHistoryStore,
          useValue: {
            signalHistoryCache: signal({}),
            signalHistoryLoading: signal({}),
            loadSignalHistoryForRun: jest.fn(),
            loadSignalHistory: jest.fn(),
          },
        },
        {
          provide: SignalReviewUiStore,
          useValue: {
            signalFilter: signal({ timeframe: 'ALL', direction: 'ALL' }),
            expandedGroups: signal(new Set<string>()),
            allExpanded: signal(false),
            setTimeframeFilter: jest.fn(),
            setDirectionFilter: jest.fn(),
            setAllExpanded: jest.fn(),
          },
        },
        {
          provide: StStore,
          useValue: {
            runs,
            latestCompletedRun,
            loadData: jest.fn(),
          },
        },
        GroupStore,
      ],
    });

    store = TestBed.inject(GroupStore);
  });

  // ===========================================================================
  // isActionableRun — the viewed run must be a completed run; run age is not
  // a restriction (#439).
  // ===========================================================================

  describe('isActionableRun', () => {
    it('is false when no run is being viewed', () => {
      expect(store.isActionableRun()).toBe(false);
    });

    it('is false when the viewed run is not completed', () => {
      const running = makeRun({ id: 'run-running', status: 'RUNNING', completedAt: undefined });
      runs.set([running]);
      store.setActiveRun('run-running', '2026-08-25');

      expect(store.isActionableRun()).toBe(false);
    });

    it('is false when the viewed run failed', () => {
      const failed = makeRun({ id: 'run-failed', status: 'FAILED' });
      runs.set([failed]);
      store.setActiveRun('run-failed', '2026-08-25');

      expect(store.isActionableRun()).toBe(false);
    });

    it('is false when the viewed run is not in the runs stream', () => {
      runs.set([makeRun({ id: 'run-new' })]);
      store.setActiveRun('run-missing', '2026-08-20');

      expect(store.isActionableRun()).toBe(false);
    });

    it('is true when viewing the latest completed run', () => {
      const latest = makeRun({ id: 'run-new' });
      runs.set([latest]);
      store.setActiveRun('run-new', '2026-08-25');

      expect(store.isActionableRun()).toBe(true);
    });

    it('is true when viewing a prior completed run (not the latest)', () => {
      const latest = makeRun({ id: 'run-new', marketDate: '2026-08-26' });
      const prior = makeRun({ id: 'run-old', marketDate: '2026-08-20' });
      runs.set([latest, prior]);
      store.setActiveRun('run-old', '2026-08-20');

      expect(store.isActionableRun()).toBe(true);
    });

    it('is true for a PARTIAL completed run', () => {
      const partial = makeRun({ id: 'run-partial', status: 'PARTIAL' });
      runs.set([partial]);
      store.setActiveRun('run-partial', '2026-08-25');

      expect(store.isActionableRun()).toBe(true);
    });
  });

  // ===========================================================================
  // loadSymbolsWithSignals — forkJoin(W,D) merge, history fan-out, and the
  // stale-response guard (#838 review M1): a superseded load must not patch
  // the new run's state or fan out its history under the wrong runId.
  // ===========================================================================

  describe('loadSymbolsWithSignals', () => {
    const sym = (symbol: string) => ({ symbol, enabled: true, createdAt: '2026-01-01' });
    let signalService: { getSymbolsWithSignals: jest.Mock };
    let historyStore: { loadSignalHistoryForRun: jest.Mock };
    let snackBar: { open: jest.Mock };
    // Each loadSymbolsWithSignals call issues W then D — capture the Subjects
    // per invocation so tests control emission order across overlapping loads.
    let pending: Subject<unknown[]>[];

    beforeEach(() => {
      signalService = TestBed.inject(SignalService) as unknown as typeof signalService;
      historyStore = TestBed.inject(SymbolHistoryStore) as unknown as typeof historyStore;
      snackBar = TestBed.inject(MatSnackBar) as unknown as typeof snackBar;
      pending = [];
      signalService.getSymbolsWithSignals.mockImplementation(() => {
        const s = new Subject<unknown[]>();
        pending.push(s);
        return s;
      });
    });

    it('merges W+D symbols, clears loading, and fans out history for the active run', () => {
      store.setActiveRun('run-1', '2026-08-25');
      expect(store.symbolsLoading()).toBe(true);

      pending[0].next([sym('AAPL')]);
      pending[0].complete();
      expect(store.symbolsLoading()).toBe(true); // still waiting on daily

      pending[1].next([sym('TSLA'), sym('AAPL')]);
      pending[1].complete();

      expect(store.symbolsLoading()).toBe(false);
      expect(store.signalSymbols().map((s) => s.symbol).sort()).toEqual(['AAPL', 'TSLA']);
      expect(historyStore.loadSignalHistoryForRun).toHaveBeenCalledWith('AAPL', 'run-1');
      expect(historyStore.loadSignalHistoryForRun).toHaveBeenCalledWith('TSLA', 'run-1');
    });

    it('ignores a superseded response — a stale run cannot clobber the active run', () => {
      store.setActiveRun('run-1', '2026-08-25'); // pending[0..1] = run-1 W,D
      store.setActiveRun('run-2', '2026-08-26'); // pending[2..3] = run-2 W,D

      // run-1's request resolves after run-2 is already loading.
      pending[0].next([sym('STALE')]);
      pending[0].complete();
      pending[1].next([]);
      pending[1].complete();

      // Untouched: still loading run-2, no stale symbols, no history fan-out
      // under the wrong runId.
      expect(store.symbolsLoading()).toBe(true);
      expect(store.signalSymbols()).toEqual([]);
      expect(historyStore.loadSignalHistoryForRun).not.toHaveBeenCalled();

      // The active run's own response still lands normally.
      pending[2].next([]);
      pending[2].complete();
      pending[3].next([sym('FRESH')]);
      pending[3].complete();
      expect(store.signalSymbols().map((s) => s.symbol)).toEqual(['FRESH']);
      expect(store.symbolsLoading()).toBe(false);
      expect(historyStore.loadSignalHistoryForRun).toHaveBeenCalledWith('FRESH', 'run-2');
    });

    it('ignores a superseded load error — the active run keeps its loading flag', () => {
      store.setActiveRun('run-1', '2026-08-25');
      store.setActiveRun('run-2', '2026-08-26');

      pending[0].error(new Error('stale boom'));

      expect(store.symbolsLoading()).toBe(true);
      expect(store.symbolsError()).toBeNull();
      expect(snackBar.open).not.toHaveBeenCalled();
    });

    it('surfaces a load error on the active run', () => {
      store.setActiveRun('run-1', '2026-08-25');

      pending[0].error(new Error('boom'));

      expect(store.symbolsLoading()).toBe(false);
      expect(store.symbolsError()).toBe('boom');
      expect(snackBar.open).toHaveBeenCalled();
    });
  });
});

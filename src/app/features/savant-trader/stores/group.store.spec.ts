import { TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection, signal, computed } from '@angular/core';
import { MatSnackBar } from '@angular/material/snack-bar';
import { of } from 'rxjs';

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
});

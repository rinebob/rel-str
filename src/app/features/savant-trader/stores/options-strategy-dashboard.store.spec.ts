/**
 * Unit tests for OptionsStrategyDashboardStore — state transitions,
 * loading/error states, population/instance scope derivation, and
 * filter changes triggering refetches.
 * Service dependencies are mocked via TestBed providers.
 */

jest.mock('@angular/fire/functions', () => ({
  Functions: class {},
  httpsCallable: jest.fn(),
}));
jest.mock('@angular/fire/firestore', () => ({
  Firestore: class {},
}));
jest.mock('@angular/fire/auth', () => ({
  Auth: class {},
}));

import { TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { of, Subject, throwError } from 'rxjs';
import type { GetPaperStatsResponse } from '@paper-trading/contracts';

import { OptionsStrategyDashboardStore } from './options-strategy-dashboard.store';
import { OptionsStrategyService } from '../services/options-strategy.service';
import { PaperTradingService } from '../services/paper-trading.service';
import type { Position } from '../services/options-strategy.types';
import { OptionsPositionStatus } from '../services/options-strategy.types';
import type { PaperStats } from '@paper-trading/contracts';
import { PaperTradingKind } from '@paper-trading/contracts';

// ── Fixtures ─────────────────────────────────────────────────────────────────

const openPosition: Position = {
  id: 'p1',
  instanceId: 'QQQM-WHEEL',
  symbol: 'QQQM',
  status: OptionsPositionStatus.OPEN,
  premiumCollected: 50,
  capitalRequired: 10000,
  openDate: '2026-01-01',
  currentValue: 30,
  currentValueAsOf: '2026-01-05',
  unrealizedPnl: 20,
};

const closedPosition: Position = {
  id: 'p2',
  instanceId: 'QQQM-WHEEL',
  symbol: 'QQQM',
  status: OptionsPositionStatus.EXPIRED_WORTHLESS,
  premiumCollected: 75,
  capitalRequired: 12000,
  openDate: '2025-12-01',
  currentValue: 0,
  currentValueAsOf: '2025-12-20',
  unrealizedPnl: 0,
};

const sampleStats: PaperStats = {
  kind: PaperTradingKind.STATS,
  id: 'stats-src-STRATEGY',
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-03T00:00:00Z',
  scope: 'src-STRATEGY',
  totalRealizedPnl: 75,
  totalUnrealizedPnl: 45,
  openTradeCount: 1,
  closedTradeCount: 1,
  maxDrawdown: 30,
  totalPremiumCollected: 150,
  assignedCount: 0,
  expiredWorthlessCount: 1,
  equityCurve: [
    { date: '2026-01-01', cumulativePnl: 0 },
    { date: '2026-01-02', cumulativePnl: 50 },
    { date: '2026-01-03', cumulativePnl: 120 },
  ],
};

// ── Test setup ───────────────────────────────────────────────────────────────

describe('OptionsStrategyDashboardStore', () => {
  let store: InstanceType<typeof OptionsStrategyDashboardStore>;
  let mockStrategyService: {
    listStrategyPositions$: jest.Mock;
  };
  let mockPaperService: {
    getPaperStats$: jest.Mock;
  };

  beforeEach(() => {
    mockStrategyService = {
      listStrategyPositions$: jest.fn(),
    };
    mockPaperService = {
      getPaperStats$: jest.fn(),
    };

    TestBed.configureTestingModule({
      providers: [
        provideNoopAnimations(),
        OptionsStrategyDashboardStore,
        { provide: OptionsStrategyService, useValue: mockStrategyService },
        { provide: PaperTradingService, useValue: mockPaperService },
      ],
    });

    store = TestBed.inject(OptionsStrategyDashboardStore);
  });

  // ── Initial state ──────────────────────────────────────────────────────────

  describe('initial state', () => {
    it('starts with empty positions, equity curve, and null stats', () => {
      expect(store.openPositions()).toEqual([]);
      expect(store.closedPositions()).toEqual([]);
      expect(store.equityCurve()).toEqual([]);
      expect(store.stats()).toBeNull();
    });

    it('starts with no selected instance and STRATEGY population', () => {
      expect(store.selectedInstanceId()).toBeNull();
      expect(store.selectedPopulation()).toBe('STRATEGY');
    });

    it('starts not loading', () => {
      expect(store.isLoading()).toBe(false);
    });

    it('reports isEmpty as true on initial state', () => {
      expect(store.isEmpty()).toBe(true);
    });
  });

  // ── loadPositions ──────────────────────────────────────────────────────────

  describe('loadPositions', () => {
    it('splits response into open and closed positions', () => {
      mockStrategyService.listStrategyPositions$.mockReturnValue(
        of({ openPositions: [openPosition], closedPositions: [closedPosition] }),
      );

      store.loadPositions();

      expect(store.openPositions()).toEqual([openPosition]);
      expect(store.closedPositions()).toEqual([closedPosition]);
      expect(store.isLoadingPositions()).toBe(false);
    });

    it('passes undefined instanceId when no filter is selected', () => {
      mockStrategyService.listStrategyPositions$.mockReturnValue(
        of({ openPositions: [], closedPositions: [] }),
      );

      store.loadPositions();

      expect(mockStrategyService.listStrategyPositions$).toHaveBeenCalledWith({ instanceId: undefined });
    });

    it('passes selected instanceId when filter is set', () => {
      mockStrategyService.listStrategyPositions$.mockReturnValue(
        of({ openPositions: [], closedPositions: [] }),
      );
      mockPaperService.getPaperStats$.mockReturnValue(of({ stats: [] }));

      store.selectInstance('QQQM-WHEEL');

      expect(mockStrategyService.listStrategyPositions$).toHaveBeenCalledWith({ instanceId: 'QQQM-WHEEL' });
    });

    it('sets error and shows empty positions on failure', () => {
      mockStrategyService.listStrategyPositions$.mockReturnValue(
        throwError(() => new Error('network error')),
      );

      store.loadPositions();

      expect(store.error()).toBe('Failed to load positions');
      expect(store.openPositions()).toEqual([]);
      expect(store.closedPositions()).toEqual([]);
    });
  });

  // ── loadStats (canonical getPaperStats) ──────────────────────────────

  describe('loadStats', () => {
    it('stores stats[0] fields and its equityCurve', () => {
      mockPaperService.getPaperStats$.mockReturnValue(of({ stats: [sampleStats] }));

      store.loadStats();

      expect(store.stats()).toEqual(sampleStats);
      expect(store.equityCurve()).toEqual(sampleStats.equityCurve);
      expect(store.maxDrawdown()).toBe(30);
    });

    it('requests src-STRATEGY scope by default (STRATEGY population, no instance)', () => {
      mockPaperService.getPaperStats$.mockReturnValue(of({ stats: [] }));

      store.loadStats();

      expect(mockPaperService.getPaperStats$).toHaveBeenCalledWith({ scope: 'src-STRATEGY' });
    });

    it('requests inst-{id} scope when an instance is selected under STRATEGY', () => {
      mockStrategyService.listStrategyPositions$.mockReturnValue(
        of({ openPositions: [], closedPositions: [] }),
      );
      mockPaperService.getPaperStats$.mockReturnValue(of({ stats: [] }));

      store.selectInstance('QQQM-WHEEL');

      expect(mockPaperService.getPaperStats$).toHaveBeenCalledWith({ scope: 'inst-QQQM-WHEEL' });
    });

    it('requests src-SIGNAL scope under SIGNALS population', () => {
      mockStrategyService.listStrategyPositions$.mockReturnValue(
        of({ openPositions: [], closedPositions: [] }),
      );
      mockPaperService.getPaperStats$.mockReturnValue(of({ stats: [] }));

      store.selectPopulation('SIGNAL');

      expect(mockPaperService.getPaperStats$).toHaveBeenCalledWith({ scope: 'src-SIGNAL' });
    });

    it('requests all scope under ALL population', () => {
      mockStrategyService.listStrategyPositions$.mockReturnValue(
        of({ openPositions: [], closedPositions: [] }),
      );
      mockPaperService.getPaperStats$.mockReturnValue(of({ stats: [] }));

      store.selectPopulation('ALL');

      expect(mockPaperService.getPaperStats$).toHaveBeenCalledWith({ scope: 'all' });
    });

    it('ignores retained instanceId under non-STRATEGY populations', () => {
      mockStrategyService.listStrategyPositions$.mockReturnValue(
        of({ openPositions: [], closedPositions: [] }),
      );
      mockPaperService.getPaperStats$.mockReturnValue(of({ stats: [] }));

      store.selectInstance('QQQM-WHEEL');
      mockPaperService.getPaperStats$.mockClear();
      store.selectPopulation('SIGNAL');

      expect(store.selectedInstanceId()).toBe('QQQM-WHEEL');
      expect(mockPaperService.getPaperStats$).toHaveBeenCalledWith({ scope: 'src-SIGNAL' });
    });

    it('a superseded in-flight request cannot overwrite newer state', () => {
      const stale = new Subject<GetPaperStatsResponse>();
      const fresh = new Subject<GetPaperStatsResponse>();
      mockStrategyService.listStrategyPositions$.mockReturnValue(
        of({ openPositions: [], closedPositions: [] }),
      );
      mockPaperService.getPaperStats$
        .mockReturnValueOnce(stale.asObservable())
        .mockReturnValueOnce(fresh.asObservable());

      store.loadStats();
      store.selectPopulation('SIGNAL'); // supersedes the in-flight src-STRATEGY request

      stale.next({ stats: [sampleStats] });
      stale.complete();
      fresh.next({ stats: [] });
      fresh.complete();

      expect(store.stats()).toBeNull();
      expect(store.equityCurve()).toEqual([]);
    });

    it('treats an empty stats array as empty state without error', () => {
      mockPaperService.getPaperStats$.mockReturnValue(of({ stats: [] }));

      store.loadStats();

      expect(store.stats()).toBeNull();
      expect(store.equityCurve()).toEqual([]);
      expect(store.error()).toBeNull();
      expect(store.isLoadingStats()).toBe(false);
    });

    it('sets error and clears data on failure', () => {
      mockPaperService.getPaperStats$.mockReturnValue(
        throwError(() => new Error('network error')),
      );

      store.loadStats();

      expect(store.error()).toBe('Failed to load stats');
      expect(store.equityCurve()).toEqual([]);
      expect(store.stats()).toBeNull();
    });
  });

  // ── selectInstance ─────────────────────────────────────────────────────────

  describe('selectInstance', () => {
    it('updates selectedInstanceId and triggers both loads', () => {
      mockStrategyService.listStrategyPositions$.mockReturnValue(
        of({ openPositions: [openPosition], closedPositions: [] }),
      );
      mockPaperService.getPaperStats$.mockReturnValue(of({ stats: [sampleStats] }));

      store.selectInstance('QQQM-WHEEL');

      expect(store.selectedInstanceId()).toBe('QQQM-WHEEL');
      expect(mockStrategyService.listStrategyPositions$).toHaveBeenCalledWith({ instanceId: 'QQQM-WHEEL' });
      expect(mockPaperService.getPaperStats$).toHaveBeenCalledWith({ scope: 'inst-QQQM-WHEEL' });
    });

    it('switching back to combined scope requests src-STRATEGY', () => {
      mockStrategyService.listStrategyPositions$.mockReturnValue(
        of({ openPositions: [], closedPositions: [] }),
      );
      mockPaperService.getPaperStats$.mockReturnValue(of({ stats: [] }));

      store.selectInstance('QQQM-WHEEL');
      store.selectInstance(null);

      expect(store.selectedInstanceId()).toBeNull();
      expect(mockStrategyService.listStrategyPositions$).toHaveBeenLastCalledWith({ instanceId: undefined });
      expect(mockPaperService.getPaperStats$).toHaveBeenLastCalledWith({ scope: 'src-STRATEGY' });
    });
  });

  // ── selectPopulation ───────────────────────────────────────────────────────

  describe('selectPopulation', () => {
    it('patches selectedPopulation and reloads', () => {
      mockStrategyService.listStrategyPositions$.mockReturnValue(
        of({ openPositions: [], closedPositions: [] }),
      );
      mockPaperService.getPaperStats$.mockReturnValue(of({ stats: [] }));

      store.selectPopulation('SIGNAL');

      expect(store.selectedPopulation()).toBe('SIGNAL');
      expect(mockPaperService.getPaperStats$).toHaveBeenCalledWith({ scope: 'src-SIGNAL' });
    });
  });

  // ── Computed signals ───────────────────────────────────────────────────────

  describe('computed signals', () => {
    it('openCount and closedCount read the stats doc counters', () => {
      mockStrategyService.listStrategyPositions$.mockReturnValue(
        of({ openPositions: [], closedPositions: [] }),
      );
      mockPaperService.getPaperStats$.mockReturnValue(of({ stats: [sampleStats] }));

      store.loadAll();

      expect(store.openCount()).toBe(1);
      expect(store.closedCount()).toBe(1);
    });

    it('openCount and closedCount are 0 when stats is absent', () => {
      expect(store.openCount()).toBe(0);
      expect(store.closedCount()).toBe(0);
    });

    it('isEmpty becomes false after data is loaded', () => {
      mockStrategyService.listStrategyPositions$.mockReturnValue(
        of({ openPositions: [openPosition], closedPositions: [] }),
      );

      store.loadPositions();

      expect(store.isEmpty()).toBe(false);
    });
  });
});

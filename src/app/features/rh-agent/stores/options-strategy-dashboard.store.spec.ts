/**
 * @topic #108 — Options Position Strategy Engine
 *
 * Unit tests for OptionsStrategyDashboardStore — state transitions,
 * loading/error states, filter changes triggering refetches.
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
import { of, throwError } from 'rxjs';

import { OptionsStrategyDashboardStore } from './options-strategy-dashboard.store';
import { OptionsStrategyService } from '../services/options-strategy.service';
import type {
  Position,
  StrategyStats,
  EquityCurvePoint,
} from '../services/options-strategy.types';
import { OptionsPositionStatus } from '../services/options-strategy.types';

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

const samplePoints: EquityCurvePoint[] = [
  { date: '2026-01-01', cumulativePnl: 0 },
  { date: '2026-01-02', cumulativePnl: 50 },
  { date: '2026-01-03', cumulativePnl: 120 },
];

const sampleStats: StrategyStats = {
  scope: 'ALL',
  totalPremiumCollected: 150,
  totalRealizedPnl: 75,
  totalUnrealizedPnl: 45,
  openPositionCount: 1,
  closedPositionCount: 1,
  assignedCount: 0,
  expiredWorthlessCount: 1,
  maxDrawdown: 30,
  lastUpdated: '2026-01-03',
};

// ── Test setup ───────────────────────────────────────────────────────────────

describe('OptionsStrategyDashboardStore', () => {
  let store: InstanceType<typeof OptionsStrategyDashboardStore>;
  let mockService: {
    listStrategyPositions$: jest.Mock;
    getStrategyEquityCurve$: jest.Mock;
  };

  beforeEach(() => {
    mockService = {
      listStrategyPositions$: jest.fn(),
      getStrategyEquityCurve$: jest.fn(),
    };

    TestBed.configureTestingModule({
      providers: [
        provideNoopAnimations(),
        OptionsStrategyDashboardStore,
        { provide: OptionsStrategyService, useValue: mockService },
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

    it('starts with no selected instance (ALL scope)', () => {
      expect(store.selectedInstanceId()).toBeNull();
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
      mockService.listStrategyPositions$.mockReturnValue(
        of({ openPositions: [openPosition], closedPositions: [closedPosition] }),
      );

      store.loadPositions();

      expect(store.openPositions()).toEqual([openPosition]);
      expect(store.closedPositions()).toEqual([closedPosition]);
      expect(store.isLoadingPositions()).toBe(false);
    });

    it('passes undefined instanceId when no filter is selected (ALL scope)', () => {
      mockService.listStrategyPositions$.mockReturnValue(
        of({ openPositions: [], closedPositions: [] }),
      );

      store.loadPositions();

      expect(mockService.listStrategyPositions$).toHaveBeenCalledWith({ instanceId: undefined });
    });

    it('passes selected instanceId when filter is set', () => {
      mockService.listStrategyPositions$.mockReturnValue(
        of({ openPositions: [], closedPositions: [] }),
      );
      mockService.getStrategyEquityCurve$.mockReturnValue(
        of({ points: [], stats: null }),
      );

      store.selectInstance('QQQM-WHEEL');

      expect(mockService.listStrategyPositions$).toHaveBeenCalledWith({ instanceId: 'QQQM-WHEEL' });
    });

    it('sets error and shows empty positions on failure', () => {
      mockService.listStrategyPositions$.mockReturnValue(
        throwError(() => new Error('network error')),
      );

      store.loadPositions();

      expect(store.error()).toBe('Failed to load positions');
      expect(store.openPositions()).toEqual([]);
      expect(store.closedPositions()).toEqual([]);
    });
  });

  // ── loadEquityCurve ────────────────────────────────────────────────────────

  describe('loadEquityCurve', () => {
    it('stores equity curve points and stats', () => {
      mockService.getStrategyEquityCurve$.mockReturnValue(
        of({ points: samplePoints, stats: sampleStats }),
      );

      store.loadEquityCurve();

      expect(store.equityCurve()).toEqual(samplePoints);
      expect(store.stats()).toEqual(sampleStats);
      expect(store.maxDrawdown()).toBe(30);
    });

    it('passes undefined instanceId for ALL scope', () => {
      mockService.getStrategyEquityCurve$.mockReturnValue(
        of({ points: [], stats: null }),
      );

      store.loadEquityCurve();

      expect(mockService.getStrategyEquityCurve$).toHaveBeenCalledWith({ instanceId: undefined });
    });

    it('sets error and clears data on failure', () => {
      mockService.getStrategyEquityCurve$.mockReturnValue(
        throwError(() => new Error('network error')),
      );

      store.loadEquityCurve();

      expect(store.error()).toBe('Failed to load equity curve');
      expect(store.equityCurve()).toEqual([]);
      expect(store.stats()).toBeNull();
    });
  });

  // ── selectInstance ─────────────────────────────────────────────────────────

  describe('selectInstance', () => {
    it('updates selectedInstanceId and triggers both loads', () => {
      mockService.listStrategyPositions$.mockReturnValue(
        of({ openPositions: [openPosition], closedPositions: [] }),
      );
      mockService.getStrategyEquityCurve$.mockReturnValue(
        of({ points: samplePoints, stats: sampleStats }),
      );

      store.selectInstance('QQQM-WHEEL');

      expect(store.selectedInstanceId()).toBe('QQQM-WHEEL');
      expect(mockService.listStrategyPositions$).toHaveBeenCalledWith({ instanceId: 'QQQM-WHEEL' });
      expect(mockService.getStrategyEquityCurve$).toHaveBeenCalledWith({ instanceId: 'QQQM-WHEEL' });
    });

    it('switching back to ALL scope passes undefined', () => {
      mockService.listStrategyPositions$.mockReturnValue(
        of({ openPositions: [], closedPositions: [] }),
      );
      mockService.getStrategyEquityCurve$.mockReturnValue(
        of({ points: [], stats: null }),
      );

      store.selectInstance('QQQM-WHEEL');
      store.selectInstance(null);

      expect(store.selectedInstanceId()).toBeNull();
      expect(mockService.listStrategyPositions$).toHaveBeenLastCalledWith({ instanceId: undefined });
      expect(mockService.getStrategyEquityCurve$).toHaveBeenLastCalledWith({ instanceId: undefined });
    });
  });

  // ── Computed signals ───────────────────────────────────────────────────────

  describe('computed signals', () => {
    it('openCount and closedCount reflect loaded data', () => {
      mockService.listStrategyPositions$.mockReturnValue(
        of({ openPositions: [openPosition, openPosition], closedPositions: [closedPosition] }),
      );

      store.loadPositions();

      expect(store.openCount()).toBe(2);
      expect(store.closedCount()).toBe(1);
    });

    it('isEmpty becomes false after data is loaded', () => {
      mockService.listStrategyPositions$.mockReturnValue(
        of({ openPositions: [openPosition], closedPositions: [] }),
      );

      store.loadPositions();

      expect(store.isEmpty()).toBe(false);
    });
  });
});

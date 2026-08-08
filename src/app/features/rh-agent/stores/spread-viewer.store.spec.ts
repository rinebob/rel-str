/**
 * @topic #77 — Spread Time Series Viewer (opened 2026-08-07)
 *
 * Tests for SpreadViewerStore enhancements (ADR-004 — task #98).
 * Seam: the store's public interface (state signals + methods).
 * Service dependencies are mocked via TestBed providers.
 */
import { TestBed } from '@angular/core/testing';

// Mock Firebase modules before any imports that trigger Firebase Auth init
jest.mock('@angular/fire/functions', () => ({
  Functions: class {},
  httpsCallable: jest.fn(),
}));
jest.mock('@angular/fire/firestore', () => ({
  Firestore: class {},
  collection: jest.fn(),
  collectionData: jest.fn(),
  doc: jest.fn(),
  docData: jest.fn(),
  setDoc: jest.fn(),
  deleteDoc: jest.fn(),
  getDoc: jest.fn(),
  query: jest.fn(),
  where: jest.fn(),
  runTransaction: jest.fn(),
}));
jest.mock('@angular/fire/auth', () => ({
  Auth: class {},
}));

import { SpreadViewerStore } from './spread-viewer.store';
import { SpreadService } from '../services/spread.service';
import { SpreadRunService } from '../services/spread-run.service';
import { SpreadListService } from '../services/spread-list.service';
import { OptionsContractService } from '../services/options-contract.service';
import { RsBarsService } from '../../services/rs-bars.service';
import { SpreadStatus, SpreadType, type Spread, type SpreadDefinition } from '@spread/contracts';

// ── Mock factories ───────────────────────────────────────────────────────────

function mockSpread(id: string, overrides: Partial<Spread> = {}): Spread {
  return {
    id,
    spreadType: SpreadType.VERTICAL,
    symbol: 'QQQ',
    legs: [],
    status: SpreadStatus.PENDING,
    ...overrides,
  };
}

function mockDefinition(overrides: Partial<SpreadDefinition> = {}): SpreadDefinition {
  return {
    spreadType: SpreadType.VERTICAL,
    symbol: 'QQQ',
    legs: [],
    ...overrides,
  };
}

describe('SpreadViewerStore — ADR-004 enhancements (#98)', () => {
  let store: InstanceType<typeof SpreadViewerStore>;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        SpreadViewerStore,
        { provide: SpreadService, useValue: { submitSpreadRun$: jest.fn() } },
        { provide: SpreadRunService, useValue: { watchRun$: jest.fn(), watchRunJobs$: jest.fn() } },
        { provide: SpreadListService, useValue: {
          loadNamedLists$: jest.fn(),
          loadRecentList$: jest.fn(),
          saveList: jest.fn(),
          addToRecent: jest.fn(),
          deleteList: jest.fn(),
        }},
        { provide: OptionsContractService, useValue: { getContractIndex$: jest.fn() } },
        { provide: RsBarsService, useValue: { getDailyBars$: jest.fn() } },
      ],
    });
    store = TestBed.inject(SpreadViewerStore);
  });

  // ── New state fields: initial values ──────────────────────────────────────

  describe('new state fields', () => {
    it('initializes selectedListId as null', () => {
      expect(store.selectedListId()).toBeNull();
    });

    it('initializes lastSavedSnapshot as null', () => {
      expect(store.lastSavedSnapshot()).toBeNull();
    });

    it('initializes chartDateRange with null start and end', () => {
      expect(store.chartDateRange()).toEqual({ start: null, end: null });
    });

    it('initializes entryDate as null', () => {
      expect(store.entryDate()).toBeNull();
    });

    it('initializes strikeRange with null min and max', () => {
      expect(store.strikeRange()).toEqual({ min: null, max: null });
    });

    it('initializes selectedLengthBuckets as empty set', () => {
      expect(store.selectedLengthBuckets().size).toBe(0);
    });
  });

  // ── Simple setters ────────────────────────────────────────────────────────

  describe('setters', () => {
    it('setChartDateRange updates chartDateRange', () => {
      store.setChartDateRange('2026-01-01', '2026-06-30');
      expect(store.chartDateRange()).toEqual({ start: '2026-01-01', end: '2026-06-30' });
    });

    it('setStrikeRange updates strikeRange', () => {
      store.setStrikeRange(400, 500);
      expect(store.strikeRange()).toEqual({ min: 400, max: 500 });
    });

    it('setLengthBuckets updates selectedLengthBuckets', () => {
      store.setLengthBuckets(new Set(['1mo', '3mo']));
      expect(store.selectedLengthBuckets()).toEqual(new Set(['1mo', '3mo']));
    });

    it('setEntryDate updates entryDate', () => {
      store.setEntryDate('2026-03-15');
      expect(store.entryDate()).toBe('2026-03-15');
    });
  });

  // ── clearBuffer ───────────────────────────────────────────────────────────

  describe('clearBuffer', () => {
    it('empties the spreads array', () => {
      store.addSpread(mockDefinition());
      expect(store.spreads().length).toBeGreaterThan(0);
      store.clearBuffer();
      expect(store.spreads()).toEqual([]);
    });
  });

  // ── deleteSpreadFromBuffer ────────────────────────────────────────────────

  describe('deleteSpreadFromBuffer', () => {
    it('removes a spread by id', () => {
      store.addSpread(mockDefinition());
      const id = store.spreads()[0].id;
      store.deleteSpreadFromBuffer(id);
      expect(store.spreads().find((s) => s.id === id)).toBeUndefined();
    });

    it('does nothing if id not found', () => {
      store.addSpread(mockDefinition());
      const before = store.spreads().length;
      store.deleteSpreadFromBuffer('nonexistent');
      expect(store.spreads().length).toBe(before);
    });
  });
});

// Mock @angular/fire modules to avoid Node.js Response error from transitive imports
jest.mock('@angular/fire/auth', () => ({
  Auth: class {},
  authState: jest.fn(),
}));
jest.mock('@angular/fire/functions', () => ({
  Functions: class {},
  httpsCallable: jest.fn(),
}));
jest.mock('@angular/fire/firestore', () => ({
  Firestore: class {},
  collection: jest.fn(),
  doc: jest.fn(),
  setDoc: jest.fn(),
  getDocs: jest.fn(),
  deleteDoc: jest.fn(),
}));

import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { of, Subject, throwError } from 'rxjs';

import { OptionChainPctChangeStore } from './option-chain-pct-change.store';
import type { PctChangeCell } from './utils/pct-change.utils';
import { OptionsContractService } from '../../services/options-contract.service';
import { PctChangeConfigService } from './services/pct-change-config.service';
import type { PctChangeConfigWithId } from './services/pct-change-config.service';
import { LocalBarReadService } from '../../../../core/services/local-bar-read.service';
import { Firestore } from '@angular/fire/firestore';
import { OptionType } from '@options-contract/contracts';
import type {
  GetHistoricalOptionsChainResponse,
  HistoricalOptionContract,
} from '@options-contract/contracts';
import type { PctChangeConfigDoc } from '@shared/pct-change-config-contracts';
import type { OhlcBar } from '../../../../core/models/market-data.types';
import { SwingAnalysisService } from '../../swing-analysis/swing-analysis.service';
import type { SwingAnalysisDoc } from '../../swing-analysis/swing-analysis.types';
import { SymbolHistoryStore } from '../../stores/symbol-history.store';
import type { StSignalItem } from '../../services/types';
import { SignalDirection, SignalStatus, SignalTimeframe } from '../../common/constants';
import type {
  DistributionSummary,
  Histogram,
  Pivot,
  Swing,
  SwingStats,
} from '../../../shared/components/flex-chart/indicators/st-zigzag.engine';

// =============================================================================
// Test fixtures
// =============================================================================

function makeChain(contracts: HistoricalOptionContract[]): GetHistoricalOptionsChainResponse {
  return {
    ok: true,
    symbol: 'QQQ',
    date: '2024-01-15',
    endpoint: 'historical-options',
    data: { data: contracts },
    analysis: {
      summary: {
        totalContracts: contracts.length,
        totalVolume: 0,
        totalOpenInterest: 0,
        callContracts: 0,
        putContracts: 0,
        uniqueStrikes: 0,
        avgVolumePerContract: 0,
        avgOpenInterest: 0,
      },
      expirations: [],
      strikes: [],
    },
    timestamp: '2024-01-15T00:00:00Z',
    processingTimeMs: 100,
  };
}

function makeContract(overrides: Partial<HistoricalOptionContract> = {}): HistoricalOptionContract {
  return {
    contractID: 'TEST',
    symbol: 'QQQ',
    expiration: '2024-03-15',
    strike: '100',
    type: OptionType.CALL,
    mark: '5.00',
    delta: '0.5',
    ...overrides,
  };
}

function mockService(
  startChain: HistoricalOptionContract[] = [makeContract({ contractID: 'A', mark: '10.00' })],
  targetChains: Record<string, HistoricalOptionContract[]> = {
    '2024-02-15': [makeContract({ contractID: 'A', mark: '15.00' })],
  },
): Partial<OptionsContractService> {
  return {
    getHistoricalOptionsChain$: (symbol: string, date: string) => {
      if (date === '2024-01-15') return of(makeChain(startChain));
      const chain = targetChains[date] ?? [];
      return of(makeChain(chain));
    },
  } as Partial<OptionsContractService>;
}

function makeConfigDoc(overrides: Partial<PctChangeConfigDoc> = {}): PctChangeConfigDoc {
  return {
    symbol: 'QQQ',
    startDate: '2025-04-07',
    type: OptionType.CALL,
    targetType: 'pct-change',
    targetDates: ['2025-04-10', '2025-04-15'],
    pctMode: 'list',
    pctValues: [-3, 5, 10],
    filter: { type: OptionType.CALL },
    ...overrides,
  };
}

function mockConfigService(
  savedConfigs: PctChangeConfigWithId[] = [],
): Partial<PctChangeConfigService> {
  return {
    loadConfigs: () => of(savedConfigs),
    saveConfig: () => of(undefined),
    deleteConfig: () => of(undefined),
  } as Partial<PctChangeConfigService>;
}

function makeDistributionSummary(): DistributionSummary {
  return {
    mean: 0, median: 0, stdDev: 0, min: 0, max: 0,
    p10: 0, p25: 0, p50: 0, p75: 0, p90: 0,
  };
}

function makeHistogram(): Histogram {
  return { bins: [] };
}

function makeSwingStats(): SwingStats {
  const dir = () => ({
    count: 0,
    magnitudePercent: makeDistributionSummary(),
    magnitudeAbsolute: makeDistributionSummary(),
    duration: makeDistributionSummary(),
    magnitudeHistogram: makeHistogram(),
    durationHistogram: makeHistogram(),
  });
  return { up: dir(), down: dir() };
}

function makeSwingAnalysisDoc(overrides: Partial<SwingAnalysisDoc> = {}): SwingAnalysisDoc {
  return {
    id: 'QQQ_dev5_L5_R5_1barY_projY',
    userId: 'user-1',
    symbol: 'QQQ',
    paramsId: 'dev5_L5_R5_1barY_projY',
    config: {
      devThreshold: 5,
      leftDepth: 5,
      rightDepth: 5,
      allowZigZagOnOneBar: true,
      projectionPivots: true,
      lineColor: '#000',
    },
    pivots: [],
    projection: null,
    swings: [],
    stats: makeSwingStats(),
    savedAt: '2026-09-18T00:00:00Z',
    ...overrides,
  };
}

function makeSignal(overrides: Partial<StSignalItem> = {}): StSignalItem {
  return {
    id: '2025-04-08',
    symbol: 'QQQ',
    barDate: '2025-04-08',
    marketDate: '2025-04-08',
    runId: 'run-1',
    timeframe: SignalTimeframe.DAILY,
    direction: SignalDirection.LONG,
    signalType: 'D_ZONE_V1_UPTICK',
    status: SignalStatus.INTERIM,
    indicators: {},
    closePrice: 100,
    ...overrides,
  };
}

function mockSwingAnalysisService(
  docs: SwingAnalysisDoc[] = [makeSwingAnalysisDoc()],
): Partial<SwingAnalysisService> {
  return {
    loadSavedAnalyses: jest.fn(() => of(docs)),
  } as Partial<SwingAnalysisService>;
}

/** Minimal SymbolHistoryStore stand-in — the store only reads
 *  `signalHistoryCache` and calls `loadSignalHistory`. Tests write to the
 *  `signalHistoryCache` signal to simulate a populated cache. */
function mockHistoryStore(initial: Record<string, StSignalItem[]> = {}) {
  return {
    signalHistoryCache: signal<Record<string, StSignalItem[]>>(initial),
    signalHistoryLoading: signal<Record<string, boolean>>({}),
    loadSignalHistory: jest.fn(),
    loadSignalHistoryForRun: jest.fn(),
    clearSymbolHistory: jest.fn(),
  };
}

function setupStore(
  service: Partial<OptionsContractService> = mockService(),
  configService: Partial<PctChangeConfigService> = mockConfigService(),
  barReadService: Partial<LocalBarReadService> = mockBarReadService(),
  swingAnalysisService: Partial<SwingAnalysisService> = mockSwingAnalysisService(),
  historyStore: ReturnType<typeof mockHistoryStore> = mockHistoryStore(),
): InstanceType<typeof OptionChainPctChangeStore> {
  TestBed.configureTestingModule({
    providers: [
      { provide: OptionsContractService, useValue: service },
      { provide: PctChangeConfigService, useValue: configService },
      { provide: LocalBarReadService, useValue: barReadService },
      { provide: SwingAnalysisService, useValue: swingAnalysisService },
      { provide: SymbolHistoryStore, useValue: historyStore },
      { provide: Firestore, useValue: {} },
      OptionChainPctChangeStore,
    ],
  });
  return TestBed.inject(OptionChainPctChangeStore);
}

function mockBarReadService(bars: OhlcBar[] = []): Partial<LocalBarReadService> {
  return {
    getDailyBarsForRange$: () => of(bars),
  } as Partial<LocalBarReadService>;
}

// =============================================================================
// Tests
// =============================================================================

describe('OptionChainPctChangeStore', () => {
  it('initializes with default state', () => {
    const store = setupStore();
    expect(store.symbol()).toBe('QQQ');
    expect(store.startDate()).toBe('2025-04-07');
    expect(store.targetDates()).toEqual([]);
    expect(store.loading()).toBe(false);
    expect(store.error()).toBeNull();
    expect(store.grids()).toEqual([]);
    expect(store.snapshotCache()).toEqual({});
    expect(store.hasResults()).toBe(false);
    expect(store.canRun()).toBe(false);
  });

  describe('input setters', () => {
    it('setSymbol trims and uppercases', () => {
      const store = setupStore();
      store.setSymbol('  qqq  ');
      expect(store.symbol()).toBe('QQQ');
    });

    it('setSymbol invalidates cached snapshots', () => {
      const store = setupStore();
      store.setSymbol('QQQ');
      store.setStartDate('2024-01-15');
      store.addTargetDate('2024-02-15');
      store.runAnalysis();
      // After fetch, startSnapshot is populated. Changing symbol should clear it.
      store.setSymbol('SPY');
      expect(store.snapshotCache()).toEqual({});
      expect(Object.keys(store.snapshotCache()).length).toBe(0);
    });

    it('setStartDate trims and invalidates start snapshot', () => {
      const store = setupStore();
      store.setSymbol('QQQ');
      store.setStartDate('2024-01-15');
      store.addTargetDate('2024-02-15');
      store.runAnalysis();
      store.setStartDate('2024-01-16');
      expect(store.snapshotCache()).toEqual({});
    });

    it('addTargetDate adds a new date', () => {
      const store = setupStore();
      store.addTargetDate('2024-02-15');
      expect(store.targetDates()).toEqual(['2024-02-15']);
    });

    it('addTargetDate does not add duplicates', () => {
      const store = setupStore();
      store.addTargetDate('2024-02-15');
      store.addTargetDate('2024-02-15');
      expect(store.targetDates()).toEqual(['2024-02-15']);
    });

    it('removeTargetDate removes an existing date', () => {
      const store = setupStore();
      store.addTargetDate('2024-02-15');
      store.addTargetDate('2024-03-15');
      store.removeTargetDate('2024-02-15');
      expect(store.targetDates()).toEqual(['2024-03-15']);
    });

    it('setType updates both type and filter.type', () => {
      const store = setupStore();
      store.setType(OptionType.PUT);
      expect(store.type()).toBe(OptionType.PUT);
      expect(store.filter().type).toBe(OptionType.PUT);
    });

    it('setFilter merges partial filter fields', () => {
      const store = setupStore();
      store.setFilter({ strikeGte: 100, strikeLte: 200 });
      expect(store.filter().strikeGte).toBe(100);
      expect(store.filter().strikeLte).toBe(200);
    });
  });

  describe('canRun computed', () => {
    it('returns false when symbol is empty', () => {
      const store = setupStore();
      store.setSymbol('');
      store.setStartDate('2024-01-15');
      store.addTargetDate('2024-02-15');
      expect(store.canRun()).toBe(false);
    });

    it('returns false when startDate is empty', () => {
      const store = setupStore();
      store.setSymbol('QQQ');
      store.setStartDate('');
      store.addTargetDate('2024-02-15');
      expect(store.canRun()).toBe(false);
    });

    it('returns false when targetDates is empty', () => {
      const store = setupStore();
      store.setSymbol('QQQ');
      store.setStartDate('2024-01-15');
      expect(store.canRun()).toBe(false);
    });

    it('returns true when all inputs are set', () => {
      const store = setupStore();
      store.setSymbol('QQQ');
      store.setStartDate('2024-01-15');
      store.addTargetDate('2024-02-15');
      expect(store.canRun()).toBe(true);
    });
  });

  describe('grids computed', () => {
    it('returns empty when no snapshots are cached', () => {
      const store = setupStore();
      store.setSymbol('QQQ');
      store.setStartDate('2024-01-15');
      store.addTargetDate('2024-02-15');
      expect(store.grids()).toEqual([]);
    });

    it('auto-recomputes when filter changes after fetch', () => {
      const store = setupStore();
      store.setSymbol('QQQ');
      store.setStartDate('2024-01-15');
      store.addTargetDate('2024-02-15');
      store.runAnalysis();

      // of() emits synchronously — results are already patched.
      expect(store.grids().length).toBe(1);
      // Change filter — grids should auto-recompute without re-fetching.
      store.setFilter({ strikeGte: 50 });
      expect(store.grids().length).toBe(1);
    });
  });

  describe('runAnalysis', () => {
    it('fetches, caches snapshots, and computes grids', () => {
      const store = setupStore();
      store.setSymbol('QQQ');
      store.setStartDate('2024-01-15');
      store.addTargetDate('2024-02-15');

      store.runAnalysis();

      expect(store.loading()).toBe(false);
      expect(store.error()).toBeNull();
      expect(store.grids().length).toBe(1);
      expect(store.hasResults()).toBe(true);
      expect(store.snapshotCache()['2024-01-15']).toBeDefined();
    });

    it('sets error message on fetch failure', () => {
      const failingService: Partial<OptionsContractService> = {
        getHistoricalOptionsChain$: () => throwError(() => new Error('Network error')),
      } as Partial<OptionsContractService>;
      const store = setupStore(failingService);
      store.setSymbol('QQQ');
      store.setStartDate('2024-01-15');
      store.addTargetDate('2024-02-15');

      store.runAnalysis();

      expect(store.loading()).toBe(false);
      expect(store.error()).toContain('Network error');
      expect(store.grids()).toEqual([]);
    });

    it('sets error and clears stale results when inputs are incomplete', () => {
      const store = setupStore();
      store.runAnalysis();
      expect(store.error()).toContain('required');
      expect(store.loading()).toBe(false);
      expect(store.snapshotCache()).toEqual({});
      expect(store.grids()).toEqual([]);
    });

    it('cancels stale in-flight request when called twice rapidly', () => {
      // Use Subjects so the first request stays pending while the second fires.
      const firstSubject = new Subject<GetHistoricalOptionsChainResponse>();
      const secondSubject = new Subject<GetHistoricalOptionsChainResponse>();
      let callCount = 0;
      const service: Partial<OptionsContractService> = {
        getHistoricalOptionsChain$: () => {
          callCount++;
          // First call returns firstSubject, subsequent calls return secondSubject.
          return callCount === 1 ? firstSubject.asObservable() : secondSubject.asObservable();
        },
      } as Partial<OptionsContractService>;
      const store = setupStore(service);
      store.setSymbol('QQQ');
      store.setStartDate('2024-01-15');
      store.addTargetDate('2024-02-15');

      store.runAnalysis();
      // Immediately fire a second run — should cancel the first.
      store.runAnalysis();

      // Complete the first subject (simulating a late response).
      firstSubject.next(makeChain([makeContract({ contractID: 'STALE', mark: '999.00' })]));
      firstSubject.complete();

      // Now complete the second subject.
      secondSubject.next(makeChain([makeContract({ contractID: 'FRESH', mark: '10.00' })]));
      secondSubject.next(makeChain([makeContract({ contractID: 'FRESH', mark: '10.00' })]));
      secondSubject.complete();

      // The stale first response should not have overwritten the fresh one.
      expect(store.loading()).toBe(false);
      expect(store.snapshotCache()['2024-01-15']).toBeDefined();
      // The fresh snapshot should contain FRESH, not STALE.
      const snapshot = store.snapshotCache()['2024-01-15'];
      expect(snapshot.some((c) => c.contractID === 'FRESH')).toBe(true);
      expect(snapshot.some((c) => c.contractID === 'STALE')).toBe(false);
    });
  });

  describe('reset', () => {
    it('clears all state and cancels in-flight fetch', () => {
      const subject = new Subject<GetHistoricalOptionsChainResponse>();
      const service: Partial<OptionsContractService> = {
        getHistoricalOptionsChain$: () => subject.asObservable(),
      } as Partial<OptionsContractService>;
      const store = setupStore(service);
      store.setSymbol('QQQ');
      store.setStartDate('2024-01-15');
      store.addTargetDate('2024-02-15');
      store.runAnalysis();

      // Reset while in-flight.
      store.reset();

      expect(store.symbol()).toBe('QQQ');
      expect(store.startDate()).toBe('2025-04-07');
      expect(store.targetDates()).toEqual([]);
      expect(store.grids()).toEqual([]);
      expect(store.snapshotCache()).toEqual({});
      expect(store.loading()).toBe(false);
      expect(store.error()).toBeNull();

      // Emit a late response — should not repopulate the store.
      subject.next(makeChain([makeContract({ contractID: 'LATE', mark: '999.00' })]));
      subject.complete();

      expect(store.snapshotCache()).toEqual({});
      expect(store.grids()).toEqual([]);
    });
  });

  // ===========================================================================
  // resolvePctChangeTargets
  // ===========================================================================

  describe('resolvePctChangeTargets', () => {
    function makeBar(date: string, close: number): OhlcBar {
      return { d: date, o: close, h: close, l: close, c: close, v: 0 };
    }

    it('resolves target dates from bars in list mode', () => {
      const bars: OhlcBar[] = [
        makeBar('2025-04-07', 100),
        makeBar('2025-04-08', 101),
        makeBar('2025-04-09', 105), // +5% from 100
        makeBar('2025-04-10', 110), // +10% from 100
      ];
      const barRead = mockBarReadService(bars);
      const store = setupStore(mockService(), mockConfigService(), barRead);
      store.setSymbol('QQQ');
      store.setStartDate('2025-04-07');
      store.resolvePctChangeTargets({ mode: 'list', values: [5, 10] });

      expect(store.targetDates().length).toBe(2);
      expect(store.targetDates()).toContain('2025-04-09');
      expect(store.targetDates()).toContain('2025-04-10');
      expect(store.resolveNonce()).toBe(1);
    });

    it('resolves target dates across calendar year boundary', () => {
      // Start date late in the year; +10% target reached in the following year.
      const bars: OhlcBar[] = [
        makeBar('2025-12-15', 100),
        makeBar('2025-12-30', 101),
        makeBar('2026-01-05', 110), // +10% from 100, in the next year
      ];
      const barRead = mockBarReadService(bars);
      const store = setupStore(mockService(), mockConfigService(), barRead);
      store.setSymbol('QQQ');
      store.setStartDate('2025-12-15');
      store.resolvePctChangeTargets({ mode: 'list', values: [10] });

      expect(store.targetDates()).toContain('2026-01-05');
    });

    it('cancels in-flight resolution when reset is called', () => {
      const subject = new Subject<OhlcBar[]>();
      const barRead: Partial<LocalBarReadService> = {
        getDailyBarsForRange$: () => subject.asObservable(),
      } as Partial<LocalBarReadService>;
      const store = setupStore(mockService(), mockConfigService(), barRead);
      store.setSymbol('QQQ');
      store.setStartDate('2025-04-07');
      store.resolvePctChangeTargets({ mode: 'list', values: [5] });

      // Reset while in-flight.
      store.reset();

      // Emit a late response — should not repopulate targetDates.
      subject.next([makeBar('2025-04-07', 100), makeBar('2025-04-09', 105)]);
      subject.complete();

      expect(store.targetDates()).toEqual([]);
    });

    it('sets error when symbol and start date are missing', () => {
      const store = setupStore();
      store.setSymbol('');
      store.setStartDate('');
      store.resolvePctChangeTargets({ mode: 'list', values: [5] });
      expect(store.error()).toContain('required');
    });

    it('sets error when the request produces no percentages', () => {
      const store = setupStore();
      store.setSymbol('QQQ');
      store.setStartDate('2025-04-07');
      store.resolvePctChangeTargets({ mode: 'list', values: [] });
      expect(store.error()).toContain('Nothing to resolve');
    });

    it('sets error and keeps existing dates when no percentage resolves', () => {
      // +50% is never reached — the resolve must surface an error instead
      // of silently clearing/emptying the date list.
      const bars: OhlcBar[] = [
        makeBar('2025-04-07', 100),
        makeBar('2025-04-09', 105),
      ];
      const barRead = mockBarReadService(bars);
      const store = setupStore(mockService(), mockConfigService(), barRead);
      store.setSymbol('QQQ');
      store.setStartDate('2025-04-07');
      store.setTargetDates(['2025-05-01']);
      store.resolvePctChangeTargets({ mode: 'list', values: [50] });

      expect(store.error()).toContain('No dates resolved');
      expect(store.targetDates()).toEqual(['2025-05-01']);
    });
  });

  // ===========================================================================
  // Config state
  // ===========================================================================

  describe('config state', () => {
    it('initializes with default config state', () => {
      const store = setupStore();
      expect(store.targetType()).toBe('pct-change');
      expect(store.pctMode()).toBe('list');
      expect(store.pctValues()).toEqual([]);
      expect(store.pctStep()).toBe(5);
      expect(store.pctCount()).toBe(4);
      expect(store.pctDirection()).toBe('up');
      expect(store.userDatesMode()).toBe('manual');
      expect(store.intervalCount()).toBe(5);
      expect(store.intervalDays()).toBe(5);
      expect(store.savedConfigs()).toEqual([]);
      expect(store.selectedConfigId()).toBeNull();
    });

    it('setTargetType updates targetType', () => {
      const store = setupStore();
      store.setTargetType('user-dates');
      expect(store.targetType()).toBe('user-dates');
    });

    it('setPctMode updates pctMode', () => {
      const store = setupStore();
      store.setPctMode('gradation');
      expect(store.pctMode()).toBe('gradation');
    });

    it('setPctParams updates values, step, count, direction in one patch', () => {
      const store = setupStore();
      store.setPctParams([-3, 5, 10], 2, 6, 'down');
      expect(store.pctValues()).toEqual([-3, 5, 10]);
      expect(store.pctStep()).toBe(2);
      expect(store.pctCount()).toBe(6);
      expect(store.pctDirection()).toBe('down');
    });

    it('setUserDatesMode updates userDatesMode', () => {
      const store = setupStore();
      store.setUserDatesMode('interval');
      expect(store.userDatesMode()).toBe('interval');
    });

    it('setIntervalParams updates count and intervalDays', () => {
      const store = setupStore();
      store.setIntervalParams(3, 7);
      expect(store.intervalCount()).toBe(3);
      expect(store.intervalDays()).toBe(7);
    });
  });

  // ===========================================================================
  // loadSavedConfigs
  // ===========================================================================

  describe('loadSavedConfigs', () => {
    it('loads saved configs into state', () => {
      const cfg: PctChangeConfigWithId = {
        id: 'QQQ-2025-04-07-2-pct-change-abc',
        ...makeConfigDoc(),
      };
      const configService = mockConfigService([cfg]);
      const store = setupStore(mockService(), configService);
      store.loadSavedConfigs();
      expect(store.savedConfigs().length).toBe(1);
      expect(store.savedConfigs()[0].id).toBe('QQQ-2025-04-07-2-pct-change-abc');
    });

    it('handles empty config list', () => {
      const store = setupStore();
      store.loadSavedConfigs();
      expect(store.savedConfigs()).toEqual([]);
    });

    it('sets error message when config load fails', () => {
      const configService: Partial<PctChangeConfigService> = {
        loadConfigs: () => throwError(() => new Error('network down')),
        saveConfig: () => of(undefined),
        deleteConfig: () => of(undefined),
      };
      const store = setupStore(mockService(), configService);
      store.loadSavedConfigs();
      expect(store.savedConfigs()).toEqual([]);
      expect(store.error()).toContain('Failed to load saved configs');
      expect(store.error()).toContain('network down');
    });
  });

  // ===========================================================================
  // selectConfig
  // ===========================================================================

  describe('selectConfig', () => {
    it('populates all inputs from saved config', () => {
      const cfg: PctChangeConfigWithId = {
        id: 'QQQ-2025-04-07-2-pct-change-abc',
        ...makeConfigDoc({
          symbol: 'SPY',
          startDate: '2025-03-01',
          type: OptionType.PUT,
          targetType: 'user-dates',
          targetDates: ['2025-03-05', '2025-03-10'],
          pctMode: 'gradation',
          pctStep: 2,
          pctCount: 6,
          pctDirection: 'down',
          pctValues: [-3, 5],
          userDatesMode: 'interval',
          intervalCount: 2,
          intervalDays: 5,
          filter: { type: OptionType.PUT, strikeGte: 100 },
        }),
      };
      const configService = mockConfigService([cfg]);
      const store = setupStore(mockService(), configService);
      store.loadSavedConfigs();
      store.selectConfig('QQQ-2025-04-07-2-pct-change-abc');
      expect(store.symbol()).toBe('SPY');
      expect(store.startDate()).toBe('2025-03-01');
      expect(store.type()).toBe(OptionType.PUT);
      expect(store.filter().type).toBe(OptionType.PUT);
      expect(store.filter().strikeGte).toBe(100);
      expect(store.targetType()).toBe('user-dates');
      expect(store.targetDates()).toEqual(['2025-03-05', '2025-03-10']);
      expect(store.pctMode()).toBe('gradation');
      expect(store.pctValues()).toEqual([-3, 5]);
      expect(store.pctStep()).toBe(2);
      expect(store.pctCount()).toBe(6);
      expect(store.pctDirection()).toBe('down');
      expect(store.userDatesMode()).toBe('interval');
      expect(store.intervalCount()).toBe(2);
      expect(store.intervalDays()).toBe(5);
      expect(store.selectedConfigId()).toBe('QQQ-2025-04-07-2-pct-change-abc');
      expect(store.snapshotCache()).toEqual({});
      expect(store.underlyingPrices()).toEqual({});
    });

    it('is a no-op when configId not found', () => {
      const store = setupStore();
      store.setSymbol('QQQ');
      store.selectConfig('nonexistent');
      expect(store.symbol()).toBe('QQQ');
      expect(store.selectedConfigId()).toBeNull();
    });

    it('applies defaults for missing optional fields', () => {
      // Only required fields — pctMode, pctValues, pctStep, pctCount,
      // pctDirection, userDatesMode, intervalCount, intervalDays are omitted.
      const cfg: PctChangeConfigWithId = {
        id: 'QQQ-2025-04-07-2-pct-change-abc',
        symbol: 'SPY',
        startDate: '2025-03-01',
        type: OptionType.CALL,
        targetType: 'pct-change',
        targetDates: ['2025-03-05'],
        filter: { type: OptionType.CALL },
      } as PctChangeConfigWithId;
      const configService = mockConfigService([cfg]);
      const store = setupStore(mockService(), configService);
      store.loadSavedConfigs();
      store.selectConfig('QQQ-2025-04-07-2-pct-change-abc');
      expect(store.pctMode()).toBe('list');
      expect(store.pctValues()).toEqual([]);
      expect(store.pctStep()).toBe(5);
      expect(store.pctCount()).toBe(4);
      expect(store.pctDirection()).toBe('up');
      expect(store.userDatesMode()).toBe('manual');
      expect(store.intervalCount()).toBe(5);
      expect(store.intervalDays()).toBe(5);
    });
  });

  // ===========================================================================
  // deselectConfig
  // ===========================================================================

  describe('deselectConfig', () => {
    it('clears selectedConfigId only (preserves inputs)', () => {
      const cfg: PctChangeConfigWithId = {
        id: 'QQQ-2025-04-07-2-pct-change-abc',
        ...makeConfigDoc({ symbol: 'SPY', startDate: '2025-03-01' }),
      };
      const configService = mockConfigService([cfg]);
      const store = setupStore(mockService(), configService);
      store.loadSavedConfigs();
      store.selectConfig('QQQ-2025-04-07-2-pct-change-abc');
      expect(store.selectedConfigId()).toBe('QQQ-2025-04-07-2-pct-change-abc');
      store.deselectConfig();
      expect(store.selectedConfigId()).toBeNull();
      // Inputs are preserved — only the selection is cleared.
      expect(store.symbol()).toBe('SPY');
      expect(store.startDate()).toBe('2025-03-01');
    });
  });

  // ===========================================================================
  // saveCurrentConfig
  // ===========================================================================

  describe('saveCurrentConfig', () => {
    it('builds a doc and calls service.saveConfig', () => {
      const saveSpy = jest.fn().mockReturnValue(of(undefined));
      const configService = { ...mockConfigService(), saveConfig: saveSpy as never };
      const store = setupStore(mockService(), configService);
      store.setSymbol('QQQ');
      store.setStartDate('2025-04-07');
      store.setTargetType('pct-change');
      store.setPctParams([-3, 5, 10], 5, 4, 'up');
      store.addTargetDate('2025-04-10');
      store.saveCurrentConfig();
      expect(saveSpy).toHaveBeenCalledTimes(1);
      const savedArg = saveSpy.mock.calls[0][0] as PctChangeConfigWithId;
      expect(savedArg.symbol).toBe('QQQ');
      expect(savedArg.startDate).toBe('2025-04-07');
      expect(savedArg.targetType).toBe('pct-change');
      expect(savedArg.pctValues).toEqual([-3, 5, 10]);
      expect(savedArg.targetDates).toEqual(['2025-04-10']);
      expect(savedArg.id).toBeTruthy();
    });

    it('adds the saved config to savedConfigs and sets selectedConfigId', () => {
      const saveSpy = jest.fn().mockReturnValue(of(undefined));
      const configService = { ...mockConfigService(), saveConfig: saveSpy as never };
      const store = setupStore(mockService(), configService);
      store.setSymbol('QQQ');
      store.setStartDate('2025-04-07');
      store.addTargetDate('2025-04-10');
      store.saveCurrentConfig();
      expect(store.savedConfigs().length).toBe(1);
      expect(store.selectedConfigId()).toBe(store.savedConfigs()[0].id);
    });

    it('sets error state when save fails', () => {
      const saveSpy = jest.fn().mockReturnValue(throwError(() => new Error('save failed')));
      const configService = { ...mockConfigService(), saveConfig: saveSpy as never };
      const store = setupStore(mockService(), configService);
      store.setSymbol('QQQ');
      store.setStartDate('2025-04-07');
      store.addTargetDate('2025-04-10');
      store.saveCurrentConfig();
      expect(store.error()).toContain('Failed to save config');
    });
  });

  // ===========================================================================
  // deleteConfig
  // ===========================================================================

  describe('deleteConfig', () => {
    it('calls service.deleteConfig and removes from savedConfigs', () => {
      const deleteSpy = jest.fn().mockReturnValue(of(undefined));
      const cfg: PctChangeConfigWithId = {
        id: 'QQQ-2025-04-07-2-pct-change-abc',
        ...makeConfigDoc(),
      };
      const configService = {
        ...mockConfigService([cfg]),
        deleteConfig: deleteSpy as never,
      };
      const store = setupStore(mockService(), configService);
      store.loadSavedConfigs();
      expect(store.savedConfigs().length).toBe(1);
      store.deleteConfig('QQQ-2025-04-07-2-pct-change-abc');
      expect(deleteSpy).toHaveBeenCalledWith('QQQ-2025-04-07-2-pct-change-abc');
      expect(store.savedConfigs().length).toBe(0);
    });

    it('deselects when deleting the currently selected config', () => {
      const deleteSpy = jest.fn().mockReturnValue(of(undefined));
      const cfg: PctChangeConfigWithId = {
        id: 'QQQ-2025-04-07-2-pct-change-abc',
        ...makeConfigDoc(),
      };
      const configService = {
        ...mockConfigService([cfg]),
        deleteConfig: deleteSpy as never,
      };
      const store = setupStore(mockService(), configService);
      store.loadSavedConfigs();
      store.selectConfig('QQQ-2025-04-07-2-pct-change-abc');
      expect(store.selectedConfigId()).toBe('QQQ-2025-04-07-2-pct-change-abc');
      store.deleteConfig('QQQ-2025-04-07-2-pct-change-abc');
      expect(store.selectedConfigId()).toBeNull();
    });

    it('sets error state when delete fails', () => {
      const deleteSpy = jest.fn().mockReturnValue(throwError(() => new Error('delete failed')));
      const cfg: PctChangeConfigWithId = {
        id: 'QQQ-2025-04-07-2-pct-change-abc',
        ...makeConfigDoc(),
      };
      const configService = {
        ...mockConfigService([cfg]),
        deleteConfig: deleteSpy as never,
      };
      const store = setupStore(mockService(), configService);
      store.loadSavedConfigs();
      store.deleteConfig('QQQ-2025-04-07-2-pct-change-abc');
      expect(store.error()).toContain('Failed to delete config');
    });
  });

  // ===========================================================================
  // Contract selection (chart popup)
  // ===========================================================================

  describe('contract selection', () => {
    const CELL: PctChangeCell = {
      contractID: 'A',
      strike: 100,
      expiration: '2024-03-15',
      delta: 0.5,
      targetDelta: 0.6,
      startPrice: 10,
      targetPrice: 15,
      pctChange: 50,
    };
    const CELL_B: PctChangeCell = { ...CELL, contractID: 'B' };

    it('initializes with no selection and not pinned', () => {
      const store = setupStore();
      expect(store.selectedCell()).toBeNull();
      expect(store.isContractPinned()).toBe(false);
      expect(store.selectedContractSeries()).toEqual([]);
    });

    it('previewContract sets selectedCell without pinning', () => {
      const store = setupStore();
      store.previewContract(CELL, '2024-02-15');
      expect(store.selectedCell()).toEqual({
        contractID: 'A',
        strike: 100,
        expiration: '2024-03-15',
        targetDate: '2024-02-15',
      });
      expect(store.isContractPinned()).toBe(false);
    });

    it('previewContract updates selection on successive hovers', () => {
      const store = setupStore();
      store.previewContract(CELL, '2024-02-15');
      store.previewContract(CELL_B, '2024-02-15');
      expect(store.selectedCell()!.contractID).toBe('B');
    });

    it('pinContract sets selectedCell and isContractPinned', () => {
      const store = setupStore();
      store.pinContract(CELL, '2024-02-15');
      expect(store.selectedCell()!.contractID).toBe('A');
      expect(store.isContractPinned()).toBe(true);
    });

    it('ignores previewContract while a contract is pinned', () => {
      const store = setupStore();
      store.pinContract(CELL, '2024-02-15');
      store.previewContract(CELL_B, '2024-03-15');
      expect(store.selectedCell()!.contractID).toBe('A');
      expect(store.selectedCell()!.targetDate).toBe('2024-02-15');
      expect(store.isContractPinned()).toBe(true);
    });

    it('ignores pinContract while a contract is pinned', () => {
      const store = setupStore();
      store.pinContract(CELL, '2024-02-15');
      store.pinContract(CELL_B, '2024-03-15');
      expect(store.selectedCell()!.contractID).toBe('A');
      expect(store.selectedCell()!.targetDate).toBe('2024-02-15');
    });

    it('clearContractSelection resets selection and pin', () => {
      const store = setupStore();
      store.pinContract(CELL, '2024-02-15');
      store.clearContractSelection();
      expect(store.selectedCell()).toBeNull();
      expect(store.isContractPinned()).toBe(false);
      expect(store.selectedContractSeries()).toEqual([]);
    });

    it('highlightContract sets the cross-grid highlight, overwritten by the next click', () => {
      const store = setupStore();
      store.highlightContract(CELL);
      expect(store.highlightedContract()).toEqual({ strike: 100, expiration: '2024-03-15' });
      store.highlightContract({ ...CELL_B, strike: 105 });
      expect(store.highlightedContract()).toEqual({ strike: 105, expiration: '2024-03-15' });
    });

    it('clearHighlight clears only the highlight, not the selection', () => {
      const store = setupStore();
      store.pinContract(CELL, '2024-02-15');
      store.highlightContract(CELL);
      store.clearHighlight();
      expect(store.highlightedContract()).toBeNull();
      expect(store.selectedCell()!.contractID).toBe('A');
      expect(store.isContractPinned()).toBe(true);
    });

    it('allows new selection after clearing a pin', () => {
      const store = setupStore();
      store.pinContract(CELL, '2024-02-15');
      store.clearContractSelection();
      store.previewContract(CELL_B, '2024-03-15');
      expect(store.selectedCell()!.contractID).toBe('B');
      expect(store.isContractPinned()).toBe(false);
    });

    it('selectedContractSeries returns the contract series across all snapshots', () => {
      const store = setupStore();
      store.setSymbol('QQQ');
      store.setStartDate('2024-01-15');
      store.addTargetDate('2024-02-15');
      store.runAnalysis();

      store.previewContract(CELL, '2024-02-15');
      const series = store.selectedContractSeries();
      expect(series).toEqual([
        { date: '2024-01-15', price: 10, delta: 0.5 },
        { date: '2024-02-15', price: 15, delta: 0.5 },
      ]);
    });

    it('selectedContractSeries spans all target snapshots, not just the clicked grid', () => {
      const store = setupStore(mockService(
        [makeContract({ contractID: 'A', mark: '10.00' })],
        {
          '2024-02-15': [makeContract({ contractID: 'A', mark: '15.00' })],
          '2024-03-15': [makeContract({ contractID: 'A', mark: '20.00' })],
        },
      ));
      store.setSymbol('QQQ');
      store.setStartDate('2024-01-15');
      store.addTargetDate('2024-02-15');
      store.addTargetDate('2024-03-15');
      store.runAnalysis();

      // Cell selected in the FIRST grid — series still spans both targets.
      store.previewContract(CELL, '2024-02-15');
      const series = store.selectedContractSeries();
      expect(series).toEqual([
        { date: '2024-01-15', price: 10, delta: 0.5 },
        { date: '2024-02-15', price: 15, delta: 0.5 },
        { date: '2024-03-15', price: 20, delta: 0.5 },
      ]);
    });

    it('selectedContractSeries returns [] when snapshots are cleared', () => {
      const store = setupStore();
      store.previewContract(CELL, '2024-02-15');
      expect(store.selectedContractSeries()).toEqual([]);
    });

    it('clears selection when setSymbol invalidates snapshots', () => {
      const store = setupStore();
      store.pinContract(CELL, '2024-02-15');
      store.setSymbol('SPY');
      expect(store.selectedCell()).toBeNull();
      expect(store.isContractPinned()).toBe(false);
    });

    it('clears selection when setType changes the contract universe', () => {
      const store = setupStore();
      store.pinContract(CELL, '2024-02-15');
      store.setType(OptionType.PUT);
      expect(store.selectedCell()).toBeNull();
      expect(store.isContractPinned()).toBe(false);
    });

    it('clears selection when runAnalysis refreshes snapshots', () => {
      const store = setupStore();
      store.pinContract(CELL, '2024-02-15');
      store.setSymbol('QQQ');
      store.setStartDate('2024-01-15');
      store.addTargetDate('2024-02-15');
      store.runAnalysis();
      expect(store.selectedCell()).toBeNull();
      expect(store.isContractPinned()).toBe(false);
    });

    it('clears selection when selectConfig changes inputs', () => {
      const cfg: PctChangeConfigWithId = {
        id: 'QQQ-2025-04-07-2-pct-change-abc',
        ...makeConfigDoc(),
      };
      const configService = mockConfigService([cfg]);
      const store = setupStore(mockService(), configService);
      store.loadSavedConfigs();
      store.pinContract(CELL, '2024-02-15');
      store.selectConfig('QQQ-2025-04-07-2-pct-change-abc');
      expect(store.selectedCell()).toBeNull();
      expect(store.isContractPinned()).toBe(false);
    });

    it('clears selection when the selected cell\u2019s target date is removed', () => {
      const store = setupStore();
      store.addTargetDate('2024-02-15');
      store.addTargetDate('2024-03-15');
      store.pinContract(CELL, '2024-02-15');
      store.removeTargetDate('2024-02-15');
      expect(store.selectedCell()).toBeNull();
      expect(store.isContractPinned()).toBe(false);
    });

    it('clears selection when any target date is removed (universe invalidated)', () => {
      const store = setupStore();
      store.addTargetDate('2024-02-15');
      store.addTargetDate('2024-03-15');
      store.pinContract(CELL, '2024-02-15');
      store.removeTargetDate('2024-03-15');
      expect(store.selectedCell()).toBeNull();
      expect(store.isContractPinned()).toBe(false);
    });

    it('clears selection when runAnalysis fetch fails (no zombie pin)', () => {
      const failingService: Partial<OptionsContractService> = {
        getHistoricalOptionsChain$: () => throwError(() => new Error('Network error')),
      } as Partial<OptionsContractService>;
      const store = setupStore(failingService);
      store.pinContract(CELL, '2024-02-15');
      store.setSymbol('QQQ');
      store.setStartDate('2024-01-15');
      store.addTargetDate('2024-02-15');
      store.runAnalysis();

      expect(store.selectedCell()).toBeNull();
      expect(store.isContractPinned()).toBe(false);
    });

    it('reset clears selection', () => {
      const store = setupStore();
      store.pinContract(CELL, '2024-02-15');
      store.reset();
      expect(store.selectedCell()).toBeNull();
      expect(store.isContractPinned()).toBe(false);
    });
  });

  // ===========================================================================
  // loadSwingData — saved swing sets + signal history per symbol
  // ===========================================================================

  describe('loadSwingData', () => {
    it('fetches swing sets + requests signal history for the current symbol', () => {
      const swingSvc = mockSwingAnalysisService([makeSwingAnalysisDoc({ paramsId: 'p1' })]);
      const history = mockHistoryStore();
      const store = setupStore(mockService(), mockConfigService(), mockBarReadService(), swingSvc, history);

      store.setSymbol('MSFT');
      store.loadSwingData();

      expect(swingSvc.loadSavedAnalyses).toHaveBeenCalledWith('MSFT');
      expect(history.loadSignalHistory).toHaveBeenCalledWith('MSFT');
      expect(store.savedAnalyses()).toHaveLength(1);
      expect(store.savedAnalyses()[0].paramsId).toBe('p1');
    });

    it('derives signals from the shared per-symbol history cache', () => {
      const history = mockHistoryStore();
      const store = setupStore(mockService(), mockConfigService(), mockBarReadService(), mockSwingAnalysisService(), history);
      store.setSymbol('MSFT');

      // Populate the shared cache — signals() reflects it for that symbol.
      history.signalHistoryCache.set({ MSFT: [makeSignal(), makeSignal({ barDate: '2025-04-09' })] });
      expect(store.signals()).toHaveLength(2);

      // A different symbol's cache entry never leaks into this symbol's view.
      store.setSymbol('QQQ');
      history.signalHistoryCache.set({ MSFT: [makeSignal()], QQQ: [makeSignal(), makeSignal(), makeSignal()] });
      expect(store.signals()).toHaveLength(3);
      expect(store.signals().every((s) => s.symbol === 'QQQ')).toBe(true);
    });

    it('auto-loads on setSymbol when the symbol changes', () => {
      const swingSvc = mockSwingAnalysisService();
      const history = mockHistoryStore();
      const store = setupStore(mockService(), mockConfigService(), mockBarReadService(), swingSvc, history);

      store.setSymbol('MSFT');

      expect(swingSvc.loadSavedAnalyses).toHaveBeenCalledWith('MSFT');
      expect(history.loadSignalHistory).toHaveBeenCalledWith('MSFT');
    });

    it('does not refetch when setSymbol is called with the same symbol', () => {
      const swingSvc = mockSwingAnalysisService();
      const history = mockHistoryStore();
      const store = setupStore(mockService(), mockConfigService(), mockBarReadService(), swingSvc, history);

      // Initial symbol is 'QQQ' — setting it again must not fetch.
      store.setSymbol('QQQ');
      expect(swingSvc.loadSavedAnalyses).not.toHaveBeenCalled();

      store.setSymbol('MSFT');
      store.setSymbol('MSFT');
      expect(swingSvc.loadSavedAnalyses).toHaveBeenCalledTimes(1);
      expect(history.loadSignalHistory).toHaveBeenCalledTimes(1);
    });

    it('clears savedAnalyses synchronously on symbol change, even with a fetch in flight', () => {
      const pending = new Subject<SwingAnalysisDoc[]>();
      const swingSvc: Partial<SwingAnalysisService> = {
        loadSavedAnalyses: jest.fn(() => pending.asObservable()),
      } as Partial<SwingAnalysisService>;
      const store = setupStore(mockService(), mockConfigService(), mockBarReadService(), swingSvc);
      store.setSymbol('MSFT');
      // Force-populate so we can observe the clear (patch wouldn't otherwise
      // be distinguishable from "never loaded").
      store.setSymbol('QQQ'); // clears + fires a second pending fetch
      expect(store.savedAnalyses()).toEqual([]);
    });

    it('discards a stale swing-set result when the symbol changes mid-flight', () => {
      const msft$ = new Subject<SwingAnalysisDoc[]>();
      const qqq$ = new Subject<SwingAnalysisDoc[]>();
      const swingSvc: Partial<SwingAnalysisService> = {
        loadSavedAnalyses: jest.fn((sym: string) => (sym === 'MSFT' ? msft$ : qqq$)),
      } as Partial<SwingAnalysisService>;
      const store = setupStore(mockService(), mockConfigService(), mockBarReadService(), swingSvc);

      store.setSymbol('MSFT');
      store.setSymbol('QQQ');

      qqq$.next([makeSwingAnalysisDoc({ symbol: 'QQQ', paramsId: 'qqq-fresh' })]);
      qqq$.complete();
      // MSFT fetch resolves last — its result must be discarded, not overwrite.
      msft$.next([makeSwingAnalysisDoc({ symbol: 'MSFT', paramsId: 'msft-stale' })]);
      msft$.complete();

      expect(store.savedAnalyses()).toHaveLength(1);
      expect(store.savedAnalyses()[0].paramsId).toBe('qqq-fresh');
    });

    it('reset cancels an in-flight swing-set fetch', () => {
      const pending = new Subject<SwingAnalysisDoc[]>();
      const swingSvc: Partial<SwingAnalysisService> = {
        loadSavedAnalyses: jest.fn(() => pending.asObservable()),
      } as Partial<SwingAnalysisService>;
      const store = setupStore(mockService(), mockConfigService(), mockBarReadService(), swingSvc);
      store.setSymbol('MSFT');

      store.reset();
      pending.next([makeSwingAnalysisDoc()]);
      pending.complete();

      expect(store.savedAnalyses()).toEqual([]);
    });

    it('patches empty savedAnalyses on fetch error and does not set error state', () => {
      const errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
      const swingSvc: Partial<SwingAnalysisService> = {
        loadSavedAnalyses: jest.fn(() => throwError(() => new Error('fs fail'))),
      } as Partial<SwingAnalysisService>;
      const store = setupStore(mockService(), mockConfigService(), mockBarReadService(), swingSvc);

      store.setSymbol('MSFT');
      store.loadSwingData();

      expect(store.savedAnalyses()).toEqual([]);
      expect(store.error()).toBeNull();
      expect(errSpy).toHaveBeenCalled();
      errSpy.mockRestore();
    });

    it('clears the list and skips fetch when symbol is empty', () => {
      const swingSvc = mockSwingAnalysisService();
      const history = mockHistoryStore();
      const store = setupStore(mockService(), mockConfigService(), mockBarReadService(), swingSvc, history);

      store.setSymbol('');
      store.loadSwingData();

      expect(swingSvc.loadSavedAnalyses).not.toHaveBeenCalled();
      expect(history.loadSignalHistory).not.toHaveBeenCalled();
      expect(store.savedAnalyses()).toEqual([]);
    });
  });

  // ===========================================================================
  // Swing-compare state — frame/extremes sets, date list, runs, snapshot cache
  // ===========================================================================

  describe('swing-compare state', () => {
    const ms = (d: string) => new Date(d + 'T00:00:00.000Z').getTime();
    const mkPivot = (time: string, isHigh = false, confirmed = true): Pivot => ({
      barIndex: 0, time: ms(time), price: 100, isHigh, confirmed,
    });
    const mkSwing = (start: string, end: string, direction: 'up' | 'down' = 'up'): Swing => ({
      direction,
      start: { time: ms(start), price: 100, barIndex: 0 },
      end: { time: ms(end), price: 110, barIndex: 10 },
      magnitudePercent: 10,
      magnitudeAbsolute: 10,
      duration: 10,
      volume: 0,
      confirmed: true,
    });

    const frameDoc = () =>
      makeSwingAnalysisDoc({
        id: 'QQQ_frame',
        paramsId: 'frame-p',
        swings: [mkSwing('2025-04-01', '2025-04-30')],
      });
    const extremesDoc = () =>
      makeSwingAnalysisDoc({
        id: 'QQQ_extremes',
        paramsId: 'extremes-p',
        pivots: [
          mkPivot('2025-04-10', true),
          mkPivot('2025-04-15', false),
          mkPivot('2025-04-20', true, false), // unconfirmed — excluded
          mkPivot('2025-05-10', true),        // outside frame — excluded
        ],
      });

    function setupSwingStore(): InstanceType<typeof OptionChainPctChangeStore> {
      const swingSvc = mockSwingAnalysisService([frameDoc(), extremesDoc()]);
      const history = mockHistoryStore({
        MSFT: [makeSignal({ barDate: '2025-04-12' })],
      });
      const store = setupStore(mockService(), mockConfigService(), mockBarReadService(), swingSvc, history);
      store.setSymbol('MSFT'); // loads savedAnalyses (frame + extremes docs)
      return store;
    }

    it('selectFrameSet / selectExtremesSet / selectFrameSwing patch state', () => {
      const store = setupSwingStore();
      store.selectFrameSet('QQQ_frame');
      store.selectExtremesSet('QQQ_extremes');
      const swing = store.frameSwings()[0];
      store.selectFrameSwing(swing);
      expect(store.frameSetId()).toBe('QQQ_frame');
      expect(store.extremesSetId()).toBe('QQQ_extremes');
      expect(store.frameSwing()).toBe(swing);
    });

    it('frameSwings returns the selected frame set swings; empty without selection', () => {
      const store = setupSwingStore();
      expect(store.frameSwings()).toEqual([]);
      store.selectFrameSet('QQQ_frame');
      expect(store.frameSwings()).toHaveLength(1);
    });

    it('dateList merges extremes pivots + signals inside the frame + frame start', () => {
      const store = setupSwingStore();
      store.selectFrameSet('QQQ_frame');
      store.selectExtremesSet('QQQ_extremes');
      store.selectFrameSwing(store.frameSwings()[0]);

      const list = store.dateList();
      // frame start + confirmed in-frame pivots + the signal
      expect(list.map((d) => d.date)).toEqual([
        '2025-04-01', '2025-04-10', '2025-04-12', '2025-04-15',
      ]);
      expect(list[0].labels).toContain('frame-start');
      expect(list[3].labels).toContain('swing-low');
    });

    it('dateList is empty until a frame swing is selected', () => {
      const store = setupSwingStore();
      store.selectFrameSet('QQQ_frame');
      store.selectExtremesSet('QQQ_extremes');
      expect(store.dateList()).toEqual([]);
    });

    it('targetCandidates returns only dates after the chosen start', () => {
      const store = setupSwingStore();
      store.selectFrameSet('QQQ_frame');
      store.selectExtremesSet('QQQ_extremes');
      store.selectFrameSwing(store.frameSwings()[0]);

      const cands = store.targetCandidates('2025-04-10');
      expect(cands.map((d) => d.date)).toEqual(['2025-04-12', '2025-04-15']);
    });

    it('addRun appends with a unique id; removeRun deletes by id', () => {
      const store = setupSwingStore();
      store.addRun('2025-04-01', ['2025-04-10'], OptionType.CALL);
      store.addRun('2025-04-10', ['2025-04-15'], OptionType.PUT);
      expect(store.runs()).toHaveLength(2);
      expect(store.runs()[0].id).not.toBe(store.runs()[1].id);
      expect(store.runs()[0].type).toBe(OptionType.CALL);

      store.removeRun(store.runs()[0].id);
      expect(store.runs()).toHaveLength(1);
      expect(store.runs()[0].startDate).toBe('2025-04-10');
    });

    it('changing the frame swing clears runs built against the old bounds', () => {
      const store = setupSwingStore();
      store.selectFrameSet('QQQ_frame');
      store.selectFrameSwing(store.frameSwings()[0]);
      store.addRun('2025-04-01', ['2025-04-10'], OptionType.CALL);

      store.selectFrameSwing(mkSwing('2025-05-01', '2025-05-20'));
      expect(store.runs()).toEqual([]);
    });

    it('changing the frame set clears the selected swing and runs', () => {
      const store = setupSwingStore();
      store.selectFrameSet('QQQ_frame');
      store.selectFrameSwing(store.frameSwings()[0]);
      store.addRun('2025-04-01', ['2025-04-10'], OptionType.CALL);

      store.selectFrameSet('QQQ_extremes');
      expect(store.frameSwing()).toBeNull();
      expect(store.runs()).toEqual([]);
    });

    it('ensureSnapshots fetches only missing dates and skips cached on repeat', () => {
      const svc = mockService();
      const spy = jest.spyOn(
        svc as OptionsContractService,
        'getHistoricalOptionsChain$',
      );
      const store = setupStore(
        svc,
        mockConfigService(),
        mockBarReadService(),
        mockSwingAnalysisService([frameDoc(), extremesDoc()]),
        mockHistoryStore(),
      );
      store.setSymbol('MSFT');

      store.ensureSnapshots(['2025-04-10', '2025-04-15']);
      expect(spy).toHaveBeenCalledTimes(2);
      expect(store.snapshotCache()['2025-04-10']).toBeDefined();
      expect(store.snapshotCache()['2025-04-15']).toBeDefined();

      // Repeat — both cached, no refetch.
      store.ensureSnapshots(['2025-04-10', '2025-04-15']);
      expect(spy).toHaveBeenCalledTimes(2);

      // One new date → only that one fetched.
      store.ensureSnapshots(['2025-04-10', '2025-04-20']);
      expect(spy).toHaveBeenCalledTimes(3);
      expect(spy).toHaveBeenLastCalledWith('MSFT', '2025-04-20');
    });

    it('setSymbol clears swing-compare state and snapshot cache', () => {
      const store = setupSwingStore();
      store.selectFrameSet('QQQ_frame');
      store.selectExtremesSet('QQQ_extremes');
      store.selectFrameSwing(store.frameSwings()[0]);
      store.addRun('2025-04-01', ['2025-04-10'], OptionType.CALL);
      store.ensureSnapshots(['2025-04-10']);

      store.setSymbol('QQQ');

      expect(store.frameSetId()).toBeNull();
      expect(store.extremesSetId()).toBeNull();
      expect(store.frameSwing()).toBeNull();
      expect(store.runs()).toEqual([]);
      expect(store.snapshotCache()).toEqual({});
    });
  });
});

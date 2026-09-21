/// <reference types="jest" />
/**
 * Tests for SwingAnalysisStore. Mocks ChartService and SwingAnalysisService
 * so the seam is the store's public interface.
 */

jest.mock('@angular/fire/firestore', () => ({
  Firestore: class {},
  collection: jest.fn(),
  collectionData: jest.fn(),
  doc: jest.fn(),
  setDoc: jest.fn(),
  getDoc: jest.fn(),
  getDocs: jest.fn(),
}));
jest.mock('@angular/fire/auth', () => ({
  Auth: class {},
  authState: jest.fn(() => of({ uid: 'user-123' })),
}));

import { TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { of, Subject, throwError } from 'rxjs';

import { SwingAnalysisStore, LARGE_CONFIG, SMALL_CONFIG } from './swing-analysis.store';
import { ChartService } from '../services/chart.service';
import { SwingAnalysisService } from './swing-analysis.service';
import { deriveParamsId } from './swing-analysis.types';
import { BarsInterval } from '../../../core/models/partner.types';
import type { ChartDataset } from '../../heatmap-chart/heatmap-chart.types';
import type {
  PriceBar,
  SwingStats,
  DistributionSummary,
  Histogram,
} from '../../shared/components/flex-chart/indicators/st-zigzag.engine';
import type { SwingAnalysisDoc, SwingAnalysisInput } from './swing-analysis.types';

// =============================================================================
// Test fixtures
// =============================================================================

function makeBars(n: number): PriceBar[] {
  const bars: PriceBar[] = [];
  // Phase length must exceed LARGE_CONFIG's leftDepth/rightDepth (10) so
  // that pivots are detectable at phase boundaries.
  const phaseLen = 15;
  for (let i = 0; i < n; i++) {
    const phase = Math.floor(i / phaseLen) % 2;
    const stepInPhase = i % phaseLen;
    const delta = phase === 0 ? stepInPhase * 5 : -stepInPhase * 5;
    const d = new Date(2026, 0, i + 1);
    bars.push({
      date: d.toISOString().slice(0, 10),
      x: d,
      open: 100 + delta,
      high: 105 + delta,
      low: 95 + delta,
      close: 100 + delta,
      volume: 1000,
    });
  }
  return bars;
}

function makeChartDataset(bars: PriceBar[]): ChartDataset {
  return {
    baseline: 'SPY',
    symbol: 'TEST',
    interval: BarsInterval.DAILY,
    bars,
    dateRange: { from: bars[0]?.date ?? '', to: bars[bars.length - 1]?.date ?? '' },
  };
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
  return {
    up: {
      count: 0,
      magnitudePercent: makeDistributionSummary(),
      magnitudeAbsolute: makeDistributionSummary(),
      duration: makeDistributionSummary(),
      magnitudeHistogram: makeHistogram(),
      durationHistogram: makeHistogram(),
    },
    down: {
      count: 0,
      magnitudePercent: makeDistributionSummary(),
      magnitudeAbsolute: makeDistributionSummary(),
      duration: makeDistributionSummary(),
      magnitudeHistogram: makeHistogram(),
      durationHistogram: makeHistogram(),
    },
  };
}

function makeSwingAnalysisDoc(overrides: Partial<SwingAnalysisDoc> = {}): SwingAnalysisDoc {
  return {
    id: deriveParamsId(LARGE_CONFIG),
    userId: 'user-123',
    symbol: 'AAPL',
    paramsId: deriveParamsId(LARGE_CONFIG),
    config: { ...LARGE_CONFIG },
    pivots: [],
    projection: null,
    swings: [],
    stats: makeSwingStats(),
    savedAt: '2026-09-16T00:00:00Z',
    ...overrides,
  };
}

function mockChartService(bars: PriceBar[]): Partial<ChartService> {
  return {
    loadBars$: () =>
      of({
        daily: makeChartDataset(bars),
        weekly: makeChartDataset(bars),
        monthly: makeChartDataset(bars),
        version: 'test',
      }),
  };
}

type ServiceMock = ReturnType<typeof mockSwingAnalysisService>;

function mockSwingAnalysisService(
  docs: SwingAnalysisDoc[] = [],
  allSets: SwingAnalysisDoc[] = docs,
): Partial<SwingAnalysisService> & {
  saveAnalysis: jest.Mock;
  loadSavedAnalyses: jest.Mock;
  loadAllSwingSets: jest.Mock;
  loadAnalysis: jest.Mock;
} {
  return {
    loadSavedAnalyses: jest.fn(() => of(docs)),
    loadAllSwingSets: jest.fn(() => of(allSets)),
    saveAnalysis: jest.fn(() => of(undefined)),
    loadAnalysis: jest.fn((_symbol: string, docId: string) =>
      of(docs.find((d) => d.id === docId) ?? null),
    ),
  };
}

interface StoreSetup {
  store: InstanceType<typeof SwingAnalysisStore>;
  service: ServiceMock;
}

function setupStore(
  bars: PriceBar[] = makeBars(40),
  savedDocs: SwingAnalysisDoc[] = [],
): StoreSetup {
  const service = mockSwingAnalysisService(savedDocs);
  TestBed.configureTestingModule({
    providers: [
      provideZonelessChangeDetection(),
      { provide: ChartService, useValue: mockChartService(bars) },
      { provide: SwingAnalysisService, useValue: service },
      SwingAnalysisStore,
    ],
  });
  return { store: TestBed.inject(SwingAnalysisStore), service };
}

// =============================================================================
// Store state — initial
// =============================================================================

describe('SwingAnalysisStore — initial state', () => {
  it('has two configs (large + small) and dualMode on by default', () => {
    const { store } = setupStore();
    expect(store.symbol()).toBe('');
    expect(store.configs()).toEqual([{ ...LARGE_CONFIG }, { ...SMALL_CONFIG }]);
    expect(store.dualMode()).toBe(true);
    expect(store.bars()).toEqual([]);
    expect(store.pivots()).toEqual([[], []]);
    expect(store.projections()).toEqual([null, null]);
    expect(store.swings()).toEqual([[], []]);
    expect(store.stats()).toEqual([null, null]);
    expect(store.loading()).toBe(false);
    expect(store.error()).toBeNull();
    expect(store.savedAnalyses()).toEqual([]);
  });

  it('derives paramsIds from configs', () => {
    const { store } = setupStore();
    expect(store.paramsIds()).toEqual([deriveParamsId(LARGE_CONFIG), deriveParamsId(SMALL_CONFIG)]);
  });

  it('defaults the small swing line color to black', () => {
    const { store } = setupStore();
    expect(SMALL_CONFIG.lineColor).toBe('#000000');
    expect(store.configs()[1].lineColor).toBe('#000000');
  });

  it('hasProjection is false when no projections exist', () => {
    const { store } = setupStore();
    expect(store.hasProjection()).toBe(false);
  });
});

// =============================================================================
// setSymbol — triggers bar load + recompute for all configs
// =============================================================================

describe('SwingAnalysisStore.setSymbol', () => {
  it('updates the symbol', () => {
    const { store } = setupStore();
    store.setSymbol('AAPL');
    expect(store.symbol()).toBe('AAPL');
  });

  it('sets loading to true while bars are being fetched', () => {
    const subject = new Subject<{
      daily: ChartDataset;
      weekly: ChartDataset;
      monthly: ChartDataset;
      version: string;
    }>();
    const chartMock = { loadBars$: () => subject.asObservable() };
    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        { provide: ChartService, useValue: chartMock },
        { provide: SwingAnalysisService, useValue: mockSwingAnalysisService([]) },
        SwingAnalysisStore,
      ],
    });
    const store = TestBed.inject(SwingAnalysisStore);
    store.setSymbol('AAPL');
    expect(store.loading()).toBe(true);
    subject.complete();
  });

  it('computes pivots, swings, and stats for all configs after bar load', () => {
    const { store } = setupStore(makeBars(40));
    store.setSymbol('AAPL');
    expect(store.loading()).toBe(false);
    expect(store.pivots()[0].length).toBeGreaterThan(0);
    expect(store.swings()[0].length).toBeGreaterThan(0);
    expect(store.stats()[0]).not.toBeNull();
    expect(store.error()).toBeNull();
  });

  it('clears previous analysis when symbol changes', () => {
    const { store } = setupStore(makeBars(40));
    store.setSymbol('AAPL');
    expect(store.pivots()[0].length).toBeGreaterThan(0);
    store.setSymbol('MSFT');
    expect(store.symbol()).toBe('MSFT');
    expect(store.pivots()[0].length).toBeGreaterThan(0);
  });

  it('cancels stale bar load when symbol changes rapidly', () => {
    const subject = new Subject<{
      daily: ChartDataset;
      weekly: ChartDataset;
      monthly: ChartDataset;
      version: string;
    }>();
    const chartMock = { loadBars$: () => subject.asObservable() };
    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        { provide: ChartService, useValue: chartMock },
        { provide: SwingAnalysisService, useValue: mockSwingAnalysisService([]) },
        SwingAnalysisStore,
      ],
    });
    const store = TestBed.inject(SwingAnalysisStore);
    store.setSymbol('AAPL');
    store.setSymbol('MSFT');
    subject.complete();
    expect(store.symbol()).toBe('MSFT');
    expect(store.loading()).toBe(true);
  });
});

// =============================================================================
// updateConfig — triggers recompute for one config
// =============================================================================

describe('SwingAnalysisStore.updateConfig', () => {
  it('updates only the specified config', () => {
    const { store } = setupStore();
    store.updateConfig(0, { devThreshold: 15 });
    expect(store.configs()[0].devThreshold).toBe(15);
  });

  it('recomputes only the changed config pivots/swings/stats', () => {
    const { store } = setupStore(makeBars(40));
    store.setSymbol('AAPL');
    const pivotCountBefore = store.pivots()[0].length;
    store.updateConfig(0, { devThreshold: 15 });
    expect(store.pivots()[0].length).toBeLessThanOrEqual(pivotCountBefore);
    expect(store.stats()[0]).not.toBeNull();
  });

  it('does not reload bars', () => {
    const { store } = setupStore(makeBars(40));
    store.setSymbol('AAPL');
    const barsBefore = store.bars();
    store.updateConfig(0, { leftDepth: 3 });
    expect(store.bars()).toBe(barsBefore);
  });

  it('updates only the specified config in dual mode', () => {
    const { store } = setupStore(makeBars(40));
    store.setSymbol('AAPL');
    // Dual mode is the default — config 1 already exists.
    store.updateConfig(1, { devThreshold: 7 });
    expect(store.configs()[0].devThreshold).toBe(LARGE_CONFIG.devThreshold);
    expect(store.configs()[1].devThreshold).toBe(7);
  });

  it('leaves other config untouched when recomputing one slot', () => {
    const { store } = setupStore(makeBars(40));
    store.setSymbol('AAPL');
    const pivotsBefore = store.pivots()[1].length;
    const swingsBefore = store.swings()[1].length;
    const statsBefore = store.stats()[1];
    store.updateConfig(0, { devThreshold: 20 });
    // Config 0 changed, config 1 untouched.
    expect(store.pivots()[1].length).toBe(pivotsBefore);
    expect(store.swings()[1].length).toBe(swingsBefore);
    expect(store.stats()[1]).toBe(statsBefore);
  });

  it('does nothing for an out-of-range index', () => {
    const { store } = setupStore();
    const configBefore = store.configs();
    store.updateConfig(5, { devThreshold: 15 });
    expect(store.configs()).toBe(configBefore);
  });
});

// =============================================================================
// toggleDualMode — adds/removes second config
// =============================================================================

describe('SwingAnalysisStore.toggleDualMode', () => {
  // Dual mode is the default — the first toggle() call turns it OFF.

  it('re-adds the second config with small defaults when toggled back on', () => {
    const { store } = setupStore(makeBars(40));
    store.setSymbol('AAPL');
    store.toggleDualMode(); // off
    store.toggleDualMode(); // back on
    expect(store.dualMode()).toBe(true);
    expect(store.configs().length).toBe(2);
    expect(store.configs()[1]).toEqual({ ...SMALL_CONFIG });
  });

  it('recomputes the second config from loaded bars when toggled back on', () => {
    const { store } = setupStore(makeBars(40));
    store.setSymbol('AAPL');
    store.toggleDualMode(); // off — slot 1 removed
    store.toggleDualMode(); // on — recomputed from loaded bars
    expect(store.pivots()[1].length).toBeGreaterThan(0);
    expect(store.swings()[1].length).toBeGreaterThan(0);
    expect(store.stats()[1]).not.toBeNull();
  });

  it('removes the second config when turning off', () => {
    const { store } = setupStore(makeBars(40));
    store.setSymbol('AAPL');
    store.toggleDualMode(); // off
    expect(store.dualMode()).toBe(false);
    expect(store.configs().length).toBe(1);
    expect(store.configs()[0]).toEqual({ ...LARGE_CONFIG });
  });

  it('preserves the first config across an off→on cycle', () => {
    const { store } = setupStore(makeBars(40));
    store.setSymbol('AAPL');
    store.updateConfig(0, { devThreshold: 20 });
    store.toggleDualMode(); // off
    store.toggleDualMode(); // on
    expect(store.configs()[0].devThreshold).toBe(20);
  });

  it('produces aligned length-2 arrays when toggled back on with empty bars', () => {
    const { store } = setupStore();
    // No setSymbol — bars are empty. Dual is on by default; cycle off→on.
    store.toggleDualMode();
    store.toggleDualMode();
    expect(store.dualMode()).toBe(true);
    expect(store.configs().length).toBe(2);
    expect(store.pivots().length).toBe(2);
    expect(store.projections().length).toBe(2);
    expect(store.swings().length).toBe(2);
    expect(store.stats().length).toBe(2);
    // Second slot's derived arrays are empty but present (not undefined).
    expect(store.pivots()[1]).toEqual([]);
    expect(store.projections()[1]).toBeNull();
    expect(store.swings()[1]).toEqual([]);
    expect(store.stats()[1]).toBeNull();
  });

  it('truncates derived arrays to length 1 when turning off', () => {
    const { store } = setupStore(makeBars(40));
    store.setSymbol('AAPL');
    expect(store.pivots().length).toBe(2);
    store.toggleDualMode(); // off
    expect(store.pivots().length).toBe(1);
    expect(store.projections().length).toBe(1);
    expect(store.swings().length).toBe(1);
    expect(store.stats().length).toBe(1);
  });
});

// =============================================================================
// allStats - combined stats across both configs (dual mode "All" view)
// =============================================================================

describe('SwingAnalysisStore.allStats', () => {
  it('is null in single mode', () => {
    const { store } = setupStore(makeBars(40));
    store.setSymbol('AAPL');
    store.toggleDualMode(); // dual is the default — turn off for single mode
    expect(store.stats()[0]).not.toBeNull();
    expect(store.allStats()).toBeNull();
  });

  it('is null in dual mode with no swings', () => {
    const { store } = setupStore(); // no bars — dual is the default
    expect(store.dualMode()).toBe(true);
    expect(store.allStats()).toBeNull();
  });

  it('recomputes combined stats from both configs in dual mode', () => {
    const { store } = setupStore(makeBars(40));
    store.setSymbol('AAPL'); // dual is the default — both slots computed

    const all = store.allStats();
    expect(all).not.toBeNull();
    // Combined confirmed-swing count = sum of both configs' counts.
    const large = store.stats()[0]!;
    const small = store.stats()[1]!;
    const expectedCount = large.up.count + large.down.count + small.up.count + small.down.count;
    expect(all!.up.count + all!.down.count).toBe(expectedCount);
  });

  it('returns to null when dual mode is toggled off', () => {
    const { store } = setupStore(makeBars(40));
    store.setSymbol('AAPL');
    expect(store.allStats()).not.toBeNull();
    store.toggleDualMode(); // off
    expect(store.allStats()).toBeNull();
  });
});

// =============================================================================
// saveAnalysis — calls Firestore service for one config
// =============================================================================

describe('SwingAnalysisStore.saveAnalysis', () => {
  it('does nothing when no symbol is set', () => {
    const { store, service } = setupStore();
    store.saveAnalysis(0);
    expect(service.saveAnalysis).not.toHaveBeenCalled();
    expect(store.error()).toBeNull();
  });

  it('does nothing when no stats are computed', () => {
    const subject = new Subject<{
      daily: ChartDataset;
      weekly: ChartDataset;
      monthly: ChartDataset;
      version: string;
    }>();
    const chartMock = { loadBars$: () => subject.asObservable() };
    const service = mockSwingAnalysisService([]);
    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        { provide: ChartService, useValue: chartMock },
        { provide: SwingAnalysisService, useValue: service },
        SwingAnalysisStore,
      ],
    });
    const store = TestBed.inject(SwingAnalysisStore);
    store.setSymbol('AAPL');
    store.saveAnalysis(0);
    expect(service.saveAnalysis).not.toHaveBeenCalled();
    subject.complete();
  });

  it('calls service with correct paramsId and doc payload for config 0', () => {
    const { store, service } = setupStore(makeBars(40));
    store.setSymbol('AAPL');
    store.saveAnalysis(0);
    expect(service.saveAnalysis).toHaveBeenCalledTimes(1);
    const arg = service.saveAnalysis.mock.calls[0][0];
    expect(arg.paramsId).toBe(deriveParamsId(LARGE_CONFIG));
    expect(arg.symbol).toBe('AAPL');
    expect(arg.config).toEqual(store.configs()[0]);
    expect(arg.pivots).toEqual(store.pivots()[0]);
    expect(arg.swings).toEqual(store.swings()[0]);
    expect(arg.stats).toEqual(store.stats()[0]);
    expect(arg.bars).toBeUndefined();
    expect(arg.savedAt).toBeDefined();
  });

  it('saves config 1 independently under its own paramsId in dual mode', () => {
    const { store, service } = setupStore(makeBars(40));
    store.setSymbol('AAPL'); // dual is the default — config 1 exists
    store.saveAnalysis(1);
    expect(service.saveAnalysis).toHaveBeenCalledTimes(1);
    const arg = service.saveAnalysis.mock.calls[0][0];
    expect(arg.paramsId).toBe(deriveParamsId(SMALL_CONFIG));
    expect(arg.config).toEqual({ ...SMALL_CONFIG });
  });

  it('refreshes saved analyses after a successful save', () => {
    const doc = makeSwingAnalysisDoc();
    const { store, service } = setupStore(makeBars(40), [doc]);
    store.setSymbol('AAPL');
    service.loadSavedAnalyses.mockClear();
    store.saveAnalysis(0);
    expect(service.loadSavedAnalyses).toHaveBeenCalledTimes(1);
  });
});

// =============================================================================
// loadSavedAnalyses — reads st-swing-sets filtered by symbol
// =============================================================================

describe('SwingAnalysisStore.loadSavedAnalyses', () => {
  it('populates savedAnalyses from the service', () => {
    const doc = makeSwingAnalysisDoc({ id: deriveParamsId(LARGE_CONFIG) });
    const { store } = setupStore(makeBars(40), [doc]);
    store.setSymbol('AAPL');
    store.loadSavedAnalyses();
    expect(store.savedAnalyses().length).toBe(1);
    expect(store.savedAnalyses()[0].id).toBe(deriveParamsId(LARGE_CONFIG));
  });

  it('does nothing when no symbol is set', () => {
    const { store, service } = setupStore();
    store.loadSavedAnalyses();
    expect(service.loadSavedAnalyses).not.toHaveBeenCalled();
  });
});

// =============================================================================
// loadAnalysis — loads a saved analysis into a config slot
// =============================================================================

describe('SwingAnalysisStore.loadAnalysis', () => {
  it('loads config into slot 0 and recomputes from existing bars', () => {
    const mockConfig = { ...LARGE_CONFIG, devThreshold: 20 };
    const mockDoc = makeSwingAnalysisDoc({
      id: deriveParamsId(mockConfig),
      paramsId: deriveParamsId(mockConfig),
      config: mockConfig,
    });
    const setupBars = makeBars(40);
    const { store } = setupStore(setupBars, [mockDoc]);
    store.setSymbol('AAPL');
    store.loadAnalysis(deriveParamsId(mockConfig), 0);
    expect(store.configs()[0].devThreshold).toBe(20);
    expect(store.bars()).toEqual(setupBars);
    expect(store.pivots()[0].length).toBeGreaterThan(0);
    expect(store.swings()[0].length).toBeGreaterThan(0);
    expect(store.stats()[0]).not.toBeNull();
  });

  it('loads config into slot 1 in dual mode', () => {
    const mockConfig = { ...SMALL_CONFIG, devThreshold: 7 };
    const mockDoc = makeSwingAnalysisDoc({
      id: deriveParamsId(mockConfig),
      paramsId: deriveParamsId(mockConfig),
      config: mockConfig,
    });
    const setupBars = makeBars(40);
    const { store } = setupStore(setupBars, [mockDoc]);
    store.setSymbol('AAPL'); // dual is the default — slot 1 exists
    store.loadAnalysis(deriveParamsId(mockConfig), 1);
    expect(store.configs()[1].devThreshold).toBe(7);
    expect(store.pivots()[1].length).toBeGreaterThan(0);
    expect(store.stats()[1]).not.toBeNull();
  });

  it('fetches bars from chart service when not yet loaded', () => {
    const mockDoc = makeSwingAnalysisDoc({
      id: deriveParamsId(LARGE_CONFIG),
      config: { ...LARGE_CONFIG },
    });
    const fetchBars = makeBars(40);
    const barsSubject = new Subject<{
      daily: ChartDataset;
      weekly: ChartDataset;
      monthly: ChartDataset;
      version: string;
    }>();
    const service = mockSwingAnalysisService([mockDoc]);
    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        { provide: ChartService, useValue: { loadBars$: () => barsSubject.asObservable() } },
        { provide: SwingAnalysisService, useValue: service },
        SwingAnalysisStore,
      ],
    });
    const store = TestBed.inject(SwingAnalysisStore);
    store.setSymbol('AAPL');
    expect(store.bars()).toEqual([]);

    store.loadAnalysis(deriveParamsId(LARGE_CONFIG), 0);
    expect(store.loading()).toBe(true);

    barsSubject.next({
      daily: makeChartDataset(fetchBars),
      weekly: makeChartDataset(fetchBars),
      monthly: makeChartDataset(fetchBars),
      version: 'test',
    });
    expect(store.loading()).toBe(false);
    expect(store.bars()).toEqual(fetchBars);
    expect(store.pivots()[0].length).toBeGreaterThan(0);
    expect(store.stats()[0]).not.toBeNull();
    barsSubject.complete();
  });

  it('cancels stale loadAnalysis when setSymbol is called during fetch', () => {
    const mockDoc = makeSwingAnalysisDoc({
      id: deriveParamsId(LARGE_CONFIG),
      config: { ...LARGE_CONFIG },
    });
    const analysisSubject = new Subject<SwingAnalysisDoc | null>();
    const barsSubject = new Subject<{
      daily: ChartDataset;
      weekly: ChartDataset;
      monthly: ChartDataset;
      version: string;
    }>();
    const service = {
      loadSavedAnalyses: jest.fn(() => of([])),
      saveAnalysis: jest.fn(() => of(undefined)),
      loadAnalysis: jest.fn(() => analysisSubject.asObservable()),
    };
    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        { provide: ChartService, useValue: { loadBars$: () => barsSubject.asObservable() } },
        { provide: SwingAnalysisService, useValue: service },
        SwingAnalysisStore,
      ],
    });
    const store = TestBed.inject(SwingAnalysisStore);
    store.setSymbol('AAPL');
    store.loadAnalysis(deriveParamsId(LARGE_CONFIG), 0);
    expect(store.loading()).toBe(true);

    store.setSymbol('MSFT');
    expect(store.symbol()).toBe('MSFT');

    analysisSubject.next(mockDoc);
    expect(store.symbol()).toBe('MSFT');
    expect(store.configs()[0]).toEqual({ ...LARGE_CONFIG });
    analysisSubject.complete();
    barsSubject.complete();
  });

  it('sets error when doc is not found', () => {
    const { store, service } = setupStore(makeBars(40));
    store.setSymbol('AAPL');
    service.loadAnalysis.mockReturnValue(of(null));
    store.loadAnalysis('nonexistent-id', 0);
    expect(store.error()).toBe('Analysis not found');
  });

  it('does nothing when no symbol is set', () => {
    const { store, service } = setupStore();
    store.loadAnalysis('some-id', 0);
    expect(service.loadAnalysis).not.toHaveBeenCalled();
  });

  it('does nothing for an out-of-range index', () => {
    const { store, service } = setupStore(makeBars(40));
    store.setSymbol('AAPL');
    store.loadAnalysis('some-id', 5);
    expect(service.loadAnalysis).not.toHaveBeenCalled();
  });

  it('does not desync when toggleDualMode is called during in-flight bar load', () => {
    const barsSubject = new Subject<{
      daily: ChartDataset;
      weekly: ChartDataset;
      monthly: ChartDataset;
      version: string;
    }>();
    const service = mockSwingAnalysisService([]);
    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        { provide: ChartService, useValue: { loadBars$: () => barsSubject.asObservable() } },
        { provide: SwingAnalysisService, useValue: service },
        SwingAnalysisStore,
      ],
    });
    const store = TestBed.inject(SwingAnalysisStore);
    store.setSymbol('AAPL');
    // Bar load is in flight (2 configs — dual is the default).
    // Toggle dual mode OFF mid-flight.
    store.toggleDualMode();
    expect(store.configs().length).toBe(1);
    expect(store.pivots().length).toBe(1);

    // Bars arrive — recomputeAll reads store.configs() fresh (length 1).
    barsSubject.next({
      daily: makeChartDataset(makeBars(40)),
      weekly: makeChartDataset(makeBars(40)),
      monthly: makeChartDataset(makeBars(40)),
      version: 'test',
    });
    // All parallel arrays must be length 1 — no desync.
    expect(store.configs().length).toBe(1);
    expect(store.pivots().length).toBe(1);
    expect(store.projections().length).toBe(1);
    expect(store.swings().length).toBe(1);
    expect(store.stats().length).toBe(1);
    barsSubject.complete();
  });

  it('does not desync when toggleDualMode is called during in-flight loadAnalysis', () => {
    const mockDoc = makeSwingAnalysisDoc({
      id: deriveParamsId(LARGE_CONFIG),
      config: { ...LARGE_CONFIG },
    });
    const analysisSubject = new Subject<SwingAnalysisDoc | null>();
    const barsSubject = new Subject<{
      daily: ChartDataset;
      weekly: ChartDataset;
      monthly: ChartDataset;
      version: string;
    }>();
    const service = {
      loadSavedAnalyses: jest.fn(() => of([])),
      saveAnalysis: jest.fn(() => of(undefined)),
      loadAnalysis: jest.fn(() => analysisSubject.asObservable()),
    };
    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        { provide: ChartService, useValue: { loadBars$: () => barsSubject.asObservable() } },
        { provide: SwingAnalysisService, useValue: service },
        SwingAnalysisStore,
      ],
    });
    const store = TestBed.inject(SwingAnalysisStore);
    store.setSymbol('AAPL');
    // Start loadAnalysis — analysis doc request is pending (2 configs —
    // dual is the default). Toggle dual mode OFF while fetch is in flight.
    store.loadAnalysis(deriveParamsId(LARGE_CONFIG), 0);
    store.toggleDualMode();
    expect(store.configs().length).toBe(1);

    // Doc arrives — next handler re-reads store.configs() fresh (length 1),
    // so it applies to slot 0 without resurrecting the removed config.
    analysisSubject.next(mockDoc);
    expect(store.configs().length).toBe(1);
    expect(store.dualMode()).toBe(false);
    analysisSubject.complete();
    barsSubject.complete();
  });
});

// =============================================================================
// paramsIds computed — derived from configs
// =============================================================================

describe('SwingAnalysisStore.paramsIds', () => {
  it('derives paramsIds from configs', () => {
    const { store } = setupStore();
    expect(store.paramsIds()).toEqual([deriveParamsId(LARGE_CONFIG), deriveParamsId(SMALL_CONFIG)]);
  });

  it('updates when config changes', () => {
    const { store } = setupStore();
    store.updateConfig(0, { devThreshold: 20 });
    expect(store.paramsIds()[0]).toBe(deriveParamsId({ ...LARGE_CONFIG, devThreshold: 20 }));
  });

  it('has two entries by default (dual mode)', () => {
    const { store } = setupStore();
    expect(store.paramsIds().length).toBe(2);
    expect(store.paramsIds()[0]).toBe(deriveParamsId(LARGE_CONFIG));
    expect(store.paramsIds()[1]).toBe(deriveParamsId(SMALL_CONFIG));
  });
});

// =============================================================================
// runBatch — serial per-symbol sweep: bars -> per-config compute -> save
// =============================================================================

describe('SwingAnalysisStore.runBatch', () => {
  interface BatchSetupOpts {
    barsBySymbol?: Record<string, PriceBar[]>;
    errorSymbols?: string[];
    saveFailFor?: string[];
    pending?: boolean;
  }

  function setupBatch(opts: BatchSetupOpts = {}): {
    store: InstanceType<typeof SwingAnalysisStore>;
    service: ServiceMock;
    chart: { loadBars$: jest.Mock };
    pendingSubject?: Subject<unknown>;
  } {
    const service = mockSwingAnalysisService([]);
    const pendingSubject = opts.pending ? new Subject<unknown>() : undefined;
    const chart = {
      loadBars$: jest.fn((symbol: string) => {
        // NOTE: production loadBars$ swallows fetch errors into empty
        // datasets (chart.service.ts) — it never errors. This throwError
        // path exercises the store's defensive catchError; the realistic
        // failure mode (empty bars) is covered by the empty-bars test.
        if (opts.errorSymbols?.includes(symbol)) {
          return throwError(() => new Error(`bars fail for ${symbol}`));
        }
        if (pendingSubject) {
          return pendingSubject.asObservable();
        }
        const bars = opts.barsBySymbol?.[symbol] ?? makeBars(40);
        return of({
          daily: makeChartDataset(bars),
          weekly: makeChartDataset(bars),
          monthly: makeChartDataset(bars),
          version: 'test',
        });
      }),
    };
    if (opts.saveFailFor?.length) {
      const failSet = new Set(opts.saveFailFor);
      service.saveAnalysis.mockImplementation((input: { symbol: string }) =>
        failSet.has(input.symbol)
          ? throwError(() => new Error('save fail'))
          : of(undefined),
      );
    }
    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        { provide: ChartService, useValue: chart },
        { provide: SwingAnalysisService, useValue: service },
        SwingAnalysisStore,
      ],
    });
    return { store: TestBed.inject(SwingAnalysisStore), service, chart, pendingSubject };
  }

  const savedSymbols = (service: ServiceMock) =>
    service.saveAnalysis.mock.calls.map((c) => (c[0] as SwingAnalysisInput).symbol);

  it('saves one doc per active config per symbol (dual mode -> 2 saves per symbol)', () => {
    const { store, service } = setupBatch();
    store.runBatch('AAPL, MSFT');
    expect(service.saveAnalysis).toHaveBeenCalledTimes(4);
    expect(savedSymbols(service)).toEqual(['AAPL', 'AAPL', 'MSFT', 'MSFT']);
    // Each config saved under its own paramsId.
    const params = service.saveAnalysis.mock.calls.map((c) => c[0].paramsId);
    expect(params).toEqual([
      deriveParamsId(LARGE_CONFIG), deriveParamsId(SMALL_CONFIG),
      deriveParamsId(LARGE_CONFIG), deriveParamsId(SMALL_CONFIG),
    ]);
  });

  it('saves once per symbol in single mode', () => {
    const { store, service } = setupBatch();
    store.toggleDualMode(); // off -> 1 config
    store.runBatch('AAPL, MSFT');
    expect(service.saveAnalysis).toHaveBeenCalledTimes(2);
    expect(savedSymbols(service)).toEqual(['AAPL', 'MSFT']);
  });

  it('normalizes the symbol list — trims, uppercases, dedupes, splits on comma/space/newline', () => {
    const { store, service } = setupBatch();
    store.toggleDualMode();
    store.runBatch('aapl, msft\n  QQQ  aapl MSFT');
    expect(savedSymbols(service)).toEqual(['AAPL', 'MSFT', 'QQQ']);
  });

  it('does not disturb displayed state — symbol, bars, derived arrays untouched', () => {
    const { store } = setupBatch();
    store.setSymbol('AAPL');
    const bars = store.bars();
    const pivots = store.pivots();
    const stats = store.stats();
    store.runBatch('MSFT, QQQ');
    expect(store.symbol()).toBe('AAPL');
    expect(store.bars()).toBe(bars);
    expect(store.pivots()).toBe(pivots);
    expect(store.stats()).toBe(stats);
  });

  it('records progress and results; batchRunning clears at the end', () => {
    const { store } = setupBatch();
    store.runBatch('AAPL, MSFT, QQQ');
    expect(store.batchRunning()).toBe(false);
    expect(store.batchProgress()).toEqual({ done: 3, total: 3, current: null });
    expect(store.batchResults()).toEqual([
      { symbol: 'AAPL', ok: true },
      { symbol: 'MSFT', ok: true },
      { symbol: 'QQQ', ok: true },
    ]);
  });

  it('continues past a failed symbol and records the error', () => {
    const { store } = setupBatch({ errorSymbols: ['BAD'] });
    store.runBatch('AAPL, BAD, QQQ');
    const results = store.batchResults();
    expect(results[0]).toEqual({ symbol: 'AAPL', ok: true });
    expect(results[1].symbol).toBe('BAD');
    expect(results[1].ok).toBe(false);
    expect(results[1].error).toContain('bars fail');
    expect(results[2]).toEqual({ symbol: 'QQQ', ok: true });
    expect(store.batchProgress().done).toBe(3);
  });

  it('records save failures per symbol and continues', () => {
    const { store, service } = setupBatch({ saveFailFor: ['MSFT'] });
    store.toggleDualMode();
    store.runBatch('AAPL, MSFT, QQQ');
    const results = store.batchResults();
    expect(results[1].symbol).toBe('MSFT');
    expect(results[1].ok).toBe(false);
    expect(results[2].ok).toBe(true);
    expect(service.saveAnalysis).toHaveBeenCalledTimes(3);
  });

  it('marks a symbol failed when bars come back empty', () => {
    const { store } = setupBatch({ barsBySymbol: { EMPTY: [] } });
    store.toggleDualMode();
    store.runBatch('AAPL, EMPTY, QQQ');
    const results = store.batchResults();
    expect(results[1].symbol).toBe('EMPTY');
    expect(results[1].ok).toBe(false);
  });

  it('no-ops on empty or whitespace input', () => {
    const { store, service, chart } = setupBatch();
    store.runBatch('   ');
    store.runBatch('');
    expect(chart.loadBars$).not.toHaveBeenCalled();
    expect(service.saveAnalysis).not.toHaveBeenCalled();
    expect(store.batchRunning()).toBe(false);
  });

  it('ignores a second run while one is in flight', () => {
    const { store, service } = setupBatch({ pending: true });
    store.runBatch('AAPL');
    expect(store.batchRunning()).toBe(true);
    store.runBatch('MSFT');
    expect(service.saveAnalysis).not.toHaveBeenCalled();
    expect(store.batchProgress().total).toBe(1);
  });

  it('uses the config snapshot taken at run start — mid-run edits do not leak into saves', () => {
    const { store, service, pendingSubject } = setupBatch({ pending: true });
    store.runBatch('AAPL');
    // Change devThreshold mid-flight — the in-flight run must still save
    // the snapshot's paramsId.
    store.updateConfig(0, { devThreshold: 20 });
    pendingSubject!.next({
      daily: makeChartDataset(makeBars(40)),
      weekly: makeChartDataset(makeBars(40)),
      monthly: makeChartDataset(makeBars(40)),
      version: 'test',
    });
    const params = service.saveAnalysis.mock.calls.map(
      (c) => (c[0] as SwingAnalysisInput).paramsId,
    );
    expect(params).toEqual([
      deriveParamsId(LARGE_CONFIG), // dev 5 — the snapshot, not dev 20
      deriveParamsId(SMALL_CONFIG),
    ]);
  });

  it('fetches bars exactly once per symbol', () => {
    const { store, chart } = setupBatch();
    store.toggleDualMode();
    store.runBatch('AAPL, MSFT, QQQ');
    expect(chart.loadBars$).toHaveBeenCalledTimes(3);
    expect(chart.loadBars$.mock.calls.map((c) => c[0])).toEqual(['AAPL', 'MSFT', 'QQQ']);
  });

  it('reports mid-run progress as each symbol completes', () => {
    const { store, pendingSubject } = setupBatch({ pending: true });
    store.runBatch('AAPL, MSFT');
    expect(store.batchProgress()).toEqual({ done: 0, total: 2, current: 'AAPL' });
    // Bars for AAPL arrive — serial concatMap moves on to MSFT.
    pendingSubject!.next({
      daily: makeChartDataset(makeBars(40)),
      weekly: makeChartDataset(makeBars(40)),
      monthly: makeChartDataset(makeBars(40)),
      version: 'test',
    });
    expect(store.batchProgress()).toEqual({ done: 1, total: 2, current: 'MSFT' });
  });

  it('supports consecutive runs — a second run after completion starts clean', () => {
    const { store, service } = setupBatch();
    store.toggleDualMode();
    store.runBatch('AAPL');
    store.runBatch('MSFT');
    expect(store.batchResults()).toEqual([{ symbol: 'MSFT', ok: true }]);
    expect(service.saveAnalysis).toHaveBeenCalledTimes(2);
  });

  it('cancelBatch aborts an in-flight sweep and clears batchRunning', () => {
    const { store, service } = setupBatch({ pending: true });
    store.runBatch('AAPL, MSFT');
    expect(store.batchRunning()).toBe(true);
    store.cancelBatch();
    expect(store.batchRunning()).toBe(false);
    expect(service.saveAnalysis).not.toHaveBeenCalled();
    // A new run is unblocked after cancel.
    store.runBatch('QQQ');
  });

  it('resetState aborts an in-flight batch and clears batch fields', () => {
    const { store } = setupBatch({ pending: true });
    store.runBatch('AAPL');
    expect(store.batchRunning()).toBe(true);
    store.resetState();
    expect(store.batchRunning()).toBe(false);
    expect(store.batchResults()).toEqual([]);
    expect(store.batchProgress()).toEqual({ done: 0, total: 0, current: null });
  });
});

// =============================================================================
// loadSwingSets / loadSwingSetsIntoSlots — saved-sets browser
// =============================================================================

describe('SwingAnalysisStore.loadSwingSets', () => {
  it('patches savedSets from the service result and clears loading', () => {
    const allSets = [
      makeSwingAnalysisDoc({ id: 'a1', symbol: 'AAPL' }),
      makeSwingAnalysisDoc({ id: 'm1', symbol: 'MSFT' }),
    ];
    const service = mockSwingAnalysisService([], allSets);
    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        { provide: ChartService, useValue: mockChartService(makeBars(40)) },
        { provide: SwingAnalysisService, useValue: service },
        SwingAnalysisStore,
      ],
    });
    const store = TestBed.inject(SwingAnalysisStore);

    store.loadSwingSets();

    expect(service.loadAllSwingSets).toHaveBeenCalled();
    expect(store.savedSets()).toEqual(allSets);
    expect(store.savedSetsLoading()).toBe(false);
  });

  it('a service error sets error and clears loading', () => {
    const service = mockSwingAnalysisService();
    service.loadAllSwingSets.mockReturnValue(throwError(() => new Error('rules deny')));
    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        { provide: ChartService, useValue: mockChartService(makeBars(40)) },
        { provide: SwingAnalysisService, useValue: service },
        SwingAnalysisStore,
      ],
    });
    const store = TestBed.inject(SwingAnalysisStore);

    store.loadSwingSets();

    expect(store.savedSets()).toEqual([]);
    expect(store.savedSetsLoading()).toBe(false);
    expect(store.error()).toContain('rules deny');
  });
});

describe('SwingAnalysisStore.loadSwingSetsIntoSlots', () => {
  const docFor = (symbol: string, dev: number, id: string) =>
    makeSwingAnalysisDoc({
      id,
      symbol,
      config: { ...LARGE_CONFIG, devThreshold: dev },
    });

  it('same-symbol: replaces configs with N doc configs and recomputes all slots on current bars', () => {
    const { store } = setupStore();
    store.setSymbol('AAPL');
    const before = store.configs().length;
    expect(before).toBe(2);

    store.loadSwingSetsIntoSlots([
      docFor('AAPL', 10, 's10'),
      docFor('AAPL', 3, 's3'),
      docFor('AAPL', 1, 's1'),
    ]);

    expect(store.configs().length).toBe(3);
    expect(store.configs().map((c) => c.devThreshold)).toEqual([10, 3, 1]);
    // All three parallel arrays grew to N slots and hold real recompute output.
    expect(store.pivots().length).toBe(3);
    expect(store.swings().length).toBe(3);
    expect(store.stats().length).toBe(3);
    expect(store.symbol()).toBe('AAPL');
  });

  it('different symbol: runs the setSymbol flow — the N configs recompute on the new bars', () => {
    const { store, service } = setupStore();
    store.setSymbol('AAPL');

    store.loadSwingSetsIntoSlots([
      docFor('MSFT', 10, 'm10'),
      docFor('MSFT', 4, 'm4'),
    ]);

    expect(store.symbol()).toBe('MSFT');
    expect(store.configs().map((c) => c.devThreshold)).toEqual([10, 4]);
    expect(store.bars().length).toBeGreaterThan(0);
    expect(store.pivots().length).toBe(2);
    expect(store.swings().length).toBe(2);
    expect(service.saveAnalysis).not.toHaveBeenCalled();
  });

  it('N>2 slots: dualMode reads true and allStats merges every slot', () => {
    const { store } = setupStore();
    store.setSymbol('AAPL');

    store.loadSwingSetsIntoSlots([
      docFor('AAPL', 10, 's10'),
      docFor('AAPL', 3, 's3'),
      docFor('AAPL', 1, 's1'),
    ]);

    expect(store.dualMode()).toBe(true);
    expect(store.allStats()).not.toBeNull();
    // allStats merges every slot's swings — its count equals the sum of
    // the per-slot stats counts (computeSwingStats filters unconfirmed
    // swings, so compare against stats, not raw swing arrays).
    const perSlot = store.stats()
      .reduce((n, s) => n + (s?.up.count ?? 0) + (s?.down.count ?? 0), 0);
    expect(store.allStats()!.up.count + store.allStats()!.down.count)
      .toBe(perSlot);
  });

  it('toggleDualMode from N>2 collapses to the first config', () => {
    const { store } = setupStore();
    store.setSymbol('AAPL');
    store.loadSwingSetsIntoSlots([
      docFor('AAPL', 10, 's10'),
      docFor('AAPL', 3, 's3'),
      docFor('AAPL', 1, 's1'),
    ]);
    expect(store.configs().length).toBe(3);

    store.toggleDualMode();

    expect(store.configs().length).toBe(1);
    expect(store.configs()[0].devThreshold).toBe(10);
    expect(store.dualMode()).toBe(false);
  });

  it('cancels an in-flight loadAnalysis so it cannot overwrite a loaded slot', () => {
    const barsSubject = new Subject<{
      daily: ChartDataset;
      weekly: ChartDataset;
      monthly: ChartDataset;
      version: string;
    }>();
    const analysisSubject = new Subject<SwingAnalysisDoc | null>();
    const staleDoc = makeSwingAnalysisDoc({
      config: { ...LARGE_CONFIG, devThreshold: 99 },
    });
    const service = {
      loadSavedAnalyses: jest.fn(() => of([])),
      loadAllSwingSets: jest.fn(() => of([])),
      saveAnalysis: jest.fn(() => of(undefined)),
      loadAnalysis: jest.fn(() => analysisSubject.asObservable()),
    };
    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        { provide: ChartService, useValue: { loadBars$: () => barsSubject.asObservable() } },
        { provide: SwingAnalysisService, useValue: service },
        SwingAnalysisStore,
      ],
    });
    const store = TestBed.inject(SwingAnalysisStore);
    store.setSymbol('AAPL');
    barsSubject.next({
      daily: makeChartDataset(makeBars(40)),
      weekly: makeChartDataset(makeBars(40)),
      monthly: makeChartDataset(makeBars(40)),
      version: 't',
    });
    // Start an analysis load, then load N sets before it resolves.
    store.loadAnalysis(deriveParamsId(LARGE_CONFIG), 0);
    store.loadSwingSetsIntoSlots([docFor('AAPL', 10, 's10'), docFor('AAPL', 3, 's3')]);
    expect(store.configs().map((c) => c.devThreshold)).toEqual([10, 3]);

    // The stale response lands — must not clobber a loaded slot.
    analysisSubject.next(staleDoc);
    analysisSubject.complete();
    expect(store.configs().map((c) => c.devThreshold)).toEqual([10, 3]);
  });

  it('resetState clears savedSets and aborts an in-flight loadSwingSets', () => {
    const setsSubject = new Subject<SwingAnalysisDoc[]>();
    const service = mockSwingAnalysisService();
    service.loadAllSwingSets.mockReturnValue(setsSubject.asObservable());
    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        { provide: ChartService, useValue: mockChartService(makeBars(40)) },
        { provide: SwingAnalysisService, useValue: service },
        SwingAnalysisStore,
      ],
    });
    const store = TestBed.inject(SwingAnalysisStore);

    store.loadSwingSets();
    expect(store.savedSetsLoading()).toBe(true);
    store.resetState();
    expect(store.savedSets()).toEqual([]);
    expect(store.savedSetsLoading()).toBe(false);

    // Zombie check — a late response must not patch the reset store.
    setsSubject.next([makeSwingAnalysisDoc()]);
    setsSubject.complete();
    expect(store.savedSets()).toEqual([]);
  });

  it('a selection spanning symbols is rejected — no state change', () => {
    const { store } = setupStore();
    store.setSymbol('AAPL');
    const before = store.configs();

    store.loadSwingSetsIntoSlots([
      docFor('AAPL', 10, 'a'),
      docFor('MSFT', 5, 'm'),
    ]);

    expect(store.configs()).toEqual(before);
    expect(store.symbol()).toBe('AAPL');
  });

  it('an empty selection is a no-op', () => {
    const { store } = setupStore();
    store.setSymbol('AAPL');
    const before = store.configs();

    store.loadSwingSetsIntoSlots([]);

    expect(store.configs()).toEqual(before);
  });

  it('never re-saves the loaded docs', () => {
    const { store, service } = setupStore();
    store.setSymbol('AAPL');

    store.loadSwingSetsIntoSlots([docFor('AAPL', 10, 's10')]);

    expect(service.saveAnalysis).not.toHaveBeenCalled();
  });
});

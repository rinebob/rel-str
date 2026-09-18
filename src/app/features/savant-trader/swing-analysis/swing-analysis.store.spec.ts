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
import { of, Subject } from 'rxjs';

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
import type { SwingAnalysisDoc } from './swing-analysis.types';

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
): Partial<SwingAnalysisService> & {
  saveAnalysis: jest.Mock;
  loadSavedAnalyses: jest.Mock;
  loadAnalysis: jest.Mock;
} {
  return {
    loadSavedAnalyses: jest.fn(() => of(docs)),
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
  it('has one config (large defaults) and dualMode off', () => {
    const { store } = setupStore();
    expect(store.symbol()).toBe('');
    expect(store.configs()).toEqual([{ ...LARGE_CONFIG }]);
    expect(store.dualMode()).toBe(false);
    expect(store.bars()).toEqual([]);
    expect(store.pivots()).toEqual([[]]);
    expect(store.projections()).toEqual([null]);
    expect(store.swings()).toEqual([[]]);
    expect(store.stats()).toEqual([null]);
    expect(store.loading()).toBe(false);
    expect(store.error()).toBeNull();
    expect(store.savedAnalyses()).toEqual([]);
  });

  it('derives paramsIds from configs', () => {
    const { store } = setupStore();
    expect(store.paramsIds()).toEqual([deriveParamsId(LARGE_CONFIG)]);
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
    store.toggleDualMode();
    store.updateConfig(1, { devThreshold: 7 });
    expect(store.configs()[0].devThreshold).toBe(LARGE_CONFIG.devThreshold);
    expect(store.configs()[1].devThreshold).toBe(7);
  });

  it('leaves other config untouched when recomputing one slot', () => {
    const { store } = setupStore(makeBars(40));
    store.setSymbol('AAPL');
    store.toggleDualMode();
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
  it('adds a second config with small defaults when turning on', () => {
    const { store } = setupStore(makeBars(40));
    store.setSymbol('AAPL');
    store.toggleDualMode();
    expect(store.dualMode()).toBe(true);
    expect(store.configs().length).toBe(2);
    expect(store.configs()[1]).toEqual({ ...SMALL_CONFIG });
  });

  it('recomputes the second config from loaded bars', () => {
    const { store } = setupStore(makeBars(40));
    store.setSymbol('AAPL');
    store.toggleDualMode();
    expect(store.pivots()[1].length).toBeGreaterThan(0);
    expect(store.swings()[1].length).toBeGreaterThan(0);
    expect(store.stats()[1]).not.toBeNull();
  });

  it('removes the second config when turning off', () => {
    const { store } = setupStore(makeBars(40));
    store.setSymbol('AAPL');
    store.toggleDualMode();
    expect(store.configs().length).toBe(2);
    store.toggleDualMode();
    expect(store.dualMode()).toBe(false);
    expect(store.configs().length).toBe(1);
    expect(store.configs()[0]).toEqual({ ...LARGE_CONFIG });
  });

  it('preserves the first config when turning off', () => {
    const { store } = setupStore(makeBars(40));
    store.setSymbol('AAPL');
    store.updateConfig(0, { devThreshold: 20 });
    store.toggleDualMode();
    store.toggleDualMode();
    expect(store.configs()[0].devThreshold).toBe(20);
  });

  it('produces aligned length-2 arrays when turning on with empty bars', () => {
    const { store } = setupStore();
    // No setSymbol — bars are empty.
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
    store.toggleDualMode();
    expect(store.pivots().length).toBe(2);
    store.toggleDualMode();
    expect(store.pivots().length).toBe(1);
    expect(store.projections().length).toBe(1);
    expect(store.swings().length).toBe(1);
    expect(store.stats().length).toBe(1);
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
    store.setSymbol('AAPL');
    store.toggleDualMode();
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
// loadSavedAnalyses — reads zig-zags/{symbol}/analyses
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
    store.setSymbol('AAPL');
    store.toggleDualMode();
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
    // Bar load is in flight (1 config). Toggle dual mode on.
    store.toggleDualMode();
    expect(store.configs().length).toBe(2);
    expect(store.pivots().length).toBe(2);

    // Bars arrive — recomputeAll reads store.configs() fresh (length 2).
    barsSubject.next({
      daily: makeChartDataset(makeBars(40)),
      weekly: makeChartDataset(makeBars(40)),
      monthly: makeChartDataset(makeBars(40)),
      version: 'test',
    });
    // All parallel arrays must be length 2 — no desync.
    expect(store.configs().length).toBe(2);
    expect(store.pivots().length).toBe(2);
    expect(store.projections().length).toBe(2);
    expect(store.swings().length).toBe(2);
    expect(store.stats().length).toBe(2);
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
    // Start loadAnalysis — analysis doc request is pending (1 config).
    store.loadAnalysis(deriveParamsId(LARGE_CONFIG), 0);

    // Toggle dual mode on while fetch is in flight.
    store.toggleDualMode();
    expect(store.configs().length).toBe(2);

    // Doc arrives — next handler re-reads store.configs() fresh (length 2),
    // so it does NOT overwrite the second config.
    analysisSubject.next(mockDoc);
    expect(store.configs().length).toBe(2);
    expect(store.dualMode()).toBe(true);
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
    expect(store.paramsIds()).toEqual([deriveParamsId(LARGE_CONFIG)]);
  });

  it('updates when config changes', () => {
    const { store } = setupStore();
    store.updateConfig(0, { devThreshold: 20 });
    expect(store.paramsIds()[0]).toBe(deriveParamsId({ ...LARGE_CONFIG, devThreshold: 20 }));
  });

  it('has two entries in dual mode', () => {
    const { store } = setupStore();
    store.toggleDualMode();
    expect(store.paramsIds().length).toBe(2);
    expect(store.paramsIds()[0]).toBe(deriveParamsId(LARGE_CONFIG));
    expect(store.paramsIds()[1]).toBe(deriveParamsId(SMALL_CONFIG));
  });
});

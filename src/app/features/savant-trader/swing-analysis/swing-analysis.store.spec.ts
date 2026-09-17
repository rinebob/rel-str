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

import { SwingAnalysisStore } from './swing-analysis.store';
import { ChartService } from '../services/chart.service';
import { SwingAnalysisService } from './swing-analysis.service';
import { DEFAULT_CONFIG } from '../../shared/components/flex-chart/indicators/st-zigzag.engine';
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
  for (let i = 0; i < n; i++) {
    const phase = Math.floor(i / 5) % 2;
    const stepInPhase = i % 5;
    const delta = phase === 0 ? stepInPhase * 10 : -stepInPhase * 10;
    bars.push({
      date: `2026-01-${String(i + 1).padStart(2, '0')}`,
      x: new Date(2026, 0, i + 1),
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
    id: 'dev5_L5_R5_1barY_projY',
    userId: 'user-123',
    symbol: 'AAPL',
    paramsId: 'dev5_L5_R5_1barY_projY',
    config: { ...DEFAULT_CONFIG },
    bars: [],
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
  it('has empty initial state', () => {
    const { store } = setupStore();
    expect(store.symbol()).toBe('');
    expect(store.config()).toEqual(DEFAULT_CONFIG);
    expect(store.pivots()).toEqual([]);
    expect(store.projection()).toBeNull();
    expect(store.swings()).toEqual([]);
    expect(store.stats()).toBeNull();
    expect(store.loading()).toBe(false);
    expect(store.error()).toBeNull();
    expect(store.savedAnalyses()).toEqual([]);
  });
});

// =============================================================================
// setSymbol — triggers bar load + recompute
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

  it('computes pivots, swings, and stats after bar load completes', () => {
    // mockChartService returns of(...) which completes synchronously,
    // so state is ready immediately after setSymbol returns.
    const { store } = setupStore(makeBars(40));
    store.setSymbol('AAPL');
    expect(store.loading()).toBe(false);
    expect(store.pivots().length).toBeGreaterThan(0);
    expect(store.swings().length).toBeGreaterThan(0);
    expect(store.stats()).not.toBeNull();
    expect(store.error()).toBeNull();
  });

  it('clears previous analysis when symbol changes', () => {
    const { store } = setupStore(makeBars(40));
    store.setSymbol('AAPL');
    expect(store.pivots().length).toBeGreaterThan(0);
    store.setSymbol('MSFT');
    expect(store.symbol()).toBe('MSFT');
    expect(store.pivots().length).toBeGreaterThan(0);
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
    // Only MSFT should be active — completing AAPL should not overwrite
    subject.complete();
    expect(store.symbol()).toBe('MSFT');
    expect(store.loading()).toBe(true);
  });
});

// =============================================================================
// updateConfig — triggers recompute
// =============================================================================

describe('SwingAnalysisStore.updateConfig', () => {
  it('updates the config', () => {
    const { store } = setupStore();
    store.updateConfig({ devThreshold: 10 });
    expect(store.config().devThreshold).toBe(10);
  });

  it('recomputes pivots/swings/stats from loaded bars', () => {
    const { store } = setupStore(makeBars(40));
    store.setSymbol('AAPL');
    const pivotCountBefore = store.pivots().length;
    store.updateConfig({ devThreshold: 15 });
    expect(store.pivots().length).toBeLessThanOrEqual(pivotCountBefore);
    expect(store.stats()).not.toBeNull();
  });

  it('does not reload bars', () => {
    const { store } = setupStore(makeBars(40));
    store.setSymbol('AAPL');
    const barsBefore = store.bars();
    store.updateConfig({ leftDepth: 3 });
    expect(store.bars()).toBe(barsBefore);
  });
});

// =============================================================================
// saveAnalysis — calls Firestore service
// =============================================================================

describe('SwingAnalysisStore.saveAnalysis', () => {
  it('does nothing when no symbol is set', () => {
    const { store, service } = setupStore();
    store.saveAnalysis();
    expect(service.saveAnalysis).not.toHaveBeenCalled();
    expect(store.error()).toBeNull();
  });

  it('does nothing when no stats are computed', () => {
    // Use a Subject so bars haven't loaded yet — stats will be null
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
    store.saveAnalysis();
    expect(service.saveAnalysis).not.toHaveBeenCalled();
    subject.complete();
  });

  it('calls service with correct paramsId and doc payload', () => {
    const { store, service } = setupStore(makeBars(40));
    store.setSymbol('AAPL');
    store.saveAnalysis();
    expect(service.saveAnalysis).toHaveBeenCalledTimes(1);
    const arg = service.saveAnalysis.mock.calls[0][0];
    expect(arg.paramsId).toBe(store.paramsId());
    expect(arg.symbol).toBe('AAPL');
    expect(arg.config).toEqual(store.config());
    expect(arg.pivots).toEqual(store.pivots());
    expect(arg.swings).toEqual(store.swings());
    expect(arg.stats).toEqual(store.stats());
    expect(arg.bars).toEqual(store.bars());
    expect(arg.savedAt).toBeDefined();
  });

  it('refreshes saved analyses after a successful save', () => {
    const doc = makeSwingAnalysisDoc();
    const { store, service } = setupStore(makeBars(40), [doc]);
    store.setSymbol('AAPL');
    service.loadSavedAnalyses.mockClear();
    store.saveAnalysis();
    // saveAnalysis completes synchronously (of(undefined)),
    // then the refresh loadSavedAnalyses fires synchronously too.
    expect(service.loadSavedAnalyses).toHaveBeenCalledTimes(1);
  });
});

// =============================================================================
// loadSavedAnalyses — reads zig-zags/{symbol}/analyses
// =============================================================================

describe('SwingAnalysisStore.loadSavedAnalyses', () => {
  it('populates savedAnalyses from the service', () => {
    const doc = makeSwingAnalysisDoc({ id: 'dev5_L5_R5_1barY_projY' });
    const { store } = setupStore(makeBars(40), [doc]);
    store.setSymbol('AAPL');
    store.loadSavedAnalyses();
    expect(store.savedAnalyses().length).toBe(1);
    expect(store.savedAnalyses()[0].id).toBe('dev5_L5_R5_1barY_projY');
  });

  it('does nothing when no symbol is set', () => {
    const { store, service } = setupStore();
    store.loadSavedAnalyses();
    expect(service.loadSavedAnalyses).not.toHaveBeenCalled();
  });
});

// =============================================================================
// loadAnalysis — loads a saved analysis into the store
// =============================================================================

describe('SwingAnalysisStore.loadAnalysis', () => {
  it('loads config, pivots, swings, and stats from a saved doc', () => {
    const mockConfig = { ...DEFAULT_CONFIG, devThreshold: 10 };
    const mockBars = makeBars(20);
    const mockDoc = makeSwingAnalysisDoc({
      id: 'dev10_L5_R5_1barY_projY',
      paramsId: 'dev10_L5_R5_1barY_projY',
      config: mockConfig,
      bars: mockBars,
    });
    const { store } = setupStore(makeBars(40), [mockDoc]);
    store.setSymbol('AAPL');
    store.loadAnalysis('dev10_L5_R5_1barY_projY');
    expect(store.config().devThreshold).toBe(10);
    expect(store.bars()).toEqual(mockBars);
    expect(store.pivots()).toEqual(mockDoc.pivots);
    expect(store.swings()).toEqual(mockDoc.swings);
    expect(store.stats()).toEqual(mockDoc.stats);
  });

  it('does nothing when no symbol is set', () => {
    const { store, service } = setupStore();
    store.loadAnalysis('some-id');
    expect(service.loadAnalysis).not.toHaveBeenCalled();
  });
});

// =============================================================================
// paramsId computed — derived from config
// =============================================================================

describe('SwingAnalysisStore.paramsId', () => {
  it('derives paramsId from the current config', () => {
    const { store } = setupStore();
    expect(store.paramsId()).toBe('dev5_L5_R5_1barY_projY');
  });

  it('updates when config changes', () => {
    const { store } = setupStore();
    store.updateConfig({ devThreshold: 10 });
    expect(store.paramsId()).toBe('dev10_L5_R5_1barY_projY');
  });
});

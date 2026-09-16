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
    id: 'dev5-l5-r5-a1-p1',
    symbol: 'AAPL',
    paramsId: 'dev5-l5-r5-a1-p1',
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

function setupStore(
  bars: PriceBar[] = makeBars(40),
  savedDocs: SwingAnalysisDoc[] = [],
): InstanceType<typeof SwingAnalysisStore> & {
  _service: ReturnType<typeof mockSwingAnalysisService>;
} {
  const service = mockSwingAnalysisService(savedDocs);
  TestBed.configureTestingModule({
    providers: [
      provideZonelessChangeDetection(),
      { provide: ChartService, useValue: mockChartService(bars) },
      { provide: SwingAnalysisService, useValue: service },
      SwingAnalysisStore,
    ],
  });
  const store = TestBed.inject(SwingAnalysisStore) as InstanceType<
    typeof SwingAnalysisStore
  > & { _service: ReturnType<typeof mockSwingAnalysisService> };
  (store as unknown as { _service: unknown })._service = service;
  return store;
}

// =============================================================================
// Store state — initial
// =============================================================================

describe('SwingAnalysisStore — initial state', () => {
  it('has empty initial state', () => {
    const store = setupStore();
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
    const store = setupStore();
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

  it('computes pivots, swings, and stats after bar load completes', (done) => {
    const store = setupStore(makeBars(40));
    store.setSymbol('AAPL');
    setTimeout(() => {
      expect(store.loading()).toBe(false);
      expect(store.pivots().length).toBeGreaterThan(0);
      expect(store.swings().length).toBeGreaterThan(0);
      expect(store.stats()).not.toBeNull();
      expect(store.error()).toBeNull();
      done();
    }, 50);
  });

  it('clears previous analysis when symbol changes', (done) => {
    const store = setupStore(makeBars(40));
    store.setSymbol('AAPL');
    setTimeout(() => {
      expect(store.pivots().length).toBeGreaterThan(0);
      store.setSymbol('MSFT');
      expect(store.symbol()).toBe('MSFT');
      setTimeout(() => {
        expect(store.pivots().length).toBeGreaterThan(0);
        done();
      }, 50);
    }, 50);
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
    const store = setupStore();
    store.updateConfig({ devThreshold: 10 });
    expect(store.config().devThreshold).toBe(10);
  });

  it('recomputes pivots/swings/stats from loaded bars', (done) => {
    const store = setupStore(makeBars(40));
    store.setSymbol('AAPL');
    setTimeout(() => {
      const pivotCountBefore = store.pivots().length;
      store.updateConfig({ devThreshold: 15 });
      expect(store.pivots().length).toBeLessThanOrEqual(pivotCountBefore);
      expect(store.stats()).not.toBeNull();
      done();
    }, 50);
  });

  it('does not reload bars', (done) => {
    const store = setupStore(makeBars(40));
    store.setSymbol('AAPL');
    setTimeout(() => {
      const barsBefore = store.bars();
      store.updateConfig({ leftDepth: 3 });
      expect(store.bars()).toBe(barsBefore);
      done();
    }, 50);
  });
});

// =============================================================================
// saveAnalysis — calls Firestore service
// =============================================================================

describe('SwingAnalysisStore.saveAnalysis', () => {
  it('does nothing when no symbol is set', () => {
    const store = setupStore();
    expect(() => store.saveAnalysis()).not.toThrow();
    expect(store._service.saveAnalysis).not.toHaveBeenCalled();
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
    expect(() => store.saveAnalysis()).not.toThrow();
    expect(service.saveAnalysis).not.toHaveBeenCalled();
    subject.complete();
  });

  it('calls service with correct paramsId and doc payload', (done) => {
    const store = setupStore(makeBars(40));
    store.setSymbol('AAPL');
    setTimeout(() => {
      store.saveAnalysis();
      expect(store._service.saveAnalysis).toHaveBeenCalledTimes(1);
      const arg = store._service.saveAnalysis.mock.calls[0][0] as SwingAnalysisDoc;
      expect(arg.paramsId).toBe(store.paramsId());
      expect(arg.symbol).toBe('AAPL');
      expect(arg.config).toEqual(store.config());
      expect(arg.pivots).toEqual(store.pivots());
      expect(arg.swings).toEqual(store.swings());
      expect(arg.stats).toEqual(store.stats());
      expect(arg.bars).toEqual(store.bars());
      expect(arg.savedAt).toBeDefined();
      done();
    }, 50);
  });

  it('refreshes saved analyses after a successful save', (done) => {
    const store = setupStore(makeBars(40), [makeSwingAnalysisDoc()]);
    store.setSymbol('AAPL');
    setTimeout(() => {
      store._service.loadSavedAnalyses.mockClear();
      store.saveAnalysis();
      setTimeout(() => {
        expect(store._service.loadSavedAnalyses).toHaveBeenCalledTimes(1);
        done();
      }, 50);
    }, 50);
  }, 10000);
});

// =============================================================================
// loadSavedAnalyses — reads zig-zags/{symbol}/analyses
// =============================================================================

describe('SwingAnalysisStore.loadSavedAnalyses', () => {
  it('populates savedAnalyses from the service', (done) => {
    const doc = makeSwingAnalysisDoc({ id: 'dev5-l5-r5-a1-p1' });
    const store = setupStore(makeBars(40), [doc]);
    store.setSymbol('AAPL');
    setTimeout(() => {
      store.loadSavedAnalyses();
      setTimeout(() => {
        expect(store.savedAnalyses().length).toBe(1);
        expect(store.savedAnalyses()[0].id).toBe('dev5-l5-r5-a1-p1');
        done();
      }, 50);
    }, 50);
  }, 10000);

  it('does nothing when no symbol is set', () => {
    const store = setupStore();
    expect(() => store.loadSavedAnalyses()).not.toThrow();
  });
});

// =============================================================================
// loadAnalysis — loads a saved analysis into the store
// =============================================================================

describe('SwingAnalysisStore.loadAnalysis', () => {
  it('loads config, pivots, swings, and stats from a saved doc', (done) => {
    const mockConfig = { ...DEFAULT_CONFIG, devThreshold: 10 };
    const mockBars = makeBars(20);
    const mockDoc = makeSwingAnalysisDoc({
      id: 'dev10-l5-r5-a1-p1',
      paramsId: 'dev10-l5-r5-a1-p1',
      config: mockConfig,
      bars: mockBars,
    });
    const store = setupStore(makeBars(40), [mockDoc]);
    store.setSymbol('AAPL');
    setTimeout(() => {
      store.loadAnalysis('dev10-l5-r5-a1-p1');
      setTimeout(() => {
        expect(store.config().devThreshold).toBe(10);
        expect(store.bars()).toEqual(mockBars);
        expect(store.pivots()).toEqual(mockDoc.pivots);
        expect(store.swings()).toEqual(mockDoc.swings);
        expect(store.stats()).toEqual(mockDoc.stats);
        done();
      }, 50);
    }, 50);
  }, 10000);

  it('does nothing when no symbol is set', () => {
    const store = setupStore();
    expect(() => store.loadAnalysis('some-id')).not.toThrow();
  });
});

// =============================================================================
// paramsId computed — derived from config
// =============================================================================

describe('SwingAnalysisStore.paramsId', () => {
  it('derives paramsId from the current config', () => {
    const store = setupStore();
    expect(store.paramsId()).toBe('dev5-l5-r5-a1-p1');
  });

  it('updates when config changes', () => {
    const store = setupStore();
    store.updateConfig({ devThreshold: 10 });
    expect(store.paramsId()).toBe('dev10-l5-r5-a1-p1');
  });
});

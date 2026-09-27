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
import { provideZonelessChangeDetection, signal } from '@angular/core';
import { of, Subject, throwError } from 'rxjs';

import { SwingAnalysisStore, LARGE_CONFIG, SMALL_CONFIG } from './swing-analysis.store';
import { ChartService } from '../services/chart.service';
import { SwingAnalysisService } from './swing-analysis.service';
import { RelStrDbV2Service } from '../../services/rel-str-db-v2.service';
import { SymbolListStore } from '../stores/symbol-list.store';
import { deriveParamsId } from './swing-analysis.types';
import { BarsInterval } from '../../../core/models/partner.types';
import type { ChartDataset } from '../../heatmap-chart/heatmap-chart.types';
import type { PriceBar } from '../../shared/components/flex-chart/indicators/st-zigzag.engine';
import type { SwingAnalysisInput, SwingConfigDoc } from './swing-analysis.types';

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
  configs: SwingConfigDoc[] = [],
): Partial<SwingAnalysisService> & {
  saveAnalysis: jest.Mock;
  loadConfigs: jest.Mock;
  saveConfig: jest.Mock;
  deleteConfig: jest.Mock;
} {
  return {
    saveAnalysis: jest.fn(() => of(undefined)),
    loadConfigs: jest.fn(() => of(configs)),
    saveConfig: jest.fn(() => of(undefined)),
    deleteConfig: jest.fn(() => of(undefined)),
  };
}

interface StoreSetup {
  store: InstanceType<typeof SwingAnalysisStore>;
  service: ServiceMock;
}

function setupStore(
  bars: PriceBar[] = makeBars(40),
): StoreSetup {
  const service = mockSwingAnalysisService();
  TestBed.configureTestingModule({
    providers: [
      provideZonelessChangeDetection(),
      { provide: ChartService, useValue: mockChartService(bars) },
      { provide: RelStrDbV2Service, useValue: { getTrackedSymbols$: jest.fn(() => of([])) } },
      { provide: SymbolListStore, useValue: { symbolLists: signal<Record<string, string[]>>({}) } },
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
  it('has two configs (large + small) by default', () => {
    const { store } = setupStore();
    expect(store.symbol()).toBe('');
    expect(store.configs()).toEqual([{ ...LARGE_CONFIG }, { ...SMALL_CONFIG }]);
    expect(store.bars()).toEqual([]);
    expect(store.pivots()).toEqual([[], []]);
    expect(store.projections()).toEqual([null, null]);
    expect(store.swings()).toEqual([[], []]);
    expect(store.stats()).toEqual([null, null]);
    expect(store.loading()).toBe(false);
    expect(store.error()).toBeNull();
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
      { provide: RelStrDbV2Service, useValue: { getTrackedSymbols$: jest.fn(() => of([])) } },
      { provide: SymbolListStore, useValue: { symbolLists: signal<Record<string, string[]>>({}) } },
        { provide: SwingAnalysisService, useValue: mockSwingAnalysisService() },
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
      { provide: RelStrDbV2Service, useValue: { getTrackedSymbols$: jest.fn(() => of([])) } },
      { provide: SymbolListStore, useValue: { symbolLists: signal<Record<string, string[]>>({}) } },
        { provide: SwingAnalysisService, useValue: mockSwingAnalysisService() },
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
// activateConfig / removeActiveConfig / cloneConfig — always-N list ops
// =============================================================================

describe('SwingAnalysisStore — config list (always-N)', () => {
  // No dual-mode toggle — configs[] is the truth; the list is unbounded.

  it('activateConfig appends a config and recomputes it from loaded bars', () => {
    const { store } = setupStore(makeBars(40));
    store.setSymbol('AAPL');
    const custom = { ...LARGE_CONFIG, devThreshold: 7 };
    store.activateConfig(custom);
    expect(store.configs().length).toBe(3);
    expect(store.configs()[2]).toEqual(custom);
    expect(store.pivots()[2].length).toBeGreaterThan(0);
    expect(store.swings()[2].length).toBeGreaterThan(0);
    expect(store.stats()[2]).not.toBeNull();
  });

  it('activateConfig produces an aligned empty slot when no bars loaded', () => {
    const { store } = setupStore(); // no setSymbol
    store.activateConfig({ ...LARGE_CONFIG, devThreshold: 7 });
    expect(store.configs().length).toBe(3);
    expect(store.pivots()[2]).toEqual([]);
    expect(store.projections()[2]).toBeNull();
    expect(store.swings()[2]).toEqual([]);
    expect(store.stats()[2]).toBeNull();
  });

  it('activateConfig is unbounded — a fourth config lands fine', () => {
    const { store } = setupStore(makeBars(40));
    store.setSymbol('AAPL');
    store.activateConfig({ ...LARGE_CONFIG, devThreshold: 7 });
    store.activateConfig({ ...LARGE_CONFIG, devThreshold: 20 });
    expect(store.configs().length).toBe(4);
    expect(store.pivots().length).toBe(4);
    expect(store.swings().length).toBe(4);
    expect(store.stats().length).toBe(4);
  });

  it('removeActiveConfig splices a middle slot and keeps survivors aligned', () => {
    const { store } = setupStore(makeBars(40));
    store.setSymbol('AAPL');
    store.activateConfig({ ...LARGE_CONFIG, devThreshold: 7 });
    store.removeActiveConfig(1); // drop SMALL_CONFIG
    expect(store.configs().length).toBe(2);
    expect(store.configs()[1].devThreshold).toBe(7);
    expect(store.pivots().length).toBe(2);
    expect(store.stats().length).toBe(2);
  });

  it('removeActiveConfig(0) works — list can shrink to one then zero configs', () => {
    const { store } = setupStore(makeBars(40));
    store.setSymbol('AAPL');
    store.removeActiveConfig(0);
    expect(store.configs().length).toBe(1);
    expect(store.configs()[0]).toEqual({ ...SMALL_CONFIG });
    store.removeActiveConfig(0);
    expect(store.configs().length).toBe(0);
    expect(store.pivots()).toEqual([]);
    expect(store.stats()).toEqual([]);
  });

  it('removeActiveConfig ignores out-of-range indexes', () => {
    const { store } = setupStore();
    store.removeActiveConfig(5);
    expect(store.configs().length).toBe(2);
  });

  it('cloneConfig appends a deep copy — mutating the clone leaves the original', () => {
    const { store } = setupStore(makeBars(40));
    store.setSymbol('AAPL');
    store.cloneConfig(0);
    expect(store.configs().length).toBe(3);
    expect(store.configs()[2]).toEqual(store.configs()[0]);
    store.updateConfig(2, { devThreshold: 42 });
    expect(store.configs()[0].devThreshold).toBe(LARGE_CONFIG.devThreshold);
  });
});

// =============================================================================
// allStats - combined stats across both configs (dual mode "All" view)
// =============================================================================

describe('SwingAnalysisStore.allStats', () => {
  it('is null with a single config', () => {
    const { store } = setupStore(makeBars(40));
    store.setSymbol('AAPL');
    store.removeActiveConfig(1); // collapse to one config
    expect(store.stats()[0]).not.toBeNull();
    expect(store.allStats()).toBeNull();
  });

  it('is null with multiple configs and no swings', () => {
    const { store } = setupStore(); // no bars — two configs by default
    expect(store.configs().length).toBe(2);
    expect(store.allStats()).toBeNull();
  });

  it('recomputes combined stats across all configs', () => {
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

  it('returns to null when the list collapses to one config', () => {
    const { store } = setupStore(makeBars(40));
    store.setSymbol('AAPL');
    expect(store.allStats()).not.toBeNull();
    store.removeActiveConfig(1);
    expect(store.allStats()).toBeNull();
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
    const service = mockSwingAnalysisService();
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
        { provide: RelStrDbV2Service, useValue: { getTrackedSymbols$: jest.fn(() => of([])) } },
        { provide: SymbolListStore, useValue: { symbolLists: signal<Record<string, string[]>>({}) } },
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
    store.removeActiveConfig(1); // collapse to 1 config
    store.runBatch('AAPL, MSFT');
    expect(service.saveAnalysis).toHaveBeenCalledTimes(2);
    expect(savedSymbols(service)).toEqual(['AAPL', 'MSFT']);
  });

  it('normalizes the symbol list — trims, uppercases, dedupes, splits on comma/space/newline', () => {
    const { store, service } = setupBatch();
    store.removeActiveConfig(1);
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
    store.removeActiveConfig(1);
    store.runBatch('AAPL, MSFT, QQQ');
    const results = store.batchResults();
    expect(results[1].symbol).toBe('MSFT');
    expect(results[1].ok).toBe(false);
    expect(results[2].ok).toBe(true);
    expect(service.saveAnalysis).toHaveBeenCalledTimes(3);
  });

  it('marks a symbol failed when bars come back empty', () => {
    const { store } = setupBatch({ barsBySymbol: { EMPTY: [] } });
    store.removeActiveConfig(1);
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
    store.removeActiveConfig(1);
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
    store.removeActiveConfig(1);
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
// Config library — st-swing-configs (global, symbol-less)
// =============================================================================

describe('SwingAnalysisStore — config library', () => {
  function makeConfigDoc(overrides: Partial<SwingConfigDoc> = {}): SwingConfigDoc {
    return {
      id: deriveParamsId(LARGE_CONFIG),
      paramsId: deriveParamsId(LARGE_CONFIG),
      userId: 'user-123',
      name: 'Big',
      config: { ...LARGE_CONFIG },
      savedAt: '2026-09-26T00:00:00Z',
      ...overrides,
    };
  }

  function setupLibrary(configs: SwingConfigDoc[]) {
    const service = mockSwingAnalysisService( configs);
    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        { provide: ChartService, useValue: mockChartService(makeBars(40)) },
        { provide: RelStrDbV2Service, useValue: { getTrackedSymbols$: jest.fn(() => of([])) } },
        { provide: SymbolListStore, useValue: { symbolLists: signal<Record<string, string[]>>({}) } },
        { provide: SwingAnalysisService, useValue: service },
        SwingAnalysisStore,
      ],
    });
    return { store: TestBed.inject(SwingAnalysisStore), service };
  }

  it('loadConfigLibrary patches configLibrary and clears loading', () => {
    const cfgs = [makeConfigDoc({ id: 'c1', name: 'One' }), makeConfigDoc({ id: 'c2', name: 'Two' })];
    const { store, service } = setupLibrary(cfgs);
    store.loadConfigLibrary();
    expect(service.loadConfigs).toHaveBeenCalled();
    expect(store.configLibrary()).toEqual(cfgs);
    expect(store.configLibraryLoading()).toBe(false);
  });

  it('a loadConfigs error sets error and clears loading', () => {
    const { store, service } = setupLibrary([]);
    service.loadConfigs.mockReturnValue(throwError(() => new Error('rules deny')));
    store.loadConfigLibrary();
    expect(store.configLibrary()).toEqual([]);
    expect(store.configLibraryLoading()).toBe(false);
    expect(store.error()).toContain('rules deny');
  });

  it('saveActiveConfig writes the slim doc and upserts the library entry', () => {
    const { store, service } = setupStore();
    store.setSymbol('AAPL');
    store.saveActiveConfig(0, 'My preset');
    expect(service.saveConfig).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'My preset', config: store.configs()[0] }),
    );
    // Slim shape — no snapshot fields escape into the config library.
    const arg = service.saveConfig.mock.calls[0][0] as Record<string, unknown>;
    for (const banned of ['symbol', 'pivots', 'swings', 'stats', 'projection']) {
      expect(arg).not.toHaveProperty(banned);
    }
    expect(store.configLibrary().some((c) => c.paramsId === deriveParamsId(LARGE_CONFIG))).toBe(true);
  });

  it('saveActiveConfig re-saves overwrite in place — no duplicate paramsId rows', () => {
    const { store } = setupStore();
    store.saveActiveConfig(0, 'v1');
    store.saveActiveConfig(0, 'v2');
    const ids = store.configLibrary().map((c) => c.paramsId);
    expect(ids.filter((id) => id === deriveParamsId(LARGE_CONFIG)).length).toBe(1);
    expect(store.configLibrary().find((c) => c.paramsId === deriveParamsId(LARGE_CONFIG))!.name).toBe('v2');
  });

  it('saveActiveConfig ignores out-of-range indexes', () => {
    const { store, service } = setupStore();
    store.saveActiveConfig(9, 'x');
    expect(service.saveConfig).not.toHaveBeenCalled();
  });

  it('saveActiveConfig service error sets error', () => {
    const { store, service } = setupStore();
    service.saveConfig.mockReturnValue(throwError(() => new Error('denied')));
    store.saveActiveConfig(0, 'x');
    expect(store.error()).toContain('denied');
  });

  it('deleteSavedConfig calls the service and drops the library row', () => {
    const pid = deriveParamsId(LARGE_CONFIG);
    const { store, service } = setupLibrary([
      makeConfigDoc({ id: pid, paramsId: pid }),
      makeConfigDoc({ id: 'other', paramsId: 'other' }),
    ]);
    store.loadConfigLibrary();
    store.deleteSavedConfig(pid);
    expect(service.deleteConfig).toHaveBeenCalledWith(pid);
    expect(store.configLibrary().map((c) => c.paramsId)).toEqual(['other']);
  });

  it('deleteSavedConfig leaves the library untouched on service error', () => {
    const pid = deriveParamsId(LARGE_CONFIG);
    const { store, service } = setupLibrary([makeConfigDoc({ id: pid, paramsId: pid })]);
    store.loadConfigLibrary();
    service.deleteConfig.mockReturnValue(throwError(() => new Error('nope')));
    store.deleteSavedConfig(pid);
    expect(store.configLibrary().length).toBe(1);
    expect(store.error()).toContain('nope');
  });

  it('a save during an in-flight library load is not clobbered — the load refires post-write', () => {
    const { store, service } = setupLibrary([]);
    store.setSymbol('AAPL');
    const stale = new Subject<SwingConfigDoc[]>();
    const fresh = new Subject<SwingConfigDoc[]>();
    service.loadConfigs
      .mockReturnValueOnce(stale.asObservable())
      .mockReturnValueOnce(fresh.asObservable());
    store.loadConfigLibrary(); // in-flight on `stale`
    store.saveActiveConfig(0, 'Wide');
    // Optimistic row present + the stale load canceled + refired.
    expect(service.loadConfigs).toHaveBeenCalledTimes(2);
    const pid = deriveParamsId(LARGE_CONFIG);
    stale.next([]); // pre-write snapshot — must not clobber
    expect(store.configLibrary().some((c) => c.paramsId === pid)).toBe(true);
    const authoritative = makeConfigDoc({ id: pid, paramsId: pid, name: 'Wide' });
    fresh.next([authoritative]);
    expect(store.configLibrary()).toEqual([authoritative]);
  });

  it('a delete during an in-flight library load does not resurrect — the load refires post-write', () => {
    const pid = deriveParamsId(LARGE_CONFIG);
    const doc = makeConfigDoc({ id: pid, paramsId: pid });
    const { store, service } = setupLibrary([doc]);
    const stale = new Subject<SwingConfigDoc[]>();
    const fresh = new Subject<SwingConfigDoc[]>();
    service.loadConfigs
      .mockReturnValueOnce(stale.asObservable())
      .mockReturnValueOnce(fresh.asObservable());
    store.loadConfigLibrary();
    store.deleteSavedConfig(pid);
    expect(service.loadConfigs).toHaveBeenCalledTimes(2);
    stale.next([doc]); // pre-delete snapshot — must not resurrect
    expect(store.configLibrary()).toEqual([]);
    fresh.next([]);
    expect(store.configLibrary()).toEqual([]);
  });
});
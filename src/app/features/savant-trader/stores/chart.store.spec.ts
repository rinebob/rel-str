import { TestBed } from '@angular/core/testing';
import { EnvironmentInjector, effect, runInInjectionContext, signal } from '@angular/core';
import { Subject, of, throwError } from 'rxjs';

import {
  ChartStore,
  DEFAULT_CHART_INDICATORS,
  DEFAULT_CHART_INTERVALS,
  DEFAULT_CHART_STRATEGIES,
} from './chart.store';
import { ChartService } from '../services/chart.service';
import { RhChartService } from '../services/rh-chart.service';
import { IndicatorSeriesStore } from './indicator-series.store';
import { SymbolListStore } from './symbol-list.store';

function barsResult() {
  return {
    version: 'v1',
    daily: { bars: [] },
    weekly: { bars: [] },
    monthly: { bars: [] },
  };
}

function rhResult() {
  return {
    version: '',
    daily: { bars: [{ date: '2026-10-27' }] },
    weekly: { bars: [{ date: '2026-10-26' }] },
    monthly: { bars: [{ date: '2026-10-01' }] },
  };
}

describe('ChartStore', () => {
  let store: InstanceType<typeof ChartStore>;
  let chartServiceMock: { loadBars$: jest.Mock };
  let rhChartServiceMock: { loadBars$: jest.Mock };
  let indicatorStoreMock: { loadIfNeeded: jest.Mock };
  let symbolListStoreMock: { trackedSymbols: jest.Mock; trackedStatus: jest.Mock };

  beforeEach(() => {
    chartServiceMock = { loadBars$: jest.fn() };
    rhChartServiceMock = { loadBars$: jest.fn() };
    indicatorStoreMock = { loadIfNeeded: jest.fn() };
    symbolListStoreMock = {
      trackedSymbols: jest.fn().mockReturnValue(['AAA', 'BBB']),
      trackedStatus: jest.fn().mockReturnValue('ready'),
    };
    TestBed.configureTestingModule({
      providers: [
        { provide: ChartService, useValue: chartServiceMock },
        { provide: RhChartService, useValue: rhChartServiceMock },
        { provide: IndicatorSeriesStore, useValue: indicatorStoreMock },
        { provide: SymbolListStore, useValue: symbolListStoreMock },
      ],
    });
    store = TestBed.inject(ChartStore);
  });

  it('cancels the in-flight request when a new symbol loads (rapid nav)', () => {
    const first = new Subject<ReturnType<typeof barsResult>>();
    chartServiceMock.loadBars$
      .mockReturnValueOnce(first.asObservable())
      .mockReturnValueOnce(of(barsResult()));

    store.loadCharts('AAA');
    expect(first.observed).toBe(true);

    store.loadCharts('BBB');

    expect(first.observed).toBe(false); // first request torn down
    expect(store.selectedSymbol()).toBe('BBB');
  });

  it('ignores a stale response that emits after cancellation', () => {
    const first = new Subject<ReturnType<typeof barsResult>>();
    chartServiceMock.loadBars$
      .mockReturnValueOnce(first.asObservable())
      .mockReturnValueOnce(of(barsResult()));

    store.loadCharts('AAA');
    store.loadCharts('BBB');
    first.next(barsResult()); // late emit — must not overwrite BBB

    expect(store.selectedSymbol()).toBe('BBB');
    expect(store.symbolDataVersion()).toBe('v1');
  });

  it('blanks symbolDataVersion while a new symbol loads (no stale-key lookups)', () => {
    // Consumers key indicator responses by symbolDataVersion — while B's bars
    // are in flight the version must not still name A, or a response keyed
    // 'B|vA' can inject onto A's chart and a dead cache entry is burned.
    chartServiceMock.loadBars$.mockReturnValueOnce(of(barsResult()));
    store.loadCharts('AAA');
    expect(store.symbolDataVersion()).toBe('v1');

    const pending = new Subject<ReturnType<typeof barsResult>>();
    chartServiceMock.loadBars$.mockReturnValueOnce(pending.asObservable());
    store.loadCharts('BBB');

    expect(store.symbolDataVersion()).toBe('');

    pending.next({ ...barsResult(), version: 'v2' });
    expect(store.symbolDataVersion()).toBe('v2');
  });

  it('clearCharts cancels an in-flight request', () => {
    const pending = new Subject<ReturnType<typeof barsResult>>();
    chartServiceMock.loadBars$.mockReturnValue(pending.asObservable());

    store.loadCharts('AAA');
    store.clearCharts();

    expect(pending.observed).toBe(false);
    expect(store.loading()).toBe(false);
    expect(store.dailyData()).toBeNull();
  });

  // ===========================================================================
  // Untracked fork (#1259 — ephemeral RH charts)
  // ===========================================================================

  describe('untracked fork', () => {
    it('untracked symbol → RH path; symbol-data never called, indicators never load', () => {
      symbolListStoreMock.trackedSymbols.mockReturnValue(['AAA']); // NEW is untracked
      rhChartServiceMock.loadBars$.mockReturnValue(of(rhResult()));

      store.loadCharts('NEW');

      expect(rhChartServiceMock.loadBars$).toHaveBeenCalledWith('NEW');
      expect(chartServiceMock.loadBars$).not.toHaveBeenCalled();
      expect(store.dailyData()).toEqual(rhResult().daily);
      expect(store.symbolDataVersion()).toBe('');
      expect(indicatorStoreMock.loadIfNeeded).not.toHaveBeenCalled();
    });

    it('tracked symbol with empty symbol-data (version "") falls back to RH', () => {
      chartServiceMock.loadBars$.mockReturnValue(of({ version: '', daily: { bars: [] }, weekly: { bars: [] }, monthly: { bars: [] } }));
      rhChartServiceMock.loadBars$.mockReturnValue(of(rhResult()));

      store.loadCharts('AAA');

      expect(chartServiceMock.loadBars$).toHaveBeenCalledWith('AAA');
      expect(rhChartServiceMock.loadBars$).toHaveBeenCalledWith('AAA');
      expect(store.dailyData()).toEqual(rhResult().daily);
      expect(indicatorStoreMock.loadIfNeeded).not.toHaveBeenCalled();
    });

    it('tracked symbol with real bars stays on the symbol-data path — no RH call', () => {
      chartServiceMock.loadBars$.mockReturnValue(of(barsResult()));

      store.loadCharts('AAA');

      expect(rhChartServiceMock.loadBars$).not.toHaveBeenCalled();
      expect(store.symbolDataVersion()).toBe('v1');
      expect(indicatorStoreMock.loadIfNeeded).toHaveBeenCalledWith(
        'AAA', 'v1', DEFAULT_CHART_INTERVALS, DEFAULT_CHART_INDICATORS, DEFAULT_CHART_STRATEGIES,
      );
    });

    it('normalizes the symbol before membership + service calls', () => {
      chartServiceMock.loadBars$.mockReturnValue(of(barsResult()));

      store.loadCharts(' aaa ');

      expect(chartServiceMock.loadBars$).toHaveBeenCalledWith('AAA');
      expect(store.selectedSymbol()).toBe('AAA');
      expect(indicatorStoreMock.loadIfNeeded).toHaveBeenCalledWith(
        'AAA', 'v1', expect.anything(), expect.anything(), expect.anything(),
      );
    });

    it('whitespace-only symbol is rejected before any service call fires', () => {
      store.loadCharts('   ');

      expect(chartServiceMock.loadBars$).not.toHaveBeenCalled();
      expect(rhChartServiceMock.loadBars$).not.toHaveBeenCalled();
      expect(store.selectedSymbol()).toBeNull();
      expect(store.loading()).toBe(false);
    });

    it('universe resolving mid-flight does NOT re-fire a host-effect loadCharts', () => {
      // SignalDetailComponent calls loadCharts inside effect(). If the
      // trackedStatus/trackedSymbols reads were tracked deps, the universe
      // resolving would re-run the effect → cancel + refire (possibly on
      // the other arm). untracked() keeps the fork point-in-time.
      const status = signal<'idle' | 'loading' | 'ready' | 'error'>('loading');
      const symbols = signal<string[]>([]);
      symbolListStoreMock.trackedStatus.mockImplementation(() => status());
      symbolListStoreMock.trackedSymbols.mockImplementation(() => symbols());

      const pending = new Subject<ReturnType<typeof barsResult>>();
      chartServiceMock.loadBars$.mockReturnValue(pending.asObservable());

      const injector = TestBed.inject(EnvironmentInjector);
      let runs = 0;
      runInInjectionContext(injector, () => {
        effect(() => {
          runs++;
          store.loadCharts('AAA');
        });
      });
      TestBed.tick();
      expect(runs).toBe(1);
      expect(pending.observed).toBe(true);

      // Universe resolves — must NOT re-fire the effect / cancel the load.
      status.set('ready');
      symbols.set(['AAA']);
      TestBed.tick();

      expect(runs).toBe(1);
      expect(pending.observed).toBe(true);
    });

    it('RH errors surface as store error state, not silent blanks', () => {
      symbolListStoreMock.trackedSymbols.mockReturnValue(['AAA']); // NEW is untracked
      rhChartServiceMock.loadBars$.mockReturnValue(throwError(() => new Error('mcp down')));

      store.loadCharts('NEW');

      expect(store.loading()).toBe(false);
      expect(store.error()).toBe('mcp down');
      expect(store.dailyData()).toBeNull();
    });

    it('universe not ready (list not loaded) takes symbol-data first, RH on empty', () => {
      // Pages that never call loadTrackedSymbols (QuickCharts, galleries)
      // must keep pre-fork behavior: symbol-data first, RH fallback.
      symbolListStoreMock.trackedStatus.mockReturnValue('loading');
      chartServiceMock.loadBars$.mockReturnValue(of({ version: '', daily: { bars: [] }, weekly: { bars: [] }, monthly: { bars: [] } }));
      rhChartServiceMock.loadBars$.mockReturnValue(of(rhResult()));

      store.loadCharts('ANY');

      expect(chartServiceMock.loadBars$).toHaveBeenCalledWith('ANY');
      expect(rhChartServiceMock.loadBars$).toHaveBeenCalledWith('ANY');
      expect(store.dailyData()).toEqual(rhResult().daily);
    });

    it('second loadCharts cancels an in-flight RH FALLBACK (switchMap inner)', () => {
      // Tracked symbol whose symbol-data resolves empty → RH fallback in
      // flight; the next selection must tear it down like any other arm.
      const rhPending = new Subject<ReturnType<typeof rhResult>>();
      chartServiceMock.loadBars$.mockReturnValue(of({ version: '', daily: { bars: [] }, weekly: { bars: [] }, monthly: { bars: [] } }));
      rhChartServiceMock.loadBars$
        .mockReturnValueOnce(rhPending.asObservable())
        .mockReturnValueOnce(of(rhResult()));

      store.loadCharts('AAA');
      expect(rhPending.observed).toBe(true); // fallback subscribed

      store.loadCharts('BBB');
      expect(rhPending.observed).toBe(false);
      expect(store.selectedSymbol()).toBe('BBB');
    });

    it('rapid switching cancels an in-flight RH load', () => {
      symbolListStoreMock.trackedSymbols.mockReturnValue(['AAA']); // NEW/NEW2 untracked
      const first = new Subject<ReturnType<typeof rhResult>>();
      rhChartServiceMock.loadBars$
        .mockReturnValueOnce(first.asObservable())
        .mockReturnValueOnce(of(rhResult()));

      store.loadCharts('NEW');
      expect(first.observed).toBe(true);

      store.loadCharts('NEW2');
      expect(first.observed).toBe(false);
      expect(store.selectedSymbol()).toBe('NEW2');
    });
  });
});

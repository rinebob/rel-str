import { TestBed } from '@angular/core/testing';
import { Subject, of } from 'rxjs';

import { ChartStore } from './chart.store';
import { ChartService } from '../services/chart.service';
import { IndicatorSeriesStore } from './indicator-series.store';

function barsResult() {
  return {
    version: 'v1',
    daily: { bars: [] },
    weekly: { bars: [] },
    monthly: { bars: [] },
  };
}

describe('ChartStore', () => {
  let store: InstanceType<typeof ChartStore>;
  let chartServiceMock: { loadBars$: jest.Mock };
  let indicatorStoreMock: { loadIfNeeded: jest.Mock };

  beforeEach(() => {
    chartServiceMock = { loadBars$: jest.fn() };
    indicatorStoreMock = { loadIfNeeded: jest.fn() };
    TestBed.configureTestingModule({
      providers: [
        { provide: ChartService, useValue: chartServiceMock },
        { provide: IndicatorSeriesStore, useValue: indicatorStoreMock },
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
});

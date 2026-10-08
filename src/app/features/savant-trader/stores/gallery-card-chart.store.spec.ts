import { TestBed } from '@angular/core/testing';
import { of, Subject, throwError } from 'rxjs';

import { GalleryCardChartStore } from './gallery-card-chart.store';
import { IndicatorSeriesStore } from './indicator-series.store';
import { LocalBarReadService, type OhlcBar } from '../../../core/services/local-bar-read.service';
import {
  DEFAULT_CHART_INDICATORS,
  DEFAULT_CHART_INTERVALS,
  DEFAULT_CHART_STRATEGIES,
} from './chart.store';

const flush = () => new Promise<void>((r) => setTimeout(r, 0));

const bar = (d: string, c: number): OhlcBar => ({ d, o: c - 1, h: c + 1, l: c - 2, c });

describe('GalleryCardChartStore', () => {
  let barRead: {
    getRecentDailyBars$: jest.Mock;
    getSymbolDataVersion$: jest.Mock;
    getWeeklyBars$: jest.Mock;
  };
  let indicatorStore: { loadIfNeeded: jest.Mock };

  function setup(): InstanceType<typeof GalleryCardChartStore> {
    TestBed.configureTestingModule({
      providers: [
        { provide: LocalBarReadService, useValue: barRead },
        { provide: IndicatorSeriesStore, useValue: indicatorStore },
      ],
    });
    return TestBed.inject(GalleryCardChartStore);
  }

  beforeEach(() => {
    barRead = {
      getRecentDailyBars$: jest.fn().mockReturnValue(of([bar('2026-09-01', 100), bar('2026-09-02', 101)])),
      getSymbolDataVersion$: jest.fn().mockReturnValue(of('2026-09-02')),
      getWeeklyBars$: jest.fn().mockReturnValue(of([bar('2026-08-28', 98), bar('2026-09-04', 102)])),
    };
    indicatorStore = { loadIfNeeded: jest.fn() };
  });

  it('ensureBars fetches recent daily bars and caches them as PriceBars', async () => {
    const store = setup();
    store.ensureBars('aapl');
    await flush();

    expect(barRead.getRecentDailyBars$).toHaveBeenCalledTimes(1);
    const bars = store.barsFor()('AAPL');
    expect(bars).toHaveLength(2);
    expect(bars?.[0]).toMatchObject({ date: '2026-09-01', close: 100, open: 99 });
    expect(bars?.[0].x).toBeInstanceOf(Date);
  });

  it('dedupes concurrent ensureBars calls for the same symbol', async () => {
    const store = setup();
    store.ensureBars('AAPL');
    store.ensureBars('AAPL');
    await flush();

    expect(barRead.getRecentDailyBars$).toHaveBeenCalledTimes(1);
  });

  it('is a no-op once a symbol is cached', async () => {
    const store = setup();
    store.ensureBars('AAPL');
    await flush();
    store.ensureBars('AAPL');

    expect(barRead.getRecentDailyBars$).toHaveBeenCalledTimes(1);
  });

  it('prefetch warms each unique symbol once', async () => {
    const store = setup();
    store.prefetch(['AAPL', 'aapl', 'MSFT']);
    await flush();

    expect(barRead.getRecentDailyBars$).toHaveBeenCalledTimes(2);
    expect(store.barsFor()('AAPL')).toHaveLength(2);
    expect(store.barsFor()('MSFT')).toHaveLength(2);
  });

  it('returns undefined before load and a null error', () => {
    const store = setup();
    expect(store.barsFor()('AAPL')).toBeUndefined();
    expect(store.versionFor()('AAPL')).toBe('');
    expect(store.errorFor()('AAPL')).toBeNull();
  });

  it('treats an empty/errored read as loaded-but-empty (card shows unavailable)', async () => {
    barRead.getRecentDailyBars$.mockReturnValue(of([]));
    const store = setup();
    store.ensureBars('AAPL');
    await flush();

    expect(store.barsFor()('AAPL')).toEqual([]);
  });

  it('warms the indicator cache with the symbol-data version and default filters', async () => {
    const store = setup();
    store.ensureBars('AAPL');
    await flush();

    expect(store.versionFor()('AAPL')).toBe('2026-09-02');
    expect(indicatorStore.loadIfNeeded).toHaveBeenCalledWith(
      'AAPL',
      '2026-09-02',
      DEFAULT_CHART_INTERVALS,
      DEFAULT_CHART_INDICATORS,
      DEFAULT_CHART_STRATEGIES,
    );
  });

  it('falls back to the last bar date when the root doc has no version', async () => {
    barRead.getSymbolDataVersion$.mockReturnValue(of(''));
    const store = setup();
    store.ensureBars('AAPL');
    await flush();

    expect(store.versionFor()('AAPL')).toBe('2026-09-02');
    expect(indicatorStore.loadIfNeeded).toHaveBeenCalledWith(
      'AAPL',
      '2026-09-02',
      DEFAULT_CHART_INTERVALS,
      DEFAULT_CHART_INDICATORS,
      DEFAULT_CHART_STRATEGIES,
    );
  });

  it('skips the indicator warm when no version can be derived', async () => {
    barRead.getRecentDailyBars$.mockReturnValue(of([]));
    barRead.getSymbolDataVersion$.mockReturnValue(of(''));
    const store = setup();
    store.ensureBars('AAPL');
    await flush();

    expect(store.versionFor()('AAPL')).toBe('');
    expect(indicatorStore.loadIfNeeded).not.toHaveBeenCalled();
  });

  it('does not retry a failed symbol — errors settle as unavailable', async () => {
    barRead.getRecentDailyBars$.mockReturnValue(throwError(() => new Error('boom')));
    const store = setup();
    store.ensureBars('AAPL');
    await flush();

    expect(store.errorFor()('AAPL')).toBe('boom');
    store.ensureBars('AAPL');
    await flush();
    expect(barRead.getRecentDailyBars$).toHaveBeenCalledTimes(1);
  });

  it('ensureWeeklyBars fetches weekly bars lazily and caches them', async () => {
    const store = setup();
    expect(store.weeklyBarsFor()('AAPL')).toBeUndefined();

    store.ensureWeeklyBars('aapl');
    await flush();

    expect(barRead.getWeeklyBars$).toHaveBeenCalledTimes(1);
    const bars = store.weeklyBarsFor()('AAPL');
    expect(bars).toHaveLength(2);
    expect(bars?.[0]).toMatchObject({ date: '2026-08-28', close: 98 });
    // Weekly fetch is standalone — no indicator warm fires from it.
    expect(indicatorStore.loadIfNeeded).not.toHaveBeenCalled();
  });

  it('dedupes and skips ensureWeeklyBars for cached or errored symbols', async () => {
    const store = setup();
    store.ensureWeeklyBars('AAPL');
    store.ensureWeeklyBars('AAPL');
    await flush();
    expect(barRead.getWeeklyBars$).toHaveBeenCalledTimes(1);

    store.ensureWeeklyBars('AAPL');
    expect(barRead.getWeeklyBars$).toHaveBeenCalledTimes(1);
  });

  it('clearCache evicts weekly bars too', async () => {
    const store = setup();
    store.ensureWeeklyBars('AAPL');
    await flush();
    expect(store.weeklyBarsFor()('AAPL')).toHaveLength(2);

    store.clearCache();
    expect(store.weeklyBarsFor()('AAPL')).toBeUndefined();

    store.ensureWeeklyBars('AAPL');
    await flush();
    expect(barRead.getWeeklyBars$).toHaveBeenCalledTimes(2);
  });

  it('clearCache evicts a symbol so it can be refetched', async () => {
    const store = setup();
    store.ensureBars('AAPL');
    await flush();
    expect(store.barsFor()('AAPL')).toHaveLength(2);

    store.clearCache();
    expect(store.barsFor()('AAPL')).toBeUndefined();
    expect(store.versionFor()('AAPL')).toBe('');

    store.ensureBars('AAPL');
    await flush();
    expect(barRead.getRecentDailyBars$).toHaveBeenCalledTimes(2);
  });

  it('clearCache() with no symbol resets the whole cache', async () => {
    const store = setup();
    store.prefetch(['AAPL', 'MSFT']);
    await flush();

    store.clearCache();
    expect(store.barsFor()('AAPL')).toBeUndefined();
    expect(store.barsFor()('MSFT')).toBeUndefined();
  });

  // #819 review — daily/weekly error slots are separate so a failed
  // interval can't poison or block the other.

  it('a daily-load error does not block the weekly fetch', async () => {
    barRead.getRecentDailyBars$.mockReturnValue(throwError(() => new Error('boom')));
    const store = setup();
    store.ensureBars('AAPL');
    await flush();
    expect(store.errorFor()('AAPL')).toBe('boom');

    store.ensureWeeklyBars('AAPL');
    await flush();
    expect(barRead.getWeeklyBars$).toHaveBeenCalledTimes(1);
    expect(store.weeklyBarsFor()('AAPL')).toHaveLength(2);
    expect(store.weeklyErrorFor()('AAPL')).toBeNull();
  });

  it('a weekly-load error leaves the daily entry healthy', async () => {
    barRead.getWeeklyBars$.mockReturnValue(throwError(() => new Error('weekly boom')));
    const store = setup();
    store.ensureBars('AAPL');
    store.ensureWeeklyBars('AAPL');
    await flush();

    expect(store.barsFor()('AAPL')).toHaveLength(2);
    expect(store.errorFor()('AAPL')).toBeNull();
    expect(store.weeklyErrorFor()('AAPL')).toBe('weekly boom');

    // Errored weekly settles as unavailable — no re-fetch per call.
    store.ensureWeeklyBars('AAPL');
    expect(barRead.getWeeklyBars$).toHaveBeenCalledTimes(1);
  });

  it('clearCache resets a weekly error so the symbol can retry', async () => {
    barRead.getWeeklyBars$.mockReturnValueOnce(throwError(() => new Error('weekly boom')));
    const store = setup();
    store.ensureWeeklyBars('AAPL');
    await flush();
    expect(store.weeklyErrorFor()('AAPL')).toBe('weekly boom');

    store.clearCache();
    expect(store.weeklyErrorFor()('AAPL')).toBeNull();

    store.ensureWeeklyBars('AAPL');
    await flush();
    expect(store.weeklyBarsFor()('AAPL')).toHaveLength(2);
  });

  // #819 r2 — epoch guards: a clearCache mid-flight must drop the old
  // request's landing write, otherwise stale pre-refresh bars resurrect
  // session-permanently.

  it('clearCache bumps the epoch so pre-clear writes are dropped (daily)', async () => {
    const pending = new Subject<OhlcBar[]>();
    barRead.getRecentDailyBars$.mockReturnValue(pending.asObservable());
    const store = setup();
    store.ensureBars('AAPL');
    const before = store.epoch();

    store.clearCache();
    expect(store.epoch()).toBe(before + 1);

    // The pre-clear request lands late — its write must be ignored.
    pending.next([bar('2026-09-01', 100)]);
    await flush();
    expect(store.barsFor()('AAPL')).toBeUndefined();
    expect(store.loading()['AAPL']).toBeUndefined();
  });

  it('a request started post-clear still lands — epoch guards are not a blanket drop', async () => {
    const first = new Subject<OhlcBar[]>();
    barRead.getRecentDailyBars$
      .mockReturnValueOnce(first.asObservable())
      .mockReturnValue(of([bar('2026-09-03', 110)]));
    const store = setup();
    store.ensureBars('AAPL');
    store.clearCache();

    store.ensureBars('AAPL'); // new-epoch request
    first.next([bar('2026-09-01', 100)]); // old-epoch write lands first
    await flush();

    const bars = store.barsFor()('AAPL');
    expect(bars).toHaveLength(1);
    expect(bars?.[0].date).toBe('2026-09-03'); // new-epoch bars, not the stale write
  });

  it('clearCache drops an in-flight weekly write too', async () => {
    const pending = new Subject<OhlcBar[]>();
    barRead.getWeeklyBars$.mockReturnValue(pending.asObservable());
    const store = setup();
    store.ensureWeeklyBars('AAPL');

    store.clearCache();
    pending.next([bar('2026-08-28', 98)]);
    await flush();
    expect(store.weeklyBarsFor()('AAPL')).toBeUndefined();
  });
});

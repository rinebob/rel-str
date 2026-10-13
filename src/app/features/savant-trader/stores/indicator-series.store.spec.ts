import { TestBed } from '@angular/core/testing';
import { Functions } from '@angular/fire/functions';

jest.mock('@angular/fire/functions', () => ({
  Functions: class {},
  httpsCallable: jest.fn(),
}));

import { httpsCallable } from '@angular/fire/functions';
import { IndicatorSeriesStore } from './indicator-series.store';
import {
  DEFAULT_CHART_INDICATORS,
  DEFAULT_CHART_INTERVALS,
  DEFAULT_CHART_STRATEGIES,
  TRIGGER_BANDS_CHART_INDICATORS,
  TRIGGER_BANDS_CHART_INTERVALS,
  TRIGGER_BANDS_CHART_STRATEGIES,
} from './chart.store';
import {
  IndicatorFamily,
  type GetIndicatorSeriesRequest,
  type SymbolIndicatorSeriesResponse,
} from '../common/indicator.types';

const flush = () => new Promise<void>((r) => setTimeout(r, 0));

const defaultResponse = {
  symbol: 'QQQ',
  marketDate: '2026-01-10',
  computedAt: 't',
  intervals: { daily: { indicators: { zoneV1: [] }, signals: {} } },
} as SymbolIndicatorSeriesResponse;

const tbResponse = {
  symbol: 'QQQ',
  marketDate: '2026-01-10',
  computedAt: 't',
  intervals: { daily: { indicators: { triggerBands: [] }, signals: {} } },
} as SymbolIndicatorSeriesResponse;

// The default indicator response and the opt-in Trigger Bands response must
// coexist under distinct cache keys — the lean request must never overwrite,
// invalidate, or replace the default entry (#932).
describe('IndicatorSeriesStore — cache keying (#932)', () => {
  let store: InstanceType<typeof IndicatorSeriesStore>;
  let callable: jest.Mock;

  beforeEach(() => {
    (httpsCallable as jest.Mock).mockReset();
    callable = jest.fn(async (req: GetIndicatorSeriesRequest) => ({
      data: req.indicators?.includes(IndicatorFamily.TRIGGER_BANDS) ? tbResponse : defaultResponse,
    }));
    (httpsCallable as jest.Mock).mockReturnValue(callable);
    TestBed.configureTestingModule({
      providers: [{ provide: Functions, useValue: {} }],
    });
    store = TestBed.inject(IndicatorSeriesStore);
  });

  const defaultLookup = (version = 'v1') =>
    store.responseFor()('QQQ', version, DEFAULT_CHART_INTERVALS, DEFAULT_CHART_INDICATORS, DEFAULT_CHART_STRATEGIES);
  const tbLookup = (version = 'v1') =>
    store.responseFor()('QQQ', version, TRIGGER_BANDS_CHART_INTERVALS, TRIGGER_BANDS_CHART_INDICATORS, TRIGGER_BANDS_CHART_STRATEGIES);

  it('caches the default and lean TB responses under separate keys — both readable', async () => {
    store.loadIfNeeded('QQQ', 'v1', DEFAULT_CHART_INTERVALS, DEFAULT_CHART_INDICATORS, DEFAULT_CHART_STRATEGIES);
    store.loadIfNeeded('QQQ', 'v1', TRIGGER_BANDS_CHART_INTERVALS, TRIGGER_BANDS_CHART_INDICATORS, TRIGGER_BANDS_CHART_STRATEGIES);
    await flush();

    expect(callable).toHaveBeenCalledTimes(2);
    expect(defaultLookup()).toBe(defaultResponse);
    expect(tbLookup()).toBe(tbResponse);
  });

  it('does not refetch an already-cached filter set', async () => {
    store.loadIfNeeded('QQQ', 'v1', TRIGGER_BANDS_CHART_INTERVALS, TRIGGER_BANDS_CHART_INDICATORS, TRIGGER_BANDS_CHART_STRATEGIES);
    await flush();
    store.loadIfNeeded('QQQ', 'v1', TRIGGER_BANDS_CHART_INTERVALS, TRIGGER_BANDS_CHART_INDICATORS, TRIGGER_BANDS_CHART_STRATEGIES);
    await flush();
    expect(callable).toHaveBeenCalledTimes(1);
  });

  it('enabling TB later leaves the cached default response untouched', async () => {
    store.loadIfNeeded('QQQ', 'v1', DEFAULT_CHART_INTERVALS, DEFAULT_CHART_INDICATORS, DEFAULT_CHART_STRATEGIES);
    await flush();
    store.loadIfNeeded('QQQ', 'v1', TRIGGER_BANDS_CHART_INTERVALS, TRIGGER_BANDS_CHART_INDICATORS, TRIGGER_BANDS_CHART_STRATEGIES);
    await flush();

    expect(defaultLookup()).toBe(defaultResponse);
    expect(callable).toHaveBeenCalledTimes(2);
  });

  it('a new bars version misses both keys and refetches', async () => {
    store.loadIfNeeded('QQQ', 'v1', DEFAULT_CHART_INTERVALS, DEFAULT_CHART_INDICATORS, DEFAULT_CHART_STRATEGIES);
    await flush();
    store.loadIfNeeded('QQQ', 'v2', DEFAULT_CHART_INTERVALS, DEFAULT_CHART_INDICATORS, DEFAULT_CHART_STRATEGIES);
    await flush();
    expect(callable).toHaveBeenCalledTimes(2);
    expect(defaultLookup('v1')).toBe(defaultResponse);
    // v2 resolves to the same callable return here, but under its own key —
    // callable was invoked for it.
    expect(defaultLookup('v2')).toBe(defaultResponse);
  });

  it('clearCache(symbol) removes that symbol’s entries — both default and TB', async () => {
    store.loadIfNeeded('QQQ', 'v1', DEFAULT_CHART_INTERVALS, DEFAULT_CHART_INDICATORS, DEFAULT_CHART_STRATEGIES);
    store.loadIfNeeded('QQQ', 'v1', TRIGGER_BANDS_CHART_INTERVALS, TRIGGER_BANDS_CHART_INDICATORS, TRIGGER_BANDS_CHART_STRATEGIES);
    await flush();
    expect(defaultLookup()).toBe(defaultResponse);

    store.clearCache('QQQ');
    expect(defaultLookup()).toBeUndefined();
    expect(tbLookup()).toBeUndefined();
  });
});

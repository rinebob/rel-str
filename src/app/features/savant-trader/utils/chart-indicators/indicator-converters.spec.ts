import { injectCallableIndicatorData } from './indicator-converters';
import type { IndicatorConfig, PriceBar } from '../../../shared/components/flex-chart/flex-chart.types';
import { StIndicator } from '../../../shared/components/flex-chart/flex-chart.types';
import type { IntervalData } from '../../common/indicator.types';
import { toDatePt } from '../../utils/utils';

function bar(d: string): PriceBar {
  return { date: d, x: toDatePt(d), open: 1, high: 1, low: 1, close: 1, volume: 0 };
}

function zoneCfg(): IndicatorConfig {
  return { id: 'z1', type: StIndicator.ZONE, pane: 'lower-2', options: {}, params: {}, seriesType: 'scatter' } as IndicatorConfig;
}

describe('injectCallableIndicatorData staleness warning', () => {
  let warnSpy: jest.SpyInstance;

  beforeEach(() => {
    warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  });
  afterEach(() => warnSpy.mockRestore());

  it('warns with the bar-count lag when callable data ends before the last bar', () => {
    const bars = [bar('2026-01-01'), bar('2026-01-02'), bar('2026-01-03'), bar('2026-01-04')];
    const intervalData = {
      indicators: { zoneV1: [{ d: '2026-01-01', zone: 2 }] },
      signals: {},
    } as IntervalData;

    injectCallableIndicatorData([zoneCfg()], intervalData, bars, 'daily');

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('zoneV1 ends 2026-01-01 (3 bars behind 2026-01-04)'),
    );
  });

  it('warns when callable data is newer than chart bars', () => {
    const bars = [bar('2026-01-01'), bar('2026-01-02')];
    const intervalData = {
      indicators: { zoneV1: [{ d: '2026-01-03', zone: 2 }] },
      signals: {},
    } as IntervalData;

    injectCallableIndicatorData([zoneCfg()], intervalData, bars, 'daily');

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('zoneV1 ends 2026-01-03 (ahead of last bar 2026-01-02 by 2 bars)'),
    );
  });

  it('does not warn when callable data reaches the last bar', () => {
    const bars = [bar('2026-01-01'), bar('2026-01-02')];
    const intervalData = {
      indicators: { zoneV1: [{ d: '2026-01-02', zone: 2 }] },
      signals: {},
    } as IntervalData;

    injectCallableIndicatorData([zoneCfg()], intervalData, bars, 'daily');

    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('does not warn when there is no callable data or no bars', () => {
    injectCallableIndicatorData([zoneCfg()], undefined, [bar('2026-01-01')], 'daily');
    injectCallableIndicatorData([zoneCfg()], { indicators: { zoneV1: [{ d: '2026-01-01', zone: 1 }] }, signals: {} } as IntervalData, [], 'daily');
    expect(warnSpy).not.toHaveBeenCalled();
  });
});

function triggerCfg(): IndicatorConfig {
  return { id: 'tb1', type: StIndicator.ST_TRIGGER_BANDS, pane: 'overlay', options: {}, params: {}, seriesType: 'line' } as IndicatorConfig;
}

const tbPoint = (d: string, over: Record<string, unknown> = {}) => ({
  d,
  upper: 10,
  lower: 8,
  longPullback: false,
  longPullbackState: false,
  longBreakout: false,
  shortPullback: false,
  shortPullbackState: false,
  shortBreakout: false,
  ...over,
});

describe('injectCallableIndicatorData - trigger bands (#879)', () => {
  const bars = [bar('2026-01-01'), bar('2026-01-02'), bar('2026-01-03'), bar('2026-01-04')];

  // Most cases use short series, which legitimately trips the staleness warning;
  // keep the output quiet and assert on it only where it is the subject.
  let warnSpy: jest.SpyInstance;
  beforeEach(() => {
    warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  });
  afterEach(() => warnSpy.mockRestore());

  function inject(points: unknown[] | undefined, b = bars) {
    const intervalData = { indicators: points ? { triggerBands: points } : {}, signals: {} } as IntervalData;
    return injectCallableIndicatorData([triggerCfg()], intervalData, b, 'daily')[0];
  }

  it('maps the series onto the config as triggerBandData', () => {
    const cfg = inject([tbPoint('2026-01-01'), tbPoint('2026-01-02', { upper: 11, lower: 9 })]);
    expect(cfg.triggerBandData).toHaveLength(2);
    expect(cfg.triggerBandData![1]).toEqual({
      date: toDatePt('2026-01-02'),
      upper: 11,
      lower: 9,
      upperState: 'neutral',
      lowerState: 'neutral',
    });
  });

  it('derives the upper band state from the long flags and the lower band state from the short flags', () => {
    const cfg = inject([
      tbPoint('2026-01-01', { longPullback: true, shortBreakout: true }),
      tbPoint('2026-01-02', { longBreakout: true, shortPullback: true }),
      tbPoint('2026-01-03', { longPullbackState: true, shortPullbackState: true }),
    ]);
    const [a, b, c] = cfg.triggerBandData!;
    expect([a.upperState, a.lowerState]).toEqual(['pullback', 'breakout']);
    expect([b.upperState, b.lowerState]).toEqual(['breakout', 'pullback']);
    // the latched state alone does not colour a bar - only the per-bar pullback/breakout flags do
    expect([c.upperState, c.lowerState]).toEqual(['neutral', 'neutral']);
  });

  it('skips warm-up points whose bands are null', () => {
    const cfg = inject([
      tbPoint('2026-01-01', { upper: null, lower: null }),
      tbPoint('2026-01-02', { upper: null, lower: null }),
      tbPoint('2026-01-03'),
    ]);
    expect(cfg.triggerBandData).toHaveLength(1);
    expect(cfg.triggerBandData![0].date).toEqual(toDatePt('2026-01-03'));
  });

  it('yields an empty series - no error - when the response has no triggerBands', () => {
    expect(inject(undefined).triggerBandData).toEqual([]);
    expect(injectCallableIndicatorData([triggerCfg()], undefined, bars, 'daily')[0].triggerBandData).toEqual([]);
  });

  it('leaves other configs untouched', () => {
    const intervalData = { indicators: { triggerBands: [tbPoint('2026-01-01')], zoneV1: [] }, signals: {} } as unknown as IntervalData;
    const [zone] = injectCallableIndicatorData([zoneCfg()], intervalData, bars, 'daily');
    expect(zone.triggerBandData).toBeUndefined();
  });

  describe('staleness warning', () => {
    it('covers triggerBands when the series ends before the last bar', () => {
      inject([tbPoint('2026-01-01')]);
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('triggerBands ends 2026-01-01 (3 bars behind 2026-01-04)'),
      );
    });

    it('stays quiet when the series reaches the last bar', () => {
      inject([tbPoint('2026-01-03'), tbPoint('2026-01-04')]);
      expect(warnSpy).not.toHaveBeenCalled();
    });
  });
});

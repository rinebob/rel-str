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

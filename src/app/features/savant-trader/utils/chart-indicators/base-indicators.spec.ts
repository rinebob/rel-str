import { ChartIntervalKey, StIndicator } from '../../../shared/components/flex-chart/flex-chart.types';
import { buildBaseIndicators, buildConfigForId } from './base-indicators';

describe('base-indicators — ST Anchored VWAP is opt-in only', () => {
  it.each([ChartIntervalKey.DAILY, ChartIntervalKey.WEEKLY, ChartIntervalKey.MONTHLY])(
    'does not auto-enable it on the %s base indicator set',
    (interval) => {
      expect(buildBaseIndicators(interval).some((i) => i.type === StIndicator.ST_ANCHORED_VWAP)).toBe(false);
    },
  );

  it('is still resolvable by id for the indicator menu', () => {
    expect(buildConfigForId('st-anchored-vwap')?.type).toBe(StIndicator.ST_ANCHORED_VWAP);
  });
});

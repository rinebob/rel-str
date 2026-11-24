import { ChartIntervalKey, StIndicator } from '../../../shared/components/flex-chart/flex-chart.types';
import { addChartExtras, buildBaseIndicators, buildConfigForId, type ChartScatterPoint } from './base-indicators';
import {
  ST_ZONE_V1_UPTICK_DOTS_INDICATOR,
  ST_ZONE_V2_UPTICK_DOTS_INDICATOR,
} from '../../../shared/components/flex-chart/indicators/st-trend-rider-dots.indicator';
import { ST_SUPPRESSED_DOT_COLORS, ST_UPTICK_DOT_COLORS } from '@flex-chart/indicator-visuals';
import { buildDefaultConfig } from '../../../shared/components/flex-chart/indicators/indicator-registry';

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

describe('addChartExtras — IBS-suppressed dots series (#1679)', () => {
  const dots: ChartScatterPoint[] = [
    { x: new Date('2026-11-18T00:00:00Z'), y: 95, color: ST_UPTICK_DOT_COLORS.v1Long },
    { x: new Date('2026-11-19T00:00:00Z'), y: 96, color: ST_UPTICK_DOT_COLORS.v1Short },
  ];
  const base = [buildDefaultConfig(ST_ZONE_V1_UPTICK_DOTS_INDICATOR)];

  it('appends a `-suppressed` sibling series with ghost colors remapped per point', () => {
    const out = addChartExtras(base, { uptickDotsV1Suppressed: dots });
    const supp = out.find(c => c.id === 'st-zone-v1-uptick-dots-default-suppressed');
    expect(supp).toBeTruthy();
    expect(supp!.pane).toBe('overlay');
    expect(supp!.options.name).toBe('ST Trend Rider V1 (suppressed)');
    const colors = (supp!.data as ChartScatterPoint[]).map(p => p.color);
    expect(colors).toEqual([
      ST_SUPPRESSED_DOT_COLORS[ST_UPTICK_DOT_COLORS.v1Long],
      ST_SUPPRESSED_DOT_COLORS[ST_UPTICK_DOT_COLORS.v1Short],
    ]);
    // placement preserved verbatim
    const xs = (supp!.data as ChartScatterPoint[]).map(p => p.x.getTime());
    expect(xs).toEqual(dots.map(d => d.x.getTime()));
  });

  it('no suppressed series when the field is absent or empty — emitted path untouched', () => {
    const emittedDots: ChartScatterPoint[] = [
      { x: new Date('2026-11-18T00:00:00Z'), y: 95, color: ST_UPTICK_DOT_COLORS.v2Long },
    ];
    const out = addChartExtras(base, { uptickDotsV2: emittedDots, uptickDotsV2Suppressed: [] });
    expect(out.some(c => c.id.endsWith('-suppressed'))).toBe(false);
    expect(out.find(c => c.id === ST_ZONE_V2_UPTICK_DOTS_INDICATOR.id + '-default')?.data).toEqual(emittedDots);
  });

  it('V1 + V2 suppressed series coexist under their own ids', () => {
    const out = addChartExtras(base, {
      uptickDotsV1Suppressed: dots,
      uptickDotsV2Suppressed: [{ x: new Date('2026-11-19T00:00:00Z'), y: 96, color: ST_UPTICK_DOT_COLORS.v2Long }],
    });
    expect(out.some(c => c.id === 'st-zone-v1-uptick-dots-default-suppressed')).toBe(true);
    expect(out.some(c => c.id === 'st-zone-v2-uptick-dots-default-suppressed')).toBe(true);
  });
});

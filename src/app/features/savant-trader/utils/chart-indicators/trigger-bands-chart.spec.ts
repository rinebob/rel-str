import {
  addChartExtras,
  addTriggerBandsDots,
  buildBaseIndicators,
  buildConfigForId,
} from './base-indicators';
import type { ChartScatterPoint } from './base-indicators';
import { convertTriggerBandsDotMarkers } from './signal-marker-converters';
import { injectTriggerBandsData } from './indicator-converters';
import { ChartIntervalKey, StIndicator } from '../../../shared/components/flex-chart/flex-chart.types';
import {
  ST_TRIGGER_BANDS_DOTS_INDICATOR,
  ST_TRIGGER_BANDS_INDICATOR,
} from '../../../shared/components/flex-chart/indicators/st-trigger-bands.indicator';
import { ST_TRIGGER_BANDS_DOT_COLORS } from '@flex-chart/indicator-visuals';
import type { DotMarker, IntervalData } from '../../common/indicator.types';
import { toDatePt } from '../../utils/utils';

function marker(over: Partial<DotMarker> = {}): DotMarker {
  return {
    d: '2026-01-02',
    index: 1,
    direction: 'long',
    y: 95,
    version: 'TB',
    signalType: 'TRIGGER_BANDS_LONG_BREAKOUT',
    ...over,
  };
}

const interval = (over: Partial<IntervalData> = {}): IntervalData =>
  ({ indicators: {}, signals: {}, ...over }) as IntervalData;

describe('convertTriggerBandsDotMarkers (#880)', () => {
  it('maps dot markers to scatter points at the marker date and price', () => {
    const dots = convertTriggerBandsDotMarkers(
      interval({ dotMarkers: { triggerBands: [marker({ d: '2026-01-05', index: 4, y: 91.5 })] } }),
    );
    expect(dots).toEqual([
      { x: toDatePt('2026-01-05'), y: 91.5, color: ST_TRIGGER_BANDS_DOT_COLORS['TRIGGER_BANDS_LONG_BREAKOUT'], index: 4 },
    ]);
  });

  it('colours the four kinds per the Pine vocabulary: breakout in the side colour, pullback in the opposite', () => {
    const kinds = [
      'TRIGGER_BANDS_LONG_BREAKOUT',
      'TRIGGER_BANDS_SHORT_BREAKOUT',
      'TRIGGER_BANDS_LONG_PULLBACK',
      'TRIGGER_BANDS_SHORT_PULLBACK',
    ];
    const dots = convertTriggerBandsDotMarkers(
      interval({
        dotMarkers: {
          triggerBands: kinds.map((signalType, i) =>
            marker({ signalType, index: i, direction: signalType.includes('LONG') ? 'long' : 'short' })),
        },
      }),
    );
    const colors = dots.map((d) => d.color);
    // Pine: long breakout blue, short breakout yellow, long pullback yellow,
    // short pullback blue — two hues; the dot's position carries the side.
    expect(new Set(colors).size).toBe(2);
    expect(colors).toEqual(kinds.map((k) => ST_TRIGGER_BANDS_DOT_COLORS[k]));
    expect(ST_TRIGGER_BANDS_DOT_COLORS['TRIGGER_BANDS_LONG_BREAKOUT']).not.toBe(
      ST_TRIGGER_BANDS_DOT_COLORS['TRIGGER_BANDS_SHORT_BREAKOUT'],
    );
  });

  it('drops markers with an unrecognised signalType rather than guessing a colour', () => {
    const dots = convertTriggerBandsDotMarkers(
      interval({ dotMarkers: { triggerBands: [marker({ signalType: 'SOMETHING_ELSE' }), marker()] } }),
    );
    expect(dots).toHaveLength(1);
  });

  it('is empty without markers, without an interval, or from an older backend', () => {
    expect(convertTriggerBandsDotMarkers(undefined)).toEqual([]);
    expect(convertTriggerBandsDotMarkers(interval())).toEqual([]);
    expect(convertTriggerBandsDotMarkers(interval({ dotMarkers: {} }))).toEqual([]);
  });
});

describe('Trigger Bands chart attachment (#880)', () => {
  const dots: ChartScatterPoint[] = [{ x: toDatePt('2026-01-02'), y: 95, color: '#4caf50', index: 1 }];

  it('buildConfigForId resolves the Trigger Bands bands config, but it is never a default indicator', () => {
    const cfg = buildConfigForId(ST_TRIGGER_BANDS_INDICATOR.id);
    expect(cfg?.type).toBe(StIndicator.ST_TRIGGER_BANDS);
    for (const key of [ChartIntervalKey.DAILY, ChartIntervalKey.WEEKLY, ChartIntervalKey.MONTHLY]) {
      expect(buildBaseIndicators(key).some((c) => c.type === StIndicator.ST_TRIGGER_BANDS)).toBe(false);
    }
  });

  it('addTriggerBandsDots appends a scatter overlay config carrying the points', () => {
    const [cfg] = addTriggerBandsDots([], dots);
    expect(cfg.id).toBe(`${ST_TRIGGER_BANDS_DOTS_INDICATOR.id}-default`);
    expect(cfg.type).toBe(StIndicator.ST_TRIGGER_BANDS_DOTS);
    expect(cfg.seriesType).toBe('scatter');
    expect(cfg.pane).toBe('overlay');
    expect(cfg.data).toEqual(dots);
  });

  it('addTriggerBandsDots upserts by id and adds nothing for an empty series', () => {
    const once = addTriggerBandsDots([], dots);
    expect(addTriggerBandsDots(once, dots)).toHaveLength(1);
    expect(addTriggerBandsDots([], [])).toEqual([]);
  });

  it('addChartExtras attaches the dots when provided and leaves the list alone otherwise', () => {
    const base = [buildConfigForId(ST_TRIGGER_BANDS_INDICATOR.id)!];
    expect(addChartExtras(base, { triggerBandsDots: dots }).map((c) => c.type)).toEqual([
      StIndicator.ST_TRIGGER_BANDS,
      StIndicator.ST_TRIGGER_BANDS_DOTS,
    ]);
    expect(addChartExtras(base, {})).toEqual(base);
  });
});

describe('injectTriggerBandsData (#880)', () => {
  const point = (d: string) => ({
    d, upper: 10, lower: 8,
    longPullback: false, longPullbackState: false, longBreakout: false,
    shortPullback: false, shortPullbackState: false, shortBreakout: false,
  });

  it('sets the series on the Trigger Bands config only, leaving other configs untouched', () => {
    const tb = buildConfigForId(ST_TRIGGER_BANDS_INDICATOR.id)!;
    const other = { ...buildBaseIndicators(ChartIntervalKey.DAILY)[0], data: [{ x: new Date(), y: 1 }] };
    const data = interval({ indicators: { triggerBands: [point('2026-01-01'), point('2026-01-02')] } });

    const [outTb, outOther] = injectTriggerBandsData([tb, other], data);

    expect(outTb.triggerBandData).toHaveLength(2);
    expect(outOther).toBe(other);
  });

  it('survives an absent or empty response without error', () => {
    const tb = buildConfigForId(ST_TRIGGER_BANDS_INDICATOR.id)!;
    expect(injectTriggerBandsData([tb], undefined)[0].triggerBandData).toEqual([]);
    expect(injectTriggerBandsData([tb], interval())[0].triggerBandData).toEqual([]);
  });
});

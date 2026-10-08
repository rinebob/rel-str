import {
  ST_TRIGGER_BANDS_INDICATOR,
  computeTriggerBandLines,
  type TriggerBandLine,
  type TriggerBandPoint,
  type TriggerBandState,
} from './st-trigger-bands.indicator';
import { buildDefaultConfig, DEFAULT_ST_INDICATORS } from './indicator-registry';
import { StIndicator } from '../flex-chart.types';
import {
  ST_TRIGGER_BANDS_COLORS,
  ST_TRIGGER_BANDS_LINE_WIDTH,
} from '@flex-chart/indicator-visuals';

const day = (i: number): Date => new Date(2026, 0, i + 1);

/** dateToIndex for `n` consecutive daily bars starting 2026-01-01. */
function indexMap(n: number): Map<number, number> {
  return new Map(Array.from({ length: n }, (_, i) => [day(i).getTime(), i]));
}

function point(
  i: number,
  upper: number | null,
  upperState: TriggerBandState,
  lower: number | null = null,
  lowerState: TriggerBandState = 'neutral',
): TriggerBandPoint {
  return { date: day(i), upper, lower, upperState, lowerState };
}

const line = (lines: TriggerBandLine[], band: 'upper' | 'lower') =>
  lines.find((l) => l.band === band);

const ys = (l: TriggerBandLine | undefined) => l?.data.map((p) => p.y);
const colors = (l: TriggerBandLine | undefined) => l?.data.map((p) => p.color);

describe('ST_TRIGGER_BANDS_INDICATOR', () => {
  it('declares an overlay indicator on the price axis with no params', () => {
    expect(ST_TRIGGER_BANDS_INDICATOR.id).toBe('st-trigger-bands');
    expect(ST_TRIGGER_BANDS_INDICATOR.label).toBe('ST Trigger Bands');
    expect(ST_TRIGGER_BANDS_INDICATOR.type).toBe(StIndicator.ST_TRIGGER_BANDS);
    expect(ST_TRIGGER_BANDS_INDICATOR.defaultPane).toBe('overlay');
    expect(ST_TRIGGER_BANDS_INDICATOR.axisScale).toBe('price');
    expect(ST_TRIGGER_BANDS_INDICATOR.params).toEqual([]);
  });

  it('builds a default line config and is not part of the default ST suite', () => {
    const cfg = buildDefaultConfig(ST_TRIGGER_BANDS_INDICATOR);
    expect(cfg.type).toBe(StIndicator.ST_TRIGGER_BANDS);
    expect(cfg.seriesType).toBe('line');
    expect(cfg.pane).toBe('overlay');
    expect(DEFAULT_ST_INDICATORS.some((c) => c.type === StIndicator.ST_TRIGGER_BANDS)).toBe(false);
  });

  it('has no calculator — the series comes from the callable', async () => {
    const { indicatorCalculators } = await import('./indicator-registry');
    expect(indicatorCalculators[StIndicator.ST_TRIGGER_BANDS]).toBeUndefined();
  });
});

describe('computeTriggerBandLines', () => {
  it('returns no lines when there are no points', () => {
    expect(computeTriggerBandLines([], indexMap(5), 5)).toEqual([]);
  });

  it('emits exactly two lines — one per band — step-expanded to hinge + level rows', () => {
    const points = [point(0, 10, 'neutral', 5, 'neutral'), point(1, 11, 'neutral', 6, 'neutral')];
    const lines = computeTriggerBandLines(points, indexMap(5), 5);
    expect(lines.map((l) => l.key)).toEqual(['trigger-upper', 'trigger-lower']);
    for (const l of lines) {
      expect(l.width).toBe(ST_TRIGGER_BANDS_LINE_WIDTH);
      expect(l.color).toBe(ST_TRIGGER_BANDS_COLORS[l.band].neutral);
    }
    // Bar 1 emits a hinge (prior level) then the level — the step into bar 1.
    expect(line(lines, 'upper')!.data).toEqual([
      { index: 0, y: 10, color: ST_TRIGGER_BANDS_COLORS.upper.neutral },
      { index: 1, y: 10, color: ST_TRIGGER_BANDS_COLORS.upper.neutral },
      { index: 1, y: 11, color: ST_TRIGGER_BANDS_COLORS.upper.neutral },
      { index: 2, y: null, color: ST_TRIGGER_BANDS_COLORS.upper.neutral },
      { index: 3, y: null, color: ST_TRIGGER_BANDS_COLORS.upper.neutral },
      { index: 4, y: null, color: ST_TRIGGER_BANDS_COLORS.upper.neutral },
    ]);
  });

  it('colours the step into bar i and the flat run ending at bar i with bar i\'s state (TV right-endpoint rule)', () => {
    // upper states: neutral, pullback, pullback, breakout
    const points = [
      point(0, 10, 'neutral'),
      point(1, 11, 'pullback'),
      point(2, 11, 'pullback'),
      point(3, 12, 'breakout'),
    ];
    const U = ST_TRIGGER_BANDS_COLORS.upper;
    const rows = line(computeTriggerBandLines(points, indexMap(4), 4), 'upper')!.data;
    // A row's colour paints the segment it starts: hinge rows carry the state
    // of the bar they step INTO; level rows carry the state of the bar the
    // flat run ends on.
    expect(rows.map((r) => [r.index, r.y, r.color])).toEqual([
      [0, 10, U.pullback],   // flat run ending at bar 1 (pullback)
      [1, 10, U.pullback],   // hinge → vertical step into bar 1 (pullback)
      [1, 11, U.pullback],   // flat run ending at bar 2 (pullback)
      [2, 11, U.pullback],   // hinge → vertical step into bar 2 (pullback)
      [2, 11, U.breakout],   // flat run ending at bar 3 (breakout)
      [3, 11, U.breakout],   // hinge → vertical step into bar 3 (breakout)
      [3, 12, U.breakout],   // last bar carries its own state
    ]);
  });

  it('keeps null rows through warm-up bars so the line starts at the first real band value', () => {
    const points = [
      point(0, null, 'neutral'),
      point(1, null, 'neutral'),
      point(2, 10, 'pullback'),
      point(3, 10, 'pullback'),
    ];
    const upper = line(computeTriggerBandLines(points, indexMap(4), 4), 'upper')!;
    expect(upper.data.map((r) => r.y)).toEqual([null, null, 10, 10, 10]);
    expect(upper.data.map((r) => r.index)).toEqual([0, 1, 2, 3, 3]);
  });

  it('colours the lower band from its own states, independently of the upper band', () => {
    const points = [
      point(0, 10, 'neutral', 5, 'neutral'),
      point(1, 11, 'pullback', 5, 'pullback'),
      point(2, 12, 'breakout', 4, 'breakout'),
    ];
    const lines = computeTriggerBandLines(points, indexMap(3), 3);
    const L = ST_TRIGGER_BANDS_COLORS.lower;
    // lower: step into bar 1 = pullback (blue); step into bar 2 + trailing
    // run = breakout (yellow)
    expect(colors(line(lines, 'lower'))).toEqual([L.pullback, L.pullback, L.breakout, L.breakout, L.breakout]);
    expect(ys(line(lines, 'lower'))).toEqual([5, 5, 5, 5, 4]);
  });

  it('a single-bar state interruption paints only its own step, not a bridge', () => {
    const points = [point(0, 5, 'pullback'), point(1, 6, 'neutral'), point(2, 7, 'pullback')];
    const U = ST_TRIGGER_BANDS_COLORS.upper;
    // interval into bar 1 neutral, into bar 2 pullback — no overdraw artefact
    expect(colors(line(computeTriggerBandLines(points, indexMap(3), 3), 'upper')))
      .toEqual([U.neutral, U.neutral, U.pullback, U.pullback, U.pullback]);
  });

  it('drops points whose date is not a bar, or whose index is outside the bar range', () => {
    const points = [
      point(0, 10, 'neutral'),
      { ...point(1, 11, 'neutral'), date: new Date(2030, 0, 1) }, // unknown date
      point(2, 12, 'neutral'),
    ];
    const lines = computeTriggerBandLines(points, indexMap(3), 2); // barCount 2: index 2 is out of range
    expect(ys(line(lines, 'upper'))).toEqual([10, null]);
  });

  it('does not depend on point order', () => {
    const points = [point(2, 12, 'neutral'), point(0, 10, 'neutral'), point(1, 11, 'neutral')];
    const lines = computeTriggerBandLines(points, indexMap(3), 3);
    // level + hinge rows: 10 | 10→11 step | 11→12 step
    expect(ys(line(lines, 'upper'))).toEqual([10, 10, 11, 11, 12]);
  });

  it('always emits the same two keys once any point lands, whatever the data (stable series count)', () => {
    const sets: TriggerBandPoint[][] = [
      [point(0, 10, 'neutral')],
      [point(0, 10, 'breakout', 5, 'pullback'), point(1, 11, 'breakout', 6, 'breakout')],
      [point(0, null, 'neutral'), point(1, null, 'neutral')],
    ];
    const keySets = sets.map((s) => computeTriggerBandLines(s, indexMap(3), 3).map((l) => l.key));
    for (const keys of keySets) expect(keys).toEqual(['trigger-upper', 'trigger-lower']);
  });
});

/**
 * ST Trigger Bands — chart indicator (renderer only).
 *
 * Body-based length-3 Donchian bands with a per-side pullback / breakout
 * state. The numbers and flags are computed on the backend and arrive through
 * the indicator-series callable (`indicators.triggerBands`); this file only
 * turns that series into state-coloured step lines. There is deliberately no
 * calculator — the backend is the single source of truth, so the chart and
 * any strategy that reads the same flags cannot disagree.
 *
 * Colouring (per bar, as in the TradingView script):
 *   - upper band: long pullback → 'pullback', long breakout → 'breakout'
 *   - lower band: short pullback → 'pullback', short breakout → 'breakout'
 *   - otherwise 'neutral'
 * The state → colour map is per-band (a pullback borrows the opposite side's
 * colour) — see ST_TRIGGER_BANDS_COLORS.
 *
 * Rendering: TWO `MultiColoredLine` series — one upper, one lower. Syncfusion
 * has no multi-coloured STEP series, so the steps are baked into the data:
 * at each valued bar i the line emits a hinge point (i, value[i-1]) then the
 * level point (i, value[i]) — two points at the same x on the Double axis —
 * which renders as horizontal-run-then-vertical-jump, a true step. Every
 * point carries a `color` (`pointColorMapping`); Syncfusion colours a
 * segment by its LEFT endpoint, so the hinge and level colours are chosen
 * so every piece of the interval (i-1, i] — flat run AND the vertical
 * transition — takes bar i's state, TradingView's right-endpoint rule.
 * One uniform width — the state carries only colour.
 */

import type { IndicatorOption } from '../flex-chart.types';
import { StIndicator } from '../flex-chart.types';
import {
  ST_TRIGGER_BANDS_COLORS,
  ST_TRIGGER_BANDS_LINE_WIDTH,
} from '@flex-chart/indicator-visuals';

// =============================================================================
// 1. CHART CONFIGURATION
// =============================================================================

export const ST_TRIGGER_BANDS_INDICATOR: IndicatorOption = {
  id: 'st-trigger-bands',
  label: 'ST Trigger Bands',
  type: StIndicator.ST_TRIGGER_BANDS,
  defaultPane: 'overlay',
  axisScale: 'price',
  params: [],
  defaultOptions: {},
};

/** Companion scatter overlay for the pullback / breakout dots. It is not a menu
 *  entry of its own - the Trigger Bands toggle attaches it with the bands. */
export const ST_TRIGGER_BANDS_DOTS_INDICATOR: IndicatorOption = {
  id: 'st-trigger-bands-dots',
  label: 'ST Trigger Bands Signals',
  type: StIndicator.ST_TRIGGER_BANDS_DOTS,
  defaultPane: 'overlay',
  axisScale: 'price',
  params: [],
  defaultOptions: { name: 'Trigger Bands signals' },
};

// =============================================================================
// 2. TYPES
// =============================================================================

export type TriggerBandState = 'neutral' | 'pullback' | 'breakout';

/** One bar of callable Trigger Bands data, reduced to what the renderer needs. */
export interface TriggerBandPoint {
  date: Date;
  /** Null during the 3-bar warm-up. */
  upper: number | null;
  lower: number | null;
  upperState: TriggerBandState;
  lowerState: TriggerBandState;
}

/** One chart-ready band line: per-point coloured, step-expanded. */
export interface TriggerBandLine {
  key: string;
  name: string;
  band: 'upper' | 'lower';
  /** Fallback interior (a point without a mapped colour). */
  color: string;
  width: number;
  /** Step-expanded rows: each valued bar i emits (i, value[i-1]) then
   *  (i, value[i]) so the same-x pair renders as a vertical step; unvalued
   *  bars emit a single null row to keep index alignment and gap breaks.
   *  `color` paints the segment STARTING at a row (left-endpoint rule), so
   *  hinge rows carry state[i] (the transition into bar i) and level rows
   *  carry state[i+1] (the interval ending at bar i+1). */
  data: { index: number; y: number | null; color: string }[];
}

// =============================================================================
// 3. SERIES BUILDING
// =============================================================================

const BANDS = ['upper', 'lower'] as const;

/**
 * Turn callable points into the two band lines. `dateToIndex` maps bar
 * timestamps to the axis index; points that do not land on a bar, or land
 * outside `[0, barCount)`, are dropped. Always returns both lines once any
 * point lands, so the chart's series count is stable.
 */
export function computeTriggerBandLines(
  points: readonly TriggerBandPoint[],
  dateToIndex: ReadonlyMap<number, number>,
  barCount: number,
): TriggerBandLine[] {
  if (points.length === 0 || barCount <= 0) return [];

  return BANDS.map((band) => {
    const values: (number | null)[] = new Array(barCount).fill(null);
    const states: TriggerBandState[] = new Array(barCount).fill('neutral');
    for (const p of points) {
      const index = dateToIndex.get(p.date.getTime());
      if (index === undefined || index < 0 || index >= barCount) continue;
      values[index] = band === 'upper' ? p.upper : p.lower;
      states[index] = band === 'upper' ? p.upperState : p.lowerState;
    }
    const colorOf = (bar: number) =>
      ST_TRIGGER_BANDS_COLORS[band][states[Math.min(bar, barCount - 1)]];

    const data: TriggerBandLine['data'] = [];
    for (let i = 0; i < barCount; i++) {
      const value = values[i];
      if (value === null) {
        data.push({ index: i, y: null, color: colorOf(i) });
        continue;
      }
      // Hinge at the prior level → the same-x pair renders as the vertical
      // step into bar i, coloured by bar i's state.
      if (i > 0 && values[i - 1] !== null) {
        data.push({ index: i, y: values[i - 1], color: colorOf(i) });
      }
      // Level point: paints the flat run to bar i+1 with state[i+1].
      data.push({ index: i, y: value, color: colorOf(i + 1) });
    }

    return {
      key: `trigger-${band}`,
      name: `Trigger ${band === 'upper' ? 'Upper' : 'Lower'}`,
      band,
      color: ST_TRIGGER_BANDS_COLORS[band].neutral,
      width: ST_TRIGGER_BANDS_LINE_WIDTH,
      data,
    };
  });
}

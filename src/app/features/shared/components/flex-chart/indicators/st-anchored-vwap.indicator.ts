/**
 * ST Anchored VWAP — chart indicator definition + series builder.
 *
 * Wraps the pure computation (`st-anchored-vwap.engine.ts`) into the
 * `IndicatorOption` shape used by flex-chart and maps its segments onto a
 * FIXED set of 14 series: per set, four VWAP slots (high/low x history/active —
 * one active series and one history series per side holding the side's
 * terminated segments), plus a confirmed ZigZag-leg chain series, a dashed
 * developing-leg series, and a Scatter series of confirmation-point
 * markers. The series count never depends on the data,
 * because a Syncfusion chart reinitialises when its series structure changes.
 *
 * Every terminated segment packs into its side's single history series,
 * separated by a `y: null` break point (rendered as a gap by
 * `emptyPointSettings: { mode: 'Gap' }`). Packed runs rely on the
 * category axis plotting each point at its own x position while
 * connecting in data order — verified in UAT with overlapping persist
 * fans (#1466); the persist fan is therefore unbounded.
 *
 * There is no `IndicatorCalculator`: rendering is entirely through the bespoke
 * series (consumed by `ChartDataAdapter.anchoredVwapSeries`), and
 * `computeIndicators` explicitly supports indicators without one.
 */

import type { IndicatorOption, PriceBar } from '../flex-chart.types';
import { StIndicator } from '../flex-chart.types';
import { computeAnchoredVwapResult } from './st-anchored-vwap.engine';
import type { AnchoredVwapConfig, AnchoredVwapSegment, AnchoredVwapSet } from './st-anchored-vwap.types';
import { boolParam, colorParam, numParam } from './indicator-params';

// =============================================================================
// 1. CHART CONFIGURATION
// =============================================================================

const DEFAULTS = {
  line1RetracementPct: 2,
  line2RetracementPct: 5,
  line1LeftDepth: 5,
  line1RightDepth: 2,
  line2LeftDepth: 5,
  line2RightDepth: 2,
  // literal-sweep exception #1216: line-1/line-2 identity hues —
  // deliberate categorical pairs (see #955), consumed as literals.
  line1HighColor: '#FF8CFF',
  line1LowColor: '#FFFF00',
  // Green/red — deliberately outside line 1's magenta/yellow family so the
  // two sets cannot be confused (#955, recolored #1459).
  line2HighColor: '#00C853',
  line2LowColor: '#FF0000',
  // Radio 1–3, 3 heaviest — line 1 defaults heaviest (was hardcoded 1 / 2.5
  // before #1459).
  line1Weight: 3,
  line2Weight: 1,
  // Legs draw in a uniform teal (#1459) — they lost the per-leg high/low hue
  // encoding so each set's whole chain reads as one stroke.
  line1ZigZagColor: '#2DD4BF',
  line2ZigZagColor: '#2DD4BF',
  showLine1High: true,
  showLine1Low: true,
  showLine2High: true,
  showLine2Low: true,
  // Per-set leg visibility (#1459) — line 1's legs can be inspected alone.
  showLine1ZigZag: true,
  showLine2ZigZag: true,
  // Per-set confirmation-point markers — a debug overlay, off by default.
  showLine1Confirms: false,
  showLine2Confirms: false,
  // Per-set persist mode — keep every triggered vertex's line to the last
  // bar (a VWAP fan) instead of ending each at the next vertex's trigger.
  line1Persist: false,
  line2Persist: false,
  maxHistory: 100,
} as const;

export const ST_ANCHORED_VWAP_INDICATOR: IndicatorOption = {
  id: 'st-anchored-vwap',
  label: 'ST Anchored VWAP',
  type: StIndicator.ST_ANCHORED_VWAP,
  defaultPane: 'overlay',
  axisScale: 'price',
  params: [
    { key: 'line1RetracementPct', label: 'Line 1 Retracement %', default: DEFAULTS.line1RetracementPct, min: 0.1, max: 50, input: 'number' },
    { key: 'line2RetracementPct', label: 'Line 2 Retracement %', default: DEFAULTS.line2RetracementPct, min: 0.1, max: 50, input: 'number' },
    { key: 'line1LeftDepth', label: 'Line 1 Left Depth', default: DEFAULTS.line1LeftDepth, min: 2, max: 100, input: 'number' },
    // rightDepth defaults below leftDepth: narrows the window where a
    // reversal has met the deviation amount but not yet the bar count.
    { key: 'line1RightDepth', label: 'Line 1 Right Depth', default: DEFAULTS.line1RightDepth, min: 2, max: 100, input: 'number' },
    { key: 'line2LeftDepth', label: 'Line 2 Left Depth', default: DEFAULTS.line2LeftDepth, min: 2, max: 100, input: 'number' },
    { key: 'line2RightDepth', label: 'Line 2 Right Depth', default: DEFAULTS.line2RightDepth, min: 2, max: 100, input: 'number' },
    { key: 'line1HighColor', label: 'Line 1 High Color', default: DEFAULTS.line1HighColor, input: 'color' },
    { key: 'line1LowColor', label: 'Line 1 Low Color', default: DEFAULTS.line1LowColor, input: 'color' },
    { key: 'line2HighColor', label: 'Line 2 High Color', default: DEFAULTS.line2HighColor, input: 'color' },
    { key: 'line2LowColor', label: 'Line 2 Low Color', default: DEFAULTS.line2LowColor, input: 'color' },
    // Per-set stroke weight — radio 1–3 (#1459); min/max bound the values.
    { key: 'line1Weight', label: 'Line 1 Weight', default: DEFAULTS.line1Weight, min: 1, max: 3, input: 'radio' },
    { key: 'line2Weight', label: 'Line 2 Weight', default: DEFAULTS.line2Weight, min: 1, max: 3, input: 'radio' },
    { key: 'line1ZigZagColor', label: 'Line 1 ZigZag Color', default: DEFAULTS.line1ZigZagColor, input: 'color' },
    { key: 'line2ZigZagColor', label: 'Line 2 ZigZag Color', default: DEFAULTS.line2ZigZagColor, input: 'color' },
    // Per-side visibility toggles (#1459) — each empties only its side's
    // VWAP slots. No `input` — boolean defaults fall back to a checkbox.
    { key: 'showLine1High', label: 'Show Line 1 Upper', default: DEFAULTS.showLine1High },
    { key: 'showLine1Low', label: 'Show Line 1 Lower', default: DEFAULTS.showLine1Low },
    { key: 'showLine2High', label: 'Show Line 2 Upper', default: DEFAULTS.showLine2High },
    { key: 'showLine2Low', label: 'Show Line 2 Lower', default: DEFAULTS.showLine2Low },
    // Per-set leg toggles (#1459) — each empties only its own set's chain +
    // developing leg.
    { key: 'showLine1ZigZag', label: 'Show Line 1 ZigZag Legs', default: DEFAULTS.showLine1ZigZag },
    { key: 'showLine2ZigZag', label: 'Show Line 2 ZigZag Legs', default: DEFAULTS.showLine2ZigZag },
    // Per-set confirmation markers (#1459) — the same reversal-trigger dots
    // the standalone ZigZag draws: a dot at the threshold level (or the
    // open on a gap-through) on the bar that first crossed it, in the source
    // pivot's side color. Debug overlay for "where was a line allowed to
    // start".
    { key: 'showLine1Confirms', label: 'Show Line 1 Confirmation Points', default: DEFAULTS.showLine1Confirms },
    { key: 'showLine2Confirms', label: 'Show Line 2 Confirmation Points', default: DEFAULTS.showLine2Confirms },
    // Persist mode — no `show` prefix: a behavior toggle, not visibility.
    // The dialog still lifts it to the group header as 'Persist'.
    { key: 'line1Persist', label: 'Line 1 Persist Lines', default: DEFAULTS.line1Persist },
    { key: 'line2Persist', label: 'Line 2 Persist Lines', default: DEFAULTS.line2Persist },
    { key: 'maxHistory', label: 'Max History', default: DEFAULTS.maxHistory, min: 0, max: 1000, input: 'number' },
    // ISO 'YYYY-MM-DD' — only a string survives the params panel. The engine
    // compares it against the pivot bar's session `date` (calendar strings,
    // not epochs), so no timezone conversion happens anywhere.
    { key: 'historyStart', label: 'History Start (YYYY-MM-DD)', default: '', input: 'date' },
  ],
};

// =============================================================================
// 2. TYPES
// =============================================================================

/** One of the 14 fixed series. `y: null` entries are gap-producing break points. */
export interface AnchoredVwapLineSeries {
  /** `${set}-${side}-active` | `-history` | `${set}-zigzag` | `${set}-developing` | `${set}-confirmations`. */
  key: string;
  /** Display name for tooltips: `AVWAP-1H {pct}%` / `AVWAP-1L {pct}%` / `AVWAP-2H {pct}%` / `AVWAP-2L {pct}%` / `ZZ {pct}%`. */
  name: string;
  /** Series color — for the ZigZag chain this is the fallback fill; the set's uniform leg color lives on the points. */
  color: string;
  /** Set's stroke weight (radio 1–3); legs share the set's weight (#1459). */
  width: number;
  /** 'Line' for VWAP + developing leg, 'MultiColoredLine' for the confirmed chain, 'Scatter' for the confirmation markers. */
  type: 'Line' | 'MultiColoredLine' | 'Scatter';
  /** Dash array for the developing leg; '' for solid. */
  dashArray: string;
  /** 'color' on the MultiColoredLine chain + Scatter markers (per-point hues); '' elsewhere. */
  pointColorMapping: string;
  /** Marker config — only the Scatter confirmations series sets it; undefined elsewhere. */
  marker?: { visible: boolean; shape: string; width: number; height: number };
  /** Points by bar index; `color` drives per-point hue on the chain + markers. */
  data: { index: number; y: number | null; color?: string }[];
}

type Params = Record<string, number | string | boolean>;

// =============================================================================
// 3. PARAM EXTRACTION
// =============================================================================

function extractConfig(params: Params): AnchoredVwapConfig {
  return {
    line1RetracementPct: Math.min(50, Math.max(0.1, numParam(params['line1RetracementPct'], DEFAULTS.line1RetracementPct))),
    line2RetracementPct: Math.min(50, Math.max(0.1, numParam(params['line2RetracementPct'], DEFAULTS.line2RetracementPct))),
    line1LeftDepth: Math.min(100, Math.max(2, Math.floor(numParam(params['line1LeftDepth'], DEFAULTS.line1LeftDepth)))),
    line1RightDepth: Math.min(100, Math.max(2, Math.floor(numParam(params['line1RightDepth'], DEFAULTS.line1RightDepth)))),
    line2LeftDepth: Math.min(100, Math.max(2, Math.floor(numParam(params['line2LeftDepth'], DEFAULTS.line2LeftDepth)))),
    line2RightDepth: Math.min(100, Math.max(2, Math.floor(numParam(params['line2RightDepth'], DEFAULTS.line2RightDepth)))),
    line1Persist: boolParam(params['line1Persist'], DEFAULTS.line1Persist),
    line2Persist: boolParam(params['line2Persist'], DEFAULTS.line2Persist),
    maxHistory: Math.min(1000, Math.max(0, Math.floor(numParam(params['maxHistory'], DEFAULTS.maxHistory)))),
    // ISO date string through to the engine, which validates it and compares
    // against each pivot's session `date` — no epoch conversion here.
    ...(typeof params['historyStart'] === 'string' && params['historyStart'].trim() !== ''
      ? { historyStart: params['historyStart'].trim() }
      : {}),
  };
}

// =============================================================================
// 4. FIXED-SLOT SERIES
// =============================================================================

const DEVELOPING_DASH = '5,3';

/** Stroke weight from the 1–3 radio — integer-clamped so a persisted
 *  out-of-range value can't explode the stroke. */
function weightParam(value: Params[string] | undefined, fallback: number): number {
  return Math.min(3, Math.max(1, Math.round(numParam(value, fallback))));
}

/** Concatenate segments into one series, separated by a break point between
 *  runs. The break index is clamped to the last bar — persist runs all end
 *  there, so `endBar + 1` would index a phantom category past the edge. */
function pack(segments: AnchoredVwapSegment[], lastBar: number): AnchoredVwapLineSeries['data'] {
  return segments.flatMap((segment, i) => {
    const points: AnchoredVwapLineSeries['data'] = segment.points.map((p) => ({ index: p.index, y: p.y }));
    return i < segments.length - 1 ? [...points, { index: Math.min(segment.endBar + 1, lastBar), y: null }] : points;
  });
}

/**
 * Compute the 14 fixed Anchored VWAP series.
 *
 * Per set: four VWAP slots (high/low × history/active), then the
 * ZigZag leg series — a confirmed chain (MultiColoredLine in the set's
 * uniform leg color), a dashed developing leg to the running extreme, and a
 * Scatter series of confirmation markers (each reversal trigger in its
 * source pivot's side color).
 * `showLineNZigZag: false` leaves that set's leg series empty;
 * `showLineNConfirms: false` — the default — leaves its marker series empty.
 *
 * Order: line 1's slots + legs + markers, then line 2's (line 2 draws on
 * top); within a slot, high before low, `history` then `active` last.
 * Always returns exactly 14 series, including for empty data.
 */
export function computeAnchoredVwapSeries(bars: PriceBar[], params: Params): AnchoredVwapLineSeries[] {
  const config = extractConfig(params);
  const { segments, legs } = computeAnchoredVwapResult(bars, config);
  const lastBar = bars.length - 1;

  const sets = ([1, 2] as const).map((n) => ({
    set: `line${n}` as AnchoredVwapSet,
    pct: config[`line${n}RetracementPct`],
    width: weightParam(params[`line${n}Weight`], DEFAULTS[`line${n}Weight`]),
    highColor: colorParam(params[`line${n}HighColor`], DEFAULTS[`line${n}HighColor`]),
    lowColor: colorParam(params[`line${n}LowColor`], DEFAULTS[`line${n}LowColor`]),
    showHigh: boolParam(params[`showLine${n}High`], DEFAULTS[`showLine${n}High`]),
    showLow: boolParam(params[`showLine${n}Low`], DEFAULTS[`showLine${n}Low`]),
    showLegs: boolParam(params[`showLine${n}ZigZag`], DEFAULTS[`showLine${n}ZigZag`]),
    showConfirms: boolParam(params[`showLine${n}Confirms`], DEFAULTS[`showLine${n}Confirms`]),
    legColor: colorParam(params[`line${n}ZigZagColor`], DEFAULTS[`line${n}ZigZagColor`]),
  }));

  return sets.flatMap(({ set, pct, width, highColor, lowColor, showHigh, showLow, showLegs, showConfirms, legColor }) => {
    const sideColor = (isHigh: boolean) => (isHigh ? highColor : lowColor);
    const vwapSeries = (['high', 'low'] as const).flatMap((side) => {
      const sideSegs = segments
        .filter((s) => s.set === set && s.side === side)
        .sort((a, b) => a.startBar - b.startBar);
      const base = {
        name: `AVWAP-${set === 'line1' ? '1' : '2'}${side === 'high' ? 'H' : 'L'} ${pct}%`,
        color: sideColor(side === 'high'),
        width,
        type: 'Line' as const,
        dashArray: '',
        pointColorMapping: '',
      };
      // A hidden side empties only its own VWAP slots — the other side, the
      // leg series, and the fixed 14-key structure are unaffected (#1459).
      const showSide = side === 'high' ? showHigh : showLow;
      return [
        { ...base, key: `${set}-${side}-history`, data: pack(sideSegs.filter((s) => !s.active), lastBar) },
        { ...base, key: `${set}-${side}-active`, data: pack(sideSegs.filter((s) => s.active), lastBar) },
      ].map((s) => (showSide ? s : { ...s, data: [] }));
    });

    const legSet = legs.find((l) => l.set === set);
    // The whole chain draws in the set's uniform leg color (#1459) — the
    // MultiColoredLine contract still carries a color per vertex. A lone
    // anchor is still one marked vertex. Legs share the set's weight.
    const chainData: AnchoredVwapLineSeries['data'] = !showLegs || !legSet
      ? []
      : legSet.vertices.map((v) => ({ index: v.index, y: v.y, color: legColor }));
    const chain: AnchoredVwapLineSeries = {
      key: `${set}-zigzag`,
      name: `ZZ ${pct}%`,
      color: legColor,
      width,
      type: 'MultiColoredLine',
      dashArray: '',
      pointColorMapping: 'color',
      data: chainData,
    };
    const dev = legSet?.developing;
    const developing: AnchoredVwapLineSeries = {
      key: `${set}-developing`,
      name: `ZZ ${pct}% (developing)`,
      color: legColor,
      width,
      type: 'Line',
      dashArray: DEVELOPING_DASH,
      pointColorMapping: '',
      data: showLegs && dev ? [{ index: dev.from.index, y: dev.from.y }, { index: dev.to.index, y: dev.to.y }] : [],
    };

    // Confirmation markers — the same reversal-trigger dots the standalone
    // ZigZag draws: a dot at the threshold level on the bar that first
    // crossed it, in the source pivot's side color. Off unless
    // showLineNConfirms is set.
    const confirmations: AnchoredVwapLineSeries = {
      key: `${set}-confirmations`,
      name: `ZZ ${pct}% confirms`,
      color: legColor,
      width,
      type: 'Scatter',
      dashArray: '',
      pointColorMapping: 'color',
      marker: { visible: true, shape: 'Circle', width: 8, height: 8 },
      data: !showConfirms || !legSet
        ? []
        : legSet.confirmations.map((c) => ({
            index: c.index,
            y: c.y,
            color: sideColor(c.isHigh),
          })),
    };

    // The leg series answer to their own set's showLineNZigZag toggle, the
    // markers to showLineNConfirms. The 14-key structure is preserved either
    // way (#955); side visibility was applied inside the per-side slots (#1459).
    return [...vwapSeries, chain, developing, confirmations];
  });
}

/**
 * ST Anchored VWAP — chart indicator definition + series builder.
 *
 * Wraps the pure computation (`st-anchored-vwap.engine.ts`) into the
 * `IndicatorOption` shape used by flex-chart and maps its segments onto a
 * FIXED set of 16 line series: 4 VWAP slots (set x side), each with one
 * active series and two history series that the slot's terminated segments
 * alternate between, plus per set a confirmed ZigZag-leg chain series and a
 * dashed developing-leg series. The series count never depends on the data,
 * because a Syncfusion chart reinitialises when its series structure changes.
 *
 * Alternation is required because neighbouring segments share their handoff
 * bar and one series holds only one `y` per bar. Inside a history series,
 * consecutive segments are separated by a `y: null` break point (rendered as
 * a gap via `emptyPointSettings: { mode: 'Gap' }`).
 *
 * There is no `IndicatorCalculator`: rendering is entirely through the bespoke
 * series (consumed by `ChartDataAdapter.anchoredVwapSeries`), and
 * `computeIndicators` explicitly supports indicators without one.
 */

import type { IndicatorOption, PriceBar } from '../flex-chart.types';
import { StIndicator } from '../flex-chart.types';
import { computeAnchoredVwapResult } from './st-anchored-vwap.engine';
import type { AnchoredVwapConfig, AnchoredVwapSegment } from './st-anchored-vwap.types';
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
  line1HighColor: '#FF8CFF',
  line1LowColor: '#8CF5FF',
  // Orange/green — deliberately outside line 1's magenta/cyan family so the
  // two sets cannot be confused (#955).
  line2HighColor: '#FFA500',
  line2LowColor: '#00C853',
  showLine1: true,
  showLine2: true,
  showZigZag: true,
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
    // No `input` — boolean defaults fall back to a checkbox control.
    { key: 'showLine1', label: 'Show Line 1', default: DEFAULTS.showLine1 },
    { key: 'showLine2', label: 'Show Line 2', default: DEFAULTS.showLine2 },
    { key: 'showZigZag', label: 'Show ZigZag Legs', default: DEFAULTS.showZigZag },
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

/** One of the 16 fixed line series. `y: null` entries are gap-producing break points. */
export interface AnchoredVwapLineSeries {
  /** `${set}-${side}-active` | `-history-a` | `-history-b` | `${set}-zigzag` | `${set}-developing`. */
  key: string;
  /** Display name for tooltips: `AVWAP-1H {pct}%` / `AVWAP-1L {pct}%` / `AVWAP-2H {pct}%` / `AVWAP-2L {pct}%` / `ZZ {pct}%`. */
  name: string;
  /** Series color — for the ZigZag chain this is the fallback fill; per-leg hues live on the points. */
  color: string;
  /** Line 2 thicker than line 1; legs are thin context. */
  width: number;
  /** 'Line' for VWAP + developing leg, 'MultiColoredLine' for the confirmed chain (per-leg hues). */
  type: 'Line' | 'MultiColoredLine';
  /** Dash array for the developing leg; '' for solid. */
  dashArray: string;
  /** 'color' on the MultiColoredLine chain (per-leg hues on the points); '' elsewhere. */
  pointColorMapping: string;
  /** Points by bar index; `color` drives per-leg hue on the MultiColoredLine chain. */
  data: { index: number; y: number | null; color?: string }[];
}

type Params = Record<string, number | string | boolean>;

// =============================================================================
// 3. PARAM EXTRACTION
// =============================================================================

function extractConfig(params: Params): AnchoredVwapConfig {
  return {
    line1RetracementPct: Math.max(0.1, numParam(params['line1RetracementPct'], DEFAULTS.line1RetracementPct)),
    line2RetracementPct: Math.max(0.1, numParam(params['line2RetracementPct'], DEFAULTS.line2RetracementPct)),
    line1LeftDepth: Math.max(2, Math.floor(numParam(params['line1LeftDepth'], DEFAULTS.line1LeftDepth))),
    line1RightDepth: Math.max(2, Math.floor(numParam(params['line1RightDepth'], DEFAULTS.line1RightDepth))),
    line2LeftDepth: Math.max(2, Math.floor(numParam(params['line2LeftDepth'], DEFAULTS.line2LeftDepth))),
    line2RightDepth: Math.max(2, Math.floor(numParam(params['line2RightDepth'], DEFAULTS.line2RightDepth))),
    maxHistory: Math.max(0, Math.floor(numParam(params['maxHistory'], DEFAULTS.maxHistory))),
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

const LINE1_WIDTH = 1;
const LINE2_WIDTH = 2.5;
const LEG_WIDTH = 1;
const DEVELOPING_DASH = '5,3';

/** Concatenate segments into one series, separated by a break point after each segment's last bar. */
function pack(segments: AnchoredVwapSegment[]): AnchoredVwapLineSeries['data'] {
  return segments.flatMap((segment, i) => {
    const points: AnchoredVwapLineSeries['data'] = segment.points.map((p) => ({ index: p.index, y: p.y }));
    return i < segments.length - 1 ? [...points, { index: segment.endBar + 1, y: null }] : points;
  });
}

/**
 * Compute the 16 fixed Anchored VWAP line series.
 *
 * Per set: six VWAP slots (high/low × history-a/history-b/active) then the
 * ZigZag leg series — a confirmed chain (MultiColoredLine, each leg taking
 * its destination pivot's side hue) and a dashed developing leg to the
 * running extreme. `showZigZag: false` leaves the leg series empty.
 *
 * Order: line 1's slots + legs, then line 2's (line 2 draws on top); within
 * a slot, high before low, and `history-a`, `history-b`, then `active` last.
 * Always returns exactly 16 series, including for empty data.
 */
export function computeAnchoredVwapSeries(bars: PriceBar[], params: Params): AnchoredVwapLineSeries[] {
  const config = extractConfig(params);
  const { segments, legs } = computeAnchoredVwapResult(bars, config);
  const showZigZag = boolParam(params['showZigZag'], DEFAULTS.showZigZag);

  const sets = [
    {
      set: 'line1' as const,
      pct: config.line1RetracementPct,
      width: LINE1_WIDTH,
      highColor: colorParam(params['line1HighColor'], DEFAULTS.line1HighColor),
      lowColor: colorParam(params['line1LowColor'], DEFAULTS.line1LowColor),
      show: boolParam(params['showLine1'], DEFAULTS.showLine1),
    },
    {
      set: 'line2' as const,
      pct: config.line2RetracementPct,
      width: LINE2_WIDTH,
      highColor: colorParam(params['line2HighColor'], DEFAULTS.line2HighColor),
      lowColor: colorParam(params['line2LowColor'], DEFAULTS.line2LowColor),
      show: boolParam(params['showLine2'], DEFAULTS.showLine2),
    },
  ];

  return sets.flatMap(({ set, pct, width, highColor, lowColor, show }) => {
    const sideColor = (isHigh: boolean) => (isHigh ? highColor : lowColor);
    const vwapSeries = (['high', 'low'] as const).flatMap((side) => {
      const slot = segments
        .filter((s) => s.set === set && s.side === side)
        .sort((a, b) => a.startBar - b.startBar);
      const terminated = slot.filter((s) => !s.active);
      const live = slot.filter((s) => s.active);
      const base = {
        name: `AVWAP-${set === 'line1' ? '1' : '2'}${side === 'high' ? 'H' : 'L'} ${pct}%`,
        color: sideColor(side === 'high'),
        width,
        type: 'Line' as const,
        dashArray: '',
        pointColorMapping: '',
      };
      return [
        { ...base, key: `${set}-${side}-history-a`, data: pack(terminated.filter((_, k) => k % 2 === 0)) },
        { ...base, key: `${set}-${side}-history-b`, data: pack(terminated.filter((_, k) => k % 2 === 1)) },
        { ...base, key: `${set}-${side}-active`, data: pack(live) },
      ];
    });

    const legSet = legs.find((l) => l.set === set);
    // MultiColoredLine paints each segment with the color at its START
    // vertex, so vertex i carries the hue of the leg starting there (its
    // destination pivot's side). The terminal vertex has no outgoing leg —
    // its own side's hue. A lone anchor is still one marked vertex.
    const chainData: AnchoredVwapLineSeries['data'] = !showZigZag || !legSet
      ? []
      : legSet.vertices.map((v, i) => ({
          index: v.index,
          y: v.y,
          color: sideColor(legSet.vertices[i + 1]?.isHigh ?? v.isHigh),
        }));
    const chain: AnchoredVwapLineSeries = {
      key: `${set}-zigzag`,
      name: `ZZ ${pct}%`,
      color: sideColor(true),
      width: LEG_WIDTH,
      type: 'MultiColoredLine',
      dashArray: '',
      pointColorMapping: 'color',
      data: chainData,
    };
    const dev = legSet?.developing;
    const developing: AnchoredVwapLineSeries = {
      key: `${set}-developing`,
      name: `ZZ ${pct}% (developing)`,
      color: dev ? sideColor(dev.isHigh) : sideColor(true),
      width: LEG_WIDTH,
      type: 'Line',
      dashArray: DEVELOPING_DASH,
      pointColorMapping: '',
      data: showZigZag && dev ? [{ index: dev.from.index, y: dev.from.y }, { index: dev.to.index, y: dev.to.y }] : [],
    };

    // A hidden set empties only its VWAP slots — the leg series answer to
    // showZigZag alone, so legs can be inspected without the VWAP lines.
    // The 16-key structure is preserved either way (#955).
    return [...vwapSeries.map((s) => (show ? s : { ...s, data: [] })), chain, developing];
  });
}

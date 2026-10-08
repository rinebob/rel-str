/**
 * ST Anchored VWAP — chart indicator definition + series builder.
 *
 * Wraps the pure computation (`st-anchored-vwap.engine.ts`) into the
 * `IndicatorOption` shape used by flex-chart and maps its segments onto a
 * FIXED set of 12 line series: 4 slots (scale x side), each with one active
 * series and two history series that the slot's terminated segments alternate
 * between. The series count never depends on the data, because a Syncfusion
 * chart reinitialises when its series structure changes.
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
import { computeAnchoredVwap } from './st-anchored-vwap.engine';
import type { AnchoredVwapConfig, AnchoredVwapSegment } from './st-anchored-vwap.types';

// =============================================================================
// 1. CHART CONFIGURATION
// =============================================================================

const DEFAULTS = {
  smallRetracementPct: 2,
  largeRetracementPct: 5,
  leftDepth: 5,
  rightDepth: 5,
  smallHighColor: '#FF8CFF',
  smallLowColor: '#8CF5FF',
  largeHighColor: '#FF00E6',
  largeLowColor: '#00E5FF',
  maxHistory: 100,
} as const;

export const ST_ANCHORED_VWAP_INDICATOR: IndicatorOption = {
  id: 'st-anchored-vwap',
  label: 'ST Anchored VWAP',
  type: StIndicator.ST_ANCHORED_VWAP,
  defaultPane: 'overlay',
  axisScale: 'price',
  params: [
    { key: 'smallRetracementPct', label: 'Small Retracement %', default: DEFAULTS.smallRetracementPct, min: 0.1, max: 50 },
    { key: 'largeRetracementPct', label: 'Large Retracement %', default: DEFAULTS.largeRetracementPct, min: 0.1, max: 50 },
    { key: 'leftDepth', label: 'Left Depth', default: DEFAULTS.leftDepth, min: 2, max: 100 },
    { key: 'rightDepth', label: 'Right Depth', default: DEFAULTS.rightDepth, min: 2, max: 100 },
    { key: 'smallHighColor', label: 'Small High Color', default: DEFAULTS.smallHighColor },
    { key: 'smallLowColor', label: 'Small Low Color', default: DEFAULTS.smallLowColor },
    { key: 'largeHighColor', label: 'Large High Color', default: DEFAULTS.largeHighColor },
    { key: 'largeLowColor', label: 'Large Low Color', default: DEFAULTS.largeLowColor },
    { key: 'maxHistory', label: 'Max History', default: DEFAULTS.maxHistory, min: 0, max: 1000 },
  ],
};

// =============================================================================
// 2. TYPES
// =============================================================================

/** One of the 12 fixed line series. `y: null` entries are gap-producing break points. */
export interface AnchoredVwapLineSeries {
  /** `${scale}-${side}-active` | `${scale}-${side}-history-a` | `${scale}-${side}-history-b`. */
  key: string;
  /** Display name for tooltips: `AVWAP-H {pct}%` / `AVWAP-L {pct}%`. */
  name: string;
  color: string;
  /** Large scale thicker than small. */
  width: number;
  /** Points by bar index. */
  data: { index: number; y: number | null }[];
}

type Params = Record<string, number | string | boolean>;

// =============================================================================
// 3. PARAM EXTRACTION
// =============================================================================

function num(v: number | string | boolean | undefined, fallback: number): number {
  const n = Number(v ?? fallback);
  return Number.isFinite(n) ? n : fallback;
}

function colorParam(v: number | string | boolean | undefined, fallback: string): string {
  return typeof v === 'string' && v !== '' ? v : fallback;
}

function extractConfig(params: Params): AnchoredVwapConfig {
  return {
    smallRetracementPct: Math.max(0.1, num(params['smallRetracementPct'], DEFAULTS.smallRetracementPct)),
    largeRetracementPct: Math.max(0.1, num(params['largeRetracementPct'], DEFAULTS.largeRetracementPct)),
    leftDepth: Math.max(2, Math.floor(num(params['leftDepth'], DEFAULTS.leftDepth))),
    rightDepth: Math.max(2, Math.floor(num(params['rightDepth'], DEFAULTS.rightDepth))),
    maxHistory: Math.max(0, Math.floor(num(params['maxHistory'], DEFAULTS.maxHistory))),
  };
}

// =============================================================================
// 4. FIXED-SLOT SERIES
// =============================================================================

const SMALL_WIDTH = 1;
const LARGE_WIDTH = 2.5;

/** Concatenate segments into one series, separated by a break point after each segment's last bar. */
function pack(segments: AnchoredVwapSegment[]): AnchoredVwapLineSeries['data'] {
  return segments.flatMap((segment, i) => {
    const points: AnchoredVwapLineSeries['data'] = segment.points.map((p) => ({ index: p.index, y: p.y }));
    return i < segments.length - 1 ? [...points, { index: segment.endBar + 1, y: null }] : points;
  });
}

/**
 * Compute the 12 fixed Anchored VWAP line series.
 *
 * Order: small scale then large (the large lines draw on top); within a
 * slot, high before low, and `history-a`, `history-b`, then `active` last.
 * Always returns exactly 12 series, including for empty data.
 */
export function computeAnchoredVwapSeries(bars: PriceBar[], params: Params): AnchoredVwapLineSeries[] {
  const config = extractConfig(params);
  const segments = computeAnchoredVwap(bars, config);

  const scales = [
    {
      scale: 'small' as const,
      pct: config.smallRetracementPct,
      width: SMALL_WIDTH,
      highColor: colorParam(params['smallHighColor'], DEFAULTS.smallHighColor),
      lowColor: colorParam(params['smallLowColor'], DEFAULTS.smallLowColor),
    },
    {
      scale: 'large' as const,
      pct: config.largeRetracementPct,
      width: LARGE_WIDTH,
      highColor: colorParam(params['largeHighColor'], DEFAULTS.largeHighColor),
      lowColor: colorParam(params['largeLowColor'], DEFAULTS.largeLowColor),
    },
  ];

  return scales.flatMap(({ scale, pct, width, highColor, lowColor }) =>
    (['high', 'low'] as const).flatMap((side) => {
      const slot = segments
        .filter((s) => s.scale === scale && s.side === side)
        .sort((a, b) => a.startBar - b.startBar);
      const terminated = slot.filter((s) => !s.active);
      const live = slot.filter((s) => s.active);
      const base = {
        name: `AVWAP-${side === 'high' ? 'H' : 'L'} ${pct}%`,
        color: side === 'high' ? highColor : lowColor,
        width,
      };
      return [
        { ...base, key: `${scale}-${side}-history-a`, data: pack(terminated.filter((_, k) => k % 2 === 0)) },
        { ...base, key: `${scale}-${side}-history-b`, data: pack(terminated.filter((_, k) => k % 2 === 1)) },
        { ...base, key: `${scale}-${side}-active`, data: pack(live) },
      ];
    }),
  );
}

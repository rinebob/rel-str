/**
 * ST ZigZag — chart indicator definition + calculator.
 *
 * Wraps the pure ZigZag engine (`st-zigzag.engine.ts`) into the
 * `IndicatorOption` / `IndicatorCalculator` shape used by flex-chart.
 *
 * Two outputs:
 *  - `calculateZigZag` — basic `IndicatorCalculator` returning confirmed
 *    pivot points as `{ x, y }[]` for simple line rendering.
 *  - `computeZigZagSeries` — full multi-line series: solid segments
 *    connecting confirmed pivots + a dashed segment for the projected
 *    (unconfirmed) pivot. Consumed by `ChartDataAdapter.zigZagSeries`.
 */

import type { IndicatorOption, IndicatorCalculator, PriceBar } from '../flex-chart.types';
import { StIndicator } from '../flex-chart.types';
import { computeZigZagPivots, DEFAULT_CONFIG } from './st-zigzag.engine';
import type { ZigZagConfig, Pivot } from './st-zigzag.engine';

// =============================================================================
// 1. CHART CONFIGURATION
// =============================================================================

export const ST_ZIGZAG_INDICATOR: IndicatorOption = {
  id: 'st-zigzag',
  label: 'ST ZigZag',
  type: StIndicator.ST_ZIGZAG,
  defaultPane: 'overlay',
  axisScale: 'price',
  params: [
    { key: 'devThreshold', label: 'Dev Threshold %', default: DEFAULT_CONFIG.devThreshold, min: 0.1, max: 50 },
    { key: 'leftDepth', label: 'Left Depth', default: DEFAULT_CONFIG.leftDepth, min: 2, max: 100 },
    { key: 'rightDepth', label: 'Right Depth', default: DEFAULT_CONFIG.rightDepth, min: 2, max: 100 },
    { key: 'allowZigZagOnOneBar', label: 'Allow on One Bar', default: DEFAULT_CONFIG.allowZigZagOnOneBar },
    { key: 'projectionPivots', label: 'Projection Pivots', default: DEFAULT_CONFIG.projectionPivots },
  ],
};

// =============================================================================
// 2. TYPES
// =============================================================================

/** A single named line series for chart rendering. */
export interface ZigZagLineSeries {
  /** Unique key for this line segment. */
  key: string;
  /** Display name for legend/tooltip. */
  name: string;
  /** Line color. */
  color: string;
  /** Line width. */
  width: number;
  /** Dash array for dashed lines (empty for solid). */
  dashArray: string;
  /** Data points: index from bar, y value. */
  data: { index: number; y: number }[];
}

/** Complete chart-ready output for the ZigZag indicator. */
export interface ZigZagChartSeries {
  /** Solid line segments connecting confirmed pivots. */
  lines: ZigZagLineSeries[];
  /** Dashed line from last confirmed pivot to projected pivot (undefined if no projection). */
  projectedLine?: ZigZagLineSeries;
}

// =============================================================================
// 3. PARAM EXTRACTION
// =============================================================================

/** Parse a boolean param that may be a string ('true'/'false'), boolean, or undefined. */
function toBool(v: number | string | boolean | undefined, fallback: boolean): boolean {
  if (v === true || v === 'true') return true;
  if (v === false || v === 'false') return false;
  return fallback;
}

/** Extract a ZigZagConfig from indicator params, falling back to DEFAULT_CONFIG. */
function extractConfig(params: Record<string, number | string | boolean>): ZigZagConfig {
  return {
    devThreshold: Math.max(0.1, Number(params['devThreshold'] ?? DEFAULT_CONFIG.devThreshold)),
    leftDepth: Math.max(2, Math.floor(Number(params['leftDepth'] ?? DEFAULT_CONFIG.leftDepth))),
    rightDepth: Math.max(2, Math.floor(Number(params['rightDepth'] ?? DEFAULT_CONFIG.rightDepth))),
    allowZigZagOnOneBar: toBool(params['allowZigZagOnOneBar'], DEFAULT_CONFIG.allowZigZagOnOneBar),
    projectionPivots: toBool(params['projectionPivots'], DEFAULT_CONFIG.projectionPivots),
  };
}

// =============================================================================
// 4. INDICATOR CALCULATOR (IndicatorCalculator signature)
// =============================================================================

/**
 * calculateZigZag — returns confirmed pivot points as `{ x, y }[]`.
 * For full multi-line rendering with dashed projection, use
 * `computeZigZagSeries` instead.
 */
export const calculateZigZag: IndicatorCalculator = (bars, params) => {
  if (bars.length === 0) return [];

  const config = extractConfig(params);
  const { pivots, projection } = computeZigZagPivots(bars, config);

  const points: { x: Date; y: number }[] = [];
  for (const pivot of pivots) {
    const bar = bars[pivot.barIndex];
    if (bar) {
      points.push({ x: bar.x, y: pivot.price });
    }
  }
  if (projection) {
    const bar = bars[projection.barIndex];
    if (bar) {
      points.push({ x: bar.x, y: projection.price });
    }
  }

  return points;
};

// =============================================================================
// 5. FULL SERIES COMPUTATION (for chart rendering)
// =============================================================================

const ZIGZAG_COLOR = '#1976d2';
const ZIGZAG_WIDTH = 1.5;
const PROJECTED_DASH = '5,3';

/**
 * Compute ZigZag chart series: solid segments connecting confirmed pivots
 * + a dashed segment from the last confirmed pivot to the projected pivot.
 */
export function computeZigZagSeries(
  bars: PriceBar[],
  params: Record<string, number | string | boolean>,
): ZigZagChartSeries {
  if (bars.length === 0) return { lines: [] };

  const config = extractConfig(params);
  const { pivots, projection } = computeZigZagPivots(bars, config);

  if (pivots.length === 0 && !projection) {
    return { lines: [] };
  }

  const lines: ZigZagLineSeries[] = [];

  // Build solid segments between consecutive confirmed pivots.
  // Each segment is a pair of adjacent pivots → one line series.
  for (let i = 0; i < pivots.length - 1; i++) {
    const start = pivots[i];
    const end = pivots[i + 1];
    lines.push(buildSegment(
      `zigzag-${start.barIndex}-${end.barIndex}`,
      'ZigZag',
      ZIGZAG_COLOR,
      ZIGZAG_WIDTH,
      '',
      start,
      end,
    ));
  }

  // Build the dashed projected line from the last confirmed pivot to the projection.
  let projectedLine: ZigZagLineSeries | undefined;
  if (projection && pivots.length > 0) {
    const lastConfirmed = pivots[pivots.length - 1];
    projectedLine = buildSegment(
      'zigzag-projected',
      'ZigZag (projected)',
      ZIGZAG_COLOR,
      ZIGZAG_WIDTH,
      PROJECTED_DASH,
      lastConfirmed,
      projection,
    );
  }

  return { lines, projectedLine };
}

/** Build a ZigZagLineSeries from two pivot endpoints. */
function buildSegment(
  key: string,
  name: string,
  color: string,
  width: number,
  dashArray: string,
  start: Pivot,
  end: Pivot,
): ZigZagLineSeries {
  return {
    key,
    name,
    color,
    width,
    dashArray,
    data: [
      { index: start.barIndex, y: start.price },
      { index: end.barIndex, y: end.price },
    ],
  };
}

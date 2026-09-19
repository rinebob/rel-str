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
import { computeZigZagPivots, computeTriggerPoints, DEFAULT_CONFIG } from './st-zigzag.engine';
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
    { key: 'lineColor', label: 'Line Color', default: DEFAULT_CONFIG.lineColor },
    { key: 'showTriggerDots', label: 'Trigger Dots', default: true },
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

/** Scatter series of reversal-trigger dots — one dot per pivot at the
 *  bar where price first crossed the deviation threshold. */
export interface ZigZagTriggerSeries {
  /** Unique key for this series. */
  key: string;
  /** Display name for legend/tooltip. */
  name: string;
  /** Scatter points: trigger bar index, threshold price level, series color. */
  data: { index: number; y: number; color: string }[];
}

/** Complete chart-ready output for the ZigZag indicator. */
export interface ZigZagChartSeries {
  /** Solid line segments connecting confirmed pivots. */
  lines: ZigZagLineSeries[];
  /** Dashed line from last confirmed pivot to projected pivot (undefined if no projection). */
  projectedLine?: ZigZagLineSeries;
  /** Reversal-trigger dots on the bars that crossed the deviation threshold. */
  triggers?: ZigZagTriggerSeries;
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
    lineColor: typeof params['lineColor'] === 'string' ? params['lineColor'] : DEFAULT_CONFIG.lineColor,
    showTriggerDots: toBool(params['showTriggerDots'], true),
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

const ZIGZAG_WIDTH = 1.5;
const PROJECTED_DASH = '5,3';

/** Options for multi-instance ZigZag rendering. */
export interface ComputeZigZagSeriesOptions {
  /** Unique instance ID used to namespace line keys and names. */
  instanceId?: string;
  /** Override line color; falls back to config.params.lineColor, then DEFAULT_CONFIG.lineColor. */
  lineColor?: string;
}

/**
 * Compute ZigZag chart series: solid segments connecting confirmed pivots
 * + a dashed segment from the last confirmed pivot to the projected pivot.
 *
 * When `options.instanceId` is provided, line keys and names are namespaced
 * to support multiple ZigZag instances on the same chart.
 */
export function computeZigZagSeries(
  bars: PriceBar[],
  params: Record<string, number | string | boolean>,
  options?: ComputeZigZagSeriesOptions,
): ZigZagChartSeries {
  if (bars.length === 0) return { lines: [] };

  const config = extractConfig(params);
  const { pivots, projection } = computeZigZagPivots(bars, config);

  if (pivots.length === 0 && !projection) {
    return { lines: [] };
  }

  const instanceId = options?.instanceId;
  const prefix = instanceId ? `${instanceId}-` : '';
  const lineColor = options?.lineColor ?? config.lineColor;
  const baseName = instanceId ? `ZigZag (${instanceId})` : 'ZigZag';
  const projectedName = instanceId ? `ZigZag (${instanceId}, projected)` : 'ZigZag (projected)';

  const lines: ZigZagLineSeries[] = [];

  // Build solid segments between consecutive confirmed pivots.
  // Each segment is a pair of adjacent pivots → one line series.
  for (let i = 0; i < pivots.length - 1; i++) {
    const start = pivots[i];
    const end = pivots[i + 1];
    lines.push(buildSegment(
      `${prefix}zigzag-${start.barIndex}-${end.barIndex}`,
      baseName,
      lineColor,
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
      `${prefix}zigzag-projected`,
      projectedName,
      lineColor,
      ZIGZAG_WIDTH,
      PROJECTED_DASH,
      lastConfirmed,
      projection,
    );
  }

  // Reversal-trigger dots — one per pivot, on the bar that first crossed
  // the deviation threshold (the bar that flipped the switch). Disabled
  // via the showTriggerDots config flag.
  const triggerPoints = config.showTriggerDots === false
    ? []
    : computeTriggerPoints(bars, pivots, config.devThreshold);
  let triggers: ZigZagTriggerSeries | undefined;
  if (triggerPoints.length > 0) {
    triggers = {
      key: `${prefix}zigzag-triggers`,
      name: `${baseName} triggers`,
      data: triggerPoints.map((t) => ({ index: t.barIndex, y: t.price, color: lineColor })),
    };
  }

  return { lines, projectedLine, triggers };
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

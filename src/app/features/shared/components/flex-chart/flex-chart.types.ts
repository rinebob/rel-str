/**
 * Flex Chart Types
 *
 * Type definitions for the flexible multi-pane chart component.
 */

import type { BarsInterval } from '../../../../core/models/partner.types';

/** Price bar data point */
export interface PriceBar {
  date: string;
  x: Date;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
}

/** Chart dataset */
export interface FlexChartDataset {
  symbol: string;
  interval: BarsInterval;
  bars: PriceBar[];
}

/** Indicator types supported */
export type IndicatorType =
  | 'sma'      // Simple Moving Average
  | 'ema'      // Exponential Moving Average
  | 'bollinger' // Bollinger Bands
  | 'rsi'      // Relative Strength Index
  | 'macd'     // MACD
  | 'adx'      // Average Directional Index
  | 'volume'   // Volume bars
  | 'st-trend-bands'     // ST Trend Bands (overlay)
  | 'st-zone'            // ST Zone Classification (lower pane)
  | 'st-trend-strength'  // ST Trend Strength (lower pane)
  | 'st-trigger-band'    // ST Trigger Band (overlay)
  | 'custom';  // Custom indicator (data provided externally)

/** Pane assignment for indicators */
export type IndicatorPane = 'main' | 'overlay' | 'lower-1' | 'lower-2' | 'lower-3' | 'lower-4';

/** Series type for rendering */
export type SeriesType = 'line' | 'area' | 'column' | 'band' | 'candle' | 'scatter';

/** Individual indicator configuration */
export interface IndicatorConfig {
  /** Unique ID for this indicator instance */
  id: string;

  /** Indicator type */
  type: IndicatorType;

  /** Which pane to render in */
  pane: IndicatorPane;

  /** Series type for rendering */
  seriesType: SeriesType;

  /** Indicator parameters (period, etc.) */
  params: Record<string, number | string | boolean>;

  /** Visual styling options */
  options: {
    /** Display name in legend */
    name?: string;

    /** Primary color */
    color?: string;

    /** Secondary color (for bands, fills) */
    color2?: string;

    /** Line width */
    lineWidth?: number;

    /** Show filled area under line */
    fillArea?: boolean;

    /** Opacity for fills */
    opacity?: number;

    /** Dash array for dashed lines */
    dashArray?: string;

    /** Visibility toggle */
    visible?: boolean;

    /** Y-axis scale: 'fixed-0-100' for RSI-type, 'price' for overlays, 'fixed' for custom range, 'auto' for everything else */
    axisScale?: 'auto' | 'fixed-0-100' | 'price' | 'fixed';

    /** Custom axis min/max (used when axisScale is 'fixed') */
    axisMin?: number;
    axisMax?: number;

    /** Horizontal reference lines to draw on this indicator's pane */
    referenceLines?: { value: number; color: string; dashArray?: string; label?: string }[];

    /** Show histogram (MACD histogram = MACD line - signal line) */
    showHistogram?: boolean;
  };

  /** Pre-calculated indicator data (optional - if not provided, will be calculated from price bars) */
  data?: { x: Date; y: number; y2?: number }[];
}

/** Pane configuration */
export interface PaneConfig {
  /** Pane ID (matches IndicatorPane) */
  id: IndicatorPane;

  /** Height ratio relative to total chart height */
  heightRatio: number;

  /** Y-axis configuration */
  yAxis: {
    /** Axis label */
    label?: string;

    /** Format string for values */
    format?: string;

    /** Min value (auto if not specified) */
    min?: number;

    /** Max value (auto if not specified) */
    max?: number;
  };
}

/** Complete chart configuration */
export interface FlexChartConfig {
  /** Array of indicators to display */
  indicators: IndicatorConfig[];

  /** Pane configurations (optional - defaults will be created based on indicators) */
  panes?: PaneConfig[];

  /** Show/hide crosshair */
  showCrosshair?: boolean;

  /** Show/hide zoom toolbar */
  showZoomToolbar?: boolean;

  /** Enable/disable scrollbar */
  enableScrollbar?: boolean;

  /** Initial zoom days */
  initialZoomDays?: number;
}

/** Computed indicator series - supports both Date (DateTime) and index (Category) x values */
export interface ComputedIndicatorSeries {
  id: string;
  config: IndicatorConfig;
  data: { x?: Date; index?: number; y: number; y2?: number; y3?: number; bandHigh?: number; bandLow?: number; up?: boolean }[];
}

/** Parameter definition for indicator config dialogs */
export interface IndicatorParamDef {
  key: string;
  label: string;
  default: number;
  min: number;
  max: number;
}

/** Available indicator definition — each indicator type exports one of these */
export interface IndicatorOption {
  id: string;
  label: string;
  type: IndicatorType;
  defaultPane: IndicatorPane;
  axisScale?: 'auto' | 'fixed-0-100' | 'price' | 'fixed';
  params: IndicatorParamDef[];
  /** Default options applied when this indicator is added (referenceLines, histogram, etc.) */
  defaultOptions?: Partial<IndicatorConfig['options']>;
}

/** Indicator calculation function signature */
export type IndicatorCalculator = (
  bars: PriceBar[],
  params: Record<string, number | string | boolean>
) => { x: Date; y: number; y2?: number; y3?: number; bandHigh?: number; bandLow?: number; up?: boolean }[];

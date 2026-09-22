/**
 * Scale Strategy Types
 *
 * Abstractions for price-axis scaling (linear vs logarithmic) used by the
 * Y-axis viewport controller. Keeping the two modes behind a strategy prevents
 * the main chart component from branching on `config.logScale` everywhere.
 */

import type { PriceBar } from '../flex-chart.types';
import type { ChartYAxisViewport } from '../store/chart-viewport.store';

export { ChartYAxisViewport };

export interface AxisRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface VisibleRange {
  min: number;
  max: number;
  delta: number;
}

/** Axis style overrides a scale strategy may contribute to primaryYAxis
 *  (e.g. the log scale hides generated gridlines/ticks because stripLines
 *  draw the real ticks). */
export interface AxisStyleConfig {
  majorGridLines?: { width: number };
  majorTickLines?: { width: number };
  edgeLabelPlacement?: 'Shift' | 'None';
  interval?: number;
}

export interface ScaleStrategy {
  /** Extra axis style properties that belong to this scale. */
  readonly axisConfig: AxisStyleConfig;

  /**
   * Transform a price into axis units — the value bound to primary-pane
   * series and applied as axis min/max. Identity for linear; log10(price)
   * with a positive floor for log.
   */
  transformValue(price: number): number;

  /** Invert an axis-unit value back to a real price. */
  invertValue(axisValue: number): number;

  /**
   * Compute the Y-axis viewport for the visible bars.
   * @param visibleBars Bars currently visible on the X-axis.
   */
  computeViewport(visibleBars: PriceBar[]): ChartYAxisViewport;

  /** Format a numeric axis value for display */
  formatLabel(value: number): string;

  /** Convert a pixel position within the Y-axis rect back to a price */
  priceFromPixel(pixelY: number, yRect: AxisRect, range: VisibleRange): number;

  /** Convert a price to a pixel position within the Y-axis rect */
  pixelFromPrice(price: number, yRect: AxisRect, range: VisibleRange): number;
}

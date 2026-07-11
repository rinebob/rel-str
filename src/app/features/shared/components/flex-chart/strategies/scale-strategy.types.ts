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

export interface ScaleStrategy {
  /** Syncfusion valueType for this scale */
  readonly valueType: 'Logarithmic' | 'Double';

  /** Extra axis properties that belong to this scale (e.g. interval, edgeLabelPlacement) */
  readonly axisConfig: Record<string, unknown>;

  /**
   * Compute the Y-axis viewport for the visible bars.
   * @param allBars Full dataset, used for log-scale auto-range reference.
   * @param visibleBars Bars currently visible on the X-axis.
   */
  computeViewport(allBars: PriceBar[], visibleBars: PriceBar[]): ChartYAxisViewport;

  /** Format a numeric axis value for display */
  formatLabel(value: number): string;

  /** Convert a pixel position within the Y-axis rect back to a price */
  priceFromPixel(pixelY: number, yRect: AxisRect, range: VisibleRange): number;

  /** Convert a price to a pixel position within the Y-axis rect */
  pixelFromPrice(price: number, yRect: AxisRect, range: VisibleRange): number;
}

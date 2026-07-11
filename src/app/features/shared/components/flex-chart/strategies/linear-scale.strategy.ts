/**
 * Linear Scale Strategy
 *
 * Standard price-axis scaling: additive padding around the visible range.
 */

import type { PriceBar } from '../flex-chart.types';
import type { AxisRect, ScaleStrategy, VisibleRange } from './scale-strategy.types';
import type { ChartYAxisViewport } from '../store/chart-viewport.store';

export class LinearScaleStrategy implements ScaleStrategy {
  readonly valueType: 'Double' = 'Double';
  readonly axisConfig: Record<string, unknown> = {};

  private static readonly PAD_FACTOR = 0.03;

  computeViewport(_allBars: PriceBar[], visibleBars: PriceBar[]): ChartYAxisViewport {
    if (visibleBars.length === 0) {
      return { valueType: this.valueType, min: 0, max: 1 };
    }
    const rawMin = Math.min(...visibleBars.map(b => b.low));
    const rawMax = Math.max(...visibleBars.map(b => b.high));
    const pad = (rawMax - rawMin) * LinearScaleStrategy.PAD_FACTOR;
    return {
      valueType: this.valueType,
      min: Math.max(0, rawMin - pad),
      max: rawMax + pad,
    };
  }

  formatLabel(value: number): string {
    return `$${Math.round(value).toLocaleString('en-US')}`;
  }

  priceFromPixel(pixelY: number, yRect: AxisRect, range: VisibleRange): number {
    const ratio = pixelY / yRect.height;
    return range.max - ratio * range.delta;
  }

  pixelFromPrice(price: number, yRect: AxisRect, range: VisibleRange): number {
    const ratio = (range.max - price) / range.delta;
    return yRect.y + ratio * yRect.height;
  }
}

/**
 * Linear Scale Strategy
 *
 * Standard price-axis scaling: additive padding around the visible range.
 */

import type { PriceBar } from '../flex-chart.types';
import type { AxisRect, AxisStyleConfig, ScaleStrategy, VisibleRange } from './scale-strategy.types';
import type { ChartYAxisViewport } from '../store/chart-viewport.store';
import { formatPrice } from './price-format';

export class LinearScaleStrategy implements ScaleStrategy {
  readonly axisConfig: AxisStyleConfig = {};

  private static readonly PAD_FACTOR = 0.03;

  transformValue(price: number): number {
    return price;
  }

  invertValue(axisValue: number): number {
    return axisValue;
  }

  computeViewport(visibleBars: PriceBar[]): ChartYAxisViewport {
    if (visibleBars.length === 0) {
      return { min: 0, max: 1 };
    }
    const rawMin = Math.min(...visibleBars.map(b => b.low));
    const rawMax = Math.max(...visibleBars.map(b => b.high));
    const pad = (rawMax - rawMin) * LinearScaleStrategy.PAD_FACTOR;
    return {
      min: Math.max(0, rawMin - pad),
      max: rawMax + pad,
    };
  }

  formatLabel(value: number): string {
    return formatPrice(value);
  }

  priceFromPixel(pixelY: number, yRect: AxisRect, range: VisibleRange): number {
    if (range.delta <= 0) return range.max;
    const ratio = pixelY / yRect.height;
    return range.max - ratio * range.delta;
  }

  pixelFromPrice(price: number, yRect: AxisRect, range: VisibleRange): number {
    if (range.delta <= 0) return yRect.y;
    const ratio = (range.max - price) / range.delta;
    return yRect.y + ratio * yRect.height;
  }
}

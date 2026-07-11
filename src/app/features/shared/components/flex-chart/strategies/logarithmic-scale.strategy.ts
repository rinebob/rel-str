/**
 * Logarithmic Scale Strategy
 *
 * Logarithmic price-axis scaling using Syncfusion's built-in log axis. The
 * built-in log axis does not support arbitrary min/max ranges; it snaps labels
 * to powers of 10. This strategy keeps the full-data auto-range and uses
 * `zoomFactor`/`zoomPosition` to zoom the Y-axis to the visible log range.
 *
 * The strategy is retained for future work. The toolbar toggle is reachable,
 * but the built-in log axis will not render a correctly-snapped Y-axis until a
 * manual log implementation is added.
 */

import type { PriceBar } from '../flex-chart.types';
import type { AxisRect, ScaleStrategy, VisibleRange } from './scale-strategy.types';
import type { ChartYAxisViewport } from '../store/chart-viewport.store';

export class LogarithmicScaleStrategy implements ScaleStrategy {
  readonly valueType: 'Logarithmic' = 'Logarithmic';
  readonly axisConfig: Record<string, unknown> = {
    edgeLabelPlacement: 'Shift',
    interval: 1,
  };

  private static readonly MIN_LOG_VALUE = 0.001;
  private static readonly PAD_FACTOR = 1.03;

  computeViewport(allBars: PriceBar[], visibleBars: PriceBar[]): ChartYAxisViewport {
    if (visibleBars.length === 0 || allBars.length === 0) {
      return {
        valueType: this.valueType,
        min: LogarithmicScaleStrategy.MIN_LOG_VALUE,
        max: 1,
      };
    }

    const fullMin = Math.min(...allBars.map(b => b.low));
    const fullMax = Math.max(...allBars.map(b => b.high));
    const rawMin = Math.min(...visibleBars.map(b => b.low));
    const rawMax = Math.max(...visibleBars.map(b => b.high));

    if (fullMin <= 0 || fullMax <= 0 || rawMin <= 0 || rawMax <= 0) {
      return {
        valueType: this.valueType,
        min: LogarithmicScaleStrategy.MIN_LOG_VALUE,
        max: fullMax,
      };
    }

    const fullLogMin = Math.log10(fullMin);
    const fullLogMax = Math.log10(fullMax);
    const visibleLogMin = Math.log10(
      Math.max(LogarithmicScaleStrategy.MIN_LOG_VALUE, rawMin / LogarithmicScaleStrategy.PAD_FACTOR)
    );
    const visibleLogMax = Math.log10(rawMax * LogarithmicScaleStrategy.PAD_FACTOR);

    const fullLogRange = fullLogMax - fullLogMin;
    const visibleLogRange = visibleLogMax - visibleLogMin;

    if (fullLogRange <= 0 || visibleLogRange <= 0) {
      return {
        valueType: this.valueType,
        min: fullMin,
        max: fullMax,
      };
    }

    return {
      valueType: this.valueType,
      min: fullMin,
      max: fullMax,
      zoomFactor: visibleLogRange / fullLogRange,
      zoomPosition: (visibleLogMin - fullLogMin) / fullLogRange,
    };
  }

  formatLabel(value: number): string {
    // Built-in Syncfusion log axis passes actual prices to the label formatter.
    return `$${Math.round(value).toLocaleString('en-US')}`;
  }

  priceFromPixel(pixelY: number, yRect: AxisRect, range: VisibleRange): number {
    const ratio = pixelY / yRect.height;
    const maxLog = Math.log10(range.max);
    const minLog = Math.log10(range.min);
    return Math.pow(10, maxLog - ratio * (maxLog - minLog));
  }

  pixelFromPrice(price: number, yRect: AxisRect, range: VisibleRange): number {
    if (range.min <= 0 || price <= 0) return yRect.y;
    const ratio = Math.log10(range.max / price) / Math.log10(range.max / range.min);
    return yRect.y + ratio * yRect.height;
  }
}

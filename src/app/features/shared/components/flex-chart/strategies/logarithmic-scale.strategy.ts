/**
 * Logarithmic Scale Strategy
 *
 * Manual log transform on a plain `Double` axis. Syncfusion's built-in
 * `Logarithmic` valueType snaps labels/extents to powers of 10 and ignores
 * arbitrary min/max, so instead the series data is transformed upstream
 * (ChartDataAdapter applies `transformValue` to every primary-pane value)
 * and this strategy drives the axis with ordinary log-space min/max —
 * the same mechanism that already works for the linear axis.
 *
 * Values at or below zero clamp to LOG_AXIS_FLOOR — log is undefined for
 * non-positive inputs.
 */
import type { PriceBar } from '../flex-chart.types';
import type { AxisRect, AxisStyleConfig, ScaleStrategy, VisibleRange } from './scale-strategy.types';
import type { ChartYAxisViewport } from '../store/chart-viewport.store';
import { toLogAxis, fromLogAxis } from './log-transform';
import { formatPrice } from './price-format';

export class LogarithmicScaleStrategy implements ScaleStrategy {
  /**
   * Generated gridlines are hidden in log mode — they sit at uniform
   * log-space positions that don't correspond to round prices. Real
   * gridlines+labels are drawn as stripLines at exact log10(tick) positions
   * by the lifecycle facade instead.
   */
  readonly axisConfig: AxisStyleConfig = {
    majorGridLines: { width: 0 },
    majorTickLines: { width: 0 },
  };

  /** Same 3% padding as the linear strategy, applied in log space. */
  private static readonly PAD_FACTOR = 0.03;
  /** Fallback half-width in log units for a flat (single-price) range. */
  private static readonly FLAT_PAD = 0.01;

  transformValue(price: number): number {
    return toLogAxis(price);
  }

  invertValue(axisValue: number): number {
    return fromLogAxis(axisValue);
  }

  computeViewport(visibleBars: PriceBar[]): ChartYAxisViewport {
    if (visibleBars.length === 0) {
      return { min: 0, max: 1 };
    }
    const rawMin = Math.min(...visibleBars.map(b => b.low));
    const rawMax = Math.max(...visibleBars.map(b => b.high));
    const lo = toLogAxis(rawMin);
    const hi = toLogAxis(rawMax);
    const pad = hi - lo > 0
      ? (hi - lo) * LogarithmicScaleStrategy.PAD_FACTOR
      : LogarithmicScaleStrategy.FLAT_PAD;
    return {
      min: lo - pad,
      max: hi + pad,
    };
  }

  /** Axis labels arrive in log units — invert to real price for display. */
  formatLabel(value: number): string {
    return formatPrice(this.invertValue(value));
  }

  /** Pixel → price: the axis is linear in log space, so interpolate then invert. */
  priceFromPixel(pixelY: number, yRect: AxisRect, range: VisibleRange): number {
    if (range.delta <= 0) return this.invertValue(range.max);
    const ratio = pixelY / yRect.height;
    return this.invertValue(range.max - ratio * range.delta);
  }

  /** Price → pixel: transform to log space, then linear-position in the range. */
  pixelFromPrice(price: number, yRect: AxisRect, range: VisibleRange): number {
    if (range.delta <= 0) return yRect.y;
    const v = this.transformValue(price);
    const ratio = (range.max - v) / range.delta;
    return yRect.y + ratio * yRect.height;
  }
}

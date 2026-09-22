/**
 * Chart Y-Axis Viewport Controller
 *
 * Computes the primary Y-axis viewport for the visible bar slice and applies
 * the scale-specific strategy (linear vs logarithmic). Both strategies emit a
 * plain Double-axis min/max — the log scale transforms the data upstream and
 * treats the axis as linear over log10(price) values.
 */

import { Injectable } from '@angular/core';
import type { PriceBar } from '../flex-chart.types';
import { ChartYAxisViewport } from '../store/chart-viewport.store';
import {
  AxisRect,
  LinearScaleStrategy,
  LogarithmicScaleStrategy,
  ScaleStrategy,
  VisibleRange,
} from '../strategies';

export interface PrimaryYAxisConfig {
  labelFormat: string;
  /** Always 'Double' — the log scale is a manual transform, not a native axis. */
  valueType: 'Double';
  opposedPosition: boolean;
  rowIndex: number;
  majorGridLines: { width: number };
  crosshairTooltip: { enable: boolean };
  minimum?: number;
  maximum?: number;
}

@Injectable()
export class ChartYAxisViewportController {
  private readonly linear = new LinearScaleStrategy();
  private readonly logarithmic = new LogarithmicScaleStrategy();

  private strategy(logScale: boolean): ScaleStrategy {
    return logScale ? this.logarithmic : this.linear;
  }

  /**
   * Compute the Y-axis viewport for the given visible bars. The returned
   * min/max are in the strategy's axis units — price units for linear,
   * log10(price) for log.
   */
  computeViewport(logScale: boolean, visibleBars: PriceBar[]): ChartYAxisViewport {
    return this.strategy(logScale).computeViewport(visibleBars);
  }

  /** Transform a price into the strategy's axis units (identity for linear). */
  transformValue(logScale: boolean, price: number): number {
    return this.strategy(logScale).transformValue(price);
  }

  /** Invert an axis-unit value back to a real price (identity for linear). */
  invertValue(logScale: boolean, axisValue: number): number {
    return this.strategy(logScale).invertValue(axisValue);
  }

  /**
   * Build the Syncfusion primaryYAxis declarative config (valueType, rowIndex, etc.).
   * The actual min/max are applied imperatively by the lifecycle facade from the
   * current `ChartYAxisViewport`.
   */
  buildAxisConfig(logScale: boolean, rowIndex: number): PrimaryYAxisConfig {
    const base: PrimaryYAxisConfig = {
      labelFormat: '{value}',
      valueType: 'Double',
      opposedPosition: true,
      rowIndex,
      majorGridLines: { width: 1 },
      crosshairTooltip: { enable: false },
    };

    return { ...base, ...this.strategy(logScale).axisConfig };
  }

  /** Format a numeric axis value for display using the active scale strategy */
  formatLabel(logScale: boolean, value: number): string {
    return this.strategy(logScale).formatLabel(value);
  }

  /** Convert a pixel position within the Y-axis rect back to a price */
  priceFromPixel(
    logScale: boolean,
    pixelY: number,
    yRect: AxisRect,
    range: VisibleRange,
  ): number {
    return this.strategy(logScale).priceFromPixel(pixelY, yRect, range);
  }

  /** Convert a price to a pixel position within the Y-axis rect */
  pixelFromPrice(
    logScale: boolean,
    price: number,
    yRect: AxisRect,
    range: VisibleRange,
  ): number {
    return this.strategy(logScale).pixelFromPrice(price, yRect, range);
  }
}

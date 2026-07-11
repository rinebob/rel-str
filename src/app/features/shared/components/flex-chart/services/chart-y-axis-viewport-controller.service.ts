/**
 * Chart Y-Axis Viewport Controller
 *
 * Computes the primary Y-axis viewport for the visible bar slice and applies
 * scale-specific strategy (linear padding vs logarithmic zoom). Hides the
 * Syncfusion log-axis quirk behind a single typed `ChartYAxisViewport` object.
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
  valueType: 'Logarithmic' | 'Double';
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
   * Compute the Y-axis viewport for the given visible bars.
   * For linear, the viewport carries exact min/max. For log, the viewport
   * carries the full-data range plus zoomFactor/zoomPosition to zoom to the
   * visible log range.
   */
  computeViewport(logScale: boolean, allBars: PriceBar[], visibleBars: PriceBar[]): ChartYAxisViewport {
    return this.strategy(logScale).computeViewport(allBars, visibleBars);
  }

  /**
   * Build the Syncfusion primaryYAxis declarative config (valueType, rowIndex, etc.).
   * The actual range (min/max or zoomFactor/zoomPosition) is applied imperatively
   * by the lifecycle facade from the current `ChartYAxisViewport`.
   */
  buildAxisConfig(logScale: boolean, rowIndex: number): PrimaryYAxisConfig {
    const strategy = this.strategy(logScale);
    const base: PrimaryYAxisConfig = {
      labelFormat: '{value}',
      valueType: strategy.valueType,
      opposedPosition: true,
      rowIndex,
      majorGridLines: { width: 1 },
      crosshairTooltip: { enable: false },
    };

    return { ...base, ...strategy.axisConfig } as PrimaryYAxisConfig;
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

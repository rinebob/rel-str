/**
 * Chart Axis Label Service
 *
 * Owns everything about how axis-adjacent text is produced for FlexChart:
 *
 * - `renderAxisLabel` — Syncfusion `axisLabelRender` handler: category dates on
 *   the X axis; blanked uniform ticks in log mode; real prices in linear.
 * - `renderTooltip` — Syncfusion `tooltipRender` handler: inverts log-space
 *   values back to real prices for primary-pane series tooltips.
 * - `logAxisLabels` — positioned gutter labels for log mode. Syncfusion can
 *   only place axis labels at generated uniform ticks — which never land on
 *   round prices in log space — so labels are positioned divs at the exact
 *   log10(price) pixel, matching the stripLine gridlines.
 */
import { Injectable, Signal, computed, inject, signal } from '@angular/core';
import type { ITooltipRenderEventArgs } from '@syncfusion/ej2-angular-charts';

import type { FlexChartConfig, FlexChartDataset } from '../flex-chart.types';
import { ChartIntervalKey } from '../flex-chart.types';
import { ChartViewportStore } from '../store/chart-viewport.store';
import { ChartYAxisViewportController } from './chart-y-axis-viewport-controller.service';
import { ChartLifecycleFacade } from './chart-lifecycle-facade.service';
import type { SfAxisLabelRenderArgs } from './chart-instance.types';
import { toLogAxis } from '../strategies/log-transform';

export interface LogAxisLabel {
  /** Round price this label/gridline represents — stable identity. */
  price: number;
  text: string;
  top: number;
  left: number;
}

@Injectable()
export class ChartAxisLabelService {
  private readonly yAxisController = inject(ChartYAxisViewportController);
  private readonly viewport = inject(ChartViewportStore);
  private readonly lifecycleFacade = inject(ChartLifecycleFacade);

  private chartData: Signal<FlexChartDataset | null> = signal(null);
  private config: Signal<FlexChartConfig> = signal({ indicators: [] });

  /** Bind to the component's input signals once. */
  connect(
    chartData: Signal<FlexChartDataset | null>,
    config: Signal<FlexChartConfig>,
  ): void {
    this.chartData = chartData;
    this.config = config;
  }

  /** Log-mode gutter labels — recomputes whenever the captured axis state
   *  (rect/range) or the shared tick list changes. */
  logAxisLabels = computed<LogAxisLabel[]>(() => {
    if (!this.config().logScale) return [];
    const state = this.lifecycleFacade.chartState();
    const range = state?.yAxis.visibleRange;
    const rect = state?.yAxis.rect;
    if (!range || !rect || range.delta <= 0) return [];

    const labels: LogAxisLabel[] = [];
    // Same tick list the facade used for the stripLines — lines and labels
    // can never disagree about which prices get drawn.
    for (const price of this.viewport.logTicks()) {
      const v = toLogAxis(price);
      if (v < range.min - 1e-9 || v > range.max + 1e-9) continue;
      labels.push({
        price,
        text: this.yAxisController.formatLabel(true, v),
        top: this.yAxisController.pixelFromPrice(true, price, rect, range),
        left: rect.x + 2,
      });
    }
    return labels;
  });

  /** `axisLabelRender` handler — formats category dates and Y prices; blanks
   *  generated Y labels in log mode (gutter labels replace them). */
  renderAxisLabel(args: SfAxisLabelRenderArgs): void {
    if (args.axis.name === 'primaryXAxis') {
      const data = this.chartData();
      const idx = Math.round(Number(args.value));
      if (!data || Number.isNaN(idx) || !data.bars[idx]) return;

      const date = data.bars[idx].x;
      const interval = this.config().interval;
      const format: Intl.DateTimeFormatOptions = interval === ChartIntervalKey.MONTHLY
        ? { month: 'short', year: '2-digit' }
        : { month: 'short', day: 'numeric' };
      args.text = date.toLocaleDateString('en-US', format);
      return;
    }

    if (args.axis.name === 'primaryYAxis') {
      const value = Number(args.value);
      if (Number.isNaN(value)) return;

      // Log mode blanks every generated label — Syncfusion's uniform
      // log-space ticks never land on round prices. The real ticks are
      // drawn as stripLines at exact log10(price) positions with the price
      // rendered in the axis gutter, so a label always matches its gridline.
      if (this.config().logScale) {
        args.text = '';
        return;
      }
      args.text = this.yAxisController.formatLabel(false, value);
    }
  }

  /** `tooltipRender` handler — bound values are log-space in log mode, so
   *  every primary-pane tooltip value is inverted back to a real price.
   *  Lower-pane series (named axes) are untransformed and left alone. The
   *  `yAxisName` absence check is the pane discriminator — all current
   *  primary-pane series bind the default axis. */
  renderTooltip(args: ITooltipRenderEventArgs): void {
    const series = args.series as { yAxisName?: string; type?: string; name?: string };
    if (!this.config().logScale || series.yAxisName) return;

    const point = args.point;
    const invert = (v: unknown): number =>
      this.yAxisController.invertValue(true, Number(v));

    if (series.type === 'Candle' && 'high' in point) {
      const open = invert(point.open);
      const high = invert(point.high);
      const low = invert(point.low);
      const close = invert(point.close);
      if ([open, high, low, close].some(Number.isNaN)) return;
      args.text = `O: $${open.toFixed(2)}  H: $${high.toFixed(2)}  L: $${low.toFixed(2)}  C: $${close.toFixed(2)}`;
      const idx = args.data?.pointIndex;
      const bar = idx !== undefined ? this.chartData()?.bars[idx] : undefined;
      if (bar) args.headerText = bar.x.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
    } else {
      const y = Number(args.data?.pointY ?? point.y);
      if (Number.isNaN(y)) return;
      args.text = `${series.name ?? 'Value'}: ${this.yAxisController.formatLabel(true, y)}`;
    }
  }
}

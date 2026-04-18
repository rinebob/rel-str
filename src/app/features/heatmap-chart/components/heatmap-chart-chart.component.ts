import { Component, input, viewChild, effect, signal, ChangeDetectionStrategy } from '@angular/core';
import {
  ChartModule,
  ChartComponent as SfChartComponent,
  CandleSeriesService,
  DateTimeService,
  ZoomService,
  ScrollBarService,
  TooltipService,
  CrosshairService,
  IZoomCompleteEventArgs,
  IScrollEventArgs,
} from '@syncfusion/ej2-angular-charts';

import type { ChartDataset } from '../heatmap-chart.types';
import { autoscaleYAxisForRange } from '../../shared/utils/chart.util';

@Component({
  selector: 'app-heatmap-chart-chart',
  standalone: true,
  imports: [ChartModule],
  providers: [
    CandleSeriesService,
    DateTimeService,
    ZoomService,
    ScrollBarService,
    TooltipService,
    CrosshairService,
  ],
  template: `
    <div class="chart-wrapper">
      @if (chartData(); as data) {
        <ejs-chart
          #chart
          [primaryXAxis]="primaryXAxis"
          [primaryYAxis]="primaryYAxis"
          [zoomSettings]="zoomSettings"
          [tooltip]="tooltip"
          [crosshair]="crosshair"
          [height]="height()"
          (loaded)="onChartLoaded()"
          (zoomComplete)="onZoomComplete($event)"
          (scrollEnd)="onScrollEnd($event)">
          
          <e-series-collection>
            <e-series
              [dataSource]="data.bars"
              type="Candle"
              xName="x"
              high="high"
              low="low"
              open="open"
              close="close"
              volume="volume"
              [name]="data.symbol"
              bearFillColor="#ef5350"
              bullFillColor="#26a69a">
            </e-series>
          </e-series-collection>
        </ejs-chart>
      }
    </div>
  `,
  styles: [`
    .chart-wrapper {
      width: 100%;
      height: 100%;
    }
  `],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class HeatmapChartChartComponent {
  chart = viewChild<SfChartComponent>('chart');
  
  chartData = input.required<ChartDataset | null>();
  height = input<string>('400px');
  
  isInitialLoad = signal<boolean>(true);

  primaryXAxis = {
    valueType: 'DateTime',
    labelFormat: 'MMM dd',
    majorGridLines: { width: 0 },
    crosshairTooltip: { enable: true },
    skeleton: 'yMd',
    edgeLabelPlacement: 'Shift',
  };

  primaryYAxis = {
    labelFormat: '${value}',
    majorGridLines: { width: 1 },
    crosshairTooltip: { enable: true },
  };

  zoomSettings = {
    enableSelectionZooming: true,
    enableScrollbar: true,
    enableMouseWheelZooming: false,
    mode: 'X',
    enablePan: true,
    toolbarItems: ['Zoom', 'ZoomIn', 'ZoomOut', 'Pan', 'Reset'],
  };

  tooltip = {
    enable: true,
    shared: true,
    format: '<b>${point.x}</b><br/>Open: <b>${point.open}</b><br/>High: <b>${point.high}</b><br/>Low: <b>${point.low}</b><br/>Close: <b>${point.close}</b>',
    header: '<b>${point.x}</b>',
  };

  crosshair = {
    enable: true,
    lineType: 'Vertical',
  };

  constructor() {
    effect(() => {
      const data = this.chartData();
      if (data && data.bars.length > 0) {
        this.isInitialLoad.set(true);
      }
    });
  }

  onChartLoaded(): void {
    if (!this.isInitialLoad()) return;

    const chart = this.chart();
    const data = this.chartData();
    
    if (!chart || !data || data.bars.length === 0) return;

    this.applyInitialZoom(data.bars.length);
    this.isInitialLoad.set(false);
  }

  onZoomComplete(event: IZoomCompleteEventArgs): void {
    const chart = this.chart();
    const data = this.chartData();
    if (!chart || !data || !event.currentVisibleRange) return;

    const minX = event.currentVisibleRange.min ?? 0;
    const maxX = event.currentVisibleRange.max ?? 0;
    
    const chartBars = data.bars.map(b => ({
      x: new Date(b.date),
      open: b.open,
      high: b.high,
      low: b.low,
      close: b.close,
    }));

    autoscaleYAxisForRange(chartBars, [], chart, minX, maxX, true);
  }

  onScrollEnd(event: IScrollEventArgs): void {
    const chart = this.chart();
    const data = this.chartData();
    if (!chart || !data) return;

    const xAxis = chart.primaryXAxis as any;
    const visibleRange = xAxis?.visibleRange;
    if (!visibleRange) return;

    const minX = visibleRange.min ?? 0;
    const maxX = visibleRange.max ?? 0;
    
    const chartBars = data.bars.map(b => ({
      x: new Date(b.date),
      open: b.open,
      high: b.high,
      low: b.low,
      close: b.close,
    }));

    autoscaleYAxisForRange(chartBars, [], chart, minX, maxX, true);
  }

  private applyInitialZoom(totalBars: number): void {
    const chart = this.chart();
    const data = this.chartData();
    if (!chart || !data || data.bars.length === 0) return;

    // Add padding to X-axis maximum to prevent last bar from being cut off
    const firstX = data.bars[0].x;
    const lastX = data.bars[data.bars.length - 1].x;
    if (chart.primaryXAxis) {
      const paddingMs = 3 * 24 * 60 * 60 * 1000; // 3 days
      const paddedMax = new Date(lastX.getTime() + paddingMs);
      chart.primaryXAxis.minimum = firstX as any;
      chart.primaryXAxis.maximum = paddedMax as any;
    }

    const initialDays = 60;
    const visibleCount = Math.min(initialDays, data.bars.length - 1);
    const zoomFactor = visibleCount / data.bars.length;
    const zoomPosition = (data.bars.length - visibleCount) / data.bars.length;

    if (chart.primaryXAxis) {
      chart.primaryXAxis.zoomFactor = zoomFactor;
      chart.primaryXAxis.zoomPosition = zoomPosition;
    }

    const chartBars = data.bars.map(b => ({
      x: new Date(b.date),
      open: b.open,
      high: b.high,
      low: b.low,
      close: b.close,
    }));

    const minX = chartBars[chartBars.length - visibleCount].x;
    const maxX = chartBars[chartBars.length - 1].x;

    autoscaleYAxisForRange(chartBars, [], chart, minX, maxX, true);
  }
}

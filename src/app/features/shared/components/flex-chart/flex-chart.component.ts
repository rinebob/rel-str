/**
 * Flex Chart Component
 *
 * Flexible multi-pane chart with configurable indicators.
 * Supports dynamic indicator panes and various technical indicators.
 */
import {
  Component,
  input,
  viewChild,
  effect,
  signal,
  ChangeDetectionStrategy,
  computed,
} from '@angular/core';
import {
  ChartModule,
  ChartComponent as SfChartComponent,
  CandleSeriesService,
  LineSeriesService,
  AreaSeriesService,
  ColumnSeriesService,
  RangeAreaSeriesService,
  DateTimeService,
  CategoryService,
  ZoomService,
  ScrollBarService,
  TooltipService,
  CrosshairService,
  LegendService,
  IZoomCompleteEventArgs,
  IScrollEventArgs,
} from '@syncfusion/ej2-angular-charts';

import type {
  FlexChartDataset,
  FlexChartConfig,
  IndicatorConfig,
  IndicatorPane,
  ComputedIndicatorSeries,
} from './flex-chart.types';
import { computeIndicators, groupIndicatorsByPane } from './flex-chart-calculations';
import { autoscaleYAxisForRange } from '../../utils/chart.util';
import type { OHLCDatum } from '../../types/rs.interfaces';

@Component({
  selector: 'app-flex-chart',
  standalone: true,
  imports: [ChartModule],
  providers: [
    CandleSeriesService,
    LineSeriesService,
    AreaSeriesService,
    ColumnSeriesService,
    RangeAreaSeriesService,
    DateTimeService,
    CategoryService,
    ZoomService,
    ScrollBarService,
    TooltipService,
    CrosshairService,
    LegendService,
  ],
  template: `
    <div class="flex-chart-wrapper">
      @if (chartData(); as data) {
        @if (data.bars.length === 0) {
          <div class="no-data">No price data available</div>
        } @else {
        <ejs-chart
          #chart
          [primaryXAxis]="primaryXAxis"
          [primaryYAxis]="primaryYAxis"
          [zoomSettings]="zoomSettings"
          [tooltip]="tooltip"
          [crosshair]="crosshair"
          [legendSettings]="{ visible: false }"
          [axes]="chartAxes"
          [height]="height()"
          width="100%"
          background="transparent"
          (loaded)="onChartLoaded()"
          (zoomComplete)="onZoomComplete($event)"
          (scrollEnd)="onScrollEnd($event)"
          (axisLabelRender)="primaryXAxis.axisLabelRender($event)">

          <e-series-collection>
            <!-- Main pane: Price candles -->
            <e-series
              [dataSource]="categoryBars()"
              type="Candle"
              xName="index"
              high="high"
              low="low"
              open="open"
              close="close"
              bearFillColor="#ef5350"
              bullFillColor="#26a69a"
              [enableTooltip]="true">
            </e-series>

            <!-- Main pane indicators (overlay on price) -->
            @for (indicator of mainPaneSeries(); track indicator.id) {
              @if (indicator.config.seriesType === 'line') {
                <e-series
                  [dataSource]="indicator.data"
                  type="Line"
                  xName="index"
                  yName="y"
                  [name]="indicator.config.options.name || indicator.config.type.toUpperCase()"
                  [fill]="indicator.config.options.color || '#2196f3'"
                  width="{{ indicator.config.options.lineWidth || 2 }}"
                  [enableTooltip]="true">
                </e-series>
              }
            }

            <!-- Lower pane 1: RSI (0-100 scale) -->
            @for (indicator of lowerPane1Series(); track indicator.id) {
              @if (indicator.config.seriesType === 'line') {
                <e-series
                  [dataSource]="indicator.data"
                  type="Line"
                  xName="index"
                  yName="y"
                  yAxisName="lowerYAxis1"
                  [name]="indicator.config.options.name || indicator.config.type.toUpperCase()"
                  [fill]="indicator.config.options.color || '#2196f3'"
                  width="{{ indicator.config.options.lineWidth || 2 }}"
                  [enableTooltip]="true">
                </e-series>
              }
            }

            <!-- Lower pane 2: MACD (auto-scale) -->
            @for (indicator of lowerPane2Series(); track indicator.id) {
              @if (indicator.config.seriesType === 'line') {
                <!-- MACD line -->
                <e-series
                  [dataSource]="indicator.data"
                  type="Line"
                  xName="index"
                  yName="y"
                  yAxisName="lowerYAxis2"
                  [name]="indicator.config.options.name || indicator.config.type.toUpperCase()"
                  [fill]="indicator.config.options.color || '#ff9800'"
                  width="{{ indicator.config.options.lineWidth || 2 }}"
                  [enableTooltip]="true">
                </e-series>
                <!-- MACD signal line (y2) -->
                @if (indicator.data.length > 0 && indicator.data[0].y2 !== undefined) {
                  <e-series
                    [dataSource]="indicator.data"
                    type="Line"
                    xName="index"
                    yName="y2"
                    yAxisName="lowerYAxis2"
                    [name]="(indicator.config.options.name || 'MACD') + ' Signal'"
                    [fill]="indicator.config.options.color2 || '#e91e63'"
                    width="1"
                    [dashArray]="'4,3'"
                    [enableTooltip]="true">
                  </e-series>
                }
              }
            }
          </e-series-collection>
        </ejs-chart>
        }
      } @else {
        <div class="no-data">Select a signal to view chart</div>
      }
    </div>
  `,
  styles: [`
    :host {
      display: block;
      width: 100%;
      height: 100%;
    }
    .flex-chart-wrapper {
      width: 100%;
      height: 100%;
      min-height: 300px;
    }
    .no-data {
      display: flex;
      align-items: center;
      justify-content: center;
      height: 100%;
      color: var(--mat-sys-on-surface-variant);
    }
  `],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FlexChartComponent {
  chart = viewChild<SfChartComponent>('chart');

  // Inputs
  chartData = input.required<FlexChartDataset | null>();
  config = input<FlexChartConfig>({ indicators: [] });
  height = input<string>('400px');

  // Signals
  isInitialLoad = signal<boolean>(true);
  visibleRangeStart = signal<Date | null>(null);

  // Transform bars for Category axis (even spacing, no gaps)
  categoryBars = computed(() => {
    const data = this.chartData();
    if (!data) return [];
    
    // Map bars to index-based x values for Category axis
    return data.bars.map((bar, index) => ({
      index,
      open: bar.open,
      high: bar.high,
      low: bar.low,
      close: bar.close,
      volume: bar.volume,
      date: bar.x, // Keep original date for reference
    }));
  });

  // Computed indicators with index-based x values
  computedSeries = computed<ComputedIndicatorSeries[]>(() => {
    const data = this.chartData();
    const cfg = this.config();
    if (!data || data.bars.length === 0 || cfg.indicators.length === 0) {
      return [];
    }

    // Compute indicators on original bars
    const originalSeries = computeIndicators(data.bars, cfg.indicators);

    // Build a map of date timestamp to bar index for quick lookup
    const dateToIndex = new Map<number, number>();
    data.bars.forEach((bar, idx) => {
      dateToIndex.set(bar.x.getTime(), idx);
    });

    // Transform to index-based x values using date matching
    return originalSeries.map(series => ({
      ...series,
      data: series.data.map((point) => {
        if (!point.x) return { index: -1, y: point.y, y2: point.y2 };
        const index = dateToIndex.get(point.x.getTime());
        return {
          index: index ?? -1, // -1 if not found (shouldn't happen)
          y: point.y,
          y2: point.y2,
        };
      }).filter(p => p.index >= 0), // Remove any unmatched points
    }));
  });

  // Group by pane
  private groupedSeries = computed(() => groupIndicatorsByPane(this.computedSeries()));

  mainPaneSeries = computed(() => this.groupedSeries()['main'] || []);
  lowerPane1Series = computed(() => this.groupedSeries()['lower-1'] || []);
  lowerPane2Series = computed(() => this.groupedSeries()['lower-2'] || []);
  lowerPane3Series = computed(() => this.groupedSeries()['lower-3'] || []);

  lowerPane1Title = computed(() => {
    const series = this.lowerPane1Series();
    if (series.length === 0) return '';
    return series[0].config.options.name || series[0].config.type.toUpperCase();
  });

  lowerPane2Title = computed(() => {
    const series = this.lowerPane2Series();
    if (series.length === 0) return '';
    return series[0].config.options.name || series[0].config.type.toUpperCase();
  });

  // Secondary Y-axes for lower pane indicators (opposed on right side)
  chartAxes = [
    {
      name: 'lowerYAxis1',
      opposedPosition: true,
      title: '',
      minimum: 0,
      maximum: 100,
      majorGridLines: { width: 0 },
      lineStyle: { width: 1, color: '#9e9e9e' },
      crosshairTooltip: { enable: false },
    },
    {
      name: 'lowerYAxis2',
      opposedPosition: true,
      title: '',
      majorGridLines: { width: 0 },
      lineStyle: { width: 1, color: '#9e9e9e' },
      crosshairTooltip: { enable: false },
    },
  ];

  // Chart configuration - Category axis removes gaps (like TradingView)
  primaryXAxis = {
    valueType: 'Category',
    majorGridLines: { width: 0 },
    crosshairTooltip: { enable: false }, // Disabled - Category axis uses indices, not dates
    edgeLabelPlacement: 'Shift',
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    axisLabelRender: (args: any) => {
      // args.value is the index - look up the actual date
      const data = this.chartData();
      if (!data || !data.bars[args.value]) return;
      
      const date = data.bars[args.value].x;
      const month = date.getMonth();
      const day = date.getDate();
      
      // Get the visible range start from our tracked signal
      const visibleStart = this.visibleRangeStart();
      const isFirstVisibleLabel = visibleStart && date.getTime() <= visibleStart.getTime() + 86400000;
      
      // Show year for year boundaries or first visible label
      const isYearBoundary = month === 0 && day === 1;
      const shouldShowYear = isYearBoundary || (isFirstVisibleLabel && !isYearBoundary);
      
      if (shouldShowYear) {
        args.text = date.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
      } else {
        args.text = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      }
    },
  };

  primaryYAxis = {
    labelFormat: '${value}',
    majorGridLines: { width: 1 },
    crosshairTooltip: { enable: false },
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
    enable: false,
    shared: false,
  };

  crosshair = {
    enable: true,
    lineType: 'Vertical',
  };

  constructor() {
    effect(() => {
      const data = this.chartData();
      console.log('[FlexChart] Data received:', data ? `${data.bars.length} bars for ${data.symbol}` : 'null');
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

    // Category axis: min/max are indices
    const minIdx = Math.floor(event.currentVisibleRange.min ?? 0);
    const maxIdx = Math.ceil(event.currentVisibleRange.max ?? 0);
    
    // Track visible range start for axis label formatting (get date from bar at index)
    const startBar = data.bars[minIdx];
    if (startBar) {
      this.visibleRangeStart.set(startBar.x);
    }
    
    const chartBars: OHLCDatum[] = data.bars.map(b => ({
      x: b.x,
      open: b.open,
      high: b.high,
      low: b.low,
      close: b.close,
    }));

    // Use date values for Y-axis autoscale
    const minDate = data.bars[minIdx]?.x ?? new Date(0);
    const maxDate = data.bars[Math.min(maxIdx, data.bars.length - 1)]?.x ?? new Date();
    autoscaleYAxisForRange(chartBars, [], chart, minDate, maxDate, true);
  }

  onScrollEnd(event: IScrollEventArgs): void {
    const chart = this.chart();
    const data = this.chartData();
    if (!chart || !data) return;

    const xAxis = chart.primaryXAxis as any;
    const visibleRange = xAxis?.visibleRange;
    if (!visibleRange) return;

    // Category axis: min/max are indices
    const minIdx = Math.floor(visibleRange.min ?? 0);
    const maxIdx = Math.ceil(visibleRange.max ?? 0);
    
    // Track visible range start for axis label formatting
    const startBar = data.bars[minIdx];
    if (startBar) {
      this.visibleRangeStart.set(startBar.x);
    }
    
    const chartBars: OHLCDatum[] = data.bars.map(b => ({
      x: b.x,
      open: b.open,
      high: b.high,
      low: b.low,
      close: b.close,
    }));

    // Use date values for Y-axis autoscale
    const minDate = data.bars[minIdx]?.x ?? new Date(0);
    const maxDate = data.bars[Math.min(maxIdx, data.bars.length - 1)]?.x ?? new Date();
    autoscaleYAxisForRange(chartBars, [], chart, minDate, maxDate, true);
  }

  private applyInitialZoom(totalBars: number): void {
    const chart = this.chart();
    const data = this.chartData();
    if (!chart || !data || data.bars.length === 0) return;

    // Category axis: use indices for min/max
    if (chart.primaryXAxis) {
      chart.primaryXAxis.minimum = 0;
      chart.primaryXAxis.maximum = data.bars.length - 1;
    }

    const initialDays = this.config().initialZoomDays ?? 60;
    const visibleCount = Math.min(initialDays, data.bars.length - 1);
    const zoomFactor = visibleCount / data.bars.length;
    const zoomPosition = (data.bars.length - visibleCount) / data.bars.length;

    if (chart.primaryXAxis) {
      chart.primaryXAxis.zoomFactor = zoomFactor;
      chart.primaryXAxis.zoomPosition = zoomPosition;
    }

    // Apply initial Y-axis autoscale and track visible range
    const chartBars: OHLCDatum[] = data.bars.map(b => ({
      x: b.x,
      open: b.open,
      high: b.high,
      low: b.low,
      close: b.close,
    }));
    
    const visibleStart = Math.max(0, data.bars.length - visibleCount);
    const minX = chartBars[visibleStart].x;
    const maxX = chartBars[chartBars.length - 1].x;
    
    // Track visible range start for axis label formatting
    this.visibleRangeStart.set(minX);
    
    autoscaleYAxisForRange(chartBars, [], chart, minX, maxX, false);
  }
}

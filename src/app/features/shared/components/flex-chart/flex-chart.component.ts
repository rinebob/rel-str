/**
 * Flex Chart Component
 *
 * Flexible multi-pane chart with configurable indicators.
 * Supports dynamic indicator panes and various technical indicators.
 */
import {
  Component,
  input,
  output,
  viewChild,
  effect,
  signal,
  ChangeDetectionStrategy,
  computed,
  ElementRef,
  inject,
  OnDestroy,
  NgZone,
} from '@angular/core';
import {
  ChartModule,
  ChartComponent as SfChartComponent,
  CandleSeriesService,
  LineSeriesService,
  AreaSeriesService,
  ColumnSeriesService,
  RangeAreaSeriesService,
  ScatterSeriesService,
  DateTimeService,
  CategoryService,
  ZoomService,
  ScrollBarService,
  TooltipService,
  CrosshairService,
  LegendService,
  StripLineService,
  IZoomCompleteEventArgs,
  IScrollEventArgs,
  IMouseEventArgs,
} from '@syncfusion/ej2-angular-charts';

import type {
  FlexChartDataset,
  FlexChartConfig,
  IndicatorPane,
  ComputedIndicatorSeries,
} from './flex-chart.types';
import { computeIndicators, groupIndicatorsByPane } from './flex-chart-calculations';
import { computeAllBands, type BandSeriesData } from './indicators/st-trend-bands.indicator';
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
    ScatterSeriesService,
    DateTimeService,
    CategoryService,
    ZoomService,
    ScrollBarService,
    TooltipService,
    CrosshairService,
    LegendService,
    StripLineService,
  ],
  template: `
    <div class="flex-chart-wrapper">
      @if (chartData(); as data) {
        @if (data.bars.length === 0) {
          <div class="no-data">No price data available</div>
        } @else {
        <ejs-chart
          [enableAnimation]="false"
          #chart
          [primaryXAxis]="primaryXAxis()"
          [primaryYAxis]="primaryYAxis()"
          [zoomSettings]="zoomSettings"
          [tooltip]="tooltip"
          [crosshair]="crosshair"
          [legendSettings]="{ visible: false }"
          [axes]="chartAxes()"
          [rows]="chartRows()"
          [height]="height()"
          width="100%"
          background="transparent"
          (loaded)="onChartLoaded()"
          (zoomComplete)="onZoomComplete($event)"
          (scrollEnd)="onScrollEnd($event)"
          (axisLabelRender)="onAxisLabelRender($event)"
          (chartMouseMove)="onChartMouseMove($event)"
          (chartMouseLeave)="onChartMouseLeave()">

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
              [enableTooltip]="true"
              [animation]="noAnimation">
            </e-series>

            <!-- ST Trend Bands (rendered as candle bodies) -->
            @for (band of trendBandSeries(); track band.bandIndex) {
              <e-series
                [dataSource]="band.data"
                type="Candle"
                xName="index"
                high="high"
                low="low"
                open="open"
                close="close"
                [bullFillColor]="band.bullColor"
                [bearFillColor]="band.bearColor"
                [enableSolidCandles]="true"
                opacity="0.7"
                [enableTooltip]="false"
                [animation]="noAnimation">
              </e-series>
            }

            <!-- Main pane indicators (overlay on price) -->
            @for (indicator of mainPaneSeries(); track indicator.id) {
              @if (indicator.config.type !== 'st-trend-bands' && indicator.config.seriesType === 'line') {
                <e-series
                  [dataSource]="indicator.data"
                  type="Line"
                  xName="index"
                  yName="y"
                  [name]="indicator.config.options.name || indicator.config.type.toUpperCase()"
                  [fill]="indicator.config.options.color || '#2196f3'"
                  width="{{ indicator.config.options.lineWidth || 2 }}"
                  [enableTooltip]="true"
                  [animation]="noAnimation">
                </e-series>
              }
            }

            <!-- Dynamic lower panes -->
            @for (pane of lowerPanes(); track pane.id) {
              @for (indicator of pane.series; track indicator.id) {
                @if (indicator.config.seriesType === 'column') {
                  <!-- Histogram (column) series -->
                  <e-series
                    [dataSource]="indicator.data"
                    type="Column"
                    xName="index"
                    yName="y"
                    [yAxisName]="pane.axisName"
                    [name]="indicator.config.options.name || indicator.config.type.toUpperCase()"
                    [fill]="indicator.config.options.color || '#26a69a'"
                    pointColorMapping="color"
                    [columnWidth]="0.8"
                    [enableTooltip]="true"
                    [animation]="noAnimation">
                  </e-series>
                } @else if (indicator.config.seriesType === 'scatter') {
                  <!-- Thin connecting line behind dots -->
                  <e-series
                    [dataSource]="indicator.data"
                    type="Line"
                    xName="index"
                    yName="y"
                    [yAxisName]="pane.axisName"
                    name=""
                    fill="#9e9e9e"
                    width="1"
                    opacity="0.5"
                    [enableTooltip]="false"
                    [animation]="noAnimation">
                  </e-series>
                  <!-- Scatter (dots) series with per-point color -->
                  <e-series
                    [dataSource]="indicator.data"
                    type="Scatter"
                    xName="index"
                    yName="y"
                    [yAxisName]="pane.axisName"
                    [name]="indicator.config.options.name || indicator.config.type.toUpperCase()"
                    pointColorMapping="color"
                    [marker]="{ visible: true, shape: 'Circle', width: 4, height: 4 }"
                    [enableTooltip]="true"
                    [animation]="noAnimation">
                  </e-series>
                } @else if (indicator.config.seriesType === 'line') {
                  <!-- Histogram (column) behind line series -->
                  @if (indicator.config.options.showHistogram && indicator.data.length > 0 && indicator.data[0].y3 !== undefined) {
                    <e-series
                      [dataSource]="indicator.data"
                      type="Column"
                      xName="index"
                      yName="y3"
                      [yAxisName]="pane.axisName"
                      name="Histogram"
                      [fill]="'#26a69a'"
                      opacity="0.5"
                      [columnWidth]="0.6"
                      [enableTooltip]="true"
                      [animation]="noAnimation">
                    </e-series>
                  }
                  <!-- Primary line -->
                  <e-series
                    [dataSource]="indicator.data"
                    type="Line"
                    xName="index"
                    yName="y"
                    [yAxisName]="pane.axisName"
                    [name]="indicator.config.options.name || indicator.config.type.toUpperCase()"
                    [fill]="indicator.config.options.color || '#2196f3'"
                    width="{{ indicator.config.options.lineWidth || 2 }}"
                    [enableTooltip]="true"
                    [animation]="noAnimation">
                  </e-series>
                  <!-- Secondary line (signal) -->
                  @if (indicator.data.length > 0 && indicator.data[0].y2 !== undefined) {
                    <e-series
                      [dataSource]="indicator.data"
                      type="Line"
                      xName="index"
                      yName="y2"
                      [yAxisName]="pane.axisName"
                      [name]="(indicator.config.options.name || indicator.config.type.toUpperCase()) + ' Signal'"
                      [fill]="indicator.config.options.color2 || '#e91e63'"
                      width="1"
                      [dashArray]="'4,3'"
                      [enableTooltip]="true"
                      [animation]="noAnimation">
                    </e-series>
                  }
                }
              }
            }
          </e-series-collection>
        </ejs-chart>
        }
      } @else {
        <div class="no-data">Select a signal to view chart</div>
      }
      <div class="crosshair-sync-line"></div>
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
      position: relative;
    }
    .no-data {
      display: flex;
      align-items: center;
      justify-content: center;
      height: 100%;
      color: var(--mat-sys-on-surface-variant);
    }
    .crosshair-sync-line {
      display: none;
      position: absolute;
      top: 0;
      bottom: 0;
      width: 1px;
      background: #000000;
      pointer-events: none;
      z-index: 10;
    }
  `],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FlexChartComponent implements OnDestroy {
  private readonly el = inject(ElementRef);
  private readonly zone = inject(NgZone);
  private resizeObserver: ResizeObserver | null = null;

  chart = viewChild<SfChartComponent>('chart');

  // Inputs
  chartData = input.required<FlexChartDataset | null>();
  config = input<FlexChartConfig>({ indicators: [] });
  height = input<string>('400px');
  syncCrosshairDate = input<Date | null>(null);

  // Outputs
  crosshairDateChange = output<Date | null>();

  // Disable all series animations
  noAnimation = { enable: false };

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
        if (!point.x) return { ...point, index: -1 };
        const index = dateToIndex.get(point.x.getTime());
        return {
          ...point,
          index: index ?? -1,
        };
      }).filter(p => p.index >= 0), // Remove any unmatched points
    }));
  });

  // Group by pane
  private groupedSeries = computed(() => groupIndicatorsByPane(this.computedSeries()));

  mainPaneSeries = computed(() => this.groupedSeries()['main'] || []);

  /** ST Trend Band candle series — computed when trend bands indicator is active */
  trendBandSeries = computed<BandSeriesData[]>(() => {
    const mainSeries = this.mainPaneSeries();
    const hasTrendBands = mainSeries.some(s => s.config.type === 'st-trend-bands');
    if (!hasTrendBands) return [];

    const data = this.chartData();
    if (!data || data.bars.length < 30) return [];

    return computeAllBands(data.bars);
  });

  /** Active lower panes derived from current indicators — sorted by pane ID */
  lowerPanes = computed(() => {
    const grouped = this.groupedSeries();
    const paneIds = Object.keys(grouped)
      .filter(id => id.startsWith('lower-'))
      .sort() as IndicatorPane[];

    return paneIds.map(paneId => {
      const series = grouped[paneId];
      const axisName = `lowerYAxis${paneId.replace('lower-', '')}`;
      // Determine axis scale from indicators on this pane
      const useFixedScale = series.some(s => s.config.options.axisScale === 'fixed-0-100');
      const fixedIndicator = series.find(s => s.config.options.axisScale === 'fixed');
      const axisMin = fixedIndicator?.config.options.axisMin;
      const axisMax = fixedIndicator?.config.options.axisMax;
      return {
        id: paneId,
        axisName,
        series,
        useFixedScale,
        axisMin,
        axisMax,
      };
    });
  });

  /** Dynamic Y-axes for lower panes. All series share the primary X-axis for zoom sync. */
  chartAxes = computed(() => {
    return this.lowerPanes().map((pane, index) => {
      // Collect stripLines from all indicators on this pane
      const stripLines = pane.series
        .flatMap(s => s.config.options.referenceLines || [])
        .map(ref => ({
          start: ref.value,
          size: 1,
          sizeType: 'Pixel' as const,
          color: ref.color,
          dashArray: ref.dashArray || '',
          visible: true,
          opacity: 1,
          zIndex: 'Over' as const,
          text: ref.label || '',
          textStyle: { color: ref.color, size: '10px' },
          horizontalAlignment: 'End' as const,
          verticalAlignment: 'Middle' as const,
        }));

      return {
        name: pane.axisName,
        valueType: 'Double' as const,
        opposedPosition: true,
        title: '',
        rowIndex: index,
        minimum: pane.useFixedScale ? 0 : (pane.axisMin ?? undefined),
        maximum: pane.useFixedScale ? 100 : (pane.axisMax ?? undefined),
        labelFormat: '{value}',
        majorGridLines: { width: 0.5, color: 'rgba(158,158,158,0.3)' },
        lineStyle: { width: 1, color: '#9e9e9e' },
        crosshairTooltip: { enable: false },
        stripLines,
      };
    });
  });

  /** Dynamic row definitions: bottom-to-top (index 0 = bottom row) */
  chartRows = computed(() => {
    const lowerCount = this.lowerPanes().length;
    if (lowerCount === 0) return [{ height: '100%' }];

    // Lower panes at bottom, main pane on top
    // Row order in array: [lower-1, lower-2, ..., main]
    const lowerPct = Math.floor(40 / lowerCount);
    const rows: { height: string }[] = [];
    for (let i = 0; i < lowerCount; i++) {
      rows.push({ height: `${lowerPct}%` });
    }
    rows.push({ height: `${100 - lowerCount * lowerPct}%` }); // Main pane (top)
    return rows;
  });

  // Chart configuration - Category axis removes gaps (like TradingView)
  primaryXAxis = computed(() => {
    const data = this.chartData();
    const initialDays = this.config().initialZoomDays ?? 60;
    const totalBars = data?.bars.length ?? 0;
    const visibleCount = Math.min(initialDays, totalBars);
    const zoomFactor = totalBars > 0 ? visibleCount / totalBars : 1;
    const zoomPosition = totalBars > 0 ? (totalBars - visibleCount) / totalBars : 0;

    return {
      valueType: 'Category',
      majorGridLines: { width: 0 },
      crosshairTooltip: { enable: false },
      edgeLabelPlacement: 'Shift',
      zoomFactor,
      zoomPosition,
    };
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  onAxisLabelRender(args: any): void {
    if (args.axis.name !== 'primaryXAxis') return;

    const data = this.chartData();
    const idx = Math.round(args.value);
    if (!data || !data.bars[idx]) return;

    const date = data.bars[idx].x;
    args.text = date.toLocaleDateString('en-US', { month: 'short', year: '2-digit' });
  }

  // primaryYAxis rowIndex is dynamic — set via computed
  primaryYAxis = computed(() => ({
    labelFormat: '${value}',
    opposedPosition: true, // Y-axis on the right side
    rowIndex: this.lowerPanes().length, // Main pane = topmost row
    majorGridLines: { width: 1 },
    crosshairTooltip: { enable: false },
  }));

  zoomSettings = {
    enableSelectionZooming: true,
    enableScrollbar: true,
    enableMouseWheelZooming: false,
    mode: 'X',
    enablePan: true,
    showToolbar: true,
    toolbarItems: ['Zoom', 'ZoomIn', 'ZoomOut', 'Pan', 'Reset'],
    toolbarPosition: { horizontalAlignment: 'Near', verticalAlignment: 'Top' },
  };

  tooltip = {
    enable: false,
    shared: false,
  };

  crosshair = {
    enable: true,
    lineType: 'Vertical',
    snapToData: true,
  };

  constructor() {
    effect(() => {
      const data = this.chartData();
      if (data && data.bars.length > 0) {
        this.isInitialLoad.set(true);
      }
    });

    // Sync crosshair from another chart via CSS overlay line
    effect(() => {
      const syncDate = this.syncCrosshairDate();
      const chartComp = this.chart() as any;
      const data = this.chartData();

      const overlay = this.el.nativeElement.querySelector('.crosshair-sync-line') as HTMLElement;
      if (!overlay) return;

      if (!syncDate || !chartComp || !data || data.bars.length === 0) {
        overlay.style.display = 'none';
        return;
      }

      // Get axis info
      const xAxis = chartComp.axisCollections?.[0];
      if (!xAxis?.rect || !xAxis?.visibleRange) {
        overlay.style.display = 'none';
        return;
      }

      // Find the bar index closest to the synced date
      const targetTime = syncDate.getTime();
      let closestIdx = 0;
      let closestDiff = Infinity;
      for (let i = 0; i < data.bars.length; i++) {
        const barTime = new Date(data.bars[i].x).getTime();
        const diff = Math.abs(barTime - targetTime);
        if (diff < closestDiff) {
          closestDiff = diff;
          closestIdx = i;
        }
      }

      // Convert bar index to pixel position
      const { min, delta } = xAxis.visibleRange;
      const rect = xAxis.rect;
      const pixelX = rect.x + ((closestIdx - min) / delta) * rect.width;

      // Only show if within chart area
      if (pixelX < rect.x || pixelX > rect.x + rect.width) {
        overlay.style.display = 'none';
        return;
      }

      overlay.style.display = 'block';
      overlay.style.left = `${pixelX}px`;
    });

    // Watch for container resize (e.g. fullscreen toggle) and refresh chart
    this.zone.runOutsideAngular(() => {
      this.resizeObserver = new ResizeObserver(() => {
        const chart = this.chart();
        if (chart) {
          chart.animateSeries = false;
          chart.refresh();
        }
      });
      this.resizeObserver.observe(this.el.nativeElement);
    });
  }

  ngOnDestroy(): void {
    this.resizeObserver?.disconnect();
  }

  onChartMouseMove(event: IMouseEventArgs): void {
    const chartComp = this.chart() as any;
    const data = this.chartData();
    if (!chartComp || !data || data.bars.length === 0) return;

    // Get the x-axis from axisCollections
    const xAxis = chartComp.axisCollections?.[0];
    if (!xAxis || !xAxis.visibleRange || !xAxis.rect) return;

    const rect = xAxis.rect;
    const pixelX = event.x - rect.x;
    if (pixelX < 0 || pixelX > rect.width) return;

    const { min, delta } = xAxis.visibleRange;
    const idx = Math.round(min + (pixelX / rect.width) * delta);

    if (idx >= 0 && idx < data.bars.length) {
      const bar = data.bars[idx];
      if (bar) {
        this.crosshairDateChange.emit(new Date(bar.x));
      }
    }
  }

  onChartMouseLeave(): void {
    this.crosshairDateChange.emit(null);
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

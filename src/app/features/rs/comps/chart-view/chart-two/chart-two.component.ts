import { ChangeDetectionStrategy, Component, ViewChild, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ChartModule, CandleSeriesService, DateTimeService, TooltipService, ZoomService, ChartComponent as SfChartComponent, LegendService } from '@syncfusion/ej2-angular-charts';
import { RsPaneComponent } from '../rs-pane/rs-pane.component';
import { ChartToolbarComponent } from '../chart-toolbar/chart-toolbar.component';

// Extend the candle type to include optional rsColor
export interface CandleWithRSColor {
  x: Date;
  open: number;
  high: number;
  low: number;
  close: number;
  rsColor?: string;
}

@Component({
  selector: 'rs-chart-two',
  standalone: true,
  imports: [ChartModule, CommonModule, RsPaneComponent, ChartToolbarComponent],
  providers: [CandleSeriesService, DateTimeService, TooltipService, ZoomService, LegendService],
  templateUrl: './chart-two.component.html',
  styleUrl: './chart-two.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
/**
 * ChartTwoComponent renders a candlestick chart for MSFT using OHLC data provided by the parent via @Input properties. Purely presentational.
 */
export class ChartTwoComponent {
  /**
   * Handler for the 'Use Subset' button. Presentational stub for parent integration.
   */
  public useSubset(): void {
    // No-op: to be implemented by parent or integrated as needed
  }


  /**
   * Signal for current zoom factor (fraction of chart shown, 0 < zoomFactor <= 1)
   */
  /**
   * Current zoom factor (fraction of chart shown, 0 < zoomFactor <= 1)
   */
  public zoomFactor: number = 1;

  /**
   * Current zoom position (start of zoom window, 0 <= zoomPosition <= 1-zoomFactor)
   */
  public zoomPosition: number = 0;

  /**
   * Chart primaryXAxis config, dynamically updated to prevent bar clipping
   */
  public primaryXAxis: any = {
    valueType: 'DateTime',
    title: 'Date',
    zoomFactor: this.zoomFactor,
    zoomPosition: this.zoomPosition,
    plotOffset: 0
  };

  /**
   * Candlestick data (MSFT) to be rendered. Provided by parent container.
   */
  @Input() candleData: CandleWithRSColor[] = [];

  /**
   * QQQ baseline data for RS comparison (optional, for pane or overlays). Provided by parent container.
   */
  @Input() qqqData: CandleWithRSColor[] = [];

  /**
   * RS comparison summary (optional, for display/debug). Provided by parent container.
   */
  @Input() rsComparisonSummary: string = '';

  /**
   * Whether tooltips are enabled for the chart. Can be toggled by parent if needed.
   */
  public tooltipEnabled = true;

  /**
   * Returns the RS color array for each day (for the RS pane)
   */
  /**
   * Returns the RS color array for each day (for the RS pane)
   */
  public get rsColorArray(): string[] {
    return this.candleData.map((d: CandleWithRSColor) => d.rsColor || '#ddd');
  }

  /**
   * Logs the number of visible candlesticks rendered by Syncfusion and the number of RS bars.
   * Helps diagnose alignment issues between RS pane and candlestick chart.
   * Uses // Removed: debugLog utility.
   */
  private logRenderedCandlesVsRsBars(): void {
    const chart = this.chartComponent as any;
    let visiblePoints: any[] = [];
    if (chart && chart.visibleSeries && chart.visibleSeries[0] && chart.visibleSeries[0].points) {
      visiblePoints = chart.visibleSeries[0].points.filter((pt: any) => pt.visible !== false);
    }
    const rsBars = this.visibleRsColors;
    // For debugging only: log visible candle and RS bar counts
    // console.log('Rendered Candles', {
    //   candleCount: visiblePoints.length,
    //   first: visiblePoints[0]?.x,
    //   last: visiblePoints[visiblePoints.length-1]?.x
    // });
    // console.log('RS Pane Bars', {
    //   rsCount: rsBars.length,
    //   first: rsBars[0],
    //   last: rsBars[rsBars.length-1]
    // });
  }

  /**
   * Returns only the visible RS colors (for zoom/pan sync).
   * Uses the actual x-axis visible range from the chart for precise alignment.
   * Falls back to zoomFactor/zoomPosition if visibleRange is not available.
   *
   * Expects candleData to be provided by parent.
   */
  public get visibleRsColors(): string[] {
    const data = this.candleData;
    if (!data.length) return [];
    if (this.chartComponent && this.chartComponent.primaryXAxis && (this.chartComponent.primaryXAxis as any).visibleRange) {
      const min: number = (this.chartComponent.primaryXAxis as any).visibleRange.min;
      const max: number = (this.chartComponent.primaryXAxis as any).visibleRange.max;
      const visible = data.filter(d => d.x instanceof Date && d.x.getTime() >= min && d.x.getTime() <= max);
      return visible.map((d: CandleWithRSColor) => d.rsColor || '#ddd');
    }
    // Fallback: use zoomFactor/zoomPosition logic
    const total = data.length;
    const factor = this.zoomFactor;
    const position = this.zoomPosition;
    const startIdx = Math.floor(position * total);
    const endIdx = Math.min(total, Math.ceil(startIdx + factor * total));
    const sliced = data.slice(startIdx, endIdx);
    // Debug logging
    if (sliced.length > 0) {
      // eslint-disable-next-line no-console
      console.log('[RS DEBUG] zoomFactor/zoomPosition:', { startIdx, endIdx, count: sliced.length, first: sliced[0].x, last: sliced[sliced.length-1].x });
    } else {
      // eslint-disable-next-line no-console
      console.log('[RS DEBUG] zoomFactor/zoomPosition:', { startIdx, endIdx, count: 0 });
    }
    return sliced.map((d: CandleWithRSColor) => d.rsColor || '#ddd');
  }

  /**
   * Reference to the Syncfusion chart instance
   */
  @ViewChild('msftChart', { static: false })
  public chartComponent?: SfChartComponent;

  /**
   * Left offset (px) of the chart plot area, for RS pane alignment
   */
  public plotAreaLeft = 0;
  /**
   * Width (px) of the chart plot area, for RS pane alignment
   */
  public plotAreaWidth = 0;

  /**
   * After view init, measure the chart plot area and update RS pane alignment.
   */
  ngAfterViewInit(): void {
    // Removed setPlotAreaDims() call; now triggered by chart loaded event
    window.addEventListener('resize', () => this.setPlotAreaDims());
  }

  /**
   * Helper to update plotAreaLeft and plotAreaWidth by querying the Syncfusion plot area DOM.
   * Retries up to 10 times if plot area is not yet rendered.
   */
  private _plotAreaRetryCount = 0;
  public setPlotAreaDims(): void {
    console.log('[setPlotAreaDims] called');
    if (!this.chartComponent) {
      console.log('  chartComponent not ready');
      return;
    }
    const chartEl = (this.chartComponent as any).element as HTMLElement;
    if (!chartEl) {
      console.log('  chartEl not ready');
      return;
    }
    // Improved debug logging and checks
    const svg = chartEl.querySelector('svg');
    if (!svg) {
      console.log('  SVG not found (retry ' + this._plotAreaRetryCount + ')');
      if (this._plotAreaRetryCount < 15) {
        this._plotAreaRetryCount++;
        setTimeout(() => this.setPlotAreaDims(), 75);
      }
      return;
    }
    const plotRectEl = svg.querySelector('#candlestick-chart-two_ChartAreaBorder') as SVGRectElement;
    if (!plotRectEl) {
      console.log('  #candlestick-chart-two_ChartAreaBorder not found (retry ' + this._plotAreaRetryCount + ')');
      if (this._plotAreaRetryCount < 15) {
        this._plotAreaRetryCount++;
        setTimeout(() => this.setPlotAreaDims(), 75);
      }
      return;
    }
    const rawX = plotRectEl.getAttribute('x');
    const rawWidth = plotRectEl.getAttribute('width');
    console.log('  Found ChartAreaBorder rect: x=', rawX, 'width=', rawWidth);
    const x = Number(rawX);
    const width = Number(rawWidth);
    if (isNaN(x) || isNaN(width)) {
      console.log('  ChartAreaBorder x or width is NaN (retry ' + this._plotAreaRetryCount + ')');
      if (this._plotAreaRetryCount < 15) {
        this._plotAreaRetryCount++;
        setTimeout(() => this.setPlotAreaDims(), 75);
      }
      return;
    }
    if (!width || width === 0) {
      console.log('  ChartAreaBorder width is 0 (retry ' + this._plotAreaRetryCount + ')');
      if (this._plotAreaRetryCount < 15) {
        this._plotAreaRetryCount++;
        setTimeout(() => this.setPlotAreaDims(), 75);
      }
      return;
    }
    this.plotAreaLeft = x;
    this.plotAreaWidth = width;
    this._plotAreaRetryCount = 0;
    console.log('  plotAreaLeft:', this.plotAreaLeft, 'plotAreaWidth:', this.plotAreaWidth);
  }

  /**
   * Returns the year of the first visible candle (for axis labeling).
   */
  public firstVisibleYear(): number | null {
    const data = this.candleData;
    if (!data.length) return null;
    if (this.chartComponent && this.chartComponent.primaryXAxis && (this.chartComponent.primaryXAxis as any).visibleRange) {
      const min = (this.chartComponent.primaryXAxis as any).visibleRange.min;
      const first = data.find(d => d.x instanceof Date && d.x.getTime() >= min);
      return first?.x instanceof Date ? first.x.getFullYear() : null;
    }
    // Fallback: use first candle in visible data
    const total = data.length;
    const factor = this.zoomFactor;
    const position = this.zoomPosition;
    const startIdx = Math.floor(position * total);
    const visible = data.slice(startIdx);
    if (!visible.length) return null;
    const first = visible[0];
    return first.x instanceof Date ? first.x.getFullYear() : null;
  }

  /**
   * Zoom in by halving the zoom factor (show less data).
   */
  public zoomIn(): void {
    let factor = this.zoomFactor;
    if (factor > 0.05) {
      factor = Math.max(0.05, factor / 2);
      this.setZoom(factor, this.zoomPosition);
    }
  }

  /**
   * Zoom out by doubling the zoom factor (show more data).
   */
  public zoomOut(): void {
    let factor = this.zoomFactor;
    factor = Math.min(1, factor * 2);
    this.setZoom(factor, this.zoomPosition);
  }

  /**
   * Resets zoom to show the entire chart.
   */
  public resetZoom(): void {
    this.setZoom(1, 0);
  }

  /**
   * Handler for Syncfusion axisLabelRender event. Prepends the year to the first x-axis label.
   */
  public onAxisLabelRender(args: any): void {
    if (args.axis.name === 'primaryXAxis' && args.value instanceof Date) {
      // Only for the first visible tick (left edge)
      const min = args.axis.visibleRange?.min;
      if (min !== undefined && args.value.getTime() === min) {
        args.text = `${args.value.getFullYear()} ${args.text}`;
      }
    }
  }

  /**
   * Handler for Syncfusion tooltipRender event. Formats tooltip with full date and OHLC values on separate lines.
   */
  public onTooltipRender(args: any): void {
    if (args && args.point && args.point.x instanceof Date) {
      const d = args.point.x;
      const dateStr = d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: '2-digit' });
      args.text = `${dateStr}<br/>Open: ${args.point.open}<br/>High: ${args.point.high}<br/>Low: ${args.point.low}<br/>Close: ${args.point.close}`;
    }
  }

  /**
   * Sets the zoom factor and position, and updates the chart's primaryXAxis.
   * Also triggers y-axis autoscaling and chart data binding.
   * @param factor Fraction of chart to display (0 < factor <= 1)
   * @param position Start position of zoom window (0 <= position <= 1-factor)
   */
  public setZoom(factor: number, position: number): void {
    this.zoomFactor = factor;
    this.zoomPosition = Math.max(0, Math.min(position, 1 - factor));
    if (this.chartComponent && this.chartComponent.primaryXAxis) {
      this.chartComponent.primaryXAxis.zoomFactor = this.zoomFactor;
      this.chartComponent.primaryXAxis.zoomPosition = this.zoomPosition;
      this.autoscaleYAxis();
      this.chartComponent.dataBind();
    }
  }

  /**
   * Automatically rescales the y-axis to fit the visible OHLC data range.
   * Called after zoom/pan or data load.
   * @param factor Optional: zoom factor to use (from Syncfusion event)
   * @param position Optional: zoom position to use (from Syncfusion event)
   */
  public autoscaleYAxis(factor?: number, position?: number): void {
    const data = this.candleData;
    if (!data.length) {
      // Removed: yMin.set(null);
      // Removed: yMax.set(null);
      return;
    }
    // Determine visible range based on zoom
    const total = data.length;
    factor = factor ?? this.zoomFactor;
    position = position ?? this.zoomPosition;
    const startIdx = Math.floor(position * total);
    const endIdx = Math.min(total, Math.ceil(startIdx + factor * total));
    const visible = data.slice(startIdx, endIdx);
    const min = Math.min(...visible.map(d => d.low));
    const max = Math.max(...visible.map(d => d.high));
    if (this.chartComponent && this.chartComponent.primaryYAxis) {
      this.chartComponent.primaryYAxis.minimum = min;
      this.chartComponent.primaryYAxis.maximum = max;
    }
  }

  /**
   * Handles Syncfusion chart zoomComplete events (pan/zoom interactions).
   * Calls autoscaleYAxis to ensure y-axis fits the visible data.
   * @param event Syncfusion ZoomCompleteEventArgs
   */
  public onChartZoomComplete(event: any): void {
    // Use visibleRange from Syncfusion event to determine x-range actually visible
    if (event && event.axis && event.axis.visibleRange) {
      const minX = event.axis.visibleRange.min;
      const maxX = event.axis.visibleRange.max;
      this.autoscaleYAxisForRange(minX, maxX);
    } else {
      this.autoscaleYAxis();
    }
    // Always update RS pane alignment after zoom/pan
    setTimeout(() => {
      this.setPlotAreaDims();
      this.logRenderedCandlesVsRsBars();
    }, 0);
  }

  /**
   * Handles the chart loaded event to trigger plot area measurement and RS pane alignment.
   * Also updates visibleXAxisTicks for RS pane axis alignment.
   */
  public onChartLoaded(): void {
    this.setPlotAreaDims();
    this.logRenderedCandlesVsRsBars();
    this.updateVisibleXAxisTicks();
  }

  /**
   * Returns indices of candles whose dates match the chart's visible x-axis major ticks.
   */
  public visibleXAxisTicks: number[] = [];

  /**
   * Autoscale the y-axis to fit the data within a specific x-range (used for zoom/pan events).
   * @param minX Minimum x (timestamp in ms or Date)
   * @param maxX Maximum x (timestamp in ms or Date)
   */
  public autoscaleYAxisForRange(minX: number | Date, maxX: number | Date): void {
    const data = this.candleData;
    if (!data.length) return;
    let minVal = typeof minX === 'number' ? minX : minX.getTime();
    let maxVal = typeof maxX === 'number' ? maxX : maxX.getTime();
    const visible = data.filter(d => d.x instanceof Date && d.x.getTime() >= minVal && d.x.getTime() <= maxVal);
    if (!visible.length) return;
    const min = Math.min(...visible.map(d => d.low));
    const max = Math.max(...visible.map(d => d.high));
    if (this.chartComponent && this.chartComponent.primaryYAxis) {
      this.chartComponent.primaryYAxis.minimum = min;
      this.chartComponent.primaryYAxis.maximum = max;
    }
  }

  /**
   * Updates visibleXAxisTicks based on the chart's visible labels.
   */
  public updateVisibleXAxisTicks(): void {
    const chart = this.chartComponent as any;
    if (!chart || !chart.primaryXAxis || !chart.primaryXAxis.visibleLabels) {
      this.visibleXAxisTicks = [];
      return;
    }
    const data = this.candleData;
    const total = data.length;
    const factor = this.zoomFactor;
    const position = this.zoomPosition;
    const startIdx = Math.floor(position * total);
    const endIdx = Math.min(total, Math.ceil(startIdx + factor * total));
    const visible = data.slice(startIdx, endIdx);
    // Map visible label values to candle indices
    const labelDates = chart.primaryXAxis.visibleLabels.map((lbl: any) => lbl.value);
    this.visibleXAxisTicks = visible
      .map((d, idx) => labelDates.includes(d.x.getTime()) ? startIdx + idx : -1)
      .filter(idx => idx !== -1);
  }
}


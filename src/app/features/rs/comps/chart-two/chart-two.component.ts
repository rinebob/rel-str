import { ChangeDetectionStrategy, Component, ViewChild, inject, signal } from '@angular/core';
import { debugLog } from './debug-log.util'; // Debug logging utility
import { parseOhlcCsv } from './csv-parse.util';
import { runRsComparisonUtil } from './rs-compare.util';

import { CommonModule } from '@angular/common';
import { ChartModule, CandleSeriesService, DateTimeService, TooltipService, ZoomService, ChartComponent as SfChartComponent, LegendService } from '@syncfusion/ej2-angular-charts';
import { HttpClient } from '@angular/common/http';
import { compareRsDatasets } from '../../utils/rs-calc-utils-compare';
import { generatePercentChangeData, addColorToRank } from '../../utils/rs-calc-utils';
import { generateColorArray } from '../../utils/color-utils';
import { ChartTwoRsPaneComponent } from './chart-two-rs-pane.component';

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
  imports: [ChartModule, CommonModule, ChartTwoRsPaneComponent],
  providers: [CandleSeriesService, DateTimeService, TooltipService, ZoomService, LegendService],
  templateUrl: './chart-two.component.html',
  styleUrl: './chart-two.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
/**
 * ChartTwoComponent renders a candlestick chart for MSFT using OHLC data parsed from a CSV file in assets/data.
 * Uses Angular's HttpClient and signals for reactive updates.
 */
export class ChartTwoComponent {

  /**
   * Signal for current zoom factor (fraction of chart shown, 0 < zoomFactor <= 1)
   */
  public zoomFactor = signal<number>(1);

  /**
   * Signal for current zoom position (start of zoom window, 0 <= zoomPosition <= 1-zoomFactor)
   */
  public zoomPosition = signal<number>(0);

  /**
   * Chart primaryXAxis config, dynamically updated to prevent bar clipping
   */
  public primaryXAxis: any = {
    valueType: 'DateTime',
    title: 'Date',
    zoomFactor: this.zoomFactor(),
    zoomPosition: this.zoomPosition(),
    plotOffset: 0
  };

  /**
   * Signal for toggling between showing all data and a subset (UI-driven)
   */
  public useDataSubset = signal<boolean>(true);

  /**
   * Handler to toggle data subset usage and reload chart data
   */
  public toggleDataSubset(): void {
    this.useDataSubset.set(!this.useDataSubset());
    this.loadBothCSVsAndCompare();
  }

  /**
   * Returns the RS color array for each day (for the RS pane)
   */
  public get rsColorArray(): string[] {
    return (this.candleData() as CandleWithRSColor[]).map(d => d.rsColor || '#ddd');
  }

  /**
   * Logs the number of visible candlesticks rendered by Syncfusion and the number of RS bars.
   * Helps diagnose alignment issues between RS pane and candlestick chart.
   * Uses debugLog utility.
   */
  private logRenderedCandlesVsRsBars(): void {
    const chart = this.chartComponent as any;
    let visiblePoints: any[] = [];
    if (chart && chart.visibleSeries && chart.visibleSeries[0] && chart.visibleSeries[0].points) {
      visiblePoints = chart.visibleSeries[0].points.filter((pt: any) => pt.visible !== false);
    }
    const rsBars = this.visibleRsColors;
    debugLog('Rendered Candles', {
      candleCount: visiblePoints.length,
      first: visiblePoints[0]?.x,
      last: visiblePoints[visiblePoints.length-1]?.x
    });
    debugLog('RS Pane Bars', {
      rsCount: rsBars.length,
      first: rsBars[0],
      last: rsBars[rsBars.length-1]
    });
  }
  // TODO: Move all debug logging to a dedicated debug service

  /**
   * Returns only the visible RS colors (for zoom/pan sync).
   * Uses the actual x-axis visible range from the chart for precise alignment.
   * Falls back to zoomFactor/zoomPosition if visibleRange is not available.
   */
  public get visibleRsColors(): string[] {
    // Debug: warn if any candle after index 4 is missing rsColor
    const data = this.candleData() as CandleWithRSColor[];
    const missingColors: { index: number; date: Date }[] = [];
    data.forEach((d, i) => {
      if (i > 4 && !d.rsColor) {
        missingColors.push({ index: i, date: d.x });
      }
    });
    if (missingColors.length > 0) {
      // eslint-disable-next-line no-console
      console.warn('[RS DEBUG] Missing rsColor for candles:', missingColors);
    }
    if (!data.length) return [];
    // Try to use Syncfusion visibleRange for exact visible candles
    if (this.chartComponent && this.chartComponent.primaryXAxis && (this.chartComponent.primaryXAxis as any).visibleRange) {
      const min = (this.chartComponent.primaryXAxis as any).visibleRange.min;
      const max = (this.chartComponent.primaryXAxis as any).visibleRange.max;
      const filtered = data.filter(d => {
        const xVal = d.x instanceof Date ? d.x.getTime() : d.x;
        return xVal >= min && xVal <= max;
      });
      // Debug logging
      if (filtered.length > 0) {
        // eslint-disable-next-line no-console
        console.log('[RS DEBUG] visibleRange:', { min, max, count: filtered.length, first: filtered[0].x, last: filtered[filtered.length-1].x });
      } else {
        // eslint-disable-next-line no-console
        console.log('[RS DEBUG] visibleRange:', { min, max, count: 0 });
      }
      return filtered.map(d => d.rsColor || '#ddd');
    }
    // Fallback: use zoomFactor/zoomPosition logic
    const total = data.length;
    const factor = this.zoomFactor();
    const position = this.zoomPosition();
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
    return sliced.map(d => d.rsColor || '#ddd');
  }
  /**
   * Signal holding the parsed OHLC data for the candlestick chart.
   */
  public candleData = signal<Array<{ x: Date, open: number, high: number, low: number, close: number }>>([]);


  /**
   * Signal for tooltip enabled state (persisted in localStorage)
   */
  public tooltipEnabled = signal<boolean>(this.getTooltipPref());

  /**
   * Signals for current min/max y-axis values (autoscales to visible data)
   */
  public yMin = signal<number | null>(null);
  public yMax = signal<number | null>(null);

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


  private readonly http = inject(HttpClient);

  // Signals for QQQ/MSFT parsed data (for RS comparison)
  public qqqData = signal<any[]>([]);
  public msftData = signal<any[]>([]);

  // Signal for RS comparison summary
  public rsComparisonSummary = signal<string>('');

  constructor() {
    this.loadBothCSVsAndCompare();
  }

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
   * Get tooltip preference from localStorage (default: true)
   */
  private getTooltipPref(): boolean {
    const val = localStorage.getItem('rs_charttwo_tooltip');
    return val === null ? true : val === 'true';
  }

  /**
   * Set tooltip preference in localStorage
   */
  private setTooltipPref(enabled: boolean): void {
    localStorage.setItem('rs_charttwo_tooltip', String(enabled));
  }

  /**
   * Toggle tooltip enabled state and persist to localStorage
   */
  public toggleTooltip(): void {
    const next = !this.tooltipEnabled();
    this.tooltipEnabled.set(next);
    this.setTooltipPref(next);
  }

  /**
   * Scroll to the beginning of the chart (show earliest data).
   */
  public scrollToStart(): void {
    this.setZoom(this.zoomFactor(), 0);
  }

  /**
   * Scroll to the end of the chart (show latest data).
   */
  public scrollToEnd(): void {
    const factor = this.zoomFactor();
    this.setZoom(factor, 1 - factor);
  }

  /**
   * Returns the year of the first visible candle (left edge of chart) based on Syncfusion visibleRange,
   * or falls back to the first candle in the visible data if not available.
   */
  public firstVisibleYear(): number | null {
    const data = this.candleData();
    if (!data.length) return null;
    // Try to use Syncfusion visibleRange if chart is available
    if (this.chartComponent && this.chartComponent.primaryXAxis && (this.chartComponent.primaryXAxis as any).visibleRange) {
      const min = (this.chartComponent.primaryXAxis as any).visibleRange.min;
      // Find the first candle whose x (timestamp) >= min
      const first = data.find(d => d.x instanceof Date && d.x.getTime() >= min);
      return first?.x instanceof Date ? first.x.getFullYear() : null;
    }
    // Fallback: use first candle in visible data
    const total = data.length;
    const factor = this.zoomFactor();
    const position = this.zoomPosition();
    const startIdx = Math.floor(position * total);
    const visible = data.slice(startIdx);
    if (!visible.length) return null;
    const first = visible[0];
    return first.x instanceof Date ? first.x.getFullYear() : null;
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
   * Loads and parses the MSFT CSV file from assets/data at runtime.
   * Sets the candleData signal with parsed OHLC data.
   */
  /**
   * Loads both QQQ and MSFT CSVs, parses them, and runs RS comparison on page load.
   */
  private loadBothCSVsAndCompare(): void {
    const msftUrl = '/assets/data/BATS_MSFT, 1D_0d494.csv';
    const qqqUrl = '/assets/data/BATS_QQQ, 1D_862dd.csv';
    // Load both CSVs in parallel
    Promise.all([
      this.http.get(msftUrl, { responseType: 'text' }).toPromise(),
      this.http.get(qqqUrl, { responseType: 'text' }).toPromise()
    ]).then(([msftCsv, qqqCsv]) => {
      // console.log('[RS] Loaded MSFT CSV:', typeof msftCsv, msftCsv?.slice?.(0, 100));
      // console.log('[RS] Loaded QQQ CSV:', typeof qqqCsv, qqqCsv?.slice?.(0, 100));
      if (!msftCsv || !qqqCsv) {
        // console.error('[RS] One or both CSVs are missing or empty.', { msftCsv, qqqCsv });
        this.rsComparisonSummary.set('Error: Missing or empty CSV data');
        return;
      }
      // Parse MSFT using utility
      const msftOhlc = parseOhlcCsv(msftCsv);
      // --- RS Color Mapping ---
      // (Obsolete RS color assignment block removed; RS color assignment is now handled after slicing both datasets to the subset above.)
      // Parse QQQ using utility
      const qqqOhlc = parseOhlcCsv(qqqCsv);

      /**
       * Use subset toggle from signal (UI-driven)
       */
      const USE_CHART_DATA_SUBSET = this.useDataSubset();
      const CHART_DATA_SUBSET_SIZE = 100;

      // Slice both MSFT and QQQ to the subset first
      const msftOhlcToUse = USE_CHART_DATA_SUBSET ? msftOhlc.slice(-CHART_DATA_SUBSET_SIZE) : msftOhlc;
      const qqqOhlcToUse = USE_CHART_DATA_SUBSET ? qqqOhlc.slice(-CHART_DATA_SUBSET_SIZE) : qqqOhlc;

      // RS color assignment should use only the sliced MSFT data
      const msftCloses = msftOhlcToUse.map(d => ({ [d.x.toISOString().slice(0,10)]: d.close }));
      const windowSize = 5;
      const heatmapColors = generateColorArray(11);
      const msftPct = generatePercentChangeData(msftCloses);
      // msftPct.length should be msftOhlcToUse.length - 1
      // We want msftRsColors.length === msftOhlcToUse.length - windowSize
      const msftRsColors = msftPct.slice(windowSize).map(rsObj => addColorToRank(rsObj, heatmapColors));
      if (msftRsColors.length !== msftOhlcToUse.length - windowSize) {
        // eslint-disable-next-line no-console
        console.warn('[RS DEBUG] Mismatch: msftRsColors.length:', msftRsColors.length, 'msftOhlcToUse.length - windowSize:', msftOhlcToUse.length - windowSize);
      }
      // Debug: Log the dates used for RS calculation and for candles
      const rsCalcDates = msftCloses.map(obj => Object.keys(obj)[0]);
      // eslint-disable-next-line no-console
      console.log('[RS DEBUG] Dates used for RS calculation:', rsCalcDates);
      const candleDates = msftOhlcToUse.map(candle => candle.x.toISOString().slice(0, 10));
      // eslint-disable-next-line no-console
      console.log('[RS DEBUG] Dates in candles:', candleDates);
      // Build a date-to-color map from msftRsColors using the date property
      const rsColorMap: Record<string, string> = {};
      msftRsColors.forEach(rs => {
        if (rs.date) {
          rsColorMap[rs.date] = rs.color;
        }
      });
      const rsColorDates = Object.keys(rsColorMap);
      // eslint-disable-next-line no-console
      console.log('[RS DEBUG] Dates in RS color map:', rsColorDates);
      // Assign rsColor by date lookup for chart candles
      const msftColoredOhlcToUse = msftOhlcToUse.map((candle, i) => {
        const dateStr = candle.x.toISOString().slice(0, 10);
        return {
          ...candle,
          rsColor: rsColorMap[dateStr] ?? null
        };
      });
      // Debug: count fallback vs colored bars
      const fallbackCount = msftOhlcToUse.filter(bar => (bar as CandleWithRSColor).rsColor == null).length;
      const coloredCount = msftOhlcToUse.length - fallbackCount;
      debugLog('RS Pane Bars', {
        fallbackCount,
        coloredCount,
        totalCount: msftOhlcToUse.length
      });
      // Set both msftData and candleData to the colored, sliced MSFT data
      this.msftData.set(msftColoredOhlcToUse);
      this.candleData.set(msftColoredOhlcToUse);
      this.qqqData.set(qqqOhlcToUse);

      // --- Debugging logs ---
      // console.log('[RS][DEBUG] msftOhlcToUse length:', msftOhlcToUse.length, 'First:', msftOhlcToUse[0], 'Last:', msftOhlcToUse[msftOhlcToUse.length - 1]);
      // console.log('[RS][DEBUG] qqqOhlcToUse length:', qqqOhlcToUse.length, 'First:', qqqOhlcToUse[0], 'Last:', qqqOhlcToUse[qqqOhlcToUse.length - 1]);
      // console.log('[RS][DEBUG] this.candleData():', this.candleData());
      // console.log('[RS][DEBUG] this.qqqData():', this.qqqData());
      // Dynamically set x-axis maximum to prevent last bar clipping
      const data = this.candleData();
      if (data.length > 0) {
        const lastDate = data[data.length - 1].x;
        // Add a 1-day buffer (adjust if your data uses a different interval)
        const bufferMs = 24 * 60 * 60 * 1000;
        this.primaryXAxis.maximum = new Date(lastDate.getTime() + bufferMs);
      } else {
        this.primaryXAxis.maximum = undefined;
      }
      this.autoscaleYAxis();
      // Run RS comparison
      // console.log('[RS] About to run RS comparison...');
      this.runRsComparison();
    }).catch(err => {
      // eslint-disable-next-line no-console
      // console.error('Failed to load CSVs:', err);
      this.rsComparisonSummary.set('Error: Failed to load CSVs');
    });
  }

  /**
   * Runs RS dataset comparison between QQQ and MSFT and stores a summary for the UI.
   */
  private runRsComparison(): void {
    // Defensive: check data
    const msft = this.msftData();
    const qqq = this.qqqData();
    if (!msft || !Array.isArray(msft) || !msft.length || !qqq || !Array.isArray(qqq) || !qqq.length) {
      console.error('[RS] MSFT or QQQ data missing for RS comparison.', {
        msft,
        qqq,
        msftType: typeof msft,
        qqqType: typeof qqq,
        msftLength: msft ? msft.length : 'n/a',
        qqqLength: qqq ? qqq.length : 'n/a'
      });
      this.rsComparisonSummary.set(`Error: MSFT or QQQ data missing (msft: ${msft ? msft.length : 'n/a'}, qqq: ${qqq ? qqq.length : 'n/a'})`);
      return;
    }
    // --- Debugging logs ---
    console.log('[RS][DEBUG] runRsComparison msftData length:', msft.length, 'Sample:', msft.slice(0, 2));
    console.log('[RS][DEBUG] runRsComparison qqqData length:', qqq.length, 'Sample:', qqq.slice(0, 2));
    // Convert OHLC to close price objects for percent change utility
    const msftCloses = this.msftData().map(d => ({ [d.x.toISOString().slice(0,10)]: d.close }));
    const qqqCloses = this.qqqData().map(d => ({ [d.x.toISOString().slice(0,10)]: d.close }));
    console.log('[RS] msftCloses:', msftCloses.slice(0,5));
    console.log('[RS] qqqCloses:', qqqCloses.slice(0,5));
    // Generate percent change arrays
    const msftPct = generatePercentChangeData(msftCloses);
    const qqqPct = generatePercentChangeData(qqqCloses);
    // Slice off the first 5 elements to align with RS Table logic (rolling window)
    const msftPctWindowed = msftPct.slice(5);
    const qqqPctWindowed = qqqPct.slice(5);
    console.log('[RS] msftPctWindowed:', msftPctWindowed.slice(0,5));
    console.log('[RS] qqqPctWindowed:', qqqPctWindowed.slice(0,5));
    // Generate heatmap color array (11 colors for 0-1)
    const heatmapColors = generateColorArray(11);
    // Run comparison
    const result = compareRsDatasets(qqqPctWindowed, msftPctWindowed, heatmapColors);
    console.log('[RS] RS comparison result:', result);
    // Set summary
    if (result.mismatches.length === 0) {
      this.rsComparisonSummary.set('All results match!');
      console.log('[RS] Set summary: All results match!');
    } else {
      this.rsComparisonSummary.set(`${result.mismatches.length} mismatches found`);
      console.warn(`[RS] Set summary: ${result.mismatches.length} mismatches found`);
    }
  }

  /**
   * Zooms in by halving the visible window (down to a minimum of 5% of the chart).
   */
  public zoomIn(): void {
    let factor = this.zoomFactor();
    if (factor > 0.05) {
      factor = Math.max(0.05, factor / 2);
      this.setZoom(factor, this.zoomPosition());
    }
  }

  /**
   * Zooms out by doubling the visible window (up to a maximum of 100% of the chart).
   */
  public zoomOut(): void {
    let factor = this.zoomFactor();
    factor = Math.min(1, factor * 2);
    this.setZoom(factor, this.zoomPosition());
  }

  /**
   * Resets zoom to show the entire chart.
   */
  public resetZoom(): void {
    this.setZoom(1, 0);
  }

  /**
   * Sets the zoom factor and position, and updates the chart's primaryXAxis.
   * Also triggers y-axis autoscaling and chart data binding.
   * @param factor Fraction of chart to display (0 < factor <= 1)
   * @param position Start position of zoom window (0 <= position <= 1-factor)
   */
  public setZoom(factor: number, position: number): void {
    this.zoomFactor.set(factor);
    this.zoomPosition.set(Math.max(0, Math.min(position, 1 - factor)));
    if (this.chartComponent && this.chartComponent.primaryXAxis) {
      this.chartComponent.primaryXAxis.zoomFactor = this.zoomFactor();
      this.chartComponent.primaryXAxis.zoomPosition = this.zoomPosition();
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
    const data = this.candleData();
    if (!data.length) {
      this.yMin.set(null);
      this.yMax.set(null);
      return;
    }
    // Determine visible range based on zoom
    const total = data.length;
    factor = factor ?? this.zoomFactor();
    position = position ?? this.zoomPosition();
    const startIdx = Math.floor(position * total);
    const endIdx = Math.min(total, Math.ceil(startIdx + factor * total));
    const visible = data.slice(startIdx, endIdx);
    const min = Math.min(...visible.map(d => d.low));
    const max = Math.max(...visible.map(d => d.high));
    this.yMin.set(min);
    this.yMax.set(max);
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
    const data = this.candleData();
    if (!data.length) return;
    let minVal = typeof minX === 'number' ? minX : minX.getTime();
    let maxVal = typeof maxX === 'number' ? maxX : maxX.getTime();
    const visible = data.filter(d => d.x instanceof Date && d.x.getTime() >= minVal && d.x.getTime() <= maxVal);
    if (!visible.length) return;
    const min = Math.min(...visible.map(d => d.low));
    const max = Math.max(...visible.map(d => d.high));
    this.yMin.set(min);
    this.yMax.set(max);
    if (this.chartComponent && this.chartComponent.primaryYAxis) {
      this.chartComponent.primaryYAxis.minimum = min;
      this.chartComponent.primaryYAxis.maximum = max;
    }
  }

  private updateVisibleXAxisTicks(): void {
    const chart = this.chartComponent as any;
    if (!chart || !chart.primaryXAxis || !chart.primaryXAxis.visibleLabels) {
      this.visibleXAxisTicks = [];
      return;
    }
    // Compute visible candles based on zoom factor and position
    const data = this.candleData();
    const total = data.length;
    const factor = this.zoomFactor();
    const position = this.zoomPosition();
    const startIdx = Math.floor(position * total);
    const endIdx = Math.min(total, Math.ceil(startIdx + factor * total));
    const visible = data.slice(startIdx, endIdx);
    const min = Math.min(...visible.map(d => d.low));
    const max = Math.max(...visible.map(d => d.high));
    this.yMin.set(min);
    this.yMax.set(max);
    if (this.chartComponent && this.chartComponent.primaryYAxis) {
      this.chartComponent.primaryYAxis.minimum = min;
      this.chartComponent.primaryYAxis.maximum = max;
    }
  }
}


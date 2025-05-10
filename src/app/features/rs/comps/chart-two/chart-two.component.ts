import { ChangeDetectionStrategy, Component, ViewChild, inject, signal } from '@angular/core';
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
   * Returns the RS color array for each day (for the RS pane)
   */
  public get rsColorArray(): string[] {
    return (this.candleData() as CandleWithRSColor[]).map(d => d.rsColor || '#ddd');
  }

  /**
   * Returns only the visible RS colors (for zoom/pan sync)
   */
  public get visibleRsColors(): string[] {
    const data = this.candleData() as CandleWithRSColor[];
    if (!data.length) return [];
    const total = data.length;
    const factor = this.zoomFactor();
    const position = this.zoomPosition();
    const startIdx = Math.floor(position * total);
    const endIdx = Math.min(total, Math.ceil(startIdx + factor * total));
    return data.slice(startIdx, endIdx).map(d => d.rsColor || '#ddd');
  }
  /**
   * Signal holding the parsed OHLC data for the candlestick chart.
   */
  public candleData = signal<Array<{ x: Date, open: number, high: number, low: number, close: number }>>([]);

  /**
   * Signal for current zoom factor (fraction of chart shown, 0 < zoomFactor <= 1)
   */
  public zoomFactor = signal<number>(1);

  /**
   * Signal for current zoom position (start of zoom window, 0 <= zoomPosition <= 1-zoomFactor)
   */
  public zoomPosition = signal<number>(0);

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
      console.log('[RS] Loaded MSFT CSV:', typeof msftCsv, msftCsv?.slice?.(0, 100));
      console.log('[RS] Loaded QQQ CSV:', typeof qqqCsv, qqqCsv?.slice?.(0, 100));
      if (!msftCsv || !qqqCsv) {
        console.error('[RS] One or both CSVs are missing or empty.', { msftCsv, qqqCsv });
        this.rsComparisonSummary.set('Error: Missing or empty CSV data');
        return;
      }
      // Parse MSFT
      const msftLines = msftCsv.split('\n').filter(Boolean);
      msftLines.shift();
      console.log('[RS] MSFT lines after header:', msftLines.length);
      const msftOhlc = msftLines.map(line => {
        const [timestamp, open, high, low, close] = line.split(',');
        return {
          x: new Date(Number(timestamp) * 1000),
          open: +open,
          high: +high,
          low: +low,
          close: +close
        };
      });
      // --- RS Color Mapping ---
      // 1. Generate percent change arrays for MSFT and QQQ
      const msftCloses = msftOhlc.map(d => ({ [d.x.toISOString().slice(0,10)]: d.close }));
      const qqqCloses = [];
      // We'll fill qqqCloses after parsing QQQ

      const msftPct = generatePercentChangeData(msftCloses);
      // 2. Generate heatmap colors
      const heatmapColors = generateColorArray(11);
      // RS calculation uses a rolling window of 5 (see generateTargetRanksData)
      const windowSize = 5;
      // Only keep candles that have a corresponding RS value
      const msftOhlcRecent = msftOhlc.slice(-100 + windowSize);
      const msftClosesRecent = msftCloses.slice(-100 + windowSize);
      const msftPctRecent = msftPct.slice(-100);
      // Generate RS color data for the most recent 100-windowSize days
      // If you use a compare function, ensure you generate the RS array for this window
      const msftRsColors = msftPctRecent.slice(windowSize).map(rsObj => addColorToRank(rsObj, heatmapColors));
      // Assign RS colors to the sliced MSFT candles by index (guaranteed 1:1)
      const msftColoredOhlcRecent = msftOhlcRecent.map((candle, i) => ({
        ...candle,
        rsColor: msftRsColors[i]?.color
      }));
      this.msftData.set(msftColoredOhlcRecent);
      // Parse QQQ
      const qqqLines = qqqCsv.split('\n').filter(Boolean);
      qqqLines.shift();
      console.log('[RS] QQQ lines after header:', qqqLines.length);
      const qqqOhlc = qqqLines.map(line => {
        const [timestamp, open, high, low, close] = line.split(',');
        return {
          x: new Date(Number(timestamp) * 1000),
          open: +open,
          high: +high,
          low: +low,
          close: +close
        };
      });
      const qqqOhlcRecent = qqqOhlc.slice(-100);
      this.qqqData.set(qqqOhlcRecent);
      this.candleData.set(msftColoredOhlcRecent);
      this.autoscaleYAxis();
      // Run RS comparison
      console.log('[RS] About to run RS comparison...');
      this.runRsComparison();
    }).catch(err => {
      // eslint-disable-next-line no-console
      console.error('Failed to load CSVs:', err);
      this.rsComparisonSummary.set('Error: Failed to load CSVs');
    });
  }

  /**
   * Runs RS dataset comparison between QQQ and MSFT and stores a summary for the UI.
   */
  private runRsComparison(): void {
    // Defensive: check data
    if (!this.msftData() || !this.msftData().length || !this.qqqData() || !this.qqqData().length) {
      console.error('[RS] MSFT or QQQ data missing for RS comparison.', {
        msft: this.msftData(),
        qqq: this.qqqData()
      });
      this.rsComparisonSummary.set('Error: MSFT or QQQ data missing');
      return;
    }
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
   * Zooms out by doubling the visible window (up to a maximum of 1).
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
   * Also triggers y-axis autoscaling.
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
  }

  /**
   * Autoscale y-axis to fit only the data visible in the provided x-range (from Syncfusion visibleRange).
   * Used after pan/zoom events.
   * @param minX minimum visible x (timestamp)
   * @param maxX maximum visible x (timestamp)
   */
  public autoscaleYAxisForRange(minX: number, maxX: number): void {
    const data = this.candleData();
    if (!data.length) {
      this.yMin.set(null);
      this.yMax.set(null);
      return;
    }
    // Filter for only visible data by x (Date.getTime())
    const visible = data.filter(d => {
      const xVal = d.x instanceof Date ? d.x.getTime() : d.x;
      return xVal >= minX && xVal <= maxX;
    });
    if (!visible.length) {
      this.yMin.set(null);
      this.yMax.set(null);
      return;
    }
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

